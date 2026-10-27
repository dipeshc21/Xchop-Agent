import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET, PUT } from '../app/api/prospecting/route';
import { POST as queueRun } from '../app/api/prospecting/run/route';
import { GET as getSuppression, POST as suppress } from '../app/api/suppression/route';
import { discoveryDatabaseError, missingMigration, readSmallJson, runColumns } from '../app/api/prospecting/support';
import { inngestEndpointStatus, dispatchProspectingRun } from '../lib/inngest/client';

function withEnvironment(values: Record<string, string | undefined>, task: () => Promise<void>) {
  const before = new Map(Object.keys(values).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  return task().finally(() => {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
}
function request(path: string, method: string, origin = 'http://localhost:3000', body?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method, headers: { origin, host: 'localhost:3000', 'content-type': 'application/json' }, body,
  });
}

test('discovery and suppression fail closed before making any connection when setup is absent', async () => {
  await withEnvironment({ NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, APP_URL: undefined }, async () => {
    const before = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('A setup-only request must not call a provider.'); };
    try {
      for (const response of [await GET(), await getSuppression(), await PUT(request('/api/prospecting', 'PUT', undefined, '{}')), await queueRun(request('/api/prospecting/run', 'POST')), await suppress(request('/api/suppression', 'POST', undefined, '{}'))]) {
        assert.equal(response.status, 503);
        assert.match((await response.json()).error, /Connect Supabase/);
      }
    } finally { globalThis.fetch = before; }
  });
});

test('every browser mutation rejects cross-site requests before database or paid API access', async () => {
  await withEnvironment({ APP_URL: undefined }, async () => {
    for (const [handler, path, method] of [[PUT, '/api/prospecting', 'PUT'], [queueRun, '/api/prospecting/run', 'POST'], [suppress, '/api/suppression', 'POST']] as const) {
      const response = await handler(request(path, method, 'https://another-site.example', '{}'));
      assert.equal(response.status, 403);
    }
  });
});

test('database failures disclose safe instructions without reflecting raw provider messages', async () => {
  const unsafe = 'SUPABASE_SERVICE_ROLE_KEY=private; https://provider.example?api_key=private';
  for (const error of [{ code: '42501', message: unsafe }, { code: 'PGRST202', message: unsafe }, { message: 'PROSPECTING_RATE_LIMIT' }, { message: 'PROSPECTING_PAUSED' }]) {
    const response = discoveryDatabaseError(error);
    const json = JSON.stringify(await response.json());
    assert.equal(json.includes('private'), false);
    assert.equal(json.includes('api_key='), false);
  }
  assert.equal(discoveryDatabaseError({ code: 'PGRST202' }).status, 503);
  assert.equal(discoveryDatabaseError({ message: 'PROSPECTING_RATE_LIMIT' }).status, 429);
  assert.equal(discoveryDatabaseError({ message: 'PROSPECTING_PAUSED' }).status, 409);
  assert.equal(missingMigration({ code: '42501' }), false, 'Access denial must not appear as an uninstalled schema.');
  assert.equal(runColumns.includes('claim_token'), false, 'Worker claims are never returned in browser run history.');
});

test('mutation parser bounds actual bytes even when Content-Length is absent', async () => {
  const response = await readSmallJson(request('/api/prospecting', 'PUT', undefined, JSON.stringify({ value: 'あ'.repeat(7000) })));
  assert.equal(response.response?.status, 413);
  assert.equal((await readSmallJson(request('/api/prospecting', 'PUT', undefined, 'invalid'))).response?.status, 400);
  assert.deepEqual((await readSmallJson(request('/api/prospecting', 'PUT', undefined, '{"enabled":false}'))).body, { enabled: false });
});

test('production background endpoint rejects unsigned development mode and unbound dispatch', async () => {
  await withEnvironment({ NODE_ENV: 'production', INNGEST_DEV: '1', INNGEST_SIGNING_KEY: 'configured-test-signing-key', AUTOMATION_OWNER_ID: '15d9bdd0-a143-407c-adc3-6d9b9f933104' }, async () => {
    assert.equal(inngestEndpointStatus().enabled, false);
    await assert.rejects(dispatchProspectingRun('c54a3c00-2654-4e47-af19-52e95a7f28ff', '576b8863-5952-47bc-9f3a-734dce8631a7'), /PROSPECTING_OWNER_MISMATCH/);
  });
  await withEnvironment({ NODE_ENV: 'development', INNGEST_DEV: '1', APP_URL: 'https://public-host.example' }, async () => {
    assert.equal(inngestEndpointStatus().enabled, false);
  });
});
