import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { defaultProspectingConfig } from '../lib/prospecting/types';
import { parseProjectDateToken, qualifyProjectRequest } from '../lib/intent/evidence';
import type { ProjectEvidence } from '../lib/intent/types';

const owner = '88000000-0000-4000-8000-000000000001';
const other = '88000000-0000-4000-8000-000000000002';
const token = 'reliability-repair-worker-lease-token';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const monthDay = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const config = { ...defaultProspectingConfig, discoveryMode: 'project_requests' as const,
  services: ['website', 'application'], maxAgeDays: 30, intervalHours: 24,
  keywords: ['website development', 'application development'], enabled: true, countries: ['US', 'GB'], dailyLeadLimit: 20,
  lawfulBasis: 'Review original public requests and respond only through the published project response route.' };
const requestText = 'We are seeking an external development agency to rebuild our customer website.';
function payload(id: string, sourceText = `Published: ${day(-1)}\nBuyer country: United States\n${requestText}`, changes: Partial<ProjectEvidence> = {}) {
  const evidence: ProjectEvidence = { version: 1, title: 'Website development request for proposals', requestText,
    service: 'website', sourceUrl: `https://procurement.buyer.org/notices/${id}`, platform: 'procurement.buyer.org',
    publishedAt: `${day(-1)}T00:00:00.000Z`, publishedDateText: day(-1), deadlineAt: null, deadlineText: null,
    countryCode: 'US', countryEvidence: 'Buyer country: United States', buyerName: null, ...changes };
  return { evidence, sourceText, discoveryQuery: 'public website redesign requests' };
}
async function setup(contacts = true) {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema auth,storage to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;`);
  const apply = async (name = '008_discovery_reliability.sql') => db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  for (const name of ['001_foundation.sql', '002_live_workspace.sql', '003_dashboard_summary.sql', '004_restore_workspace_access.sql', '005_automatic_prospecting.sql', '006_project_requests.sql']) await apply(name);
  if (contacts) await apply('007_project_contacts.sql');
  await db.exec(`insert into auth.users values('${owner}'),('${other}');`);
  const auth = async (id = owner) => db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
  const service = async () => db.exec('reset role;set role service_role;');
  const rpc = async <T = Record<string, unknown>>(call: string, args: unknown[] = []) => (await db.query<{ result: T }>(`select public.${call} as result`, args)).rows[0].result;
  const start = async () => { await auth();await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify(config)]);
    const run = await rpc<string>('queue_prospecting_run()');await service();await rpc('claim_prospecting_run($1,$2,$3)', [owner, run, token]);return run; };
  const save = async (run: string, value: unknown) => rpc<{ status: string; request_id?: string }>('save_discovered_project_request($1,$2,$3,$4::jsonb)', [owner, run, token, JSON.stringify(value)]);
  return { db, apply, auth, service, rpc, start, save };
}

test('repair accepts source-backed real layouts and exact timed deadlines without pausing settings or losing published contacts', async () => {
  const { db, apply, auth, service, rpc, start, save } = await setup();
  try {
    const run = await start();await db.exec('reset role;');
    const before = (await db.query('select data,version,next_run_at from public.prospecting_settings')).rows;
    await apply();await apply();
    assert.deepEqual((await db.query('select data,version,next_run_at from public.prospecting_settings')).rows, before);
    await service();
    const published = day(-1), deadline = day(7), month = monthDay(published);
    const formats = [
      [`Published:\n${published}\nBuyer country:\nUnited States`, published, 'Buyer country:\nUnited States'],
      [`| Publication date | ${published} |\n| Buyer country | United States |`, published, '| Buyer country | United States |'],
      [`Posted ${month}\nBuyer country: United States`, month, 'Buyer country: United States'],
      [`## Published\n\n${published}\n## Buyer country\nUnited States`, published, '## Buyer country\nUnited States'],
      [`| Published | ${published} | Buyer country | United States |`, published, `| Published | ${published} | Buyer country | United States |`],
    ];
    for (let index = 0; index < formats.length; index++) {
      const [header, publishedDateText, countryEvidence] = formats[index];
      const sourceText = `${header}\nSubmission deadline: ${deadline} at 5:00 PM UTC\n${requestText}`;
      const fixture = payload(`format-${index}`, sourceText, { publishedDateText, countryEvidence, deadlineText: `${deadline} at 5:00 PM UTC`, deadlineAt: `${deadline}T17:00:00.000Z` });
      const qualification = qualifyProjectRequest({ title: fixture.evidence.title, url: fixture.evidence.sourceUrl, rawContent: sourceText, publishedDate: null }, { countries: config.countries, services: ['website', 'application'], maxAgeDays: 30 });
      assert.equal(qualification.qualified, true, `JS qualification: ${header}`);
      if (qualification.qualified) assert.equal((await save(run, { ...fixture, evidence: qualification.evidence })).status, 'saved', `SQL acceptance: ${header}`);
    }
    const fixture = payload('contact-retained');
    const contact = { contactName: 'Alex Morgan', contactEmail: 'alex@buyer.org', contactSourceUrl: fixture.evidence.sourceUrl };
    assert.equal((await save(run, { ...fixture, sourceText: fixture.sourceText + '\nProject contact:\nName: Alex Morgan\nEmail: alex@buyer.org', contact })).status, 'saved');
    await auth();
    assert.deepEqual(await rpc('project_discovery_readiness()'), { schema_version: 6 });
    assert.deepEqual(await rpc('project_discovery_reliability_readiness()'), { schema_version: 8 });
    const contacts = (await db.query('select contact_name,contact_email from public.project_requests where contact_name is not null')).rows;
    assert.deepEqual(contacts, [{ contact_name: 'Alex Morgan', contact_email: 'alex@buyer.org' }]);
    await auth(other);assert.equal((await db.query('select id from public.project_requests')).rows.length, 0);
    await db.exec('reset role;set role anon;');await assert.rejects(rpc('project_discovery_reliability_readiness()'), /permission denied/);
  } finally { await db.close(); }
});

test('repair still rejects guessed dates, unsupported clocks, wrong countries and altered deadline instants', async () => {
  const { db, apply, service, start, save, rpc } = await setup();
  try {
    await apply();const run = await start();
    const fixture = payload('spurious-publication');
    assert.equal((await save(run, { ...fixture, sourceText: `Last updated: ${day(-1)}\nBuyer country: United States\n${requestText}` })).status, 'evidence_required');
    assert.equal(await rpc('project_date_value($1)', ['11/12/2026']), null);
    assert.equal(await rpc('project_date_value($1)', [`${day(7)} at 5:00 PM local time`]), null);
    assert.equal(await rpc('project_date_value($1)', [`${day(7)} at 17:00 IST`]), null);
    for (const value of ['November 21st, 2026, at 5 PM EST', '21st November 2026 at 17:00 CET', '2026-11-21T17:00:59.123+02:30', '2026-11-21 at 10:30 GMT+04:00', 'November 11st, 2026', '2026-11-21T17:00:00+14:30']) {
      const parsed = parseProjectDateToken(value);
      const stored = await rpc<{ date: string; instant: string | null } | null>('project_date_details($1)', [value]);
      assert.equal(Boolean(stored), Boolean(parsed), `Matching SQL/JS date acceptance: ${value}`);
      if (stored && parsed) {
        assert.equal(Date.parse(stored.date), parsed.date, value);
        assert.equal(stored.instant ? Date.parse(stored.instant) : null, parsed.instant, value);
      }
    }
    assert.equal(await rpc('project_country_value($1)', ['Buyer country:\nUnited States / India']), 'IN');
    assert.equal(await rpc('project_country_value($1)', ['Buyer country: United States / Canada']), null);
    assert.equal(await rpc('project_country_value($1)', ['| Published | 2026-11-01 | Buyer country | United States | Supplier address | Canada |']), 'US');
    assert.equal(await rpc('project_country_value($1)', ['| Buyer country | United States | Buyer country | Canada |']), null);
    assert.equal(await rpc('project_country_value($1)', ['| Published | 2026-11-01 | Other text | United States |']), null);
    assert.equal((await save(run, payload('unknown-zone', fixture.sourceText + `\nDeadline: ${day(7)} at 17:00 local time`))).status, 'evidence_required');
    const timed = payload('time-binding', fixture.sourceText + `\nDeadline: ${day(7)}T17:00:00+02:00`, { deadlineText: `${day(7)}T17:00:00+02:00`, deadlineAt: `${day(7)}T15:00:00.000Z` });
    assert.equal((await save(run, { ...timed, evidence: { ...timed.evidence, deadlineAt: `${day(7)}T23:59:59.999Z` } })).status, 'invalid');
    assert.equal((await save(run, timed)).status, 'saved');
    await service();
  } finally { await db.close(); }
});

test('only transient failures retry within one hour; permanent failures retain the owner interval and pause remains authoritative', async () => {
  const { db, apply, auth, service, rpc, start } = await setup(false);
  try {
    await apply();
    for (const code of ['UNAVAILABLE', 'RATE_LIMIT', 'QUOTA']) {
      const run = await start();
      const finished = await rpc<boolean>('finish_prospecting_run($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)', [owner, run, token, 'failed', '{}', 'A safe provider failure.', code, 0, '{}']);
      assert.equal(finished, true);
      await auth();
      const hours = (await db.query<{ hours: number }>("select extract(epoch from (next_run_at-now()))/3600 as hours from public.prospecting_settings")).rows[0].hours;
      assert.ok(Math.abs(Number(hours) - (code === 'QUOTA' ? config.intervalHours : 1)) < 0.01, code);
      await service();
    }
    await auth();await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify({ ...config, enabled: false })]);
    await db.exec('reset role;');const before = (await db.query('select data,version,next_run_at from public.prospecting_settings')).rows;
    await apply();assert.deepEqual((await db.query('select data,version,next_run_at from public.prospecting_settings')).rows, before);
    await service();assert.equal(await rpc('queue_due_prospecting_run($1)', [owner]), null);
  } finally { await db.close(); }
});

test('repair works without contact migration and detects/reapplies safely if optional contacts are installed later', async () => {
  const { db, apply, auth, service, rpc, start, save } = await setup(false);
  try {
    await apply();const run = await start();assert.equal((await save(run, payload('without-contacts'))).status, 'saved');
    await db.exec('reset role;');await apply('007_project_contacts.sql');await auth();
    assert.deepEqual(await rpc('project_discovery_reliability_readiness()'), { schema_version: 0 });
    await db.exec('reset role;');await apply();await service();
    assert.deepEqual(await rpc('project_discovery_reliability_readiness()'), { schema_version: 8 });
    assert.equal((await save(run, payload('after-optional-contact-update'))).status, 'saved');
  } finally { await db.close(); }
});
