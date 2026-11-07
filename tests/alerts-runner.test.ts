import test from 'node:test';
import assert from 'node:assert/strict';
import { getAlertReadiness, runAlertFeeds, type AlertRepository } from '../lib/alerts/runner';
import { AlertImportError, type AlertEntry, type AlertFeedSource } from '../lib/alerts/types';

const owner = '10100000-0000-4000-8000-000000000001';
const other = '10100000-0000-4000-8000-000000000002';
const now = new Date('2026-11-07T10:00:00.000Z');
const source = (suffix = '1', resource: AlertFeedSource['resource_type'] = 'google_alerts'): AlertFeedSource => ({
  id: `10100000-0000-4000-8100-00000000000${suffix}`, owner_id: owner,
  resource_type: resource, title: resource === 'google_alerts' ? 'Google Alerts' : 'LinkedIn posts via Google Alerts',
  feed_url: `https://www.google.com/alerts/feeds/123/${suffix}`, enabled: true, version: 1,
});
const atom = (url = 'https://buyer.org/request') => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Website rebuild request</title><updated>${now.toISOString()}</updated><link rel="alternate" href="${url}"/><content>We need a web development agency to rebuild our website.</content></entry></feed>`;
function fixture() {
  process.env.AUTOMATION_OWNER_ID = owner;
  const state = { migration: true, available: true, paused: false, sources: [source()], fetched: [] as string[], entries: [] as AlertEntry[], finish: [] as { status: string; counts: { entries_seen: number; skipped_count: number }; error: string | null }[], seen: new Set<string>(), persistenceError: false };
  const repo: AlertRepository = {
    async ready() { return state.migration; },
    async sources(account) { assert.equal(account, owner); return state.sources; },
    async claim(account, sourceId, token, force) {
      assert.equal(account, owner); assert.equal(token.length, 64); assert.equal(force, true);
      return state.available ? { source: state.sources.find(item => item.id === sourceId)!, run_id: '10100000-0000-4000-8200-000000000001', claim_token: token } : null;
    },
    async persist(account, _source, _token, entry) {
      assert.equal(account, owner);
      if (state.paused) return { status: 'paused' };
      if (state.persistenceError) throw new AlertImportError('DATABASE_UNAVAILABLE');
      if (state.seen.has(entry.source_url)) return { status: 'duplicate' };
      state.seen.add(entry.source_url); state.entries.push(entry);
      return { status: 'saved', lead_id: '10100000-0000-4000-8300-000000000001' };
    },
    async finish(_owner, _source, _token, status, counts, error) { state.finish.push({ status, counts, error }); return true; },
  };
  const run = (body = atom()) => runAlertFeeds({ ownerId: owner, executionId: 'fixture-execution', force: true }, {
    repository: repo, now, readiness: () => ({ ready: true }), fetchFeed: async url => { state.fetched.push(url); return body; },
  });
  return { state, repo, run };
}

test('imports evidenced public requests without Hunter, invented contacts or source-page fetches', async () => {
  const { state, run } = fixture();
  const result = await run();
  assert.equal(result.status, 'completed'); assert.equal(result.saved, 1);
  assert.deepEqual(state.fetched, [source().feed_url]); assert.equal(state.entries[0].contact_name, null); assert.equal(state.entries[0].email, null);
  assert.equal(state.finish[0].counts.entries_seen, 1); assert.equal(state.finish[0].status, 'completed');
  assert.ok(!JSON.stringify(result).includes(source().feed_url), 'Private feed URLs must not appear in durable results.');
});

test('cross-feed and cross-run duplicates never become new discoveries', async () => {
  const { state, run } = fixture(); state.sources.push(source('2', 'linkedin_posts'));
  const post = 'https://www.linkedin.com/posts/buyer_website-rebuild-activity-12345';
  const first = await run(atom(post)); assert.equal(first.saved, 1); assert.equal(first.sources[1].saved, 0);
  const second = await run(atom(post)); assert.equal(second.saved, 0); assert.equal(state.entries.length, 1);
});

test('missing migration, unbound owner, incomplete setup and paused/due gates block all fetches', async () => {
  const { state, repo, run } = fixture(); state.migration = false;
  assert.equal((await run()).status, 'disabled'); assert.equal(state.fetched.length, 0);
  state.migration = true; state.available = false; assert.equal((await run()).status, 'idle'); assert.equal(state.fetched.length, 0);
  await runAlertFeeds({ ownerId: other, executionId: 'wrong-owner' }, { repository: repo, readiness: () => ({ ready: true }), fetchFeed: async () => { throw new Error('Must not fetch'); } });
  assert.equal((await runAlertFeeds({ ownerId: owner, executionId: 'setup-missing' }, { repository: repo, readiness: () => ({ ready: false }) })).status, 'disabled');
});

test('pause or changed configuration between fetch and persist stops further saves', async () => {
  const { state, run } = fixture(); state.paused = true;
  assert.equal((await run()).status, 'idle'); assert.equal(state.entries.length, 0); assert.equal(state.finish.length, 0);
});

test('malformed feed and storage failures keep safe, separate run errors', async () => {
  const { state, run } = fixture();
  const malformed = await run('<html>private feed contents</html>');
  assert.equal(malformed.status, 'failed'); assert.equal(malformed.sources[0].errorCode, 'FEED_PARSE');
  assert.equal(state.finish[0].error, 'FEED_PARSE');
  state.persistenceError = true;
  assert.equal((await run()).sources[0].errorCode, 'DATABASE_UNAVAILABLE'); assert.equal(state.finish[1].error, 'DATABASE_UNAVAILABLE');
});

test('zero qualified results completes with rejection details rather than fake leads', async () => {
  const { state, run } = fixture();
  const result = await run(atom().replace('We need a web development agency to rebuild our website.', 'We offer website development services.'));
  assert.equal(result.status, 'completed'); assert.equal(result.saved, 0); assert.equal(result.sources[0].skipped, 1);
  assert.match(result.sources[0].message, /supplier marketing: 1/); assert.equal(state.entries.length, 0);
});

test('alert readiness requires shared host credentials but never a Hunter/Tavily/AI key', () => {
  const variables = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'AUTOMATION_OWNER_ID', 'INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY', 'INNGEST_DEV', 'HUNTER_API_KEY', 'TAVILY_API_KEY', 'ANTHROPIC_API_KEY'];
  const original = Object.fromEntries(variables.map(name => [name, process.env[name]]));
  try {
    Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_alert_fixture', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_alert_fixture_credential_123456789', AUTOMATION_OWNER_ID: owner, INNGEST_EVENT_KEY: 'fixture-event-key-1234567890', INNGEST_SIGNING_KEY: 'fixture-signing-key-1234567890', INNGEST_DEV: '', HUNTER_API_KEY: '', TAVILY_API_KEY: '', ANTHROPIC_API_KEY: '' });
    assert.equal(getAlertReadiness(owner).ready, true); assert.equal(getAlertReadiness(other).ready, false);
    assert.ok(!getAlertReadiness(owner).checks.some(check => /hunter|tavily|anthropic/i.test(check.label)));
    process.env.INNGEST_SIGNING_KEY = ''; assert.equal(getAlertReadiness(owner).ready, false);
  } finally { for (const name of variables) { const value = original[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
