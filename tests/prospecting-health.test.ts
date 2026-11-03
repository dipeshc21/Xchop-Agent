import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryHealth } from '../lib/prospecting/health';
import type { ProspectingRun } from '../lib/prospecting/types';

const now = new Date('2026-11-03T12:00:00Z');
function run(changes: Partial<ProspectingRun> = {}): ProspectingRun {
  return {
    id: 'health-run', owner_id: 'owner', status: 'completed', trigger_source: 'scheduled',
    created_at: '2026-11-03T10:00:00Z', started_at: '2026-11-03T10:00:05Z', finished_at: '2026-11-03T10:01:00Z',
    companies_found: 10, leads_saved: 2, skipped_count: 8, request_count: 1, error_code: null, message: null,
    ...changes,
  };
}
const base = {
  config: { enabled: true, intervalHours: 24 }, readiness: { ready: true, checks: [] },
  runs: [run()], nextRunAt: '2026-11-04T10:01:00Z', now,
};

test('paused discovery cannot look healthy even when an earlier search saved requests', () => {
  const health = discoveryHealth({ ...base, config: { ...base.config, enabled: false } });
  assert.equal(health.code, 'paused'); assert.equal(health.level, 'attention');
  assert.match(health.message, /Start automatic discovery/);
  assert.equal(health.lastSuccessfulRunAt, '2026-11-03T10:01:00Z');
});

test('missing provider configuration is explicit and takes precedence over schedule state', () => {
  const health = discoveryHealth({ ...base, nextRunAt: null,
    readiness: { ready: false, checks: [{ label: 'Public project-request search', ready: false }, { label: 'Supabase connection', ready: true }] } });
  assert.equal(health.code, 'configuration'); assert.equal(health.level, 'attention');
  assert.match(health.message, /Public project-request search/); assert.doesNotMatch(health.message, /Supabase/);
});

test('a future saved interval and hourly grace do not generate false overdue warnings', () => {
  assert.equal(discoveryHealth(base).code, 'verified');
  assert.equal(discoveryHealth({ ...base, config: { enabled: true, intervalHours: 168 }, nextRunAt: '2026-11-09T10:01:00Z' }).code, 'verified');
  assert.equal(discoveryHealth({ ...base, nextRunAt: '2026-11-03T11:00:00Z' }).code, 'verified');
  const overdue = discoveryHealth({ ...base, nextRunAt: '2026-11-03T10:29:00Z' });
  assert.equal(overdue.code, 'overdue'); assert.equal(overdue.level, 'attention');
  assert.match(overdue.message, /hosted Inngest hourly schedule/);
});

test('enabled discovery without a due date or execution does not claim a working scheduler', () => {
  assert.equal(discoveryHealth({ ...base, nextRunAt: null }).code, 'not_scheduled');
  assert.equal(discoveryHealth({ ...base, nextRunAt: 'not-a-date' }).code, 'not_scheduled');
  const first = discoveryHealth({ ...base, runs: [] });
  assert.equal(first.code, 'never_run'); assert.equal(first.level, 'waiting');
  assert.equal(first.lastSuccessfulRunAt, null); assert.equal(first.lastRun, null);
});

test('queued and running work needs real progress and warns after the worker grace period', () => {
  const queued = run({ status: 'queued', created_at: '2026-11-03T11:30:00Z', started_at: null, finished_at: null, request_count: 0, leads_saved: 0 });
  assert.equal(discoveryHealth({ ...base, runs: [queued] }).code, 'queued');
  assert.equal(discoveryHealth({ ...base, runs: [{ ...queued, created_at: '2026-11-03T10:29:00Z' }] }).code, 'queue_stalled');
  const running = { ...queued, status: 'running' as const, created_at: '2026-11-03T08:00:00Z', started_at: '2026-11-03T11:30:00Z' };
  assert.equal(discoveryHealth({ ...base, runs: [running] }).code, 'running', 'A recent start does not inherit the old queue wait.');
  assert.equal(discoveryHealth({ ...base, runs: [{ ...running, started_at: '2026-11-03T10:29:00Z' }] }).code, 'worker_stalled');
});

test('failure diagnostics are safe and retain the last actual successful search', () => {
  const failed = run({ status: 'failed', created_at: '2026-11-03T11:00:00Z', error_code: 'QUOTA', request_count: 1, leads_saved: 0, message: 'api_key=private' });
  const health = discoveryHealth({ ...base, runs: [run(), failed] });
  assert.equal(health.code, 'failed'); assert.match(health.message, /credit allowance/);
  assert.equal(health.lastSuccessfulRunAt, run().finished_at);
  assert.equal(JSON.stringify(health).includes('private'), false);
  assert.equal(discoveryHealth({ ...base, runs: [{ ...failed, error_code: 'api_key=private' }] }).message.includes('private'), false);
});

test('zero saved requests and no provider request have different explanations', () => {
  const zero = discoveryHealth({ ...base, runs: [run({ leads_saved: 0 })] });
  assert.equal(zero.code, 'zero_results'); assert.equal(zero.level, 'attention');
  assert.match(zero.message, /rejected evidence or duplicates/);
  assert.equal(zero.lastSuccessfulRunAt, run().finished_at, 'A completed search with zero matches still establishes execution.');
  const capped = discoveryHealth({ ...base, runs: [run({ request_count: 0, leads_saved: 0, error_code: 'DAILY_REQUEST_LIMIT' })] });
  assert.equal(capped.code, 'search_not_run'); assert.equal(capped.lastSuccessfulRunAt, null);
  const cappedAfterSearch = discoveryHealth({ ...base, runs: [run({ error_code: 'DAILY_LEAD_LIMIT' })] });
  assert.equal(cappedAfterSearch.code, 'verified'); assert.equal(cappedAfterSearch.lastSuccessfulRunAt, run().finished_at,
    'A search that saved requests before reaching its cap still establishes completed execution.');
});

test('verified discovery requires a completed search and reports actual historical counts', () => {
  const health = discoveryHealth(base);
  assert.equal(health.code, 'verified'); assert.equal(health.level, 'healthy');
  assert.deepEqual(health.lastRun, { status: 'completed', requests: 1, pages: 10, saved: 2, finishedAt: run().finished_at });
  assert.match(health.message, /saved 2 project requests/);
  const cancelled = discoveryHealth({ ...base, runs: [run({ status: 'cancelled', error_code: 'CONFIG_CHANGED' })] });
  assert.equal(cancelled.code, 'cancelled'); assert.equal(cancelled.lastSuccessfulRunAt, null);
});
