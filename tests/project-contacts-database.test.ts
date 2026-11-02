import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { defaultProspectingConfig } from '../lib/prospecting/types';
import type { ProjectEvidence } from '../lib/intent/types';

const owner = '77000000-0000-4000-8000-000000000001';
const other = '77000000-0000-4000-8000-000000000002';
const token = 'published-contact-worker-lease-token';
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const configuration = { ...defaultProspectingConfig, enabled: true, countries: ['US'], dailyLeadLimit: 10,
  lawfulBasis: 'Review and respond to explicit public development requests after reading the source.' };

function project(id = 'first') {
  const evidence: ProjectEvidence = {
    version: 1, title: 'Request for proposals for a new website',
    requestText: 'We are seeking an external development agency to rebuild our customer website.',
    service: 'website', sourceUrl: `https://procurement.buyer.org/projects/${id}`, platform: 'procurement.buyer.org',
    publishedAt: `${isoDay(-1)}T00:00:00.000Z`, publishedDateText: isoDay(-1), deadlineAt: null, deadlineText: null,
    countryCode: 'US', countryEvidence: 'Buyer country: United States', buyerName: 'Example City',
  };
  return { evidence, sourceText: `Buyer: Example City\nPublished: ${evidence.publishedDateText}\n${evidence.countryEvidence}\n${evidence.requestText}`,
    discoveryQuery: 'website development request for proposals' };
}
const publishedContact = (sourceUrl: string) => ({ contactName: 'Alex Morgan', contactEmail: 'alex.morgan@buyer.org', contactSourceUrl: sourceUrl });
const contactText = '\n\nProject contact:\nName: Alex Morgan\nEmail: ALEX.MORGAN@buyer.org';

async function setup(withContacts = true) {
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
  for (const name of ['001_foundation.sql', '002_live_workspace.sql', '003_dashboard_summary.sql', '004_restore_workspace_access.sql', '005_automatic_prospecting.sql', '006_project_requests.sql']) {
    await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  }
  await db.exec(`insert into auth.users(id) values('${owner}'),('${other}');`);
  const apply = async () => db.exec(await readFile('supabase/migrations/007_project_contacts.sql', 'utf8'));
  if (withContacts) await apply();
  const auth = async (id = owner) => db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
  const service = async () => db.exec('reset role;set role service_role;');
  const rpc = async <T = Record<string, unknown>>(call: string, args: unknown[] = []) => (await db.query<{ result: T }>(`select public.${call} as result`, args)).rows[0].result;
  const start = async () => {
    await auth(); await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify(configuration)]);
    const run = await rpc<string>('queue_prospecting_run()'); await service();
    await rpc('claim_prospecting_run($1,$2,$3)', [owner, run, token]); return run;
  };
  const save = async (run: string, payload: Record<string, unknown>, claimToken = token) => rpc<{ status: string; request_id?: string }>(
    'save_discovered_project_request($1,$2,$3,$4::jsonb)', [owner, run, claimToken, JSON.stringify(payload)]);
  return { db, apply, auth, service, rpc, start, save };
}

test('contact upgrade preserves all existing names and emails and remains optional for request discovery', async () => {
  const { db, apply, auth, service, rpc, start, save } = await setup(false);
  try {
    await db.exec(`insert into public.leads(owner_id,company,contact_name,email,country,source,lawful_basis)
      select '${owner}', 'Preserved fixture company '||n, 'Preserved contact '||n, 'contact'||n||'@existing.org',
        'United States','Existing fixture contact','Previously recorded collection basis' from generate_series(1,14) n;`);
    const before = (await db.query('select id,company,contact_name,email from public.leads order by email')).rows;
    await apply(); await apply();
    assert.deepEqual((await db.query('select id,company,contact_name,email from public.leads order by email')).rows, before);
    assert.equal(before.length, 14);
    await auth(); assert.deepEqual(await rpc('project_discovery_readiness()'), { schema_version: 6 });
    assert.deepEqual(await rpc('project_contact_readiness()'), { schema_version: 7 });
    const run = await start();
    assert.equal((await save(run, project('without-contact'))).status, 'saved');
    assert.equal((await save(run, { ...project('null-contact'), contact: null })).status, 'saved');
    assert.equal((await save(run, { ...project('empty-contact'), contact: { contactName: null, contactEmail: null, contactSourceUrl: null } })).status, 'saved');
    await auth();
    const rows = (await db.query<{ contact_name: string | null; contact_email: string | null; contact_source_url: string | null }>('select contact_name,contact_email,contact_source_url from public.project_requests')).rows;
    assert.equal(rows.length, 3); assert.ok(rows.every(row => Object.values(row).every(value => value === null)));
    await service(); assert.deepEqual(await rpc('project_contact_readiness()'), { schema_version: 7 });
    await db.exec('reset role;set role anon;');
    await assert.rejects(rpc('project_contact_readiness()'), /permission denied/);
  } finally { await db.close(); }
});

test('only source-published project contacts are stored with their original request evidence and owner access rules', async () => {
  const { db, auth, service, start, save } = await setup();
  try {
    const run = await start(); const fixture = project();
    const payload = { ...fixture, sourceText: fixture.sourceText + contactText, contact: publishedContact(fixture.evidence.sourceUrl) };
    await auth(); await assert.rejects(save(run, payload), /permission denied/);
    await assert.rejects(db.exec("update public.project_requests set contact_email='fabricated@buyer.org'"), /permission denied/);
    await service();
    assert.equal((await save(run, { ...payload, contact: { ...payload.contact, contactName: 'Invented Person' } })).status, 'contact_evidence_required');
    assert.equal((await save(run, { ...payload, contact: { ...payload.contact, contactEmail: 'guessed@buyer.org' } })).status, 'contact_evidence_required');
    assert.equal((await save(run, { ...payload, contact: { ...payload.contact, contactSourceUrl: 'https://unrelated.org/contact' } })).status, 'contact_evidence_required');
    assert.equal((await save(run, { ...payload, contact: { ...payload.contact, contactSourceUrl: null } })).status, 'contact_evidence_required');
    assert.equal((await save(run, { ...payload, contact: { ...payload.contact, emailVerified: true } })).status, 'invalid');
    assert.equal((await save(run, { ...payload, sourceText: fixture.sourceText + '\nWebsite footer email: ALEX.MORGAN@buyer.org\nAlex Morgan' })).status, 'contact_evidence_required');
    assert.equal((await save(run, payload, 'different-worker-token-with-no-lease')).status, 'paused');
    const result = await save(run, payload); assert.equal(result.status, 'saved');
    await auth();
    const row = (await db.query<{ contact_name: string; contact_email: string; contact_source_url: string; request_text: string; evidence: ProjectEvidence }>('select contact_name,contact_email,contact_source_url,request_text,evidence from public.project_requests')).rows[0];
    assert.equal(row.contact_name, 'Alex Morgan'); assert.equal(row.contact_email, 'alex.morgan@buyer.org');
    assert.equal(row.contact_source_url, fixture.evidence.sourceUrl); assert.equal(row.request_text, fixture.evidence.requestText);
    assert.deepEqual(row.evidence, fixture.evidence, 'Adding contact information must not replace source/requirement evidence.');
    assert.equal(Object.hasOwn(row, 'email_verified'), false, 'A published email is not labelled deliverability-verified.');
    await auth(other); assert.equal((await db.query('select id from public.project_requests')).rows.length, 0);
    await service();
    const stale = { ...payload, evidence: { ...payload.evidence, publishedAt: `${isoDay(-60)}T00:00:00.000Z`, publishedDateText: isoDay(-60) }, sourceText: payload.sourceText.replace(isoDay(-1), isoDay(-60)) };
    assert.equal((await save(run, stale)).status, 'stale', 'The original recency guard remains enforced.');
  } finally { await db.close(); }
});

test('same-source repeat discoveries enrich missing contacts once without duplicating requests or spending the daily save budget', async () => {
  const { db, auth, service, rpc, start, save } = await setup();
  try {
    const run = await start(); const fixture = project();
    const original = await save(run, fixture); assert.equal(original.status, 'saved');
    const payload = { ...fixture, sourceText: fixture.sourceText + contactText, contact: publishedContact(fixture.evidence.sourceUrl) };
    const enriched = await save(run, payload); assert.equal(enriched.status, 'duplicate'); assert.equal(enriched.request_id, original.request_id);
    assert.equal((await save(run, payload)).status, 'duplicate');
    await auth();
    assert.equal((await db.query('select id from public.project_requests')).rows.length, 1);
    const row = (await db.query<{ contact_name: string; contact_email: string }>('select contact_name,contact_email from public.project_requests')).rows[0];
    assert.deepEqual(row, { contact_name: 'Alex Morgan', contact_email: 'alex.morgan@buyer.org' });
    assert.equal((await rpc<{ project_requests_saved: number }>('prospecting_usage()')).project_requests_saved, 1);
    assert.equal((await db.query("select id from public.agent_logs where agent='ProjectContactEnrichment'")).rows.length, 1);
    await service();
    const conflictText = fixture.sourceText + '\nProject contact:\nName: Different Person\nEmail: different@buyer.org';
    assert.equal((await save(run, { ...fixture, sourceText: conflictText, contact: { contactName: 'Different Person', contactEmail: 'different@buyer.org', contactSourceUrl: fixture.evidence.sourceUrl } })).status, 'duplicate');
    await auth(); assert.deepEqual((await db.query('select contact_name,contact_email from public.project_requests')).rows[0], row, 'Repeat discoveries cannot silently replace a known person/email.');
    await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify({ ...configuration, enabled: false })]);
    await service(); assert.equal((await save(run, payload)).status, 'paused');
  } finally { await db.close(); }
});

test('explicit proposal-routing mailboxes remain usable without inventing a person or accepting footer addresses', async () => {
  const { db, auth, start, save } = await setup();
  try {
    const run = await start();
    const statements = [
      'Submissions should be emailed to proposals@buyer.org.',
      'Please send your proposal to bids@buyer.org.',
      'Email your tender submission to contracts@buyer.org.',
    ];
    for (let index = 0; index < statements.length; index++) {
      const fixture = project(`submission-${index}`);
      const email = statements[index].match(/[a-z]+@buyer\.org/)![0];
      const payload = { ...fixture, sourceText: fixture.sourceText + '\n\n' + statements[index],
        contact: { contactName: null, contactEmail: email, contactSourceUrl: fixture.evidence.sourceUrl } };
      assert.equal((await save(run, payload)).status, 'saved', statements[index]);
    }
    const fixture = project('bad-submission');
    const contact = { contactName: null, contactEmail: 'proposals@buyer.org', contactSourceUrl: fixture.evidence.sourceUrl };
    for (const statement of [
      'Privacy policy\nPlease send your proposal to proposals@buyer.org.',
      'For newsletter unsubscribe requests, email your proposal to proposals@buyer.org.',
      'Please send your proposal to proposals@buyer.org or bids@buyer.org.',
      'Our public website email is proposals@buyer.org.',
    ]) assert.equal((await save(run, { ...fixture, sourceText: fixture.sourceText + '\n\n' + statement, contact })).status, 'contact_evidence_required', statement);
    await auth();
    const rows = (await db.query<{ contact_name: string | null; contact_email: string }>('select contact_name,contact_email from public.project_requests')).rows;
    assert.equal(rows.length, 3); assert.ok(rows.every(row => row.contact_name === null && row.contact_email.endsWith('@buyer.org')));
  } finally { await db.close(); }
});
