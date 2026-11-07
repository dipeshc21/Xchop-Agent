import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createServerClient } from '@supabase/ssr';
import { tsImport } from 'tsx/esm/api';

// Local fixture sessions and data only. No Google, LinkedIn or Hunter request is
// allowed; the event-delivery response is intercepted by the test preload.
await access(new URL('../.next/BUILD_ID', import.meta.url));
const { indiaDayWindow } = await tsImport('../lib/intent/day-window.ts', import.meta.url);
const day = indiaDayWindow();
const ownerId = '00000000-0000-4000-8000-000000000088';
const contactId = '00000000-0000-4000-8000-000000000087';
const sourceId = '00000000-0000-4000-8000-000000000086';
const linkedinId = '00000000-0000-4000-8000-000000000085';
const ownerEmail = 'free-alert-smoke-owner@example.test';
const publishableKey = 'sb_publishable_free_alert_smoke_only';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
  sub: ownerId, aud: 'authenticated', role: 'authenticated',
  exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
})}.fixture-signature-only`;
const user = { id: ownerId, aud: 'authenticated', role: 'authenticated', email: ownerEmail,
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
  created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-01-01T00:00:00Z' };
const contact = {
  id: contactId, owner_id: ownerId, company: 'Retained Hunter contact fixture', country: 'United States',
  contact_name: 'Recorded contact fixture', email: 'recorded@fixture.org', website: 'https://fixture.org', role: 'Director',
  stage: 'New', score: 70, score_reason: 'Recorded business facts', value: 0, segment: 'Design agency',
  source: 'Hunter official APIs', lawful_basis: 'Fixture review basis',
  created_at: day.start, updated_at: new Date().toISOString(), record_type: 'contact', resource_title: 'Hunter',
};
const googleLead = { ...contact, id: '00000000-0000-4000-8000-000000000084',
  company: 'Google website request fixture', country: 'Not published', contact_name: '', email: '', website: null, role: null,
  score: 0, score_reason: 'Not scored', segment: 'Website development', source: 'Google Alerts',
  record_type: 'alert', resource_title: 'Google Alerts', resource_url: 'https://buyer.org/request/website-rebuild',
  alert_snippet: 'We are looking for an agency to rebuild our website.', alert_service: 'website', feed_published_at: day.start,
};
const linkedinLead = { ...googleLead, id: '00000000-0000-4000-8000-000000000083',
  company: 'Earlier LinkedIn application request fixture', source: 'LinkedIn posts via Google Alerts',
  resource_title: 'LinkedIn posts via Google Alerts', resource_url: 'https://www.linkedin.com/posts/buyer_application-project-123',
  alert_service: 'application', created_at: new Date(Date.parse(day.start) - 1).toISOString(),
};
let sources = [
  { id: sourceId, resource_type: 'google_alerts', title: 'Google Alerts', feed_url: 'https://www.google.com/alerts/feeds/123456/111111', enabled: false },
  { id: linkedinId, resource_type: 'linkedin_posts', title: 'LinkedIn posts via Google Alerts', feed_url: 'https://www.google.com/alerts/feeds/123456/222222', enabled: false },
].map(source => ({ ...source, owner_id: ownerId, version: 1, next_check_at: null, last_checked_at: null,
  last_success_at: null, error_code: null, created_at: day.start, updated_at: day.start,
  lease_token: 'INTERNAL_LEASE_MUST_NOT_LEAK' }));
let migrationMissing = true;
let viewMissing = true;
let databaseFailed = false;
const requests = [];
const mock = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const entry = { method: request.method, path: url.pathname, search: url.search };
  requests.push(entry);
  response.setHeader('Content-Type', 'application/json');
  const reply = (data, status = 200) => response.writeHead(status).end(JSON.stringify(data));
  if (request.headers.authorization !== `Bearer ${accessToken}` || request.headers.apikey !== publishableKey) {
    reply({ code: 'bad_jwt', message: 'Fixture session required.' }, 401); return;
  }
  if (request.method === 'GET' && url.pathname === '/auth/v1/user') { reply(user); return; }
  if (request.method === 'GET' && url.pathname.startsWith('/rest/v1/') && !url.pathname.includes('/rpc/')) {
    if (url.searchParams.get('owner_id') !== `eq.${ownerId}`) {
      reply({ message: 'Owner filter is mandatory in the HTTP fixture.' }, 500); return;
    }
  }
  if (url.pathname === '/rest/v1/rpc/alert_sources_readiness') {
    if (migrationMissing) { reply({ code: 'PGRST202', message: 'PRIVATE_DATABASE_DETAIL_MUST_NOT_LEAK' }, 404); return; }
    if (databaseFailed) { reply({ code: '42501', message: 'PRIVATE_DATABASE_DETAIL_MUST_NOT_LEAK' }, 403); return; }
    reply({ schema_version: 10 }); return;
  }
  if (url.pathname === '/rest/v1/alert_feed_sources') {
    const columns = url.searchParams.get('select');
    assert.ok(columns && columns !== '*' && !columns.includes('lease'), 'Source reads must use the safe projection.');
    const rows = sources.filter(row => url.searchParams.get('enabled') !== 'eq.true' || row.enabled);
    reply(rows.map(row => Object.fromEntries(columns.split(',').map(key => [key, row[key]])))); return;
  }
  if (url.pathname === '/rest/v1/alert_feed_runs') {
    const columns = url.searchParams.get('select');
    assert.ok(columns && columns !== '*' && !columns.includes('lease') && !columns.includes('feed_url'));
    reply([{ id: '00000000-0000-4000-8000-000000000082', resource_type: 'google_alerts', status: 'completed',
      created_at: day.start, finished_at: day.start, entries_seen: 2, leads_saved: 1, skipped_count: 1,
      error_code: null, message: 'Fixture import completed.' }]); return;
  }
  if (url.pathname === '/rest/v1/rpc/save_alert_feed') {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const { payload } = JSON.parse(raw); entry.payload = payload;
    const old = sources.find(source => source.resource_type === payload.resource_type);
    const saved = { ...old, ...payload, updated_at: new Date().toISOString() };
    sources = sources.map(source => source.id === saved.id ? saved : source);
    reply(saved); return;
  }
  if (url.pathname === '/rest/v1/settings') { reply([{ data: {} }]); return; }
  if (url.pathname === '/rest/v1/rpc/workspace_dashboard') {
    reply({ leadCount: 1, sentCount: 0, replyRate: 0, wonCount: 0, pipelineValue: 0, quoteCount: 0,
      revenue: [], funnel: [], markets: [{ country: 'United States', count: 1 }], attention: [] }); return;
  }
  if (['/rest/v1/leads', '/rest/v1/workspace_lead_records'].includes(url.pathname)) {
    if (url.pathname.endsWith('workspace_lead_records') && viewMissing) {
      reply({ code: 'PGRST205', message: 'PRIVATE_VIEW_DETAIL_MUST_NOT_LEAK' }, 404); return;
    }
    let rows = url.pathname.endsWith('workspace_lead_records') ? [contact, googleLead, linkedinLead] : [contact];
    const dates = url.searchParams.getAll('created_at');
    rows = rows.filter(row => dates.every(value => value.startsWith('gte.')
      ? Date.parse(row.created_at) >= Date.parse(value.slice(4))
      : value.startsWith('lt.') && Date.parse(row.created_at) < Date.parse(value.slice(3))));
    const company = url.searchParams.get('company');
    if (company) rows = rows.filter(row => row.company.toLowerCase().includes(company.slice('ilike.%'.length, -1).toLowerCase()));
    const country = url.searchParams.get('country');
    if (country) rows = rows.filter(row => row.country === country.slice(3));
    rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const page = rows.slice(offset, offset + Number(url.searchParams.get('limit') ?? 50));
    response.setHeader('Content-Range', page.length ? `${offset}-${offset + page.length - 1}/${rows.length}` : `*/${rows.length}`);
    reply(page); return;
  }
  reply({ message: `Unexpected local fixture request: ${request.method} ${url.pathname}` }, 500);
});

let child;
let childExited = false;
let output = '';
const scratch = await mkdtemp(join(tmpdir(), 'xchop-alerts-smoke-'));
try {
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const address = mock.address(); assert.ok(address && typeof address !== 'string');
  const mockOrigin = `http://127.0.0.1:${address.port}`;
  const cookies = new Map();
  const auth = createServerClient(mockOrigin, publishableKey, { cookies: {
    getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
    setAll: values => values.forEach(({ name, value }) => cookies.set(name, value)),
  } });
  assert.equal((await auth.auth.setSession({ access_token: accessToken, refresh_token: 'fixture-refresh-never-sent' })).error, null);
  const cookie = Array.from(cookies, ([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('; ');
  const origin = 'http://127.0.0.1:3218';
  const blockedLog = join(scratch, 'blocked.log');
  const dispatchLog = join(scratch, 'dispatch.log');
  await writeFile(blockedLog, ''); await writeFile(dispatchLog, '');
  const guard = join(scratch, 'local-fetch-only.mjs');
  await writeFile(guard, `import { appendFileSync } from 'node:fs';
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === 'inn.gs' && url.pathname.startsWith('/e/')) {
    appendFileSync(${JSON.stringify(dispatchLog)}, 'fixture-alert-dispatched\\n');
    return Promise.resolve(new Response(JSON.stringify({ ids: ['fixture-alert-event'], status: 200 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    appendFileSync(${JSON.stringify(blockedLog)}, url.origin + '\\n');
    throw new Error('Alert smoke test blocks external provider requests.');
  }
  return originalFetch(input, init);
};\n`);
  child = spawn(process.execPath, ['--import', pathToFileURL(guard).href, 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3218'], {
    cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, NEXT_PUBLIC_SUPABASE_URL: mockOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey, NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_alert_smoke_fixture_credential_123456789', AUTOMATION_OWNER_ID: ownerId,
      INNGEST_EVENT_KEY: 'fixture-alert-event-key-12345678901234567890', INNGEST_SIGNING_KEY: 'fixture-alert-signing-key-12345678901234567890', INNGEST_DEV: '',
      HUNTER_API_KEY: '', TAVILY_API_KEY: '', ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: '', APP_URL: origin, NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  child.on('exit', () => { childExited = true; });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (childExited) break;
    try { if ((await fetch(`${origin}/login`, { redirect: 'manual', signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; } } catch { /* Temporary app startup only. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Temporary Next app did not become ready.\n${output}`);
  const headers = { cookie };
  const mutation = { ...headers, Origin: origin, 'Content-Type': 'application/json' };
  const anonymousStart = requests.length;
  const signedOut = await fetch(`${origin}/alerts`, { redirect: 'manual' });
  assert.equal(signedOut.status, 307); assert.equal(new URL(signedOut.headers.get('location'), origin).pathname, '/login');
  assert.equal((await fetch(`${origin}/api/alerts`)).status, 401);
  assert.equal((await fetch(`${origin}/api/alerts/run`, { method: 'POST', headers: { Origin: origin } })).status, 401);
  const guide = await fetch(`${origin}/alerts/setup`); assert.equal(guide.status, 200);
  const guideHtml = await guide.text();
  assert.match(guideHtml, /RSS/); assert.match(guideHtml, /LinkedIn/); assert.match(guideHtml, /Copy free-alert setup SQL/);
  assert.match(guideHtml, /free-lead-generation-resources\.pdf/);
  const pdf = await fetch(`${origin}/resources/free-lead-generation-resources.pdf`); assert.equal(pdf.status, 200);
  const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
  assert.equal(Buffer.from(pdfBytes.subarray(0, 5)).toString(), '%PDF-'); assert.ok(pdfBytes.length > 10_000);
  const sql = await fetch(`${origin}/migrations/010_free_alert_sources.sql`); assert.equal(sql.status, 200);
  assert.equal(await sql.text(), await readFile(new URL('../supabase/migrations/010_free_alert_sources.sql', import.meta.url), 'utf8'));
  assert.ok(!requests.slice(anonymousStart).some(item => item.path.startsWith('/rest/v1/')), 'Anonymous pages and downloads cannot read owner records.');

  const missing = await (await fetch(`${origin}/api/alerts`, { headers })).json();
  assert.equal(missing.migrationReady, false); assert.equal(missing.readiness.ready, false);
  assert.deepEqual(missing.sources, []); assert.deepEqual(missing.runs, []);
  assert.ok(!JSON.stringify(missing).includes('PRIVATE_DATABASE_DETAIL_MUST_NOT_LEAK'));
  const fallback = await fetch(`${origin}/?view=leads`, { headers, redirect: 'manual' }); assert.equal(fallback.status, 200);
  const fallbackHtml = await fallback.text(); assert.match(fallbackHtml, /Retained Hunter contact fixture/);
  assert.match(fallbackHtml, /Resource title/i); assert.ok(!fallbackHtml.includes('PRIVATE_VIEW_DETAIL_MUST_NOT_LEAK'));
  migrationMissing = false; viewMissing = false;

  const page = await fetch(`${origin}/alerts`, { headers, redirect: 'manual' }); assert.equal(page.status, 200);
  assert.ok((await page.text()).includes(ownerEmail));
  const statusResponse = await fetch(`${origin}/api/alerts`, { headers }); assert.equal(statusResponse.status, 200);
  assert.match(statusResponse.headers.get('cache-control') || '', /no-store/);
  const status = await statusResponse.json();
  assert.equal(status.migrationReady, true); assert.equal(status.readiness.ready, true); assert.equal(status.readiness.ownerBound, true);
  assert.equal(status.sources.length, 2); assert.equal(status.runs[0].leads_saved, 1);
  assert.ok(!JSON.stringify(status).includes('INTERNAL_LEASE_MUST_NOT_LEAK')); assert.ok(!JSON.stringify(status).includes(accessToken));
  assert.ok(!status.readiness.checks.some(check => /Hunter|Tavily|Anthropic/.test(check.label)), 'Free alerts cannot require paid provider keys.');
  const disabledRun = await fetch(`${origin}/api/alerts/run`, { method: 'POST', headers: mutation }); assert.equal(disabledRun.status, 409);
  assert.equal(await readFile(dispatchLog, 'utf8'), '');
  const savesBefore = requests.filter(item => item.path.endsWith('/save_alert_feed')).length;
  const googlePayload = { resource_type: 'google_alerts', title: 'Google Alerts', feed_url: sources[0].feed_url, enabled: true };
  const invalid = await fetch(`${origin}/api/alerts`, { method: 'PUT', headers: mutation, body: JSON.stringify({ ...googlePayload, feed_url: 'https://other.example.org/private-feed' }) });
  assert.equal(invalid.status, 400); assert.equal(requests.filter(item => item.path.endsWith('/save_alert_feed')).length, savesBefore);
  const unknownField = await fetch(`${origin}/api/alerts`, { method: 'PUT', headers: mutation, body: JSON.stringify({ ...googlePayload, owner_id: ownerId }) }); assert.equal(unknownField.status, 400);
  const saved = await fetch(`${origin}/api/alerts`, { method: 'PUT', headers: mutation, body: JSON.stringify(googlePayload) });
  assert.equal(saved.status, 200, await saved.clone().text());
  const savedSource = await saved.json();
  assert.equal(savedSource.source.enabled, true);
  assert.ok(!JSON.stringify(savedSource).includes('INTERNAL_LEASE_MUST_NOT_LEAK'), 'Mutation responses must project safe source fields too.');
  assert.equal(requests.filter(item => item.path.endsWith('/save_alert_feed')).length, savesBefore + 1);
  const queued = await fetch(`${origin}/api/alerts/run`, { method: 'POST', headers: mutation }); assert.equal(queued.status, 202);
  assert.equal((await queued.json()).status, 'queued'); assert.equal(await readFile(dispatchLog, 'utf8'), 'fixture-alert-dispatched\n');
  for (const [path, method, payload] of [['/api/alerts', 'PUT', googlePayload], ['/api/alerts/run', 'POST', {}]]) {
    const before = requests.length;
    assert.equal((await fetch(`${origin}${path}`, { method, headers: { ...mutation, Origin: 'https://other-site.example' }, body: JSON.stringify(payload) })).status, 403);
    assert.ok(!requests.slice(before).some(item => item.path.startsWith('/rest/v1/')));
  }
  databaseFailed = true;
  const denied = await fetch(`${origin}/api/alerts`, { headers }); assert.equal(denied.status, 503);
  assert.ok(!(await denied.text()).includes('PRIVATE_DATABASE_DETAIL_MUST_NOT_LEAK')); databaseFailed = false;

  const todayHtml = await (await fetch(`${origin}/?view=leads`, { headers })).text();
  assert.equal((todayHtml.match(/role="tab"/g) || []).length, 2);
  assert.match(todayHtml, /Today<\/button>/); assert.match(todayHtml, /Past<\/button>/);
  assert.match(todayHtml, /RESOURCE TITLE/i); assert.match(todayHtml, /DATE DISCOVERED/i);
  assert.match(todayHtml, /Retained Hunter contact fixture/); assert.match(todayHtml, /Google website request fixture/);
  assert.match(todayHtml, /Google Alerts/); assert.ok(todayHtml.includes(googleLead.resource_url));
  assert.ok(!todayHtml.includes(linkedinLead.company), 'Past alert discoveries cannot appear in Today.');
  const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(day.start));
  assert.ok(todayHtml.includes(date)); assert.ok(!todayHtml.includes('buyer@buyer.org'), 'Missing source contacts cannot be invented.');
  const pastHtml = await (await fetch(`${origin}/?view=leads&leadPeriod=past`, { headers })).text();
  assert.match(pastHtml, /Earlier LinkedIn application request fixture/); assert.match(pastHtml, /LinkedIn posts via Google Alerts/);
  assert.ok(pastHtml.includes(linkedinLead.resource_url)); assert.ok(!pastHtml.includes(googleLead.company));
  const leadRead = [...requests].reverse().find(item => item.path === '/rest/v1/workspace_lead_records');
  assert.deepEqual(new URLSearchParams(leadRead.search).getAll('created_at'), [`lt.${day.start}`]);
  const dashboardStart = requests.length;
  assert.equal((await fetch(origin, { headers })).status, 200);
  assert.ok(requests.slice(dashboardStart).some(item => item.path === '/rest/v1/leads'));
  assert.ok(!requests.slice(dashboardStart).some(item => item.path === '/rest/v1/workspace_lead_records'), 'Dashboard contacts remain independent of review-only alert opportunities.');

  if (process.env.ALERTS_BROWSER === '1') {
    const { chromium } = createRequire(import.meta.url)('playwright');
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
      await context.route('**/*', route => {
        const target = new URL(route.request().url());
        return ['127.0.0.1', 'localhost'].includes(target.hostname) ? route.continue() : route.abort();
      });
      await context.addCookies(Array.from(cookies, ([name, value]) => ({ name, value, url: origin })));
      const browserPage = await context.newPage();
      await browserPage.goto(`${origin}/?view=leads`);
      await browserPage.getByRole('columnheader', { name: 'RESOURCE TITLE', exact: true }).waitFor();
      assert.equal(await browserPage.getByRole('tab').count(), 2);
      await browserPage.getByRole('textbox', { name: 'Search company name' }).fill('fixture');
      await browserPage.getByRole('button', { name: 'Search', exact: true }).click();
      await browserPage.waitForURL(url => url.searchParams.get('q') === 'fixture');
      await browserPage.getByRole('tab', { name: 'Past', exact: true }).click();
      await browserPage.waitForURL(url => url.searchParams.get('leadPeriod') === 'past');
      assert.equal(new URL(browserPage.url()).searchParams.get('q'), 'fixture');
      await browserPage.getByRole('button', { name: `View ${linkedinLead.company}`, exact: true }).waitFor();
      await browserPage.getByRole('tab', { name: 'Today', exact: true }).click();
      await browserPage.waitForURL(url => url.searchParams.get('leadPeriod') === 'today');
      assert.equal(new URL(browserPage.url()).searchParams.get('q'), 'fixture');
      await browserPage.getByRole('button', { name: `View ${googleLead.company}`, exact: true }).click();
      const dialog = browserPage.getByRole('dialog');
      await dialog.getByRole('heading', { name: googleLead.company, exact: true }).waitFor();
      assert.ok((await dialog.textContent()).includes(googleLead.alert_snippet));
      assert.equal(await dialog.getByRole('link', { name: 'Open original request' }).getAttribute('href'), googleLead.resource_url);
      assert.equal(await dialog.getByRole('button', { name: 'Save changes', exact: true }).count(), 0);
      assert.equal(await dialog.locator('form').count(), 0, 'Alert details are a read-only source review, not a Hunter contact update.');
      assert.ok((await dialog.textContent()).includes('Not published in the alert'));
      assert.ok(!requests.some(item => item.path === '/rest/v1/enrichment_data'), 'Opening an alert must not call Hunter contact research.');
      await browserPage.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      await browserPage.locator('.sidebar nav').getByRole('button', { name: 'Settings', exact: true }).click();
      await browserPage.getByRole('heading', { name: 'Your business, in your words.', exact: true }).waitFor();
      await browserPage.locator('.sidebar nav').getByRole('button', { name: 'Leads', exact: true }).click();
      await browserPage.getByRole('columnheader', { name: 'RESOURCE TITLE', exact: true }).waitFor();
      await browserPage.screenshot({ path: '/tmp/xchop-alerts-leads.png', fullPage: true });
      await browserPage.goto(`${origin}/alerts`);
      await browserPage.getByRole('heading', { name: 'Google Alerts', exact: true }).waitFor();
      assert.equal(await browserPage.locator('input[type="url"]').count(), 2, 'Each supported source has its own RSS field.');
      assert.equal(await browserPage.locator('input[type="password"]').count(), 0);
      assert.ok((await browserPage.textContent('main')).includes('This is not a direct LinkedIn connection'));
      await browserPage.goto(`${origin}/alerts/setup`);
      await browserPage.getByRole('heading', { name: 'Connect Google Alerts and public LinkedIn posts.', exact: true }).waitFor();
      await browserPage.getByRole('button', { name: 'Copy free-alert setup SQL', exact: true }).waitFor();
      assert.equal(await browserPage.getByRole('link', { name: 'Download resource list PDF', exact: true }).getAttribute('href'), '/resources/free-lead-generation-resources.pdf');
      await browserPage.screenshot({ path: '/tmp/xchop-alerts-setup.png', fullPage: true });
      await browserPage.setViewportSize({ width: 390, height: 844 });
      await browserPage.goto(`${origin}/?view=leads`);
      await browserPage.getByRole('columnheader', { name: 'RESOURCE TITLE', exact: true }).waitFor();
      await browserPage.screenshot({ path: '/tmp/xchop-alerts-leads-mobile.png', fullPage: true });
      assert.ok(await browserPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'The wider source table must scroll within the panel without widening the mobile page.');
      await context.close();
    } finally { await browser.close(); }
  }
  assert.equal(await readFile(blockedLog, 'utf8'), '', 'The HTTP routes must never fetch paid providers, source pages or Google feeds directly.');
  console.log('PASS: free-alert setup/PDF/SQL, authenticated owner settings, no-paid-key readiness, strict feed guards, queued dispatch, safe failures, preserved contact fallback and unified Today/Past lead resources/dates.');
} finally {
  if (child && !childExited) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
  if (mock.listening) { const closed = once(mock, 'close'); mock.close(); mock.closeAllConnections(); await closed; }
  await rm(scratch, { recursive: true, force: true });
}
