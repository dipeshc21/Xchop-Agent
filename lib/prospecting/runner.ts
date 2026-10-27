import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HunterClient, ProviderError } from './hunter';
import { scoreProspect } from './scoring';
import { aiSummaryConfiguration, createCompanySummaryDraft } from './ai';
import { assertAutomationOwner, getProspectingReadiness } from './server-config';
import { createProspectingRepository, RepositoryError, type PersistPayload, type ProspectingRepository } from './repository';
import { prospectingConfigSchema, type CompanyFacts, type DiscoveryPage, type EmailVerification, type FitScore, type FoundContact } from './types';

export type DurableStep = {
  run<T>(id: string, callback: () => Promise<T>): Promise<T>;
  sleep(id: string, milliseconds: number): Promise<void>;
};
export type ProspectingSummary = {
  status: 'completed'|'failed'|'cancelled'|'skipped'; companiesFound: number;
  leadsSaved: number; skippedCount: number; requestsUsed: number; errorCode: string | null; message: string;
};
type Provider = {
  discover(input: { countryCode: string; keywords: string[]; limit: number; offset: number }): Promise<DiscoveryPage>;
  enrichCompany(domain: string): Promise<CompanyFacts | null>;
  domainSearch(domain: string): Promise<FoundContact[]>;
  verifyEmail(email: string): Promise<EmailVerification>;
};
type Dependencies = {
  repository?: ProspectingRepository; provider?: Provider;
  ready?: () => boolean; aiReady?: () => boolean;
  score?: (facts: CompanyFacts, contact: FoundContact, verification: EmailVerification, targets: string[]) => FitScore;
  ai?: (facts: CompanyFacts, prompt: string) => Promise<{ text: string; status: 'pending_approval' }>;
};
class StopRun extends Error {
  constructor(readonly code: string, readonly status: 'failed'|'cancelled'|'completed', message: string) { super(message); }
}
const messages: Record<string, string> = {
  configuration: 'Automatic discovery needs its server connections configured.',
  authentication: 'Hunter rejected the configured API credential. Check the server settings.',
  plan: 'Your Hunter plan does not support this discovery or enrichment request. Review your plan or turn off pagination.',
  pagination: 'Hunter pagination is unavailable for this query or plan. Turn off pagination and review coverage.',
  quota: 'Hunter credits are exhausted. Discovery stopped without retrying paid requests.',
  rate_limit: 'Hunter asked discovery to slow down. This run stopped; no automatic paid request retry was made.',
  unavailable: 'The provider is unavailable. This run stopped without repeating the request.',
  invalid_response: 'The provider returned incomplete information. Discovery stopped safely.',
  invalid_input: 'A provider request could not be validated.',
  database: 'Discovery could not safely save progress. Check the database setup before running again.',
  request_uncertain: 'A previous request may have reached the provider but has no saved result. It was not repeated to avoid duplicate charges.',
};
function safeCode(error: unknown) {
  return error instanceof ProviderError && Object.hasOwn(messages, error.code) ? error.code
    : error instanceof RepositoryError ? 'database' : 'unavailable';
}
export function normalizeProspectDomain(value: string): string | null {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    const domain = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ||
      /\.(?:example|test|invalid|local|localhost)$/.test(domain)) return null;
    return domain;
  } catch { return null; }
}
function eligibleContact(contact: FoundContact, domain: string) {
  if (!z.email().safeParse(contact.email).success) return false;
  const emailDomain = contact.email.toLowerCase().split('@')[1];
  return (emailDomain === domain || emailDomain.endsWith(`.${domain}`)) &&
    contact.provenance === 'found' && contact.sources.length > 0;
}
function identityKey(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function hasRecentVerification(verification: EmailVerification, now = Date.now()) {
  if (!verification.checkedAt) return false;
  const checkedAt = Date.parse(verification.checkedAt);
  // Hunter can return a cached verifier result up to one month old; preserve its actual date.
  return Number.isFinite(checkedAt) && checkedAt <= now + 5 * 60_000 && checkedAt >= now - 31 * 24 * 60 * 60_000;
}
/** Each paid request is a separate durable step, backed by a transactional request ledger.
 * Dependencies are injectable for tests only; HTTP handlers never accept a provider or host. */
export async function runProspecting(
  input: { ownerId: string; runId: string; executionId: string },
  step: DurableStep,
  dependencies: Dependencies = {},
): Promise<ProspectingSummary> {
  assertAutomationOwner(input.ownerId);
  const summary: ProspectingSummary = { status: 'skipped', companiesFound: 0, leadsSaved: 0, skippedCount: 0, requestsUsed: 0, errorCode: null, message: 'The run is already complete or another worker owns it.' };
  // A claim uses an event-stable token and is refreshed on function retry, never memoized.
  const token = createHash('sha256').update(`${input.runId}:${input.executionId}`).digest('hex');
  const repository = dependencies.repository ?? createProspectingRepository();
  const claim = await repository.claim(input.ownerId, input.runId, token);
  if (!claim) return summary;
  const runId = input.runId, ownerId = input.ownerId;
  let nextSearchIndex = claim.search_index ?? 0;
  let nextCursors: Record<string, number> = { ...(claim.cursors ?? {}) };
  let aiFailures = 0;
  let pendingVerifications = 0;
  async function active() {
    const status = await repository.active(ownerId, runId, token);
    if (!status.allowed) throw new StopRun('paused', 'cancelled', 'Discovery was paused, its settings changed, or this worker lease ended. No more paid requests were made.');
  }
  async function paid<T>(operation: string, provider: string, callback: () => Promise<T>): Promise<T> {
    const result = await step.run(`request:${operation}`, async (): Promise<
      { ok: true; value: T } | { ok: false; code: string; status: 'failed'|'cancelled'|'completed'; message: string }
    > => {
      try {
        await active();
        const reservation = await repository.reserve(ownerId, runId, token, operation, provider);
        if (reservation.status === 'cached') return { ok: true, value: reservation.result as T };
        if (reservation.status === 'budget_exhausted') throw new StopRun('daily_request_limit', 'completed', 'The daily API request cap was reached. Discovery will wait for the next scheduled run.');
        if (reservation.status === 'paused') throw new StopRun('paused', 'cancelled', 'Discovery was paused or its settings changed.');
        if (reservation.status !== 'reserved') throw new StopRun('request_uncertain', 'failed', messages.request_uncertain);
        let response: T;
        try { response = await callback(); }
        catch (error) {
          const code = safeCode(error);
          await repository.complete(ownerId, runId, token, operation, null, code);
          throw new StopRun(code, 'failed', messages[code]);
        }
        // If this write fails, the reserved entry deliberately prevents a second paid call.
        await repository.complete(ownerId, runId, token, operation, response);
        return { ok: true, value: response };
      } catch (error) {
        // Expected provider/limit outcomes are checkpoint data, not failed Inngest steps.
        if (error instanceof StopRun) return { ok: false, code: error.code, status: error.status, message: error.message };
        throw error;
      }
    });
    if (!result.ok) throw new StopRun(result.code, result.status, result.message);
    summary.requestsUsed++;
    return result.value;
  }
  async function mark(domain: string, status: string, reason: string) {
    const result = await step.run(`mark:${identityKey(domain)}`, () => repository.recordCandidate(ownerId, runId, token, domain, status, reason));
    if (result.status === 'paused') throw new StopRun('paused', 'cancelled', 'Discovery was paused or its settings changed.');
    summary.skippedCount++;
  }
  try {
    const parsed = prospectingConfigSchema.safeParse(claim.config);
    if (!parsed.success || !parsed.data.enabled || parsed.data.lawfulBasis.trim().length < 10) {
      throw new StopRun('paused', 'cancelled', 'Discovery is paused or a collection basis has not been recorded.');
    }
    const config = parsed.data;
    if (!(dependencies.ready?.() ?? getProspectingReadiness(ownerId, config).ready)) throw new StopRun('configuration', 'failed', messages.configuration);
    const provider = dependencies.provider ?? new HunterClient(process.env.HUNTER_API_KEY!.trim());
    const scorer = dependencies.score ?? scoreProspect;
    const partitions = config.countries.flatMap(countryCode => config.keywords.map(keyword => ({ countryCode, keyword })));
    const partitionIndex = Math.max(0, claim.search_index ?? 0) % partitions.length;
    const partition = partitions[partitionIndex];
    const queryKey = `${partition.countryCode}|${partition.keyword}`;
    const offset = config.paginationEnabled ? Math.max(0, Math.min(10000, claim.cursors?.[queryKey] ?? 0)) : 0;
    const page = await paid('discover', 'hunter', () => provider.discover({ countryCode: partition.countryCode, keywords: [partition.keyword], limit: config.companiesPerRun, offset }));
    summary.companiesFound = page.companies.length;
    const unique = new Set<string>();
    for (const match of page.companies.slice(0, config.companiesPerRun)) {
      await active();
      const domain = normalizeProspectDomain(match.domain);
      if (!domain || unique.has(domain)) { summary.skippedCount++; continue; }
      unique.add(domain);
      const domainKey = identityKey(domain);
      const candidate = await step.run(`candidate:${domainKey}`, async () => {
        const previous = await repository.candidate(ownerId, domain);
        // A fresh scheduler execution has no Inngest checkpoints. Never reopen a terminal
        // candidate. The database can transfer unfinished work from a terminal earlier run,
        // while preserving the request ledger within each individual run.
        if (previous && previous.status !== 'processing') return { status: 'seen' };
        const recorded = await repository.recordCandidate(ownerId, runId, token, domain, 'processing');
        if (recorded.status === 'paused' || recorded.status === 'created' || recorded.status === 'reclaimed' ||
          (recorded.status === 'existing' && recorded.run_id === runId)) return recorded;
        return { status: 'seen' };
      });
      if (candidate.status === 'paused') throw new StopRun('paused', 'cancelled', 'Discovery was paused or its settings changed.');
      if (candidate.status === 'seen') { summary.skippedCount++; continue; }
      const facts = await paid(`company:${domainKey}`, 'hunter', () => provider.enrichCompany(domain));
      if (!facts || normalizeProspectDomain(facts.domain) !== domain || !config.countries.includes(facts.countryCode) || facts.countryCode === 'IN') {
        await mark(domain, 'skipped', 'The company’s actual country was missing or outside the selected markets.'); continue;
      }
      const contacts = await paid(`contacts:${domainKey}`, 'hunter', () => provider.domainSearch(domain));
      const selected = await step.run(`contact:${domainKey}`, async () => {
        for (const found of contacts) {
          const contact = { ...found, email: found.email.trim().toLowerCase() };
          if (!eligibleContact(contact, domain)) continue;
          if (await repository.suppressed(ownerId, contact.email) || await repository.existingEmail(ownerId, contact.email)) continue;
          return contact;
        }
        return null;
      });
      if (!selected) { await mark(domain, 'skipped', 'No found business contact with public sources was eligible.'); continue; }
      const contact = selected;
      // Suppression or an existing record can change the selected contact on recovery.
      // Bind verifier cache identity to the exact normalized email, never only its domain.
      const emailKey = identityKey(contact.email);
      async function verify(attempt: number) {
        return paid(`verify:${domainKey}:${emailKey}:${attempt}`, 'hunter', async () => {
          // Each delayed step repeats suppression immediately before paying to verify.
          if (await repository.suppressed(ownerId, contact.email) || await repository.existingEmail(ownerId, contact.email)) return null;
          return provider.verifyEmail(contact.email);
        });
      }
      let verification = await verify(0);
      // HTTP 202 means Hunter is actively checking this mailbox. Poll twice with durable
      // sleeps; every follow-up is separately reserved and obeys the same pause/budget gate.
      for (let attempt = 1; verification?.status === 'pending' && attempt <= 2; attempt++) {
        await step.sleep(`verification-wait:${domainKey}:${emailKey}:${attempt}`, 20_000);
        await active();
        verification = await verify(attempt);
      }
      if (!verification) { await mark(domain, 'skipped', 'The contact was already present or suppressed.'); continue; }
      if (verification.status === 'claimed') {
        await step.run(`suppress:${domainKey}:${identityKey(contact.email)}`, () => repository.suppress(ownerId, contact.email));
        await mark(domain, 'skipped', 'The contact requested removal at the provider and was added to do-not-contact.'); continue;
      }
      if (verification.status === 'pending') {
        // Leave unfinished work reclaimable by a future run instead of permanently
        // discarding a mailbox just because the provider has not finished checking it.
        await mark(domain, 'processing', 'Email verification is still pending after the bounded follow-up checks.');
        pendingVerifications++; continue;
      }
      if (verification.status !== 'valid' || verification.disposable !== false || verification.webmail !== false || verification.acceptAll !== false || !hasRecentVerification(verification)) {
        await mark(domain, ['unknown', 'pending', 'accept_all'].includes(verification.status) ? 'needs_review' : 'skipped', 'Email verification did not confirm a valid business mailbox.'); continue;
      }
      const score = scorer(facts, contact, verification, config.countries);
      if (score.score < config.minScore) { await mark(domain, 'skipped', 'Company fit was below your minimum score.'); continue; }
      let aiDraft: PersistPayload['aiDraft'] = null;
      if (config.aiEnabled && (dependencies.aiReady?.() ?? aiSummaryConfiguration().ready)) {
        try {
          const draft = await paid(`ai:${domainKey}`, 'anthropic', () => (dependencies.ai ?? createCompanySummaryDraft)(facts, config.aiPrompt));
          aiDraft = { summary: draft.text, status: 'pending_approval', prompt: config.aiPrompt };
        } catch (error) {
          // Optional AI failure never replaces provider facts or bypasses a kill switch/budget.
          if (error instanceof StopRun && ['paused', 'daily_request_limit', 'request_uncertain'].includes(error.code)) throw error;
          aiFailures++;
        }
      }
      await active();
      const saved = await step.run(`save:${domainKey}`, () => repository.persist(ownerId, runId, token, {
        company: facts, contact, verification, score, lawfulBasis: config.lawfulBasis, aiDraft,
      }));
      if (saved.status === 'saved') summary.leadsSaved++;
      else if (saved.status === 'paused') throw new StopRun('paused', 'cancelled', 'Discovery was paused or its settings changed before saving.');
      else if (saved.status === 'daily_limit') throw new StopRun('daily_lead_limit', 'completed', 'The daily new-lead cap was reached. Discovery will wait for its next scheduled run.');
      else { await mark(domain, 'skipped', saved.status === 'suppressed' ? 'The contact was suppressed before saving.' : 'The contact was already present or did not pass final database checks.'); }
    }
    await active();
    nextSearchIndex = (partitionIndex + 1) % partitions.length;
    nextCursors = { ...(claim.cursors ?? {}), [queryKey]: config.paginationEnabled && page.nextOffset !== null ? Math.min(10000, page.nextOffset) : 0 };
    summary.status = 'completed';
    summary.message = config.paginationEnabled
      ? 'Discovery completed. Only verified business contacts in your selected markets were saved for review.'
      : 'Discovery completed using the first result page only. Queries rotate between runs; already-seen companies are skipped. Full market coverage is not guaranteed.';
    if (aiFailures) summary.message += ` Optional AI drafts were unavailable for ${aiFailures} qualified ${aiFailures === 1 ? 'company' : 'companies'}; provider facts were saved without an AI draft.`;
    if (pendingVerifications) summary.message += ` Verification remains pending for ${pendingVerifications} ${pendingVerifications === 1 ? 'company' : 'companies'}; unfinished checks can resume in a future run.`;
  } catch (error) {
    summary.status = error instanceof StopRun ? error.status : 'failed';
    summary.errorCode = error instanceof StopRun ? error.code : safeCode(error);
    summary.message = error instanceof StopRun ? error.message : messages[summary.errorCode] ?? messages.unavailable;
  }
  await repository.finish(ownerId, runId, token, summary.status,
    { companies_found: summary.companiesFound, skipped_count: summary.skippedCount }, summary.message, summary.errorCode, nextSearchIndex, nextCursors);
  return summary;
}
