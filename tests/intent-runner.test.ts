import test from 'node:test';
import assert from 'node:assert/strict';
import { runProjectDiscovery, buildProjectSearchQuery } from '../lib/intent/runner';
import type { ProjectDiscoveryRepository, ProjectPersistPayload, ProjectPersistResult, ProjectRunCapacity } from '../lib/intent/repository';
import { IntentProviderError } from '../lib/intent/tavily';
import type { ProjectEvidence, ProjectSearchResult } from '../lib/intent/types';
import type { ClaimedRun, Reservation } from '../lib/prospecting/repository';
import type { DurableStep } from '../lib/prospecting/runner';
import { defaultProspectingConfig } from '../lib/prospecting/types';

// All requests and provider results are isolated fixtures. No network is used.
const ownerId = 'b91915bc-1660-42ee-8dd8-204f27b3b8c9';
const runId = '30f02189-5451-40f6-8c05-560c2702ac55';
const input = { ownerId, runId, executionId: 'fixture-execution' };
const step: DurableStep = { async run(_id, task) { return task(); }, async sleep() {} };
const today = new Date().toISOString().slice(0, 10);
const future = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
function project(url = 'https://procurement.buyerboard.org/notices/website-project'): ProjectSearchResult {
  return {
    title: 'Request for proposals: website development', url, publishedDate: today,
    rawContent: `Request for proposals: website development\nBuyer: Fixture Council\nCountry: United States\nPublished: ${today}\nDeadline: ${future}\nWe are seeking an external development agency to design and develop our website. Please submit a proposal for this project.`,
  };
}
function evidence(result = project()): ProjectEvidence {
  return {
    version: 1, title: result.title,
    requestText: 'We are seeking an external development agency to design and develop our website.',
    service: 'website', sourceUrl: result.url, platform: new URL(result.url).hostname,
    publishedAt: `${today}T00:00:00.000Z`, publishedDateText: `Published: ${today}`,
    deadlineAt: `${future}T23:59:59.999Z`, deadlineText: `Deadline: ${future}`,
    countryCode: 'US', countryEvidence: 'Country: United States', buyerName: 'Fixture Council',
  };
}
function fixture() {
  process.env.AUTOMATION_OWNER_ID = ownerId;
  const state = {
    claimed: true, allowed: true, finished: false, calls: [] as string[],
    config: { ...structuredClone(defaultProspectingConfig), discoveryMode: 'project_requests' as const,
      enabled: true, countries: ['US'], keywords: ['website development'], services: ['website', 'application'] as ('website' | 'application')[],
      maxAgeDays: 30, lawfulBasis: 'Reviewing public buyer requests and their published response process.' },
    results: [project()],
    capacity: { allowed: true, reason: null } as ProjectRunCapacity,
    reservation: null as Reservation | null,
    ledger: new Map<string, { status: 'reserved' | 'completed' | 'failed'; result?: unknown }>(),
    candidates: new Map<string, string>(),
    persisted: [] as ProjectPersistPayload[],
    persistedUrls: new Set<string>(),
    persistOverride: null as ProjectPersistResult | null,
    finishStatus: '', finishThrows: false, providerPauses: false,
    searchIndex: 0, cursors: {} as Record<string, number>, nextSearchIndex: -1, nextCursors: {} as Record<string, number>,
  };
  const repository: ProjectDiscoveryRepository = {
    async claim(_owner, _run, claimToken) {
      return state.claimed && !state.finished ? {
        config: state.config, config_version: 1, search_index: state.searchIndex, cursors: state.cursors, claim_token: claimToken,
        run: { id: runId, owner_id: ownerId, status: 'running', request_count: state.ledger.size },
      } as ClaimedRun : null;
    },
    async active() { return { allowed: state.allowed }; },
    async capacity() { return state.capacity; },
    async reserve(_owner, _run, _token, operation, provider) {
      state.calls.push(`reserve:${provider}`);
      if (state.reservation) return state.reservation;
      const previous = state.ledger.get(operation);
      if (previous) return previous.status === 'completed' ? { status: 'cached', result: previous.result } : { status: 'uncertain' };
      state.ledger.set(operation, { status: 'reserved' });
      return { status: 'reserved' };
    },
    async complete(_owner, _run, _token, operation, result, error) {
      state.ledger.set(operation, { status: error ? 'failed' : 'completed', result });
    },
    async recordCandidate(_owner, _run, _token, url, status) {
      if (!state.allowed) return { status: 'paused' };
      const previous = state.candidates.get(url);
      if (previous === 'saved' || previous === 'rejected') return { status: 'existing', candidate_status: previous };
      state.candidates.set(url, status);
      return { status: previous ? 'existing' : 'created', candidate_status: status };
    },
    async persist(_owner, _run, _token, payload) {
      if (!state.allowed) return { status: 'paused' };
      if (state.persistOverride) return state.persistOverride;
      if (state.persistedUrls.has(payload.evidence.sourceUrl)) return { status: 'duplicate' };
      state.persistedUrls.add(payload.evidence.sourceUrl); state.persisted.push(payload);
      return { status: 'saved', request_id: `fixture-request-${state.persisted.length}` };
    },
    async finish(_owner, _run, _token, status, _counts, _message, _code, nextIndex, cursors) {
      state.finishStatus = status;
      state.nextSearchIndex = nextIndex ?? -1; state.nextCursors = cursors ?? {};
      if (state.finishThrows) { state.finishThrows = false; throw new Error('Fixture completion unavailable'); }
      state.finished = true; return true;
    },
  };
  const provider = {
    async search() {
      state.calls.push('search');
      if (state.providerPauses) state.allowed = false;
      return { results: state.results };
    },
  };
  return { state, repository, provider, dependencies: { repository, provider, ready: () => true } };
}

test('project workflow saves a cited development request without inventing contact information', async () => {
  const { state, dependencies } = fixture();
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.status, 'completed'); assert.equal(result.leadsSaved, 1);
  assert.deepEqual(state.calls, ['reserve:tavily', 'search']);
  assert.equal(state.persisted[0].evidence.service, 'website');
  assert.ok(state.persisted[0].sourceText.includes(state.persisted[0].evidence.requestText));
  assert.equal(state.persisted[0].evidence.platform, 'procurement.buyerboard.org');
  assert.match(state.persisted[0].discoveryQuery, /request for proposals/);
  assert.equal('email' in state.persisted[0], false);
  assert.equal('searchHistory' in state.persisted[0].evidence, false);
});

test('project discovery preserves source-published contact identity alongside requirement evidence', async () => {
  const { state, repository, dependencies } = fixture();
  repository.supportsContacts = async () => true;
  state.results[0].rawContent += '\nProject contact: Nora Buyer\nEmail: nora@buyerboard.org';
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.leadsSaved, 1);
  assert.deepEqual(state.persisted[0].contact, {
    contactName: 'Nora Buyer', contactEmail: 'nora@buyerboard.org', contactSourceUrl: state.results[0].url,
  });
  assert.ok(state.persisted[0].evidence.requestText);
});

test('migration 006 discovery remains compatible while optional contact storage is unavailable', async () => {
  const { state, repository, dependencies } = fixture();
  repository.supportsContacts = async () => false;
  state.results[0].rawContent += '\nProject contact: Nora Buyer\nEmail: nora@buyerboard.org';
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.leadsSaved, 1);
  assert.equal('contact' in state.persisted[0], false);
});

test('an unsupported contact never causes the useful project requirement to be lost', async () => {
  const { state, repository, dependencies } = fixture();
  repository.supportsContacts = async () => true;
  state.results[0].rawContent += '\nProject contact: Nora Buyer\nEmail: nora@buyerboard.org';
  const originalPersist = repository.persist;
  let attempts = 0;
  repository.persist = async (...args) => {
    attempts++;
    return args[3].contact ? { status: 'contact_evidence_required' } : originalPersist(...args);
  };
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.leadsSaved, 1);
  assert.equal(attempts, 2);
  assert.equal('contact' in state.persisted[0], false);
  assert.match(result.message, /contact evidence was incomplete/);
  assert.equal(state.calls.filter(value => value === 'search').length, 1, 'Contact handling must not repeat paid searches.');
});

test('an enabled legacy company-discovery config cannot make a new provider request', async () => {
  const { state, dependencies } = fixture();
  delete (state.config as Partial<typeof state.config>).discoveryMode;
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.status, 'cancelled'); assert.equal(result.errorCode, 'configuration');
  assert.deepEqual(state.calls, []);
});

test('a paused configuration, missing collection basis, or missing readiness makes no paid search', async () => {
  for (const variant of ['paused', 'basis', 'readiness']) {
    const { state, dependencies } = fixture();
    if (variant === 'paused') state.config.enabled = false;
    if (variant === 'basis') state.config.lawfulBasis = '';
    const result = await runProjectDiscovery(input, step, { ...dependencies, ready: () => variant !== 'readiness' });
    assert.ok(['failed', 'cancelled'].includes(result.status)); assert.deepEqual(state.calls, []);
  }
});

test('daily saved-request capacity prevents paying for another search', async () => {
  const { state, dependencies } = fixture();
  state.capacity = { allowed: false, reason: 'daily_lead_limit' };
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.status, 'completed'); assert.equal(result.errorCode, 'daily_lead_limit');
  assert.deepEqual(state.calls, []); assert.match(result.message, /No paid project search/);
});

test('daily API capacity and atomic reservation limits both stop before the provider', async () => {
  for (const stage of ['preflight', 'reservation']) {
    const { state, dependencies } = fixture();
    if (stage === 'preflight') state.capacity = { allowed: false, reason: 'daily_request_limit' };
    else state.reservation = { status: 'budget_exhausted' };
    const result = await runProjectDiscovery(input, step, dependencies);
    assert.equal(result.errorCode, 'daily_request_limit'); assert.ok(!state.calls.includes('search'));
  }
});

test('an uncertain prior paid search is never repeated', async () => {
  const { state, dependencies } = fixture(); state.reservation = { status: 'uncertain' };
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'request_uncertain');
  assert.ok(!state.calls.includes('search')); assert.equal(state.persisted.length, 0);
});

test('a cached response for a different app query cannot be relabelled or cause another paid search', async () => {
  const { state, dependencies } = fixture();
  state.ledger.set('public-project-search', { status: 'completed', result: { query: 'A different historical search', page: { results: [project()] } } });
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.errorCode, 'request_uncertain'); assert.equal(state.persisted.length, 0);
  assert.ok(!state.calls.includes('search'));
});

test('pause is checked both before search and after an in-flight search returns', async () => {
  for (const inFlight of [false, true]) {
    const { state, dependencies } = fixture();
    if (inFlight) state.providerPauses = true; else state.allowed = false;
    const result = await runProjectDiscovery(input, step, dependencies);
    assert.equal(result.status, 'cancelled'); assert.equal(state.persisted.length, 0);
    assert.equal(state.calls.includes('search'), inFlight);
  }
});

test('duplicate result URLs are checked once and different projects from one platform remain separate', async () => {
  const { state, dependencies } = fixture();
  const other = project('https://procurement.buyerboard.org/notices/second-website-project');
  state.results = [project(), project(), other];
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.leadsSaved, 2); assert.equal(state.persisted.length, 2); assert.equal(result.skippedCount, 1);
  assert.equal(new Set(state.persisted.map(saved => saved.evidence.sourceUrl)).size, 2);
});

test('company marketing, employment posts, and engine-only publication dates cannot become project inquiries', async () => {
  const { state, dependencies } = fixture();
  state.results = [
    { ...project('https://agencyboard.org/services'), title: 'Website development services', rawContent: `Published: ${today}\nCountry: United States\nWe are a website development agency. Hire us to build your website.` },
    { ...project('https://employmentboard.org/job/one'), title: 'Full-time website developer job', rawContent: `Published: ${today}\nCountry: United States\nWe are hiring a full-time website developer. Salary and employee benefits are available. Apply for this employment position.` },
    { ...project('https://procurement.buyerboard.org/notices/undated'), rawContent: 'Country: United States\nWe are seeking an external development agency to design and develop our website. Please submit a proposal for this project.' },
  ];
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.status, 'completed'); assert.equal(result.leadsSaved, 0); assert.equal(result.skippedCount, 3);
  assert.equal(state.persisted.length, 0);
  assert.match(result.message, /supplier marketing: 1/); assert.match(result.message, /employment: 1/);
  assert.match(result.message, /missing source date: 1/); assert.ok(result.message.length <= 500);
});

test('source identity and exact quote are rechecked before passing evidence to the database', async () => {
  for (const tamper of ['url', 'quote']) {
    const { state, dependencies } = fixture();
    const extracted = evidence();
    if (tamper === 'url') extracted.sourceUrl = 'https://anotherbuyer.org/project';
    else extracted.requestText = 'An invented project requirement that is absent from the source';
    const result = await runProjectDiscovery(input, step, { ...dependencies, qualify: () => ({ qualified: true, evidence: extracted }) });
    assert.equal(result.leadsSaved, 0); assert.equal(state.persisted.length, 0);
  }
});

test('provider failures are static checkpoint outcomes without repeating a paid operation', async () => {
  const { state, dependencies } = fixture();
  const result = await runProjectDiscovery(input, step, { ...dependencies, provider: { async search() {
    state.calls.push('search'); throw new IntentProviderError('authentication');
  } } });
  assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'authentication');
  assert.match(result.message, /TAVILY_API_KEY/); assert.equal(state.calls.filter(call => call === 'search').length, 1);
  assert.equal([...state.ledger.values()][0].status, 'failed');
});

test('a durable retry after a saved request reuses checkpoints and avoids a second save or paid search', async () => {
  const { state, dependencies } = fixture(); state.finishThrows = true;
  const checkpoints = new Map<string, unknown>();
  const durable: DurableStep = { async run(id, task) {
    if (checkpoints.has(id)) return checkpoints.get(id) as Awaited<ReturnType<typeof task>>;
    const value = await task(); checkpoints.set(id, structuredClone(value)); return value;
  }, async sleep() {} };
  await assert.rejects(runProjectDiscovery(input, durable, dependencies), /Fixture completion/);
  const result = await runProjectDiscovery(input, durable, dependencies);
  assert.equal(result.leadsSaved, 1); assert.equal(state.persisted.length, 1);
  assert.equal(state.calls.filter(call => call === 'search').length, 1);
});

test('a fresh recovery execution reuses the database search result and respects source URL deduplication', async () => {
  const { state, dependencies } = fixture(); state.finishThrows = true;
  await assert.rejects(runProjectDiscovery(input, step, dependencies), /Fixture completion/);
  const result = await runProjectDiscovery({ ...input, executionId: 'replacement-execution' }, step, dependencies);
  assert.equal(result.status, 'completed'); assert.equal(state.persisted.length, 1);
  assert.equal(state.calls.filter(call => call === 'search').length, 1);
});

test('recovery replays an already-paid search after that run reached a daily cap', async () => {
  const { state, dependencies } = fixture(); state.finishThrows = true;
  const checkpoints = new Map<string, unknown>();
  const durable: DurableStep = { async run(id, task) {
    if (checkpoints.has(id)) return checkpoints.get(id) as Awaited<ReturnType<typeof task>>;
    const value = await task(); checkpoints.set(id, structuredClone(value)); return value;
  }, async sleep() {} };
  await assert.rejects(runProjectDiscovery(input, durable, dependencies), /Fixture completion/);
  state.capacity = { allowed: false, reason: 'daily_lead_limit' };
  const result = await runProjectDiscovery(input, durable, dependencies);
  assert.equal(result.status, 'completed'); assert.equal(result.leadsSaved, 1);
  assert.equal(state.persisted.length, 1); assert.equal(state.calls.filter(call => call === 'search').length, 1);
});

test('the transactional saved-request limit stops processing additional search results', async () => {
  const { state, dependencies } = fixture();
  state.results.push(project('https://procurement.buyerboard.org/notices/second-project'));
  state.persistOverride = { status: 'daily_limit' };
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.status, 'completed'); assert.equal(result.errorCode, 'daily_lead_limit');
  assert.equal(state.candidates.size, 1); assert.equal(state.persisted.length, 0);
});

test('an event for another owner cannot even claim work or make provider requests', async () => {
  const { state, dependencies } = fixture();
  await assert.rejects(runProjectDiscovery({ ...input, ownerId: '0c4b42e7-ce23-4c47-a6ae-afdece876a88' }, step, dependencies), /not bound/);
  assert.deepEqual(state.calls, []);
});

test('search query targets explicit buyer requests and does not pretend to capture buyer search history', () => {
  const query = buildProjectSearchQuery('US', 'website development');
  assert.match(query, /"United States"/); assert.match(query, /request for proposals/);
  assert.ok(query.length <= 400);
  assert.throws(() => buildProjectSearchQuery('IN', 'website development'));
  assert.throws(() => buildProjectSearchQuery('US', 'a'));
  assert.ok(!query.includes('"website development"'), 'Generic development targeting must also find redesign, WordPress and Shopify requests.');
  assert.match(query, /WordPress OR Shopify/);
  assert.match(buildProjectSearchQuery('US', 'website development', 1), /looking for/);
});

test('one run covers all four default country/service combinations inside its total result limit', async () => {
  const { state, dependencies } = fixture();
  state.config.countries = ['US', 'GB']; state.config.keywords = ['website development', 'application development'];
  const searches: { query: string; limit: number; maxAgeDays: number }[] = [];
  const result = await runProjectDiscovery(input, step, { ...dependencies, provider: { async search(request) {
    searches.push(request);
    return { results: Array.from({ length: request.limit }, (_, index) => project(`https://procurement.buyerboard.org/notices/query-${searches.length}-${index}`)) };
  } } });
  assert.equal(result.status, 'completed'); assert.equal(searches.length, 4);
  assert.equal(new Set(searches.map(search => search.query)).size, 4);
  assert.equal(searches.filter(search => search.query.includes('"United States"')).length, 2);
  assert.equal(searches.filter(search => search.query.includes('"United Kingdom"')).length, 2);
  assert.equal(searches.reduce((sum, search) => sum + search.limit, 0), state.config.companiesPerRun);
  assert.equal(result.companiesFound, state.config.companiesPerRun);
  assert.equal(result.leadsSaved, state.config.companiesPerRun);
  assert.equal(result.requestsUsed, 4); assert.equal(state.ledger.size, 4);
  assert.equal(state.nextSearchIndex, 0); assert.equal(state.nextCursors.publicQueryRound, 1);
  assert.match(result.message, /4 queries/);
});

test('coverage rotates wording and partitions without exceeding a small per-run review limit', async () => {
  const { state, dependencies } = fixture();
  state.config.countries = ['US', 'GB']; state.config.keywords = ['website development', 'application development'];
  state.config.companiesPerRun = 3; state.searchIndex = 3; state.cursors = { publicQueryRound: 1 };
  const searches: { query: string; limit: number }[] = [];
  const result = await runProjectDiscovery(input, step, { ...dependencies, provider: { async search(request) {
    searches.push(request); return { results: [project(`https://procurement.buyerboard.org/notices/round-${searches.length}`)] };
  } } });
  assert.equal(searches.length, 3); assert.ok(searches.every(search => search.limit === 1));
  assert.match(searches[0].query, /looking for/); assert.match(searches[1].query, /request for proposals/);
  assert.equal(result.companiesFound, 3); assert.equal(state.nextSearchIndex, 2);
  assert.equal(state.nextCursors.publicQueryRound, 0);
});

test('a cap reached by an earlier query stops the remaining paid searches', async () => {
  const { state, repository, dependencies } = fixture();
  state.config.countries = ['US', 'GB'];
  repository.capacity = async () => state.persisted.length ? { allowed: false, reason: 'daily_lead_limit' } : { allowed: true };
  const result = await runProjectDiscovery(input, step, dependencies);
  assert.equal(result.status, 'completed'); assert.equal(result.errorCode, 'daily_lead_limit');
  assert.equal(result.leadsSaved, 1); assert.equal(state.calls.filter(call => call === 'search').length, 1);
  assert.equal(state.nextSearchIndex, 1, 'A completed capped run advances past the query it already reviewed.');
});

test('multi-query recovery reuses every exact paid-query checkpoint rather than charging again', async () => {
  const { state, dependencies } = fixture(); state.finishThrows = true;
  state.config.countries = ['US', 'GB']; state.config.keywords = ['website development', 'application development'];
  let paidSearches = 0;
  const provider = { async search() {
    paidSearches++; return { results: [project(`https://procurement.buyerboard.org/notices/checkpoint-${paidSearches}`)] };
  } };
  await assert.rejects(runProjectDiscovery(input, step, { ...dependencies, provider }), /Fixture completion/);
  assert.equal(paidSearches, 4);
  const result = await runProjectDiscovery({ ...input, executionId: 'multi-query-recovery' }, step, { ...dependencies, provider });
  assert.equal(result.status, 'completed'); assert.equal(paidSearches, 4);
  assert.equal(state.persisted.length, 4); assert.equal(state.ledger.size, 4);
});
