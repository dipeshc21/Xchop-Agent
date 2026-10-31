import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { defaultProspectingConfig } from '../lib/prospecting/types';
import type { ProjectEvidence } from '../lib/intent/types';
import { qualifyProjectRequest } from '../lib/intent/evidence';

const owner = '66000000-0000-4000-8000-000000000001';
const other = '66000000-0000-4000-8000-000000000002';
const token = 'project-worker-lease-token-primary';
const replacement = 'project-worker-lease-token-replacement';
const enabled = { ...defaultProspectingConfig, enabled: true, discoveryMode: 'project_requests', services: ['website', 'application'], maxAgeDays: 30,
  countries: ['US'], keywords: ['website development'], dailyLeadLimit: 2, dailyRequestLimit: 5, lawfulBasis: 'Respond only to explicit public project requests after checking the source and eligibility.' };

test('database accepts the source-bound service and country evidence produced by the real qualifier', async () => {
  const { db, start, save } = await setup();
  try {
    const run = await start({ ...enabled, dailyLeadLimit: 100, countries: ['US', 'GB', 'DE'] });
    const cases = [
      ['United States', 'We are seeking an external agency to develop our customer booking application.'],
      ['United States', 'The council invites qualified quotations to develop an online store.'],
      ['United States', 'Our city seeks an agency to design and implement a new landing page.'],
      ['United States', 'We require an external development partner to build custom software for appointment scheduling.'],
      ['United States', 'We are seeking a development agency to build a mobile app and a website.'],
      ['Northern Ireland', 'We are seeking an external agency to develop a new customer website.'],
      ['Deutschland', 'We are seeking an external agency to develop a new customer website.'],
    ];
    for (let index = 0; index < cases.length; index++) {
      const [country, request] = cases[index];
      const sourceText = `Published: ${date(-1)}\nBuyer country: ${country}\n${request}`;
      const result = qualifyProjectRequest({ title: 'Development project request', url: `https://procurement.buyer.org/requests/compatibility-${index}`, rawContent: sourceText, publishedDate: null },
        { countries: ['US', 'GB', 'DE'], services: ['website', 'application'], maxAgeDays: 30 });
      assert.equal(result.qualified, true, `Expected explicit request to qualify: ${request}`);
      if (!result.qualified) continue;
      const persisted = await save(run, { evidence: result.evidence, sourceText, discoveryQuery: 'public development requests' });
      assert.equal(persisted.status, 'saved', `SQL must accept the qualifier's ${result.evidence.service} evidence for ${country}`);
    }
  } finally { await db.close(); }
});
const date = (days: number) => { const value = new Date(); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
function project(url = 'https://procurement.buyer.org/requests/website-1', changes: Partial<ProjectEvidence> = {}) {
  const e: ProjectEvidence = {
    version: 1, title: 'Request for proposals: website development', requestText: 'We are seeking an external development agency to rebuild our website and online ordering service.',
    service: 'website', sourceUrl: url, platform: 'procurement.buyer.org', publishedAt: `${date(-1)}T00:00:00.000Z`, publishedDateText: date(-1),
    deadlineAt: `${date(7)}T23:59:59.999Z`, deadlineText: date(7), countryCode: 'US', countryEvidence: 'Buyer country: United States', buyerName: 'Example City', ...changes,
  };
  return { evidence: e, sourceText: `Buyer: Example City\nPublished: ${e.publishedDateText}\n${e.countryEvidence}\n${e.deadlineText ? `Deadline: ${e.deadlineText}\n` : ''}${e.requestText}`,
    discoveryQuery: 'website development request for proposals United States' };
}
async function setup(includeProjectMigration = true) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema auth,storage to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;`);
  for (const name of ['001_foundation.sql', '002_live_workspace.sql', '003_dashboard_summary.sql', '004_restore_workspace_access.sql', '005_automatic_prospecting.sql']) {
    await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  }
  await db.exec(`insert into auth.users(id) values('${owner}'),('${other}');`);
  const apply = async () => db.exec(await readFile('supabase/migrations/006_project_requests.sql', 'utf8'));
  if (includeProjectMigration) await apply();
  const auth = async (id = owner) => db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
  const service = async () => db.exec('reset role;set role service_role;');
  const rpc = async <T = Record<string, unknown>>(call: string, args: unknown[] = []) => (await db.query<{ result: T }>(`select public.${call} as result`, args)).rows[0].result;
  const start = async (config = enabled) => { await auth(); await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify(config)]); const run = await rpc<string>('queue_prospecting_run()'); await service(); await rpc('claim_prospecting_run($1,$2,$3)', [owner, run, token]); return run; };
  const save = async (run: string, payload = project(), claimToken = token) => rpc<{ status: string; request_id?: string }>('save_discovered_project_request($1,$2,$3,$4::jsonb)', [owner, run, claimToken, JSON.stringify(payload)]);
  const record = async (run: string, url: string, status = 'processing') => rpc<{ status: string; candidate_status?: string }>('record_project_request_candidate($1,$2,$3,$4,$5,$6)', [owner, run, token, url, status, null]);
  return { db, apply, auth, service, rpc, start, save, record };
}

test('migration preserves old contacts, cancels old company discovery and requires explicit new settings', async () => {
  const { db, apply, auth, service, rpc } = await setup(false);
  try {
    const { discoveryMode: _mode, services: _services, maxAgeDays: _age, ...legacy } = enabled;
    await auth(); await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify(legacy)]);
    const oldRun = await rpc<string>('queue_prospecting_run()');
    await rpc('create_workspace_lead($1::jsonb)', [JSON.stringify({ company: 'Previously saved contact', email: 'owner@old-contact.org', country: 'United States', source: 'Earlier owner contact', lawful_basis: 'Known business referral' })]);
    await db.exec('reset role'); await apply();
    await auth();
    const config = (await db.query<{ data: Record<string, unknown>; version: number; next_run_at: unknown }>('select data,version,next_run_at from public.prospecting_settings')).rows[0];
    assert.equal(config.data.enabled, false); assert.equal(config.data.discoveryMode, 'project_requests'); assert.deepEqual(config.data.services, ['website', 'application']);
    assert.equal(config.version, 2); assert.equal(config.next_run_at, null);
    assert.equal((await db.query<{ status: string }>('select status from public.prospecting_runs where id=$1', [oldRun])).rows[0].status, 'cancelled');
    assert.equal((await db.query('select id from public.leads')).rows.length, 1);
    assert.deepEqual(await rpc('project_discovery_readiness()'), { schema_version: 6 });
    await assert.rejects(rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify(legacy)]), /PROSPECTING_INVALID/);
    await service();
    assert.equal((await rpc<{ status: string }>('persist_discovered_lead($1,$2,$3::jsonb,$4)', [owner, oldRun, '{}', token])).status, 'project_evidence_required');
    assert.equal(await rpc('claim_prospecting_run($1,$2,$3)', [owner, oldRun, token]), null);
    assert.equal(await rpc('queue_due_prospecting_run($1)', [owner]), null);
  } finally { await db.close(); }
});

test('public project evidence is source-bound, owner-isolated, deduplicated by request and saved without fabricated contact data', async () => {
  const { db, auth, service, rpc, start, save, record } = await setup();
  try {
    const run = await start();
    const fixture = project();
    await auth();
    await assert.rejects(save(run), /permission denied/);
    await assert.rejects(db.exec("insert into public.project_requests(owner_id) values('66000000-0000-4000-8000-000000000001')"), /permission denied/);
    await assert.rejects(rpc('check_project_request_capacity($1,$2,$3)', [owner, run, token]), /permission denied/);
    await service();
    assert.equal((await rpc<{ allowed: boolean }>('check_project_request_capacity($1,$2,$3)', [owner, run, token])).allowed, true);
    assert.equal((await record(run, fixture.evidence.sourceUrl)).status, 'created');
    assert.equal((await record(run, fixture.evidence.sourceUrl)).status, 'existing');
    assert.equal((await save(run, { ...fixture, evidence: { ...fixture.evidence, requestText: 'We need a mobile application that does not occur in the source page.' } })).status, 'evidence_required');
    assert.equal((await save(run, { ...fixture, evidence: { ...fixture.evidence, platform: 'invented-platform.org' } })).status, 'evidence_required');
    assert.equal((await save(run, { ...fixture, evidence: { ...fixture.evidence, publishedAt: `${date(1)}T00:00:00.000Z` } })).status, 'invalid');
    assert.equal((await save(run, { ...fixture, sourceText: fixture.sourceText.replace('Published:', 'Last updated:') })).status, 'evidence_required');
    assert.equal((await save(run, { ...fixture, evidence: { ...fixture.evidence, deadlineText: null, deadlineAt: null } })).status, 'evidence_required');
    assert.equal((await save(run, { ...fixture, sourceText: fixture.sourceText.replace(`Deadline: ${fixture.evidence.deadlineText}`, `Deadline: ${fixture.evidence.deadlineText} at 09:00 UTC`) })).status, 'evidence_required');
    assert.equal((await save(run, { ...fixture, sourceText: fixture.sourceText + '\nStatus: Closed' })).status, 'evidence_required');
    assert.equal((await save(run, { ...fixture, sourceText: `Published: ${date(-60)}\n` + fixture.sourceText })).status, 'evidence_required');

    assert.equal((await save(run, { ...fixture, sourceText: fixture.sourceText.replace(fixture.evidence.countryEvidence, 'Buyer: A company somewhere') })).status, 'evidence_required');
    for (const sourceUrl of ['http://127.0.0.1/requests/1', 'https://name:password@buyer.org/1', 'https://buyer.local/1', 'https://buyer.org:9000/1', 'https://buyer.org/1?api_key=private', 'https://buyer.org/1?utm_source=email', 'https://buyer.org/1#section']) {
      assert.equal((await save(run, project(sourceUrl, { platform: 'buyer.org' }))).status, 'evidence_required');
    }
    const unknownField = { ...fixture, evidence: { ...fixture.evidence, searchHistory: 'Never invent this' } };
    assert.equal((await save(run, unknownField)).status, 'invalid');
    assert.equal((await save(run, { ...fixture, sourceText: 'a'.repeat(60001) })).status, 'invalid');
    assert.equal((await save(run, fixture, replacement)).status, 'paused');
    const saved = await save(run, fixture); assert.equal(saved.status, 'saved');
    assert.equal((await save(run, fixture)).status, 'duplicate');
    assert.equal((await record(run, fixture.evidence.sourceUrl)).candidate_status, 'saved', 'Earlier replay cannot downgrade saved evidence.');
    assert.equal((await save(run, project('https://procurement.buyer.org/requests/website-2'))).status, 'saved', 'Same buyer can have two distinct projects.');
    await auth();
    const rows = await db.query<{ evidence: Record<string, unknown>; request_text: string; service: string; discovery_query: string }>('select evidence,request_text,service,discovery_query from public.project_requests');
    assert.equal(rows.rows.length, 2); assert.equal(rows.rows[0].request_text, fixture.evidence.requestText);
    assert.deepEqual(rows.rows[0].evidence, fixture.evidence); assert.equal(Object.hasOwn(rows.rows[0].evidence, 'sourceText'), false);
    assert.equal(Object.hasOwn(rows.rows[0], 'email'), false); assert.equal(rows.rows[0].service, 'website');
    await assert.rejects(db.exec('delete from public.project_requests'), /permission denied/);
    await auth(other); assert.equal((await db.query('select id from public.project_requests')).rows.length, 0);
    assert.equal((await db.query('select run_id from public.project_request_candidates')).rows.length, 0);
    await db.exec('reset role;set role anon;'); await assert.rejects(db.query('select id from public.project_requests'), /permission denied/);
    await assert.rejects(rpc('project_discovery_readiness()'), /permission denied/);
  } finally { await db.close(); }
});

test('dated request freshness, buyer country, offered service, UTC daily caps and immutable run totals are enforced', async () => {
  const { db, auth, service, rpc, start, save, record } = await setup();
  try {
    const run = await start({ ...enabled, services: ['website'] });
    assert.equal((await save(run, project(undefined, { countryCode: 'GB', countryEvidence: 'Buyer country: United Kingdom' }))).status, 'country_excluded');
    assert.equal((await save(run, project(undefined, { countryCode: 'US', countryEvidence: 'Buyer country: India' }))).status, 'country_excluded');
    assert.equal((await save(run, project(undefined, { service: 'application', requestText: 'We are seeking an external agency for mobile application development and maintenance.' }))).status, 'service_excluded');
    assert.equal((await save(run, project(undefined, { service: 'website_and_application', requestText: 'We are seeking an agency to rebuild our website and mobile application together.' }))).status, 'service_excluded');
    assert.equal((await save(run, project(undefined, { publishedDateText: date(-35), publishedAt: `${date(-35)}T00:00:00.000Z` }))).status, 'stale');
    assert.equal((await save(run, project(undefined, { deadlineText: date(-1), deadlineAt: `${date(-1)}T23:59:59.999Z` }))).status, 'stale');
    await record(run, project().evidence.sourceUrl);
    assert.equal((await save(run)).status, 'saved');
    const second = project('https://procurement.buyer.org/requests/second'); await record(run, second.evidence.sourceUrl);
    assert.equal((await save(run, second)).status, 'saved');
    assert.equal((await save(run, project('https://procurement.buyer.org/requests/third'))).status, 'daily_limit');
    assert.equal((await rpc<{ reason: string }>('check_project_request_capacity($1,$2,$3)', [owner, run, token])).reason, 'daily_lead_limit');
    // Administrative deletion still cannot reset the immutable published-request budget.
    await db.exec('reset role'); await db.exec("delete from public.project_requests where source_url like '%second'"); await service();
    assert.equal((await save(run, second)).status, 'duplicate');
    assert.equal((await save(run, project('https://procurement.buyer.org/requests/third'))).status, 'daily_limit');
    await auth(); await db.exec("set timezone='Asia/Kolkata'");
    const usage = await rpc<{ requests: number; leads_saved: number; project_requests_saved: number; day_start: string }>('prospecting_usage()');
    assert.equal(usage.project_requests_saved, 2); assert.equal(usage.leads_saved, 2); assert.equal(new Date(usage.day_start).getUTCHours(), 0);
    await service();
    assert.equal(await rpc('finish_prospecting_run($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)', [owner, run, token, 'completed', '{"skipped_count":4}', 'Published project request review completed', null, 1, '{}']), true);
    await auth();
    const finished = (await db.query<{ leads_saved: number; companies_found: number }>('select leads_saved,companies_found from public.prospecting_runs where id=$1', [run])).rows[0];
    assert.equal(finished.leads_saved, 2); assert.equal(finished.companies_found, 2);
  } finally { await db.close(); }
});

test('Tavily paid requests use reservations and bounded checkpoints, then discard page text after pause or completion', async () => {
  const { db, auth, service, rpc, start } = await setup();
  try {
    const run = await start();
    const reserve = (operation: string, provider = 'tavily') => rpc<{ state: string; status: string; result?: unknown }>('reserve_prospecting_request($1,$2,$3,$4,$5)', [owner, run, operation, provider, token]);
    assert.equal((await reserve('company-only-source', 'hunter')).status, 'paused');
    assert.equal((await reserve('search')).status, 'reserved');
    assert.equal((await reserve('search')).status, 'uncertain');
    const result = { query: 'public website project requests', page: { results: [{ title: 'Public project', url: 'https://procurement.buyer.org/requests/1', rawContent: 'x'.repeat(70000), publishedDate: null }] } };
    await rpc('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)', [owner, run, 'search', token, JSON.stringify(result), null]);
    const cached = await reserve('search'); assert.equal(cached.status, 'cached'); assert.deepEqual(cached.result, result);
    await assert.rejects(rpc('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)', [owner, run, 'search', token, '{"api_key":"never-store"}', null]), /PROSPECTING_UNSAFE_RESULT/);
    for (let i = 0; i < 4; i++) assert.equal((await reserve(`search-${i}`)).status, 'reserved');
    assert.equal((await reserve('over-budget')).status, 'budget_exhausted');
    assert.equal((await rpc<{ reason: string }>('check_project_request_capacity($1,$2,$3)', [owner, run, token])).reason, 'daily_request_limit');
    await auth(); await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify({ ...enabled, enabled: false })]);
    await service();
    assert.equal((await rpc<{ status: string }>('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)', [owner, run, 'search-0', token, JSON.stringify(result), null])).status, 'completed');
    const stored = (await db.query<{ result: { query: string; page: { results: Record<string, unknown>[] } } }>("select result from public.prospecting_requests where operation in ('search','search-0') order by operation")).rows;
    assert.ok(stored.every(row => row.result.page.results.every(item => !Object.hasOwn(item, 'rawContent'))));
    assert.equal((await rpc<{ allowed: boolean }>('check_project_request_capacity($1,$2,$3)', [owner, run, token])).allowed, false);
    assert.equal((await reserve('paused')).status, 'paused');
    await auth(); await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify({ ...enabled, dailyRequestLimit: 6 })]);
    const next = await rpc<string>('queue_prospecting_run()'); await service(); await rpc('claim_prospecting_run($1,$2,$3)', [owner, next, token]);
    assert.equal((await rpc<{ status: string }>('reserve_prospecting_request($1,$2,$3,$4,$5)', [owner, next, 'completion-search', 'tavily', token])).status, 'reserved');
    await rpc('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)', [owner, next, 'completion-search', token, JSON.stringify(result), null]);
    await rpc('finish_prospecting_run($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)', [owner, next, token, 'completed', '{}', 'Public request search completed', null, 0, '{}']);
    const complete = (await db.query<{ result: typeof result }>("select result from public.prospecting_requests where operation='completion-search'")).rows[0].result;
    assert.equal(complete.query, result.query); assert.equal(Object.hasOwn(complete.page.results[0], 'rawContent'), false);
    assert.equal(await rpc('claim_prospecting_run($1,$2,$3)', [owner, next, replacement]), null);
  } finally { await db.close(); }
});
