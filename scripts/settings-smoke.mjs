import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createServerClient } from '@supabase/ssr';
import { tsImport } from 'tsx/esm/api';

// HTTP regression test only. Runtime application code never uses this mock or its credentials.
// A normal, unconfigured production build must exist before running this script.
await access(new URL('../.next/BUILD_ID', import.meta.url));
const { defaults } = await tsImport('../lib/schema.ts', import.meta.url);
const ownerId = '00000000-0000-4000-8000-000000000099';
const ownerEmail = 'settings-smoke-owner@example.test';
const fixture = {
  ...defaults,
  businessName: 'Settings smoke fixture business',
  address: 'Fixture office address for HTTP regression only',
  ownerEmail,
  pricing: 'Fixture pricing from the settings table',
};
const publishableKey = 'sb_publishable_settings_smoke_test_only';
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
const requests = [];
const mock = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requests.push({ method: request.method, path: url.pathname, search: url.search });
  response.setHeader('Content-Type', 'application/json');
  if (request.headers.authorization !== `Bearer ${accessToken}` || request.headers.apikey !== publishableKey) {
    response.writeHead(401).end(JSON.stringify({ code: 'bad_jwt', message: 'Test session required' }));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/auth/v1/user') {
    response.end(JSON.stringify(user));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/workspace_dashboard') {
    response.writeHead(404).end(JSON.stringify({
      code: 'PGRST202', message: 'MOCK_PROVIDER_DETAIL_MUST_NOT_LEAK', details: 'Mock function is absent', hint: null,
    }));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/save_workspace_settings') {
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { payload } = JSON.parse(body);
      assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload));
      Object.assign(fixture, payload);
      response.end('null');
    } catch {
      response.writeHead(400).end(JSON.stringify({ code: 'PGRST102', message: 'Invalid mock settings payload' }));
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/settings') {
    const rows = url.searchParams.get('select') === 'data'
      ? [{ data: fixture }]
      : [{ owner_id: ownerId }];
    response.end(JSON.stringify(rows));
    return;
  }
  if (request.method === 'GET' && /^\/rest\/v1\/(?:leads|agent_logs|email_messages|replies|payments|projects|tasks|quotes)$/.test(url.pathname)) {
    response.setHeader('Content-Range', '*/0');
    response.end('[]');
    return;
  }
  response.writeHead(500).end(JSON.stringify({ message: `Unexpected mock request: ${request.method} ${url.pathname}` }));
});

let child;
let childExited = false;
let output = '';
try {
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  const mockAddress = mock.address();
  assert.ok(mockAddress && typeof mockAddress !== 'string');
  const mockOrigin = `http://127.0.0.1:${mockAddress.port}`;
  const cookies = new Map();
  const auth = createServerClient(mockOrigin, publishableKey, {
    cookies: {
      getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
      setAll: values => values.forEach(({ name, value }) => cookies.set(name, value)),
    },
  });
  const { error: sessionError } = await auth.auth.setSession({ access_token: accessToken, refresh_token: 'test-refresh-token-never-sent' });
  assert.equal(sessionError, null, 'Mock authenticated owner session must be accepted.');
  assert.ok(cookies.size, 'Supabase SSR must write the test session cookie.');
  const cookie = Array.from(cookies, ([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('; ');
  const origin = 'http://127.0.0.1:3216';
  child = spawn(process.execPath, [
    'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3216',
  ], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: mockOrigin,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    },
  });
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  child.on('exit', () => { childExited = true; });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (childExited) break;
    try {
      const response = await fetch(`${origin}/login`, { redirect: 'manual', signal: AbortSignal.timeout(1500) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for this script's temporary server only. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Temporary Next server did not become ready.\n${output}`);
  const headers = { cookie };

  const settingsStart = requests.length;
  const settings = await fetch(`${origin}/settings`, { headers, redirect: 'manual' });
  assert.equal(settings.status, 200, `Authenticated settings must open even with a missing dashboard function; received ${settings.status} ${settings.headers.get('location') ?? ''}. A redirect to /setup may indicate that this build inlined configuration; rebuild with unconfigured environment values before this test.\n${output}`);
  const settingsHtml = await settings.text();
  assert.ok(settingsHtml.includes(fixture.businessName), 'Settings must display the stored business name, not default or fabricated data.');
  assert.ok(settingsHtml.includes(fixture.address), 'Settings must display the stored office address.');
  assert.ok(settingsHtml.includes(fixture.pricing), 'Settings must display the stored pricing.');
  assert.ok(settingsHtml.includes('Your business, in your words.'));
  assert.doesNotMatch(settingsHtml, /class="[^"]*\bmetrics-grid\b/, 'Settings-only route must not fabricate dashboard cards.');
  assert.ok(!settingsHtml.includes('Recorded revenue'), 'Settings-only route must not render revenue totals.');
  const settingsRequests = requests.slice(settingsStart);
  assert.ok(settingsRequests.some(request => request.path === '/rest/v1/settings' && request.search.includes('select=data')), 'The real settings route must query settings.');
  assert.ok(!settingsRequests.some(request => request.path === '/rest/v1/leads' || request.path === '/rest/v1/rpc/workspace_dashboard'), 'Opening /settings must not query leads or dashboard RPC.');

  const saveStart = requests.length;
  const savedFixture = {
    ...fixture,
    businessName: 'Settings saved while dashboard unavailable',
    address: 'Updated office address persisted by settings save',
  };
  const save = await fetch(`${origin}/api/workspace`, {
    method: 'PUT',
    headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(savedFixture),
  });
  assert.equal(save.status, 200, 'Authenticated business settings must save independently of dashboard availability.');
  assert.deepEqual(await save.json(), { ok: true });
  const savedPage = await fetch(`${origin}/settings`, { headers, redirect: 'manual' });
  assert.equal(savedPage.status, 200, 'Settings must reopen after a successful save.');
  const savedHtml = await savedPage.text();
  assert.ok(savedHtml.includes(savedFixture.businessName), 'Reopened Settings must display the saved business name.');
  assert.ok(savedHtml.includes(savedFixture.address), 'Reopened Settings must display the saved office address.');
  const saveRequests = requests.slice(saveStart);
  assert.ok(saveRequests.some(request => request.method === 'POST' && request.path === '/rest/v1/rpc/save_workspace_settings'), 'Save must call the real settings RPC through the API.');
  assert.ok(!saveRequests.some(request => request.path === '/rest/v1/leads' || request.path === '/rest/v1/rpc/workspace_dashboard'), 'Settings save and reload must not query leads or dashboard RPC.');

  const dashboard = await fetch(origin, { headers, redirect: 'manual' });
  assert.equal(dashboard.status, 307, 'Missing dashboard RPC must redirect the dashboard.');
  const dashboardLocation = new URL(dashboard.headers.get('location'), origin);
  assert.equal(dashboardLocation.pathname, '/setup');
  assert.equal(dashboardLocation.searchParams.get('reason'), 'dashboard');

  const setupResponse = await fetch(`${origin}/api/setup`, { headers });
  assert.equal(setupResponse.status, 200);
  const health = await setupResponse.json();
  assert.equal(health.configured, true, 'Test runtime configuration must be active.');
  assert.equal(health.authenticated, true, 'Setup must preserve authenticated state despite an RPC failure.');
  assert.equal(health.database, 'needs-setup');
  assert.equal(health.checks.find(check => check.id === 'settings')?.status, 'ready');
  assert.equal(health.checks.find(check => check.id === 'dashboard')?.status, 'blocked');
  assert.equal(health.checks.find(check => check.id === 'dashboard')?.code, 'PGRST202');
  assert.ok(!JSON.stringify(health).includes(fixture.businessName), 'Readiness response must not expose business row data.');
  assert.ok(!JSON.stringify(health).includes('MOCK_PROVIDER_DETAIL_MUST_NOT_LEAK'), 'Readiness response must not reflect provider free-form text.');

  const setupPage = await fetch(`${origin}/setup?reason=dashboard`, { headers });
  assert.equal(setupPage.status, 200);
  const setupHtml = await setupPage.text();
  assert.match(setupHtml, /<a\b[^>]*href="\/settings"[^>]*>Open Settings/);
  assert.doesNotMatch(setupHtml, /<a\b[^>]*href="\/login"[^>]*>/, 'Authenticated setup must not offer another sign-in as the repair.');
  assert.ok(setupHtml.includes('PGRST202'));

  const unauthenticatedStart = requests.length;
  const unauthenticated = await fetch(`${origin}/settings`, { redirect: 'manual' });
  assert.equal(unauthenticated.status, 307);
  assert.equal(new URL(unauthenticated.headers.get('location'), origin).pathname, '/login');
  const noSessionHealth = await (await fetch(`${origin}/api/setup`)).json();
  assert.equal(noSessionHealth.authenticated, false);
  assert.equal(noSessionHealth.database, 'not-checked');
  assert.ok(noSessionHealth.checks.filter(check => !['configuration', 'authentication'].includes(check.id)).every(check => check.status === 'not-checked'));
  assert.ok(!requests.slice(unauthenticatedStart).some(request => request.path.startsWith('/rest/v1/')), 'Unauthenticated checks must never probe workspace records.');

  console.log('PASS: authenticated /settings opens, saves through the API and reloads stored changes without dashboard/lead dependencies; missing RPC redirects dashboard; setup reports PGRST202 with Settings link and no sign-in loop; unauthenticated access is blocked.');
} finally {
  if (child && !childExited) {
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    await exit;
  }
  if (mock.listening) {
    const closed = once(mock, 'close');
    mock.close();
    mock.closeAllConnections();
    await closed;
  }
}
