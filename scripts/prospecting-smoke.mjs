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
const { indiaDayWindow } = await tsImport('../lib/intent/day-window.ts', import.meta.url);
const ownerId = '00000000-0000-4000-8000-000000000098';
const leadId = '00000000-0000-4000-8000-000000000097';
const runId = '00000000-0000-4000-8000-000000000096';
const inquiryId = '00000000-0000-4000-8000-000000000094';
const leadDay = indiaDayWindow();
const leadFixture = {
  owner_id: ownerId, company: 'Today midnight fixture', country: 'United States', email: 'today@fixture.org',
  contact_name: 'Fixture contact', website: 'https://fixture.org', role: 'Director', stage: 'new', score: 70,
  score_reason: 'Fixture company fit', value: 0, segment: 'Design agency', source: 'Local fixture only',
  lawful_basis: 'Fixture review basis', created_at: leadDay.start, updated_at: new Date().toISOString(),
};
const leadsFixture = [
  { ...leadFixture, id: leadId },
  ...Array.from({ length: 52 }, (_, index) => ({ ...leadFixture,
    id: `00000000-0000-4000-8001-${String(index).padStart(12, '0')}`,
    company: `Past fixture company ${String(index).padStart(2, '0')}`, email: `past${index}@fixture.org`,
    country: index === 51 ? 'Canada' : 'United States',
    created_at: new Date(Date.parse(leadDay.start) - 1 - index * 3_600_000).toISOString(),
  })),
  { ...leadFixture, id: '00000000-0000-4000-8001-000000000099', company: 'Tomorrow boundary fixture', created_at: leadDay.end },
];
const today = new Date().toISOString().slice(0, 10);
const futureDeadline = new Date(Date.now() + 7 * 86_400_000).toISOString();
const inquiryFixture = {
  id: inquiryId, title: 'HTTP fixture website development request',
  request_text: 'We are seeking an external development agency to rebuild our customer website.',
  service: 'website', source_url: 'https://procurement.agency.com/requests/site-rebuild', platform: 'procurement.agency.com',
  published_at: `${today}T00:00:00.000Z`, deadline_at: futureDeadline, country_code: 'US', buyer_name: 'HTTP fixture buyer',
  discovery_query: 'APP SEARCH QUERY ONLY — not private buyer history', discovered_at: new Date().toISOString(),
  contact_name: 'Published contact fixture', contact_email: 'buyer@buyer.org', contact_source_url: 'https://procurement.agency.com/requests/site-rebuild',
};
const priorDayInquiryFixture = { ...inquiryFixture,
  id: '00000000-0000-4000-8000-000000000090', title: 'Previously saved HTTP fixture request',
  source_url: 'https://procurement.agency.com/requests/prior-day-project',
  published_at: new Date(Date.now() - 86_400_000).toISOString(),
  discovered_at: new Date(Date.now() - 86_400_000).toISOString(),
};
const historicalInquiryFixture = { ...priorDayInquiryFixture,
  id: '00000000-0000-4000-8000-000000000089', title: 'Expired fixture request kept for follow-up',
  source_url: 'https://procurement.agency.com/requests/historical-project',
  published_at: new Date(Date.now() - 60 * 86_400_000).toISOString(),
  discovered_at: new Date(Date.now() - 60 * 86_400_000).toISOString(),
  deadline_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
};
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
let contactMigrationMissing = false;
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
  const discoveryTable = ['/rest/v1/prospecting_settings', '/rest/v1/prospecting_runs', '/rest/v1/project_requests'].includes(url.pathname);
  if (discoveryTable || ['/rest/v1/settings', '/rest/v1/suppression_list', '/rest/v1/leads', '/rest/v1/enrichment_data'].includes(url.pathname)) {
    if (url.searchParams.get('owner_id') !== `eq.${ownerId}`) {
      reply({ message: 'Owner filter is mandatory in this regression fixture.' }, 500); return;
    }
  }
  if (migrationMissing && (discoveryTable || ['/rest/v1/rpc/prospecting_usage', '/rest/v1/rpc/project_discovery_readiness', '/rest/v1/rpc/hunter_discovery_readiness'].includes(url.pathname))) {
    reply({ code: discoveryTable ? 'PGRST205' : 'PGRST202', message: 'MOCK_PRIVATE_DATABASE_DETAIL_MUST_NOT_LEAK' }, 404); return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/project_discovery_readiness') {
    reply({ schema_version: 6 }); return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/hunter_discovery_readiness') {
    reply({ schema_version: 9 }); return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/hunter_restoration_config') {
    reply({ ...defaultProspectingConfig, enabled: true, lawfulBasis: config.lawfulBasis, dailyLeadLimit: config.dailyLeadLimit, dailyRequestLimit: config.dailyRequestLimit }); return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/restore_hunter_discovery') {
    config = { ...defaultProspectingConfig, enabled: true, lawfulBasis: config.lawfulBasis, dailyLeadLimit: config.dailyLeadLimit, dailyRequestLimit: config.dailyRequestLimit };
    reply({ data: config, version: 3, next_run_at: new Date().toISOString() }); return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/queue_prospecting_run') {
    assert.equal(config.discoveryMode, 'company_contacts'); assert.equal(config.enabled, true);
    reply(runId); return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/workspace_dashboard') {
    reply({ leadCount: 0, sentCount: 0, replyRate: 0, wonCount: 0, pipelineValue: 0, quoteCount: 0, revenue: [], funnel: [], markets: [], attention: [] }); return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/settings') {
    reply([{ data: {} }]); return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/project_requests') {
    const dailyView = url.searchParams.getAll('discovered_at').length > 0;
    if (dailyView) {
      assert.ok(url.searchParams.get('published_at')?.startsWith('gte.'), 'Daily discoveries must be recent.');
      assert.match(url.searchParams.get('or') || '', /deadline_at\.is\.null,deadline_at\.gte\./, 'Daily discoveries must not be expired.');
    } else {
      assert.equal(url.searchParams.get('published_at'), null, 'Earlier saved requests remain accessible for follow-ups.');
      assert.equal(url.searchParams.get('or'), null, 'Passed deadlines are history, not new daily opportunities.');
    }
    assert.ok(!url.searchParams.get('select')?.includes('sourceText'), 'Full source pages must not be returned.');
    if (contactMigrationMissing && url.searchParams.get('select')?.includes('contact_name')) {
      reply({ code: '42703', message: 'column project_requests.contact_name does not exist' }, 400); return;
    }
    const discoveredFilters = url.searchParams.getAll('discovered_at');
    if (discoveredFilters.length) {
      assert.equal(discoveredFilters.length, 2, 'The daily batch requires inclusive start and exclusive end boundaries.');
      const start = discoveredFilters.find(value => value.startsWith('gte.'))?.slice(4);
      const end = discoveredFilters.find(value => value.startsWith('lt.'))?.slice(3);
      assert.ok(start && end); assert.equal(Date.parse(end) - Date.parse(start), 86_400_000);
      assert.ok(start.endsWith('T18:30:00.000Z'), 'India midnight is 18:30 UTC on the previous day.');
      assert.ok(Date.parse(start) <= Date.now() && Date.now() < Date.parse(end));
    }
    const records = [inquiryFixture, priorDayInquiryFixture, historicalInquiryFixture].filter(row => discoveredFilters.every(value =>
      value.startsWith('gte.') ? Date.parse(row.discovered_at) >= Date.parse(value.slice(4)) : Date.parse(row.discovered_at) < Date.parse(value.slice(3))));
    response.setHeader('Content-Range', records.length ? `0-${records.length - 1}/${records.length}` : '*/0');
    if (contactMigrationMissing) {
      reply(records.map(({ contact_name, contact_email, contact_source_url, ...legacyRequest }) => legacyRequest)); return;
    }
    reply(records); return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/prospecting_settings') {
    reply([{ data: config, next_run_at: null }]); return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/prospecting_runs') {
    const columns = url.searchParams.get('select');
    if (!columns || columns === '*' || columns.includes('claim_token')) { reply({ message: 'Run query requested unsafe columns.' }, 500); return; }
    assert.match(url.searchParams.get('or') ?? '', /config_snapshot->>discoveryMode.is.null,config_snapshot->>discoveryMode.eq.company_contacts/, 'Hunter history must include legacy snapshots and exclude project-mode runs.');
    reply([{ id: runId, owner_id: ownerId, status: 'completed', trigger_source: 'scheduled', created_at: '2026-01-01T00:00:00Z', started_at: '2026-01-01T00:01:00Z', finished_at: '2026-01-01T00:02:00Z', companies_found: 7, leads_saved: 3, skipped_count: 4, request_count: 12, error_code: null, message: 'HTTP regression completed.' }]); return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/prospecting_usage') {
    reply({ requests: 12, leads_saved: 17, company_leads_saved: 14, project_requests_saved: 3, day_start: '2026-01-01T00:00:00Z' }); return;
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
  if (request.method === 'GET' && url.pathname === '/rest/v1/workspace_lead_records') {
    assert.equal(url.searchParams.get('owner_id'), `eq.${ownerId}`);
    reply({ code: 'PGRST205', message: 'Free alert setup is not installed in this legacy fixture.' }, 404); return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/leads') {
    if (url.searchParams.has('id')) {
      reply(url.searchParams.get('id') === `eq.${leadId}` ? [{ id: leadId }] : []); return;
    }
    const dates = url.searchParams.getAll('created_at');
    let records = leadsFixture.filter(row => dates.every(value => value.startsWith('gte.')
      ? Date.parse(row.created_at) >= Date.parse(value.slice(4)) : value.startsWith('lt.') && Date.parse(row.created_at) < Date.parse(value.slice(3))));
    const company = url.searchParams.get('company');
    if (company) records = records.filter(row => row.company.toLowerCase().includes(company.slice('ilike.%'.length, -1).toLowerCase()));
    const country = url.searchParams.get('country');
    if (country) records = records.filter(row => row.country === country.slice(3));
    records.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const page = records.slice(offset, offset + limit);
    response.setHeader('Content-Range', page.length ? `${offset}-${offset + page.length - 1}/${records.length}` : `*/${records.length}`);
    reply(page); return;
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
  const dispatchedLog = join(scratch, 'dispatched.log');
  await writeFile(blockedLog, '');
  await writeFile(dispatchedLog, '');
  const guard = join(scratch, 'localhost-fetch-only.mjs');
  await writeFile(guard, `import { appendFileSync } from 'node:fs';
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input, init) {
  const value = typeof input === 'string' || input instanceof URL ? input : input.url;
  const url = new URL(value);
  if (url.hostname === 'inn.gs' && url.pathname.startsWith('/e/')) {
    appendFileSync(${JSON.stringify(dispatchedLog)}, 'fixture-event-dispatched\\n');
    return Promise.resolve(new Response(JSON.stringify({ ids: ['fixture-dispatch'], status: 200 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    appendFileSync(${JSON.stringify(blockedLog)}, url.origin + '\\n');
    throw new Error('HTTP regression blocks external provider requests.');
  }
  return originalFetch(input, init);
};\n`);
  const startApp = async (serverCredentials = {}) => {
    childExited = false;
    child = spawn(process.execPath, ['--import', pathToFileURL(guard).href, 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3217'], {
      cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'], env: {
        ...process.env, NEXT_PUBLIC_SUPABASE_URL: mockOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey, NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
        HUNTER_API_KEY: '', TAVILY_API_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', AUTOMATION_OWNER_ID: '', INNGEST_EVENT_KEY: '', INNGEST_SIGNING_KEY: '', INNGEST_DEV: '',
        ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: '', APP_URL: origin, NEXT_TELEMETRY_DISABLED: '1',
        ...serverCredentials,
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
  };
  await startApp();
  const headers = { cookie };
  const mutation = { ...headers, Origin: origin, 'Content-Type': 'application/json' };

  const publicStart = requests.length;
  const guide = await fetch(`${origin}/prospecting/setup`);
  assert.equal(guide.status, 200);
  const guideHtml = await guide.text();
  assert.match(guideHtml, /Hunter/); assert.match(guideHtml, /Inngest/);
  assert.match(guideHtml, /Copy Hunter restoration SQL/);
  const sql = await fetch(`${origin}/migrations/009_restore_hunter_discovery.sql`);
  assert.equal(sql.status, 200);
  assert.ok((await sql.text()) === (await readFile(new URL('../supabase/migrations/009_restore_hunter_discovery.sql', import.meta.url), 'utf8')), 'Public copy SQL must match the reviewed migration exactly.');
  const repairSql = await fetch(`${origin}/migrations/008_discovery_reliability.sql`);
  assert.equal(repairSql.status, 200);
  assert.equal(await repairSql.text(), await readFile(new URL('../supabase/migrations/008_discovery_reliability.sql', import.meta.url), 'utf8'));
  const signedOut = await fetch(`${origin}/prospecting`, { redirect: 'manual' });
  assert.equal(signedOut.status, 307);
  assert.equal(new URL(signedOut.headers.get('location'), origin).pathname, '/login');
  for (const path of ['/api/prospecting', '/api/suppression', '/api/inquiries']) assert.equal((await fetch(`${origin}${path}`)).status, 401);
  assert.ok(!requests.slice(publicStart).some(item => item.path.startsWith('/rest/v1/')), 'Anonymous requests must not read owner data.');

  const page = await fetch(`${origin}/prospecting`, { headers, redirect: 'manual' });
  assert.equal(page.status, 200, `Authenticated discovery page must open. Rebuild without configured NEXT_PUBLIC values if it redirects to setup.\n${output}`);
  assert.ok((await page.text()).includes(ownerEmail));
  const statusResponse = await fetch(`${origin}/api/prospecting`, { headers });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.migrationReady, true); assert.equal(status.enabled, false); assert.equal(status.readiness.ready, false);
  assert.deepEqual(status.usage, { requestsToday: 12, leadsToday: 14, dayStart: '2026-01-01T00:00:00Z' });
  assert.equal(status.runs[0].leads_saved, 3); assert.equal(status.runs[0].id, runId);
  assert.equal(status.provider, 'hunter'); assert.equal(status.restorationPending, false); assert.equal(status.health.code, 'paused');
  const previousConfig = config;
  config = { ...config, discoveryMode: 'project_requests', enabled: true, keywords: ['website development'] };
  const pending = await (await fetch(`${origin}/api/prospecting`, { headers })).json();
  assert.equal(pending.restorationPending, true); assert.equal(pending.enabled, false);
  assert.equal(pending.config.discoveryMode, 'company_contacts'); assert.equal(pending.config.intervalHours, 6);
  assert.deepEqual(pending.config.keywords, defaultProspectingConfig.keywords);
  assert.equal((await fetch(`${origin}/api/prospecting/restore`, { method: 'POST', headers: mutation })).status, 409);
  assert.ok(!requests.some(item => item.path.endsWith('/restore_hunter_discovery')), 'Missing Hunter connections must block the source switch.');
  config = previousConfig;
  assert.ok(!JSON.stringify(status).includes(accessToken)); assert.ok(!JSON.stringify(status).includes('claim_token'));
  const inquiriesPage = await fetch(`${origin}/inquiries`, { headers, redirect: 'manual' });
  assert.equal(inquiriesPage.status, 200);
  const inquiriesHtml = await inquiriesPage.text();
  assert.match(inquiriesHtml, /See the request behind the lead/);
  assert.match(inquiriesHtml, /New today/); assert.match(inquiriesHtml, /Saved requests/);
  const inquiryResponse = await fetch(`${origin}/api/inquiries`, { headers });
  assert.equal(inquiryResponse.status, 200);
  const inquiries = await inquiryResponse.json();
  assert.equal(inquiries.migrationReady, true);
  assert.equal(inquiries.pagination.total, 1);
  assert.equal(inquiries.inquiries[0].id, inquiryFixture.id);
  assert.equal(inquiries.inquiries[0].request_text, inquiryFixture.request_text);
  assert.equal(inquiries.inquiries[0].service, 'website');
  assert.equal(inquiries.inquiries[0].discovery_query, inquiryFixture.discovery_query);
  assert.equal(inquiries.inquiries[0].contact_name, inquiryFixture.contact_name);
  assert.equal(inquiries.inquiries[0].contact_email, inquiryFixture.contact_email);
  assert.equal(inquiries.contactStorageReady, true);
  assert.ok(!JSON.stringify(inquiries).includes('rawContent'));
  const savedResponse = await fetch(`${origin}/api/inquiries?period=saved`, { headers });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.pagination.total, 3, 'Prior-day and expired requests stay available for follow-ups, without appearing as new today.');
  assert.ok(saved.inquiries.some(row => row.id === priorDayInquiryFixture.id));
  assert.ok(saved.inquiries.some(row => row.id === historicalInquiryFixture.id));
  assert.equal((await fetch(`${origin}/api/inquiries?period=unsupported`, { headers })).status, 400);
  contactMigrationMissing = true;
  const withoutContactStorage = await fetch(`${origin}/api/inquiries`, { headers });
  assert.equal(withoutContactStorage.status, 200, 'Contact migration is additive, not a blocker for existing requests.');
  const compatible = await withoutContactStorage.json();
  assert.equal(compatible.contactStorageReady, false);
  assert.equal(compatible.inquiries[0].request_text, inquiryFixture.request_text);
  assert.equal('contact_email' in compatible.inquiries[0], false, 'Missing storage must not invent contact details.');
  contactMigrationMissing = false;
  const legacyView = await fetch(`${origin}/?view=leads`, { headers, redirect: 'manual' });
  assert.equal(legacyView.status, 200);
  const todayHtml = await legacyView.text();
  assert.match(todayHtml, /Business prospects/);
  assert.equal((todayHtml.match(/role="tab"/g) || []).length, 2, 'Leads has exactly Today and Past tabs.');
  assert.match(todayHtml, /Today<\/button>/); assert.match(todayHtml, /Past<\/button>/);
  assert.match(todayHtml, /Date discovered/i); assert.match(todayHtml, /Today midnight fixture/);
  assert.ok(!todayHtml.includes('Past fixture company'), 'Past companies must not leak into Today.');
  assert.ok(!todayHtml.includes('Tomorrow boundary fixture'), 'The end of Today is exclusive.');
  const formattedLeadDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(leadDay.start));
  assert.ok(todayHtml.includes(formattedLeadDate), 'The discovery column uses the original first-save date in India.');
  const todayRead = [...requests].reverse().find(item => item.path === '/rest/v1/leads');
  assert.deepEqual(new URLSearchParams(todayRead.search).getAll('created_at'), [`gte.${leadDay.start}`, `lt.${leadDay.end}`]);
  const pastView = await fetch(`${origin}/?view=leads&leadPeriod=past`, { headers, redirect: 'manual' });
  assert.equal(pastView.status, 200);
  const pastHtml = await pastView.text();
  assert.match(pastHtml, /Past fixture company 00/); assert.match(pastHtml, /Past fixture company 49/);
  assert.ok(!pastHtml.includes('Today midnight fixture')); assert.ok(!pastHtml.includes('Past fixture company 51'));
  const pastRead = [...requests].reverse().find(item => item.path === '/rest/v1/leads');
  assert.deepEqual(new URLSearchParams(pastRead.search).getAll('created_at'), [`lt.${leadDay.start}`]);
  const pastSecond = await (await fetch(`${origin}/?view=leads&leadPeriod=past&p=2`, { headers })).text();
  assert.match(pastSecond, /Past fixture company 50/); assert.match(pastSecond, /Past fixture company 51/);
  assert.ok(!pastSecond.includes('Today midnight fixture'), 'Past pagination remains confined to the selected period.');
  const filteredPast = await (await fetch(`${origin}/?view=leads&leadPeriod=past&q=company%2051&country=Canada`, { headers })).text();
  assert.match(filteredPast, /Past fixture company 51/); assert.ok(!filteredPast.includes('Past fixture company 50'));
  const outOfRange = await fetch(`${origin}/?view=leads&leadPeriod=past&p=99&q=company%2051&country=Canada`, { headers, redirect: 'manual' });
  assert.equal(outOfRange.status, 307);
  const corrected = new URL(outOfRange.headers.get('location'), origin);
  assert.equal(corrected.searchParams.get('view'), 'leads'); assert.equal(corrected.searchParams.get('leadPeriod'), 'past');
  assert.equal(corrected.searchParams.get('q'), 'company 51'); assert.equal(corrected.searchParams.get('country'), 'Canada');
  const dashboardStart = requests.length;
  assert.equal((await fetch(origin, { headers })).status, 200);
  assert.equal(new URLSearchParams(requests.slice(dashboardStart).find(item => item.path === '/rest/v1/leads').search).has('created_at'), false, 'The dashboard recent-leads preview remains independent of the lead tabs.');

  migrationMissing = true;
  const missingResponse = await fetch(`${origin}/api/prospecting`, { headers });
  assert.equal(missingResponse.status, 200);
  const missing = await missingResponse.json();
  assert.equal(missing.migrationReady, false); assert.equal(missing.enabled, false); assert.equal(missing.readiness.ready, false);
  assert.deepEqual(missing.runs, []); assert.equal(missing.config.enabled, false);
  assert.ok(!JSON.stringify(missing).includes('MOCK_PRIVATE_DATABASE_DETAIL_MUST_NOT_LEAK'));
  const missingInquiries = await (await fetch(`${origin}/api/inquiries`, { headers })).json();
  assert.equal(missingInquiries.migrationReady, false);
  assert.deepEqual(missingInquiries.inquiries, []);
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
  for (const [path, method, body] of [['/api/prospecting', 'PUT', pausedConfig], ['/api/prospecting/run', 'POST', {}], ['/api/prospecting/restore', 'POST', {}], ['/api/suppression', 'POST', { email: 'bad@example.test', reason: 'bounced' }]]) {
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
  assert.equal(await readFile(dispatchedLog, 'utf8'), '', 'Keyless and paused requests must not dispatch jobs.');
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;

  // Restart with fixture credentials to exercise the complete owner restoration
  // route. Inngest dispatch is intercepted above; no provider receives a request.
  config = { ...previousConfig, discoveryMode: 'project_requests', enabled: true, keywords: ['website development'], intervalHours: 24 };
  await startApp({
    HUNTER_API_KEY: 'a'.repeat(40),
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_hunter_smoke_fixture_credential_123456789',
    AUTOMATION_OWNER_ID: ownerId,
    INNGEST_EVENT_KEY: 'fixture-event-key-12345678901234567890',
    INNGEST_SIGNING_KEY: 'fixture-signing-key-12345678901234567890',
  });
  assert.equal((await fetch(`${origin}/api/prospecting/restore`, { method: 'POST', headers: { Origin: origin } })).status, 401);
  const readyPreview = await (await fetch(`${origin}/api/prospecting`, { headers })).json();
  assert.equal(readyPreview.restorationPending, true); assert.equal(readyPreview.readiness.ready, true);
  assert.equal(requests.filter(item => item.path.endsWith('/restore_hunter_discovery')).length, 0, 'Reading status cannot enable discovery.');
  const restorationResponse = await fetch(`${origin}/api/prospecting/restore`, { method: 'POST', headers: mutation });
  const restoration = await restorationResponse.json();
  assert.equal(restorationResponse.status, 202, JSON.stringify(restoration));
  assert.equal(restoration.runId, runId); assert.equal(restoration.status, 'queued');
  assert.equal(config.discoveryMode, 'company_contacts'); assert.equal(config.enabled, true);
  assert.equal(config.intervalHours, 6);
  assert.equal(config.dailyLeadLimit, previousConfig.dailyLeadLimit); assert.equal(config.dailyRequestLimit, previousConfig.dailyRequestLimit);
  assert.equal(requests.filter(item => item.path.endsWith('/restore_hunter_discovery')).length, 1);
  assert.equal(requests.filter(item => item.path.endsWith('/queue_prospecting_run')).length, 1);
  assert.equal(await readFile(dispatchedLog, 'utf8'), 'fixture-event-dispatched\n', 'The restored run must dispatch through the scheduler.');
  const restoredStatus = await (await fetch(`${origin}/api/prospecting`, { headers })).json();
  assert.equal(restoredStatus.restorationPending, false); assert.equal(restoredStatus.enabled, true);
  assert.equal(restoredStatus.readiness.ready, true); assert.equal(restoredStatus.provider, 'hunter');
  assert.equal(await readFile(blockedLog, 'utf8'), '', 'No tested route may attempt an external provider fetch.');
  console.log('PASS: Today/Past lead tabs with India boundaries, original discovery dates, filtered pagination, Hunter restoration/queue/dispatch, readiness/history/usage, exact009 SQL, preserved archive, owner isolation, keyless pause, suppression/research guards, and unsigned jobs.');
} finally {
  if (child && !childExited) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
  if (mock.listening) { const closed = once(mock, 'close'); mock.close(); mock.closeAllConnections(); await closed; }
  await rm(scratch, { recursive: true, force: true });
}
