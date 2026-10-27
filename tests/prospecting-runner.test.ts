import test from 'node:test';
import assert from 'node:assert/strict';
import { runProspecting, hasRecentVerification, normalizeProspectDomain, type DurableStep } from '../lib/prospecting/runner';
import { RepositoryError, type ClaimedRun, type PersistPayload, type ProspectingRepository, type Reservation } from '../lib/prospecting/repository';
import { defaultProspectingConfig, type CompanyFacts, type EmailVerification, type FoundContact } from '../lib/prospecting/types';
import { getProspectingReadiness, serviceRoleConfiguration } from '../lib/prospecting/server-config';
import { ProviderError } from '../lib/prospecting/hunter';

const ownerId = '126569da-aab7-443a-9471-cd48be2bbef8';
const runId = 'b86dcf7a-d42a-46b4-bb01-cbbfd039f67d';
const input = { ownerId, runId, executionId: 'event-1' };
const facts: CompanyFacts = { domain: 'agency.com', name: 'An agency', description: 'A web design agency creating Figma websites.', industry: 'Design', countryCode: 'US', country: 'United States', timeZone: null, employeeCount: 12, tags: ['web design'] };
const contact: FoundContact = { email: 'owner@agency.com', firstName: 'One', lastName: 'Owner', role: 'Founder', confidence: 90, provenance: 'found', sources: [{ uri: 'https://agency.com/team', lastSeenOn: new Date().toISOString() }] };
const verified: EmailVerification = { status: 'valid', checkedAt: new Date().toISOString(), acceptAll: false, webmail: false, disposable: false };
const step: DurableStep = { async run(_id, task) { return task(); }, async sleep() {} };

function fixture() {
  process.env.AUTOMATION_OWNER_ID = ownerId;
  const state = {
    allowed: true, claimed: true, suppressed: false, existing: false, reclaimProcessing: false,
    contacts: [structuredClone(contact)], facts: structuredClone(facts) as CompanyFacts | null,
    verification: structuredClone(verified), persisted: [] as PersistPayload[],
    calls: [] as string[], ledger: new Map<string, { status: 'reserved'|'completed'; result?: unknown }>(),
    candidates: new Map<string, { run_id: string; status: string }>(),
    reservationOverride: null as Reservation | null, finishThrows: false,
    config: { ...structuredClone(defaultProspectingConfig), enabled: true, countries: ['US'], keywords: ['web design agency'], lawfulBasis: 'Relevant business partnership research.' },
    finishStatus: '' as string,
  };
  const repository: ProspectingRepository = {
    async claim(_owner, _run, token) {
      if (!state.claimed) return null;
      return { config: state.config, search_index: 0, cursors: {}, claim_token: token, config_version: 1, run: { id: runId, owner_id: ownerId, status: 'running' } } as ClaimedRun;
    },
    async active() { return { allowed: state.allowed }; },
    async reserve(_owner, _run, _token, operation) {
      if (state.reservationOverride) return state.reservationOverride;
      const previous = state.ledger.get(operation);
      if (previous) return previous.status === 'completed' ? { status: 'cached', result: previous.result } : { status: 'uncertain' };
      state.ledger.set(operation, { status: 'reserved' }); return { status: 'reserved' };
    },
    async complete(_owner, _run, _token, operation, result, error) { state.ledger.set(operation, { status: error ? 'reserved' : 'completed', result }); },
    async candidate(_owner, domain) { return state.candidates.get(domain) ?? null; },
    async recordCandidate(_owner, _run, _token, domain, status) {
      if (!state.allowed) return { status: 'paused' };
      const existing = state.candidates.get(domain);
      if (existing && existing.run_id !== runId) {
        if (existing.status !== 'processing' || !state.reclaimProcessing) return { status: 'existing', candidate_status: existing.status, run_id: existing.run_id };
        state.candidates.set(domain, { run_id: runId, status });
        return { status: 'reclaimed', candidate_status: status, run_id: runId };
      }
      state.candidates.set(domain, { run_id: runId, status }); return { status: 'created', candidate_status: status, run_id: runId };
    },
    async suppressed() { return state.suppressed; }, async existingEmail() { return state.existing; },
    async suppress() { state.suppressed = true; },
    async persist(_owner, _run, _token, payload) {
      if (!state.allowed) return { status: 'paused' };
      state.persisted.push(payload); state.existing = true;
      state.candidates.set(payload.company.domain, { run_id: runId, status: 'saved' });
      return { status: 'saved', lead_id: 'saved-id' };
    },
    async finish(_owner, _run, _token, status) {
      state.finishStatus = status;
      if (state.finishThrows) { state.finishThrows = false; throw new RepositoryError(); }
      return true;
    },
  };
  const provider = {
    async discover() { state.calls.push('discover'); return { companies: [{ domain: 'agency.com', name: 'Agency' }], total: 1, nextOffset: null }; },
    async enrichCompany() { state.calls.push('enrich'); return state.facts; },
    async domainSearch() { state.calls.push('contacts'); return state.contacts; },
    async verifyEmail() { state.calls.push('verify'); return state.verification; },
  };
  return { state, repository, provider, dependencies: { repository, provider, ready: () => true } };
}

test('the real workflow reserves every provider call and saves only sourced verified prospects', async () => {
  const { state, dependencies } = fixture();
  const result = await runProspecting(input, step, dependencies);
  assert.equal(result.status, 'completed'); assert.equal(result.leadsSaved, 1);
  assert.deepEqual(state.calls, ['discover', 'enrich', 'contacts', 'verify']);
  assert.equal(state.ledger.size, 4); assert.equal(state.persisted.length, 1);
  assert.equal(state.persisted[0].contact.provenance, 'found');
  assert.equal(state.persisted[0].verification.checkedAt, verified.checkedAt);
  assert.ok(state.persisted[0].score.score >= 65); assert.equal(state.persisted[0].aiDraft, null);
});

test('unknown and excluded actual company countries stop before finding or verifying contacts', async () => {
  for (const countryCode of ['', 'IN', 'CA']) {
    const { state, dependencies } = fixture(); state.facts!.countryCode = countryCode;
    const result = await runProspecting(input, step, dependencies);
    assert.equal(result.leadsSaved, 0); assert.deepEqual(state.calls, ['discover', 'enrich']);
  }
});

test('inferred, unsourced, foreign-domain, duplicate and suppressed contacts never reach verification', async () => {
  for (const change of [
    (s: ReturnType<typeof fixture>['state']) => { s.contacts[0].provenance = 'inferred'; },
    (s: ReturnType<typeof fixture>['state']) => { s.contacts[0].sources = []; },
    (s: ReturnType<typeof fixture>['state']) => { s.contacts[0].email = 'owner@elsewhere.com'; },
    (s: ReturnType<typeof fixture>['state']) => { s.suppressed = true; },
    (s: ReturnType<typeof fixture>['state']) => { s.existing = true; },
  ]) {
    const { state, dependencies } = fixture(); change(state);
    await runProspecting(input, step, dependencies);
    assert.equal(state.calls.includes('verify'), false); assert.equal(state.persisted.length, 0);
  }
});

test('risky, stale and undated verifier results cannot create a lead', async () => {
  for (const verification of [
    { ...verified, status: 'accept_all' as const }, { ...verified, status: 'unknown' as const },
    { ...verified, acceptAll: true }, { ...verified, checkedAt: null },
    { ...verified, checkedAt: new Date(Date.now() - 32 * 86400_000).toISOString() },
  ]) {
    const { state, dependencies } = fixture(); state.verification = verification;
    await runProspecting(input, step, dependencies); assert.equal(state.persisted.length, 0);
  }
});

test('a provider removal request adds suppression and cannot create a lead', async () => {
  const { state, dependencies } = fixture(); state.verification.status = 'claimed';
  await runProspecting(input, step, dependencies);
  assert.equal(state.suppressed, true); assert.equal(state.persisted.length, 0);
});

test('a pending verifier result is checked again after a durable delay and can qualify', async () => {
  const { state, dependencies, provider } = fixture(); const sleeps: number[] = [];
  let attempts = 0;
  provider.verifyEmail = async () => {
    state.calls.push('verify'); attempts++;
    return attempts === 1 ? { ...verified, status: 'pending', checkedAt: null } : verified;
  };
  const result = await runProspecting(input, { ...step, async sleep(_id, milliseconds) { sleeps.push(milliseconds); } }, dependencies);
  assert.equal(result.leadsSaved, 1); assert.deepEqual(sleeps, [20_000]);
  assert.equal(state.calls.filter(call => call === 'verify').length, 2);
  assert.equal([...state.ledger.keys()].filter(key => key.startsWith('verify:')).length, 2);
});

test('pending verification polling is bounded and leaves unfinished work reclaimable', async () => {
  const { state, dependencies } = fixture(); const sleeps: number[] = [];
  state.verification = { ...verified, status: 'pending', checkedAt: null };
  const result = await runProspecting(input, { ...step, async sleep(_id, milliseconds) { sleeps.push(milliseconds); } }, dependencies);
  assert.equal(result.leadsSaved, 0); assert.deepEqual(sleeps, [20_000, 20_000]);
  assert.equal(state.calls.filter(call => call === 'verify').length, 3);
  assert.equal(state.candidates.get('agency.com')?.status, 'processing');
  assert.match(result.message, /Verification remains pending/);
});

test('pausing during the durable verifier wait prevents the follow-up paid call', async () => {
  const { state, dependencies } = fixture(); state.verification = { ...verified, status: 'pending', checkedAt: null };
  const result = await runProspecting(input, { ...step, async sleep() { state.allowed = false; } }, dependencies);
  assert.equal(result.status, 'cancelled'); assert.equal(state.persisted.length, 0);
  assert.equal(state.calls.filter(call => call === 'verify').length, 1);
});

test('pausing during an in-flight provider request prevents subsequent calls and saving', async () => {
  const { state, provider, dependencies } = fixture();
  provider.verifyEmail = async () => { state.calls.push('verify'); state.allowed = false; return state.verification; };
  const result = await runProspecting(input, step, dependencies);
  assert.equal(result.status, 'cancelled'); assert.equal(state.persisted.length, 0);
});

test('a budget cap or uncertain paid request stops before contacting the provider', async () => {
  for (const status of ['budget_exhausted', 'uncertain'] as const) {
    const { state, dependencies } = fixture(); state.reservationOverride = { status };
    const result = await runProspecting(input, step, dependencies);
    assert.deepEqual(state.calls, []); assert.equal(state.persisted.length, 0);
    assert.equal(result.status, status === 'budget_exhausted' ? 'completed' : 'failed');
  }
});

test('companies seen in an earlier run do not incur more enrichment and verification requests', async () => {
  const { state, dependencies } = fixture();
  state.candidates.set('agency.com', { run_id: 'earlier-run', status: 'skipped' });
  await runProspecting(input, step, dependencies);
  assert.deepEqual(state.calls, ['discover']); assert.equal(state.persisted.length, 0);
});

test('unfinished processing candidates can be reclaimed from a terminal earlier run', async () => {
  const { state, dependencies } = fixture();
  state.candidates.set('agency.com', { run_id: 'failed-earlier-run', status: 'processing' });
  state.reclaimProcessing = true;
  const result = await runProspecting(input, step, dependencies);
  assert.equal(result.leadsSaved, 1); assert.deepEqual(state.calls, ['discover', 'enrich', 'contacts', 'verify']);
  assert.equal(state.candidates.get('agency.com')?.run_id, runId);
});

test('processing candidates owned by another active run cannot be reclaimed by the worker', async () => {
  const { state, dependencies } = fixture();
  state.candidates.set('agency.com', { run_id: 'running-earlier-run', status: 'processing' });
  await runProspecting(input, step, dependencies);
  assert.deepEqual(state.calls, ['discover']); assert.equal(state.persisted.length, 0);
  assert.equal(state.candidates.get('agency.com')?.run_id, 'running-earlier-run');
});

test('durable replay after saving preserves decisions and never repeats a paid call or lead insert', async () => {
  const { state, dependencies } = fixture(); const checkpoints = new Map<string, unknown>();
  const durable: DurableStep = { async sleep() {}, async run(id, task) {
    if (checkpoints.has(id)) return checkpoints.get(id) as never;
    const value = await task(); checkpoints.set(id, structuredClone(value)); return value;
  } };
  state.finishThrows = true;
  await assert.rejects(runProspecting(input, durable, dependencies), RepositoryError);
  assert.equal(state.existing, true);
  const result = await runProspecting(input, durable, dependencies);
  assert.equal(result.leadsSaved, 1); assert.equal(state.calls.length, 4); assert.equal(state.persisted.length, 1);
});

test('a new scheduler execution skips terminal candidates from the same database run', async () => {
  const { state, dependencies } = fixture(); state.finishThrows = true;
  await assert.rejects(runProspecting(input, step, dependencies), RepositoryError);
  assert.equal(state.candidates.get('agency.com')?.status, 'saved');
  const result = await runProspecting({ ...input, executionId: 'recovery-execution' }, step, dependencies);
  assert.equal(result.status, 'completed'); assert.equal(result.leadsSaved, 0);
  assert.equal(state.calls.length, 4); assert.equal(state.persisted.length, 1);
  assert.equal(state.candidates.get('agency.com')?.status, 'saved');
});

test('recovery binds cached verification to the exact email when eligibility selects another contact', async () => {
  const { state, dependencies, repository, provider } = fixture();
  state.contacts.push({ ...structuredClone(contact), email: 'second@agency.com' });
  const verifiedEmails: string[] = [];
  provider.verifyEmail = async (email?: string) => {
    verifiedEmails.push(email!);
    return { ...state.verification, status: email === contact.email ? 'valid' : 'unknown' };
  };
  const persist = repository.persist;
  repository.persist = async () => { throw new RepositoryError(); };
  state.finishThrows = true;
  await assert.rejects(runProspecting(input, step, dependencies), RepositoryError);
  assert.equal(state.candidates.get('agency.com')?.status, 'processing');
  // Another process added the first contact while this execution was interrupted.
  repository.existingEmail = async (_owner, email) => email === contact.email;
  repository.persist = persist;
  await runProspecting({ ...input, executionId: 'recovery-execution' }, step, dependencies);
  assert.deepEqual(verifiedEmails, ['owner@agency.com', 'second@agency.com']);
  assert.equal([...state.ledger.keys()].filter(key => key.startsWith('verify:')).length, 2);
  assert.equal(state.persisted.length, 0);
});

test('API failures use static messages and do not repeat the failed request', async () => {
  const { state, provider, dependencies } = fixture();
  provider.discover = async () => { state.calls.push('discover'); throw new ProviderError('authentication'); };
  const result = await runProspecting(input, step, dependencies);
  assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'authentication');
  assert.match(result.message, /configured API credential/); assert.deepEqual(state.calls, ['discover']);
});

test('optional AI runs after qualification and persists a review-only draft', async () => {
  const { state, dependencies } = fixture(); state.config.aiEnabled = true;
  const result = await runProspecting(input, step, { ...dependencies, aiReady: () => true,
    ai: async () => { state.calls.push('ai'); return { text: 'Supplied provider facts.', status: 'pending_approval' }; } });
  assert.equal(result.leadsSaved, 1); assert.equal(state.calls.at(-1), 'ai');
  assert.equal(state.persisted[0].aiDraft?.status, 'pending_approval');
});

test('an optional AI failure is visible while qualified provider facts remain usable', async () => {
  const { state, dependencies } = fixture(); state.config.aiEnabled = true;
  const result = await runProspecting(input, step, { ...dependencies, aiReady: () => true,
    ai: async () => { throw new ProviderError('unavailable'); } });
  assert.equal(result.leadsSaved, 1); assert.equal(state.persisted[0].aiDraft, null);
  assert.match(result.message, /AI drafts were unavailable/);
});

test('an event for another workspace cannot claim a run or spend provider credits', async () => {
  const { state, dependencies } = fixture();
  await assert.rejects(runProspecting({ ...input, ownerId: 'f08bf680-aef0-4d7d-9540-668421029d98' }, step, dependencies), /not bound/);
  assert.deepEqual(state.calls, []);
});

test('verification date bounds and domain normalization reject ambiguous or local values', () => {
  const now = Date.now();
  assert.equal(hasRecentVerification({ ...verified, checkedAt: new Date(now - 30 * 86400_000).toISOString() }, now), true);
  assert.equal(hasRecentVerification({ ...verified, checkedAt: new Date(now + 2 * 86400_000).toISOString() }, now), false);
  assert.equal(normalizeProspectDomain('https://www.agency.com/team'), 'agency.com');
  for (const value of ['localhost', '127.0.0.1', 'https://name:password@agency.com', 'https://agency.com:8888', 'fake.invalid']) assert.equal(normalizeProspectDomain(value), null);
});

test('server credentials and optional AI readiness are fail-closed without exposing secret values', () => {
  const names = ['NODE_ENV', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'HUNTER_API_KEY', 'INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY', 'INNGEST_DEV', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'];
  const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real-project.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_public-value';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_publishable_public-value'; assert.equal(serviceRoleConfiguration().ready, false);
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_' + 'x'.repeat(40); process.env.HUNTER_API_KEY = 'a'.repeat(40);
    process.env.INNGEST_EVENT_KEY = 'event-' + 'x'.repeat(40); process.env.INNGEST_SIGNING_KEY = 'signkey-' + 'x'.repeat(40);
    delete process.env.INNGEST_DEV; Object.assign(process.env, { NODE_ENV: 'production' });
    const config = { ...defaultProspectingConfig, lawfulBasis: 'Relevant business partnership research.' };
    assert.equal(getProspectingReadiness(ownerId, config).ready, true);
    delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_MODEL;
    assert.equal(getProspectingReadiness(ownerId, { ...config, aiEnabled: true }).ready, false);
    process.env.INNGEST_DEV = '1'; assert.equal(getProspectingReadiness(ownerId, config).ready, false);
    assert.doesNotMatch(JSON.stringify(getProspectingReadiness(ownerId, config)), /sb_secret_|signkey-|event-xxx/);
  } finally { for (const name of names) { if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name]; } }
});
