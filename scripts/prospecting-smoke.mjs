import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServerClient } from '@supabase/ssr';
import { tsImport } from 'tsx/esm/api';

// Isolated HTTP regression only: every record, cookie and credential below is a
// test fixture served on localhost. This script never contacts a real provider.
// Run after a normal production build made with no Supabase configuration.
await access(new URL('../.next/BUILD_ID', import.meta.url));
const { defaultProspectingConfig } = await tsImport('../lib/prospecting/types.ts', import.meta.url);
const ownerId = '00000000-0000-4000-8000-000000000098';
const leadId = '00000000-0000-4000-8000-000000000097';
const runId = '00000000-0000-4000-8000-000000000096';
const ownerEmail = 'prospecting-smoke-owner@example.test';
const publishableKey = 'sb_publishable_prospecting_smoke_test_only';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
  sub: ownerId, aud: 'authenticated', role: 'authenticated',
  exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
})}.test-only-not-a-valid-signature`;
const user = {
  id: ownerId, aud: 'authenticated', role: 'authenticated', email: ownerEmail,
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
  created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-01-01T00:00:00Z',
};
let config = { ...defaultProspectingConfig, lawfulBasis: 'HTTP fixture basis for reviewing relevant business prospects.' };
let migrationMissing = false;
const suppressionEntries = [{ id: 'suppression-fixture', email: 'blocked@example.test', reason: 'do-not-contact', created_at: '2026-01-01T00:00:00Z' }];
const requests = [];
const mock = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const entry = { method: request.method, path: url.pathname, search: url.search };
  requests.push(entry);
  response.setHeader('Content-Type', 'application/json');
  const reply = (data, status = 200) => response.writeHead(status).end(JSON.stringify(data));
  if (request.headers.authorization !== `Bearer ${accessToken}` || request.headers.apikey !== publishableKey) {
    reply({ code: 'bad_jwt', message: 'Test session required' }, 401); return;
  }
  if (request.method === 'GET' && url.pathname === '/auth/v1/user') { reply(user); return; }
  const discoveryTable = ['/rest/v1/prospecting_settings', '/rest/v1/prospecting_runs'].includes(url.pathname);
  if (discoveryTable || ['/rest/v1/suppression_list', '/rest/v1/leads', '/rest/v1/enrichment_data'].includes(url.pathname)) {
    if (url.searchParams.get('owner_id') !== `eq.${ownerId}`) {
      reply({ message: 'Owner filter is mandatory in this regression fixture.' }, 500); return;
    }
  }
  if (migrationMissing && (discoveryTable || url.pathname === '/rest/v1/rpc/prospecting_usage')) {
    reply({ code: discoveryTable ? 'PGRST205' : 'PGRST202', message: 'MOCK_PRIVATE_DATABASE_DETAIL_MUST_NOT_LEAK' }, 404); return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/prospecting_settings') {
    reply([{ data: config, next_run_at: null }]); return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/prospecting_runs') {
    const columns = url.searchParams.get('select');
    if (!columns || columns === '*' || columns.includes('claim_token')) { reply({ message: 'Run query requested unsafe columns.' }, 500); return; }
    reply([{ id: runId, owner_id: ownerId, status: 'completed', trigger_source: 'scheduled', created_at: '2026-01-01T00:00:00Z', started_at: '2026-01-01T00:01:00Z', finished_at: '2026-01-01T00:02:00Z', companies_found: 7, leads_saved: 3, skipped_count: 4, request_count: 12, error_code: null, message: 'HTTP regression completed.' }]); return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/prospecting_usage') {
    reply({ requests: 12, leads_saved: 3, day_start: '2026-01-01T00:00:00Z' }); return;
  }
  if (request.method === 'POST' && ['/rest/v1/rpc/save_prospecting_settings', '/rest/v1/rpc/suppress_workspace_email'].includes(url.pathname)) {
    try {
      let body = ''; for await (const chunk of request) body += chunk;
      const { payload } = JSON.parse(body); entry.payload = payload;
      if (url.pathname.endsWith('save_prospecting_settings')) {
        assert.equal(payload.enabled, false, 'Missing provider credentials must block enable before its RPC.');
        config = payload; reply({ data: config, version: 2, next_run_at: null });
      } else {
        assert.equal(payload.email, payload.email.trim().toLowerCase());
        suppressionEntries.unshift({ id: 'new-suppression-fixture', ...payload, created_at: '2026-01-02T00:00:00Z' });
        reply('new-suppression-fixture');
      }
    } catch { reply({ message: 'Invalid fixture payload.' }, 400); }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/suppression_list') { reply(suppressionEntries); return; }
  if (request.method === 'GET' && url.pathname === '/rest/v1/leads') {
    reply(url.searchParams.get('id') === `eq.${leadId}` ? [{ id: leadId }] : []); return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/enrichment_data') {
    if (url.searchParams.get('lead_id') !== `eq.${leadId}`) { reply({ message: 'Lead filter required.' }, 500); return; }
    reply([{ summary: 'Recorded company description for review.', created_at: '2026-01-01T00:00:00Z', data: {
      company: { industry: 'Design', employeeCount: 12, timeZone: 'America/New_York' },
      sources: [{ uri: 'https://source.example.test/team', lastSeenOn: '2026-01-01' }],
      aiDraft: { summary: 'Draft research for review only.' },
      api_key: 'FIXTURE_SECRET_MUST_NOT_BE_RETURNED', internal: { access_token: 'FIXTURE_SECRET_MUST_NOT_BE_RETURNED' },
    } }]); return;
  }
  reply({ message: `Unexpected localhost fixture request: ${request.method} ${url.pathname}` }, 500);
});

let child;
let childExited = false;
let output = '';
const scratch = await mkdtemp(join(tmpdir(), 'xchop-prospecting-smoke-'));
try {
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const address = mock.address(); assert.ok(address && typeof address !== 'string');
  const mockOrigin = `http://127.0.0.1:${address.port}`;
  const cookies = new Map();
  const auth = createServerClient(mockOrigin, publishableKey, { cookies: {
    getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
    setAll: values => values.forEach(({ name, value }) => cookies.set(name, value)),
  } });
  assert.equal((await auth.auth.setSession({ access_token: accessToken, refresh_token: 'test-refresh-token-never-sent' })).error, null);
  assert.ok(cookies.size);
  const cookie = Array.from(cookies, ([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('; ');
  const origin = 'http://127.0.0.1:3217';
  const blockedLog = join(scratch, 'blocked.log');
  await writeFile(blockedLog, '');
  const guard = join(scratch, 'localhost-fetch-only.mjs');
  await writeFile(guard, `import { appendFileSync } from 'node:fs';
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input, init) {
  const value = typeof input === 'string' || input instanceof URL ? input : input.url;
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    appendFileSync(${JSON.stringify(blockedLog)}, url.origin + '\\n');
    throw new Error('HTTP regression blocks external provider requests.');
  }
  return originalFetch(input, init);
};\n`);
  child = spawn(process.execPath, ['--import', pathToFileURL(guard).href, 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3217'], {
    cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, NEXT_PUBLIC_SUPABASE_URL: mockOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey, NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      HUNTER_API_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', AUTOMATION_OWNER_ID: '', INNGEST_EVENT_KEY: '', INNGEST_SIGNING_KEY: '', INNGEST_DEV: '',
      ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: '', APP_URL: origin, NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  child.on('exit', () => { childExited = true; });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (childExited) break;
    try { if ((await fetch(`${origin}/login`, { redirect: 'manual', signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; } } catch { /* Temporary test server startup only. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Temporary Next server did not become ready.\n${output}`);
  const headers = { cookie };
  const mutation = { ...headers, Origin: origin, 'Content-Type': 'application/json' };

  const publicStart = requests.length;
  const guide = await fetch(`${origin}/prospecting/setup`);
  assert.equal(guide.status, 200);
  const guideHtml = await guide.text();
  assert.match(guideHtml, /Hunter/); assert.match(guideHtml, /Inngest/);
  const sql = await fetch(`${origin}/migrations/005_automatic_prospecting.sql`);
  assert.equal(sql.status, 200);
  assert.equal(await sql.text(), await readFile(new URL('../supabase/migrations/005_automatic_prospecting.sql', import.meta.url), 'utf8'), 'Public copy SQL must match the reviewed migration exactly.');
  const signedOut = await fetch(`${origin}/prospecting`, { redirect: 'manual' });
  assert.equal(signedOut.status, 307);
  assert.equal(new URL(signedOut.headers.get('location'), origin).pathname, '/login');
  for (const path of ['/api/prospecting', '/api/suppression']) assert.equal((await fetch(`${origin}${path}`)).status, 401);
  assert.ok(!requests.slice(publicStart).some(item => item.path.startsWith('/rest/v1/')), 'Anonymous requests must not read owner data.');

  const page = await fetch(`${origin}/prospecting`, { headers, redirect: 'manual' });
  assert.equal(page.status, 200, `Authenticated discovery page must open. Rebuild without configured NEXT_PUBLIC values if it redirects to setup.\n${output}`);
  assert.ok((await page.text()).includes(ownerEmail));
  const statusResponse = await fetch(`${origin}/api/prospecting`, { headers });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.migrationReady, true); assert.equal(status.enabled, false); assert.equal(status.readiness.ready, false);
  assert.deepEqual(status.usage, { requestsToday: 12, leadsToday: 3, dayStart: '2026-01-01T00:00:00Z' });
  assert.equal(status.runs[0].leads_saved, 3); assert.equal(status.runs[0].id, runId);
  assert.ok(!JSON.stringify(status).includes(accessToken)); assert.ok(!JSON.stringify(status).includes('claim_token'));

  migrationMissing = true;
  const missingResponse = await fetch(`${origin}/api/prospecting`, { headers });
  assert.equal(missingResponse.status, 200);
  const missing = await missingResponse.json();
  assert.equal(missing.migrationReady, false); assert.equal(missing.enabled, false); assert.equal(missing.readiness.ready, false);
  assert.deepEqual(missing.runs, []); assert.equal(missing.config.enabled, false);
  assert.ok(!JSON.stringify(missing).includes('MOCK_PRIVATE_DATABASE_DETAIL_MUST_NOT_LEAK'));
  migrationMissing = false;

  const pausedConfig = { ...config, enabled: false, intervalHours: 48, keywords: ['Design studio regression filter'] };
  const pauseSave = await fetch(`${origin}/api/prospecting`, { method: 'PUT', headers: mutation, body: JSON.stringify(pausedConfig) });
  assert.equal(pauseSave.status, 200, 'Pausing and editing targeting must work without provider keys.');
  assert.deepEqual(config, pausedConfig);
  const savesBeforeEnable = requests.filter(item => item.path.endsWith('/save_prospecting_settings')).length;
  const enable = await fetch(`${origin}/api/prospecting`, { method: 'PUT', headers: mutation, body: JSON.stringify({ ...pausedConfig, enabled: true }) });
  assert.equal(enable.status, 409, 'Missing provider keys must block enabling discovery.');
  assert.equal(requests.filter(item => item.path.endsWith('/save_prospecting_settings')).length, savesBeforeEnable);
  assert.equal((await fetch(`${origin}/api/prospecting/run`, { method: 'POST', headers: mutation })).status, 409);
  assert.ok(!requests.some(item => item.path.endsWith('/queue_prospecting_run')), 'A paused worker must not queue a paid operation.');

  assert.equal((await fetch(`${origin}/api/suppression`, { headers })).status, 200);
  const suppress = await fetch(`${origin}/api/suppression`, { method: 'POST', headers: mutation, body: JSON.stringify({ email: ' New@Example.test ', reason: 'do-not-contact' }) });
  assert.equal(suppress.status, 201);
  assert.equal(suppressionEntries[0].email, 'new@example.test');
  for (const [path, method, body] of [['/api/prospecting', 'PUT', pausedConfig], ['/api/prospecting/run', 'POST', {}], ['/api/suppression', 'POST', { email: 'bad@example.test', reason: 'bounced' }]]) {
    const before = requests.length;
    assert.equal((await fetch(`${origin}${path}`, { method, headers: { ...mutation, Origin: 'https://other-site.example' }, body: JSON.stringify(body) })).status, 403);
    assert.ok(!requests.slice(before).some(item => item.path.startsWith('/rest/v1/')), 'Cross-site mutations must not access owner records.');
  }
  assert.equal((await fetch(`${origin}/api/suppression`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'anonymous@example.test', reason: 'bounced' }) })).status, 401);

  const researchResponse = await fetch(`${origin}/api/leads/${leadId}/research`, { headers });
  assert.equal(researchResponse.status, 200);
  const research = await researchResponse.json();
  assert.equal(research.research.summary, 'Recorded company description for review.');
  assert.equal(research.research.industry, 'Design');
  assert.equal(research.research.aiDraft, 'Draft research for review only.');
  assert.ok(!JSON.stringify(research).includes('FIXTURE_SECRET_MUST_NOT_BE_RETURNED'), 'Research must project only review fields.');
  assert.equal((await fetch(`${origin}/api/leads/${leadId}/research`)).status, 401);
  assert.equal((await fetch(`${origin}/api/leads/00000000-0000-4000-8000-000000000095/research`, { headers })).status, 404);

  for (const method of ['GET', 'POST', 'PUT']) {
    assert.equal((await fetch(`${origin}/api/inngest`, { method })).status, 503, 'Unsigned, unconfigured background endpoint must fail closed.');
  }
  assert.equal(await readFile(blockedLog, 'utf8'), '', 'No tested route may attempt an external provider fetch.');
  console.log('PASS: real authenticated discovery routes read owner status and usage; public guide SQL matches; missing migration stays paused; pause saves without keys while enabling and queueing are blocked; suppression auth/origin guards work; lead research excludes private fields; unsigned background routes fail closed; no external provider fetches.');
} finally {
  if (child && !childExited) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
  if (mock.listening) { const closed = once(mock, 'close'); mock.close(); mock.closeAllConnections(); await closed; }
  await rm(scratch, { recursive: true, force: true });
}
