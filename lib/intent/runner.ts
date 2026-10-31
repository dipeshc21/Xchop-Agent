import { createHash } from 'node:crypto';
import { RepositoryError } from '../prospecting/repository';
import { assertAutomationOwner, getProspectingReadiness } from '../prospecting/server-config';
import { countryNames, prospectingConfigSchema } from '../prospecting/types';
import type { DurableStep, ProspectingSummary } from '../prospecting/runner';
import { normalizeProjectUrl, qualifyProjectRequest } from './evidence';
import { createProjectDiscoveryRepository, type ProjectDiscoveryRepository } from './repository';
import { IntentProviderError, TavilyClient } from './tavily';
import type { ProjectQualification, ProjectSearchPage, ProjectSearchResult } from './types';

type ProjectSearchProvider = { search(input: { query: string; limit: number; maxAgeDays: number }): Promise<ProjectSearchPage> };
type Dependencies = {
  repository?: ProjectDiscoveryRepository;
  provider?: ProjectSearchProvider;
  ready?: () => boolean;
  qualify?: (result: ProjectSearchResult, options: { countries: string[]; services: ('website' | 'application')[]; maxAgeDays: number; now?: Date }) => ProjectQualification;
};
class StopProjectRun extends Error {
  constructor(readonly code: string, readonly status: 'failed' | 'cancelled' | 'completed', message: string) { super(message); }
}
const messages: Record<string, string> = {
  configuration: 'Configure public project-request search and apply database migration 006 before enabling discovery.',
  authentication: 'Tavily rejected the server API credential. Check TAVILY_API_KEY in your hosting settings.',
  quota: 'The public-search account reached its credit allowance. This run stopped without repeating its search.',
  rate_limit: 'The search provider asked discovery to slow down. This run stopped without repeating its search.',
  unavailable: 'Public project search is unavailable. This run stopped without repeating its search.',
  invalid_response: 'The search provider returned an incomplete response. No unsupported project requirement was saved.',
  invalid_input: 'The project-request search could not be validated. Check the targeting settings.',
  database: 'Discovery could not safely save its progress. Check database migration 006 before running again.',
  request_uncertain: 'A search may have reached the provider but has no recorded result. It was not repeated automatically.',
};
const omissionLabels: Record<string, string> = {
  unsafe_source: 'unsafe source', missing_content: 'no source text', not_buyer_request: 'no buyer request',
  service_mismatch: 'other service', employment: 'employment', supplier_marketing: 'supplier marketing',
  closed: 'closed request', missing_date: 'missing source date', stale: 'old source date', expired: 'expired deadline',
  country_unknown: 'no buyer country', country_excluded: 'outside target country', duplicate: 'duplicate request',
  evidence_required: 'missing evidence', service_excluded: 'other service', invalid: 'final validation',
};
function safeErrorCode(error: unknown): string {
  if (error instanceof IntentProviderError && Object.hasOwn(messages, error.code)) return error.code;
  return error instanceof RepositoryError ? 'database' : 'unavailable';
}
function identity(value: string) { return createHash('sha256').update(value).digest('hex'); }

/** This is the app's search query, never a record of the prospective buyer's search history. */
export function buildProjectSearchQuery(countryCode: string, keyword: string) {
  const country = countryNames[countryCode];
  const phrase = keyword.replace(/[\u0000-\u001f\u007f"\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!country || phrase.length < 3 || phrase.length > 100) throw new StopProjectRun('invalid_input', 'failed', messages.invalid_input);
  return `"${phrase}" ("request for proposals" OR "seeking an agency" OR "looking for a development team" OR tender) "${country}" -careers -salary -tutorial -course`;
}

/**
 * Public project requests replace broad company/contact discovery. Every saved requirement
 * must come from source text; no private searches, emails, or AI-generated needs are created.
 */
export async function runProjectDiscovery(
  input: { ownerId: string; runId: string; executionId: string },
  step: DurableStep,
  dependencies: Dependencies = {},
): Promise<ProspectingSummary> {
  assertAutomationOwner(input.ownerId);
  const summary: ProspectingSummary = {
    status: 'skipped', companiesFound: 0, leadsSaved: 0, skippedCount: 0,
    requestsUsed: 0, errorCode: null, message: 'This request search is complete or another worker owns its lease.',
  };
  const repository = dependencies.repository ?? createProjectDiscoveryRepository();
  const token = identity(`${input.runId}:${input.executionId}`);
  // Refresh the lease on each retry rather than restoring a stale checkpointed claim.
  const claim = await repository.claim(input.ownerId, input.runId, token);
  if (!claim) return summary;
  const ownerId = input.ownerId, runId = input.runId;
  let nextSearchIndex = claim.search_index ?? 0;
  const omissions = new Map<string, number>();
  function omit(reason: string) {
    const safeReason = Object.hasOwn(omissionLabels, reason) ? reason : 'invalid';
    omissions.set(safeReason, (omissions.get(safeReason) ?? 0) + 1);
    summary.skippedCount++;
  }
  async function active() {
    const state = await repository.active(ownerId, runId, token);
    if (!state.allowed) throw new StopProjectRun('paused', 'cancelled', 'Discovery was paused, its targeting changed, or this worker lease ended. No more search requests or saves were made.');
  }
  async function search(query: string, call: () => Promise<ProjectSearchPage>) {
    // One search is allowed per immutable run. Bind its recorded response to the
    // exact app query, including recovery after a deployment changed query code.
    const operation = 'public-project-search';
    const outcome = await step.run(`request:${operation}`, async (): Promise<
      { ok: true; page: ProjectSearchPage } | { ok: false; status: 'failed' | 'cancelled' | 'completed'; code: string; message: string }
    > => {
      try {
        await active();
        const reservation = await repository.reserve(ownerId, runId, token, operation, 'tavily');
        if (reservation.status === 'cached') {
          const cached = reservation.result as { query?: unknown; page?: ProjectSearchPage } | null;
          if (!cached || cached.query !== query || !Array.isArray(cached.page?.results)) {
            throw new StopProjectRun('request_uncertain', 'failed', 'The recorded search does not match this execution’s query. It was not repeated automatically.');
          }
          return { ok: true, page: cached.page };
        }
        if (reservation.status === 'paused') throw new StopProjectRun('paused', 'cancelled', 'Project discovery was paused or its targeting changed.');
        if (reservation.status === 'budget_exhausted') throw new StopProjectRun('daily_request_limit', 'completed', 'The daily API-request cap was reached. No additional project search was made.');
        if (reservation.status !== 'reserved') throw new StopProjectRun('request_uncertain', 'failed', messages.request_uncertain);
        let page: ProjectSearchPage;
        try { page = await call(); }
        catch (error) {
          const code = safeErrorCode(error);
          await repository.complete(ownerId, runId, token, operation, null, code);
          throw new StopProjectRun(code, 'failed', messages[code]);
        }
        // A failed completion deliberately leaves an uncertain reservation. A fresh
        // execution must not repeat a potentially already-paid search.
        await repository.complete(ownerId, runId, token, operation, { query, page });
        return { ok: true, page };
      } catch (error) {
        if (error instanceof StopProjectRun) return { ok: false, code: error.code, status: error.status, message: error.message };
        throw error;
      }
    });
    if (!outcome.ok) throw new StopProjectRun(outcome.code, outcome.status, outcome.message);
    summary.requestsUsed++;
    return outcome.page;
  }
  async function mark(sourceUrl: string, status: 'processing' | 'rejected' | 'saved', reason?: string) {
    const recorded = await step.run(`candidate:${identity(sourceUrl)}:${status}`, () => repository.recordCandidate(ownerId, runId, token, sourceUrl, status, reason));
    if (recorded.status === 'paused') throw new StopProjectRun('paused', 'cancelled', 'Project discovery was paused or its targeting changed before saving.');
    return recorded;
  }
  try {
    // Do not silently reinterpret an already-enabled legacy Hunter configuration.
    if ((claim.config as { discoveryMode?: unknown }).discoveryMode !== 'project_requests') {
      throw new StopProjectRun('configuration', 'cancelled', 'Legacy company discovery is paused. Apply migration 006, save project-request targeting, and enable discovery explicitly.');
    }
    const parsed = prospectingConfigSchema.safeParse(claim.config);
    if (!parsed.success || !parsed.data.enabled || parsed.data.lawfulBasis.trim().length < 10) {
      throw new StopProjectRun('paused', 'cancelled', 'Project discovery is paused or its collection basis has not been recorded.');
    }
    const config = parsed.data;
    if (!(dependencies.ready?.() ?? getProspectingReadiness(ownerId, config).ready)) throw new StopProjectRun('configuration', 'failed', messages.configuration);
    await active();
    const capacity = await repository.capacity(ownerId, runId, token);
    // A recovered run may already own its paid search reservation. Its cached
    // response can be replayed even when that request/save reached today's cap.
    // Reserve/persist still enforce the cap before any new charge or insert.
    const canReplayAtCap = claim.run.request_count > 0 && ['daily_lead_limit', 'daily_request_limit'].includes(capacity.reason ?? '');
    if (!capacity.allowed && !canReplayAtCap) {
      if (capacity.reason === 'daily_lead_limit') throw new StopProjectRun('daily_lead_limit', 'completed', 'The daily saved-request cap was already reached. No paid project search was made.');
      if (capacity.reason === 'daily_request_limit') throw new StopProjectRun('daily_request_limit', 'completed', 'The daily API-request cap was already reached. No paid project search was made.');
      throw new StopProjectRun('paused', 'cancelled', 'Project discovery was paused or this worker lease ended.');
    }
    const partitions = config.countries.flatMap(countryCode => config.keywords.map(keyword => ({ countryCode, keyword })));
    const partitionIndex = Math.max(0, claim.search_index ?? 0) % partitions.length;
    const partition = partitions[partitionIndex];
    const query = buildProjectSearchQuery(partition.countryCode, partition.keyword);
    const provider = dependencies.provider ?? new TavilyClient(process.env.TAVILY_API_KEY?.trim() ?? '');
    const page = await search(query, () => provider.search({ query, limit: config.companiesPerRun, maxAgeDays: config.maxAgeDays }));
    const qualify = dependencies.qualify ?? qualifyProjectRequest;
    const seen = new Set<string>();
    for (const result of page.results.slice(0, config.companiesPerRun)) {
      await active();
      const sourceUrl = normalizeProjectUrl(result.url);
      if (!sourceUrl) { omit('unsafe_source'); continue; }
      if (seen.has(sourceUrl)) { omit('duplicate'); continue; }
      seen.add(sourceUrl);
      summary.companiesFound++;
      await mark(sourceUrl, 'processing');
      const qualification = await step.run(`qualify:${identity(sourceUrl)}`, async () => qualify(result, {
        countries: config.countries, services: config.services, maxAgeDays: config.maxAgeDays,
      }));
      if (!qualification.qualified) {
        await mark(sourceUrl, 'rejected', qualification.reason);
        omit(qualification.reason); continue;
      }
      // The qualifier must bind the extracted quote and origin to the same canonical result.
      if (qualification.evidence.sourceUrl !== sourceUrl || !result.rawContent.includes(qualification.evidence.requestText)) {
        await mark(sourceUrl, 'rejected', 'evidence_required'); omit('evidence_required'); continue;
      }
      await active();
      const saved = await step.run(`save:${identity(sourceUrl)}`, () => repository.persist(ownerId, runId, token, {
        evidence: qualification.evidence, sourceText: result.rawContent, discoveryQuery: query,
      }));
      if (saved.status === 'paused') throw new StopProjectRun('paused', 'cancelled', 'Project discovery was paused before saving a request.');
      if (saved.status === 'daily_limit') throw new StopProjectRun('daily_lead_limit', 'completed', 'The daily saved-request cap was reached. Remaining search results were not saved.');
      if (saved.status === 'saved') { summary.leadsSaved++; await mark(sourceUrl, 'saved'); }
      else { await mark(sourceUrl, 'rejected', saved.status); omit(saved.status); }
    }
    await active();
    nextSearchIndex = (partitionIndex + 1) % partitions.length;
    summary.status = 'completed';
    const counts = [...omissions].map(([reason, count]) => `${omissionLabels[reason]}: ${count}`).join('; ');
    summary.message = `Public project-request search finished.${counts ? ` Omitted — ${counts}.` : ''} Saved requests require literal development, date, and country evidence. Review the original request's availability before responding.`.slice(0, 500);
  } catch (error) {
    summary.status = error instanceof StopProjectRun ? error.status : 'failed';
    summary.errorCode = error instanceof StopProjectRun ? error.code : safeErrorCode(error);
    summary.message = error instanceof StopProjectRun ? error.message : messages[summary.errorCode] ?? messages.unavailable;
  }
  // The SQL function recomputes historical request/save counters from immutable audit
  // rows. Browser run history reads those values, not the checkpoint replay counters.
  await repository.finish(ownerId, runId, token, summary.status,
    { companies_found: summary.companiesFound, skipped_count: summary.skippedCount },
    summary.message, summary.errorCode, nextSearchIndex, {});
  return summary;
}
