import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Actual PostgreSQL execution. All records, sessions and credentials are fixtures.
const owner = '99090000-0000-4000-8000-000000000001';
const other = '99090000-0000-4000-8000-000000000002';
const token = 'hunter-restoration-fixture-worker-token';
const legacy = {
  enabled: true, countries: ['CA', 'GB'], keywords: ['branding agency', 'web design agency'], intervalHours: 24,
  companiesPerRun: 10, dailyLeadLimit: 10, dailyRequestLimit: 50, minScore: 72, paginationEnabled: true,
  lawfulBasis: 'Review public business sources and contact only relevant business prospects.', aiEnabled: false,
  aiPrompt: 'Summarize only recorded business facts. Do not invent project requirements or consent.',
};
const project = { ...legacy, discoveryMode: 'project_requests', countries: ['US', 'AE'], keywords: ['website development'],
  services: ['website'], maxAgeDays: 45, intervalHours: 24, companiesPerRun: 7, dailyLeadLimit: 8, dailyRequestLimit: 37,
  minScore: 40, paginationEnabled: false, lawfulBasis: 'Current owner review process must remain preserved.', aiEnabled: true };
function contact(domain = 'new-agency.org', local = 'alex') {
  return {
    company: { domain, name: `Published agency ${domain}`, description: 'A design agency', industry: 'Design', countryCode: 'CA', country: 'Canada', timeZone: null, employeeCount: 8, tags: ['design'] },
    contact: { email: `${local}@${domain}`, firstName: 'Alex', lastName: 'Morgan', role: 'Founder', confidence: 99, provenance: 'found', sources: [{ uri: `https://${domain}/team`, lastSeenOn: null }] },
    verification: { status: 'valid', checkedAt: new Date().toISOString(), disposable: false, webmail: false, acceptAll: false },
    score: { score: 85, reason: 'Recorded design-agency facts in the selected country.', segment: 'Design agency' },
    lawfulBasis: 'The persisted collection basis comes from settings.', aiDraft: null,
  };
}
async function setup(newer = true) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema auth,storage to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;`);
  const apply = async (name = '009_restore_hunter_discovery.sql') => db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  for (const name of ['001_foundation.sql', '002_live_workspace.sql', '003_dashboard_summary.sql', '004_restore_workspace_access.sql', '005_automatic_prospecting.sql']) await apply(name);
  await db.exec(`insert into auth.users values('${owner}'),('${other}');`);
  const auth = (id = owner) => db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}';`);
  const service = () => db.exec('reset role; set role service_role;');
  const rpc = async <T = Record<string, unknown>>(call: string, args: unknown[] = []) => (await db.query<{ result: T }>(`select public.${call} as result`, args)).rows[0].result;
  const queue = async () => { await auth(); const run = await rpc<string>('queue_prospecting_run()'); await service(); return run; };
  const claim = (run: string, id = owner, claimToken = token) => rpc('claim_prospecting_run($1,$2,$3)', [id, run, claimToken]);
  const save = (run: string, payload = contact(), claimToken = token) => rpc<{ status: string; lead_id?: string }>('persist_discovered_lead($1,$2,$3::jsonb,$4)', [owner, run, JSON.stringify(payload), claimToken]);
  const finish = (run: string) => rpc('finish_prospecting_run($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)', [owner, run, token, 'completed', '{}', 'Fixture discovery completed.', null, 0, '{}']);
  await auth(); await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify(legacy)]);
  await db.exec('reset role');
  await db.exec(`update public.prospecting_settings set search_index=1,cursors='{"CA|branding agency":20,"GB|branding agency":10}' where owner_id='${owner}'`);
  const oldRun = await queue(); await claim(oldRun);
  await rpc('reserve_prospecting_request($1,$2,$3,$4,$5)', [owner, oldRun, 'discover', 'hunter', token]);
  await rpc('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)', [owner, oldRun, 'discover', token, '{"companies":[],"total":70,"nextOffset":40}', null]);
  assert.equal((await save(oldRun, contact('historical-agency.org'))).status, 'saved');
  await finish(oldRun); await db.exec('reset role');
  await db.exec(`insert into public.leads(owner_id,company,contact_name,email,country,source,lawful_basis)
    select '${owner}', 'Preserved business '||n, 'Preserved contact '||n, 'contact'||n||'@existing.org', 'Canada','Existing owner contact','Existing review process'
    from generate_series(1,13) n;
    update public.agent_logs set created_at=now()-interval '2 days' where agent='QualifierAgent';
    update public.prospecting_requests set created_at=now()-interval '2 days' where provider='hunter';
    update public.leads set discovered_at=now()-interval '2 days' where discovery_run_id is not null;
    insert into public.settings(owner_id,data) values('${owner}','{"companyName":"Preserved owner business","mode":"approval"}');
    insert into public.suppression_list(owner_id,email,reason) values('${owner}','blocked@blocked-agency.org','do-not-contact');`);
  if (newer) {
    for (const name of ['006_project_requests.sql', '007_project_contacts.sql', '008_discovery_reliability.sql']) await apply(name);
    await auth(); await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify(project)]);
    const archivedRun = await queue(); await claim(archivedRun);
    const published = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const requestText = 'We are seeking an external development agency to rebuild our customer website.';
    const evidence = { version: 1, title: 'Website development request', requestText, service: 'website', sourceUrl: 'https://buyer.org/request/archived', platform: 'buyer.org', publishedAt: `${published}T00:00:00.000Z`, publishedDateText: published, deadlineAt: null, deadlineText: null, countryCode: 'US', countryEvidence: 'Buyer country: United States', buyerName: null };
    assert.equal((await rpc<{ status: string }>('save_discovered_project_request($1,$2,$3,$4::jsonb)', [owner, archivedRun, token, JSON.stringify({ evidence, sourceText: `Published: ${published}\nBuyer country: United States\n${requestText}`, discoveryQuery: 'A historical project search' })])).status, 'saved');
    await rpc('reserve_prospecting_request($1,$2,$3,$4,$5)', [owner, archivedRun, 'public-project-search', 'tavily', token]);
    await rpc('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)', [owner, archivedRun, 'public-project-search', token, '{"query":"Historical search","page":{"results":[]}}', null]);
    await finish(archivedRun);
    await auth(other); await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify({ ...project, dailyLeadLimit: 14, lawfulBasis: 'Other owner settings remain untouched.' })]);
    await rpc('queue_prospecting_run()');
    await queue();
    await db.exec('reset role');
  }
  return { db, apply, auth, service, rpc, queue, claim, save, finish, oldRun };
}

test('009 preserves existing contacts, projects, suppression, settings, checkpoint functions and history; restoration is owner-scoped', async () => {
  const { db, apply, auth, service, rpc } = await setup();
  try {
    const snapshot = async () => ({
      leads: (await db.query('select * from public.leads order by id')).rows,
      projects: (await db.query('select * from public.project_requests order by id')).rows,
      suppression: (await db.query('select * from public.suppression_list order by id')).rows,
      business: (await db.query('select * from public.settings order by owner_id')).rows,
      config: (await db.query<{ owner_id: string }>('select * from public.prospecting_settings order by owner_id')).rows,
      runs: (await db.query<{ id: string; status: string; config_snapshot: { lawfulBasis?: string; discoveryMode?: string } }>('select id,status,config_snapshot from public.prospecting_runs order by id')).rows,
      checkpoints: (await db.query('select provider,status,result,error_code from public.prospecting_requests order by id')).rows,
    });
    const before = await snapshot(); assert.equal(before.leads.length, 14); assert.equal(before.projects.length, 1);
    const functionDefs = (await db.query("select pg_get_functiondef('public.complete_prospecting_request(uuid,uuid,text,text,jsonb,text)'::regprocedure) as complete,pg_get_functiondef('public.finish_prospecting_run(uuid,uuid,text,text,jsonb,text,text,integer,jsonb)'::regprocedure) as finish")).rows;
    await apply(); await apply();
    assert.deepEqual(await snapshot(), before, 'Installing or repeating 009 must never switch owners or alter records.');
    assert.deepEqual((await db.query("select pg_get_functiondef('public.complete_prospecting_request(uuid,uuid,text,text,jsonb,text)'::regprocedure) as complete,pg_get_functiondef('public.finish_prospecting_run(uuid,uuid,text,text,jsonb,text,text,integer,jsonb)'::regprocedure) as finish")).rows, functionDefs);
    await auth(); assert.deepEqual(await rpc('hunter_discovery_readiness()'), { schema_version: 9 });
    const preview = await rpc<typeof project>('hunter_restoration_config()');
    assert.equal(preview.discoveryMode, 'company_contacts'); assert.deepEqual(preview.countries, legacy.countries); assert.deepEqual(preview.keywords, legacy.keywords);
    assert.equal(preview.minScore, 72); assert.equal(preview.paginationEnabled, true); assert.equal(preview.intervalHours, 6);
    assert.equal(preview.dailyLeadLimit, 8); assert.equal(preview.dailyRequestLimit, 37); assert.equal(preview.companiesPerRun, 7);
    assert.equal(preview.lawfulBasis, project.lawfulBasis); assert.equal(preview.aiEnabled, false); assert.deepEqual(preview.services, ['website']); assert.equal(preview.maxAgeDays, 45);
    const restored = await rpc<{ data: typeof preview; version: number }>('restore_hunter_discovery()');
    assert.equal(restored.data.enabled, true); assert.equal(restored.data.discoveryMode, 'company_contacts');
    const progress = (await db.query<{ search_index: number; cursors: Record<string, number> }>('select search_index,cursors from public.prospecting_settings where owner_id=$1', [owner])).rows[0];
    assert.equal(progress.search_index, 2, 'Restoration resumes the next country/keyword partition, not the already-seen first batch.');
    assert.deepEqual(progress.cursors, { 'CA|branding agency': 20, 'GB|branding agency': 10, 'CA|web design agency': 40 });
    await db.exec('reset role');
    const after = await snapshot(); assert.deepEqual(after.leads, before.leads); assert.deepEqual(after.projects, before.projects);
    assert.deepEqual(after.suppression, before.suppression); assert.deepEqual(after.business, before.business); assert.deepEqual(after.checkpoints, before.checkpoints);
    assert.deepEqual(after.config.find(row => row.owner_id === other), before.config.find(row => row.owner_id === other));
    const otherQueued = after.runs.filter(row => (row.config_snapshot as { lawfulBasis: string }).lawfulBasis === 'Other owner settings remain untouched.');
    assert.equal(otherQueued[0].status, 'queued');
    assert.ok(after.runs.some(row => row.status === 'cancelled' && (row.config_snapshot as { discoveryMode: string }).discoveryMode === 'project_requests'));
    await apply(); assert.deepEqual((await snapshot()).config, after.config, 'Reapplying the migration after restoring must not reset progress.');
    await db.exec(`update public.prospecting_settings set search_index=3,cursors='{"GB|web design agency":60}' where owner_id='${owner}'`);
    const progressed = (await db.query('select * from public.prospecting_settings where owner_id=$1', [owner])).rows;
    await auth(); await rpc('restore_hunter_discovery()'); await db.exec('reset role');
    assert.deepEqual((await db.query('select * from public.prospecting_settings where owner_id=$1', [owner])).rows, progressed, 'Repeated restore on the active Hunter mode does not reset newer scan progress or version.');
    await auth(other); assert.equal((await db.query('select id from public.leads')).rows.length, 0); assert.equal((await db.query('select id from public.project_requests')).rows.length, 0);
    const otherPreview = await rpc<{ keywords: string[]; dailyLeadLimit: number }>('hunter_restoration_config()');
    assert.deepEqual(otherPreview.keywords, ['web design agency', 'branding agency']); assert.equal(otherPreview.dailyLeadLimit, 14);
    await service(); assert.deepEqual(await rpc('hunter_discovery_readiness()'), { schema_version: 9 });
    await assert.rejects(rpc('restore_hunter_discovery()'), /permission denied/);
    await db.exec('reset role;set role anon;'); await assert.rejects(rpc('hunter_discovery_readiness()'), /permission denied/);
  } finally { await db.close(); }
});

test('restored Hunter operations save source-backed verified contacts and retain duplicate, suppression, daily-cap and pause guards', async () => {
  const { db, apply, auth, service, rpc, queue, claim, save, finish } = await setup();
  try {
    await apply(); await auth(); const restored = await rpc<{ data: Record<string, unknown> }>('restore_hunter_discovery()');
    await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify({ ...restored.data, dailyLeadLimit: 2, dailyRequestLimit: 5 })]);
    const run = await queue(); await claim(run);
    const reserve = (operation: string, provider = 'hunter') => rpc<{ status: string }>('reserve_prospecting_request($1,$2,$3,$4,$5)', [owner, run, operation, provider, token]);
    assert.equal((await reserve('company-search')).status, 'reserved');
    assert.equal((await reserve('company-search')).status, 'uncertain');
    await rpc('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)', [owner, run, 'company-search', token, '{"companies":[]}', null]);
    assert.equal((await reserve('company-search')).status, 'cached');
    await assert.rejects(reserve('wrong-provider', 'tavily'), /PROSPECTING_INVALID/);
    assert.equal((await reserve('optional-draft', 'anthropic')).status, 'reserved');
    assert.equal((await save(run, contact('blocked-agency.org', 'blocked'))).status, 'suppressed');
    assert.equal((await save(run, contact('existing.org', 'contact1'))).status, 'duplicate');
    assert.equal((await save(run, { ...contact('unverified.org'), verification: { ...contact().verification, status: 'unknown' } })).status, 'verification_required');
    assert.equal((await save(run, { ...contact('guessed.org'), contact: { ...contact('guessed.org').contact, provenance: 'inferred' } })).status, 'provenance_required');
    const first = await save(run, contact('first-new.org')); assert.equal(first.status, 'saved');
    assert.equal((await save(run, contact('first-new.org', 'another'))).status, 'duplicate');
    assert.equal((await save(run, contact('second-new.org'))).status, 'saved');
    assert.equal((await save(run, contact('third-new.org'))).status, 'daily_limit');
    await db.exec('reset role'); await db.exec("delete from public.leads where email='alex@first-new.org'"); await service();
    assert.equal((await save(run, contact('first-new.org', 'replacement'))).status, 'duplicate');
    await auth(); const usage = await rpc<{ company_leads_saved: number; project_requests_saved: number; leads_saved: number }>('prospecting_usage()');
    assert.equal(usage.company_leads_saved, 2); assert.equal(usage.project_requests_saved, 1); assert.equal(usage.leads_saved, 3);
    await assert.rejects(save(run), /permission denied/);
    await service();
    assert.equal((await reserve('request-3')).status, 'reserved'); assert.equal((await reserve('request-4')).status, 'reserved');
    assert.equal((await reserve('request-5')).status, 'budget_exhausted', 'The historical Tavily attempt still consumes the shared API budget.');
    assert.equal(await claim(run, other), null); assert.equal((await save(run, contact('wrong-worker.org'), 'wrong-claim-token')).status, 'paused');
    await auth(); await rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify({ ...restored.data, enabled: false, dailyLeadLimit: 2, dailyRequestLimit: 5 })]);
    await service(); assert.equal((await reserve('paused')).status, 'paused'); assert.equal((await save(run, contact('paused.org'))).status, 'paused');
    assert.equal(await rpc('queue_due_prospecting_run($1)', [owner]), null);
    await finish(run);
  } finally { await db.close(); }
});

test('005-only installations upgrade directly and legacy Hunter snapshots remain compatible without project tables', async () => {
  const { db, apply, auth, service, rpc, queue, claim, save } = await setup(false);
  try {
    await db.exec(`update public.prospecting_settings set search_index=3,cursors='{"GB|web design agency":60}' where owner_id='${owner}'`);
    const before = (await db.query('select id,email from public.leads order by email')).rows;
    await apply(); await apply(); assert.deepEqual((await db.query('select id,email from public.leads order by email')).rows, before);
    await auth(); const preview = await rpc<{ discoveryMode: string; keywords: string[]; intervalHours: number }>('hunter_restoration_config()');
    assert.equal(preview.discoveryMode, 'company_contacts'); assert.deepEqual(preview.keywords, legacy.keywords); assert.equal(preview.intervalHours, 6);
    await rpc('restore_hunter_discovery()');
    const progress = (await db.query<{ search_index: number; cursors: Record<string, number> }>('select search_index,cursors from public.prospecting_settings')).rows[0];
    assert.equal(progress.search_index, 3); assert.deepEqual(progress.cursors, { 'GB|web design agency': 60 });
    const run = await queue(); await claim(run);
    assert.equal((await save(run)).status, 'saved');
    await auth(); const saved = await rpc<{ data: { discoveryMode: string; services: string[]; maxAgeDays: number } }>('save_prospecting_settings($1::jsonb)', [JSON.stringify({ ...legacy, enabled: false })]);
    assert.equal(saved.data.discoveryMode, 'company_contacts'); assert.deepEqual(saved.data.services, ['website', 'application']); assert.equal(saved.data.maxAgeDays, 30);
    await assert.rejects(rpc('save_prospecting_settings($1::jsonb)', [JSON.stringify(project)]), /PROSPECTING_INVALID/);
    await service(); assert.deepEqual(await rpc('hunter_discovery_readiness()'), { schema_version: 9 });
  } finally { await db.close(); }
});
