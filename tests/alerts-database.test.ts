import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = 'aa100000-0000-4000-8000-000000000001';
const other = 'aa100000-0000-4000-8000-000000000002';
const token = 'alert-fixture-worker-claim-token';
const sourcePayload = (type = 'google_alerts', enabled = true) => ({
  resource_type: type, title: type === 'google_alerts' ? 'Google Alerts' : 'LinkedIn posts via Google Alerts',
  feed_url: type === 'google_alerts' ? 'https://www.google.com/alerts/feeds/123/456' : 'https://www.google.com/alerts/feeds/123/789', enabled,
});
const entry = (sourceUrl = 'https://buyer.org/requests/website') => ({
  title: 'Looking for a website development agency',
  snippet: 'We are looking for a website development agency. Project contact: Alex Morgan. Email: alex@buyer.org.',
  service: 'website', source_url: sourceUrl, source_platform: new URL(sourceUrl).hostname,
  feed_published_at: new Date().toISOString(), contact_name: null, email: null,
});
type Source = { id: string; owner_id: string; title: string; feed_url: string; enabled: boolean; version: number; next_check_at: string | null };
type Claim = { source: Source; run_id: string; claim_token: string };

async function setup(newer = true) {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema auth,storage to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;`);
  const applyFile = async (name: string) => db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  for (const name of ['001_foundation.sql', '002_live_workspace.sql', '003_dashboard_summary.sql', '004_restore_workspace_access.sql', '005_automatic_prospecting.sql']) await applyFile(name);
  if (newer) for (const name of ['006_project_requests.sql', '007_project_contacts.sql', '008_discovery_reliability.sql', '009_restore_hunter_discovery.sql']) await applyFile(name);
  await db.exec(`insert into auth.users values('${owner}'),('${other}');
    insert into public.leads(owner_id,company,contact_name,email,country,source,lawful_basis)
    select '${owner}','Preserved company '||n,'Preserved name '||n,'contact'||n||'@retained.org','United States','Hunter official APIs','Recorded review basis' from generate_series(1,22) n;
    insert into public.settings(owner_id,data) values('${owner}','{"businessName":"Preserved account","mode":"approval"}');`);
  const apply = () => applyFile('010_free_alert_sources.sql');
  const auth = (id = owner) => db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
  const service = () => db.exec('reset role;set role service_role;');
  const rpc = async <T = Record<string, unknown>>(call: string, values: unknown[] = []) =>
    (await db.query<{ result: T }>(`select public.${call} as result`, values)).rows[0].result;
  const saveSource = (payload = sourcePayload()) => rpc<Source>('save_alert_feed($1::jsonb)', [JSON.stringify(payload)]);
  const claim = (sourceId: string, claimToken = token, force = false, account = owner) =>
    rpc<Claim | null>('claim_alert_feed($1,$2,$3,$4)', [account, sourceId, claimToken, force]);
  const persist = (sourceId: string, payload: Record<string, unknown> = entry(), claimToken = token, account = owner) =>
    rpc<{ status: string; lead_id?: string }>('persist_alert_lead($1,$2,$3,$4::jsonb)', [account, sourceId, claimToken, JSON.stringify(payload)]);
  const finish = (sourceId: string, status = 'completed', error: string | null = null, counts = { entries_seen: 1, skipped_count: 0, leads_saved: 99 }, message = 'Untrusted message https://private-feed.invalid/ must never be stored') =>
    rpc<boolean>('finish_alert_feed($1,$2,$3,$4,$5::jsonb,$6,$7)', [owner, sourceId, token, status, JSON.stringify(counts), error, message]);
  return { db, apply, auth, service, rpc, saveSource, claim, persist, finish };
}

test('010 preserves Hunter records, settings and functions; owner-only view and RPC grants survive reapplication', async () => {
  const { db, apply, auth, service, rpc, saveSource, claim } = await setup();
  try {
    const records = (await db.query('select * from public.leads order by id')).rows;
    const business = (await db.query('select * from public.settings')).rows;
    const hunterFunction = (await db.query("select pg_get_functiondef('public.persist_discovered_lead(uuid,uuid,jsonb,text)'::regprocedure) as definition")).rows;
    await apply();await apply();
    assert.deepEqual((await db.query('select * from public.leads order by id')).rows, records);
    assert.deepEqual((await db.query('select * from public.settings')).rows, business);
    assert.deepEqual((await db.query("select pg_get_functiondef('public.persist_discovered_lead(uuid,uuid,jsonb,text)'::regprocedure) as definition")).rows, hunterFunction);
    await auth();assert.deepEqual(await rpc('alert_sources_readiness()'), { schema_version: 10 });
    const source = await saveSource();
    const view = (await db.query<{ resource_title: string; record_type: string }>('select resource_title,record_type from public.workspace_lead_records')).rows;
    assert.equal(view.length, 22);assert.ok(view.every(row => row.resource_title === 'Hunter' && row.record_type === 'contact'));
    for (const table of ['alert_feed_sources', 'alert_feed_runs', 'alert_leads']) {
      await assert.rejects(db.exec(`delete from public.${table}`), /permission denied/);
    }
    await assert.rejects(claim(source.id), /permission denied/);
    await auth(other);assert.equal((await db.query('select * from public.workspace_lead_records')).rows.length, 0);
    assert.equal((await db.query('select * from public.alert_feed_sources')).rows.length, 0);
    await service();assert.deepEqual(await rpc('alert_sources_readiness()'), { schema_version: 10 });
    await assert.rejects(saveSource(), /permission denied/);
    await db.exec('reset role;set role anon;');
    await assert.rejects(rpc('alert_sources_readiness()'), /permission denied/);
    await assert.rejects(db.query('select * from public.workspace_lead_records'), /permission denied/);
    await assert.rejects(saveSource(), /permission denied/);
  } finally { await db.close(); }
});

test('feed leases, pause/version checks, private URL validation and immutable cross-feed duplicate audit are enforced', async () => {
  const { db, apply, auth, service, rpc, saveSource, claim, persist, finish } = await setup(false);
  try {
    await apply();await auth();
    for (const url of ['http://www.google.com/alerts/feeds/123/456', 'https://google.com/alerts/feeds/123/456', 'https://www.google.com.evil.org/alerts/feeds/123/456', 'https://www.google.com/alerts/feeds/123/456?token=private', 'https://www.google.com/alerts/feeds/../private']) {
      await assert.rejects(saveSource({ ...sourcePayload(), feed_url: url }), /ALERT_INVALID/);
    }
    const google = await saveSource();const linkedIn = await saveSource(sourcePayload('linkedin_posts'));
    await service();
    assert.equal(await claim(google.id, token, false, other), null);
    const first = await claim(google.id);assert.ok(first);assert.equal(first.source.id, google.id);
    assert.equal(await claim(google.id, 'second-worker-claim-token'), null);
    assert.equal((await claim(google.id))?.run_id, first.run_id, 'The same execution may resume a durable run.');
    assert.equal((await persist(google.id, entry(), 'wrong-worker-claim-token')).status, 'paused');
    assert.equal((await persist(google.id, entry(), token, other)).status, 'paused');
    for (const url of ['http://127.0.0.1/private', 'https://localhost/private', 'https://buyer.internal/private', 'https://name:secret@buyer.org/private', 'https://buyer.org:8443/private', 'https://buyer.org/private?access_token=secret']) {
      assert.equal((await persist(google.id, entry(url))).status, 'invalid');
    }
    assert.equal((await persist(google.id, { ...entry(), email: 'invented@buyer.org' })).status, 'invalid');
    assert.equal((await persist(google.id, { ...entry(), contact_name: 'Invented person' })).status, 'invalid');
    const url = 'https://www.linkedin.com/posts/buyer_request-development-123';
    const saved = await persist(google.id, entry(url));assert.equal(saved.status, 'saved');assert.ok(saved.lead_id);
    assert.equal((await persist(google.id, entry(url))).status, 'duplicate');
    assert.equal(await finish(google.id), true);
    const run = (await db.query<{ leads_saved: number; message: string }>('select leads_saved,message from public.alert_feed_runs where id=$1', [first.run_id])).rows[0];
    assert.equal(run.leads_saved, 1, 'The worker cannot inflate saved counts.');assert.ok(!run.message.includes('private-feed'));
    assert.equal(await claim(google.id, token, true), null, 'Manual refresh cannot bypass the two-minute throttle.');
    assert.ok(await claim(linkedIn.id));
    assert.equal((await persist(linkedIn.id, entry('https://buyer.org/not-a-post'))).status, 'invalid');
    assert.equal((await persist(linkedIn.id, entry(url))).status, 'duplicate', 'The same original URL is deduplicated across both feeds.');
    await db.exec(`update public.alert_leads set discovered_at=now()-interval '2 days' where id='${saved.lead_id}'`);
    const original = (await db.query('select discovered_at from public.alert_leads where id=$1', [saved.lead_id])).rows;
    assert.equal((await persist(linkedIn.id, entry(url))).status, 'duplicate');
    assert.deepEqual((await db.query('select discovered_at from public.alert_leads where id=$1', [saved.lead_id])).rows, original);
    await db.exec('delete from public.alert_leads where id=$$' + saved.lead_id + '$$');
    assert.equal((await persist(linkedIn.id, entry(url))).status, 'duplicate', 'Deleting a row cannot reintroduce an audited source as new.');
    const secondUrl = 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890';
    assert.equal((await persist(linkedIn.id, { ...entry(secondUrl), email: 'alex@buyer.org', contact_name: 'Alex Morgan' })).status, 'saved');
    await auth();const previousVersion = linkedIn.version;
    const paused = await saveSource(sourcePayload('linkedin_posts', false));assert.equal(paused.version, previousVersion + 1);
    await service();assert.equal((await persist(linkedIn.id, entry('https://www.linkedin.com/posts/buyer_second'))).status, 'paused');
    assert.equal(await finish(linkedIn.id), false);
    assert.equal(await claim(linkedIn.id, token, true), null);
    const cancelled = (await db.query<{ status: string; leads_saved: number }>('select status,leads_saved from public.alert_feed_runs where source_id=$1', [linkedIn.id])).rows;
    assert.equal(cancelled[0].status, 'cancelled');assert.equal(cancelled[0].leads_saved, 1, 'Cancellation retains the audited count of partial saves.');
    await auth(other);assert.equal((await db.query('select id from public.alert_leads')).rows.length, 0);
    assert.equal((await db.query('select id from public.alert_feed_runs')).rows.length, 0);
    await service();
    await db.exec("update public.alert_feed_sources set last_checked_at=now()-interval '3 minutes' where resource_type='google_alerts'");
    assert.ok(await claim(google.id, token, true));
    assert.equal(await finish(google.id, 'failed', 'FEED_RATE_LIMIT'), true);
    const failed = (await db.query<{ error_code: string; message: string }>("select error_code,message from public.alert_feed_runs where source_id=$1 order by started_at desc,id desc", [google.id])).rows;
    assert.ok(failed.some(row => row.error_code === 'FEED_RATE_LIMIT' && !row.message.includes('private-feed')));
    await db.exec('reset role');await apply();await auth();assert.equal((await db.query('select id from public.alert_feed_sources')).rows.length, 2);
  } finally { await db.close(); }
});

test('unified view keeps nullable alert contact identity honest and all dates owner-scoped', async () => {
  const { db, apply, auth, service, saveSource, claim, persist, finish } = await setup();
  try {
    await apply();await auth();const source = await saveSource();await service();await claim(source.id);
    assert.equal((await persist(source.id)).status, 'saved');
    assert.equal(await finish(source.id, 'completed', null, { entries_seen: 7, skipped_count: 6, leads_saved: 999 },
      'Skipped — no buyer request: 2; service mismatch: 1; unsafe private-label: 1; employment: 51; closed: 999. https://www.google.com/alerts/feeds/123/secret?api_key=private'), true);
    const summary = (await db.query<{ leads_saved: number; message: string }>("select leads_saved,message from public.alert_feed_runs where source_id=$1", [source.id])).rows[0];
    assert.equal(summary.leads_saved, 1);assert.match(summary.message, /no buyer request: 2/);assert.match(summary.message, /service mismatch: 1/);
    assert.match(summary.message, /other skipped results: 3/);
    assert.ok(!summary.message.includes('private'));assert.ok(!summary.message.includes('google.com'));
    assert.ok(!summary.message.includes('employment'));assert.ok(!summary.message.includes('closed'));
    assert.ok(!summary.message.includes('999'));assert.ok(!summary.message.includes('unsafe private-label'));
    await auth();
    const alerts = (await db.query<{ record_type: string; company: string; email: string; contact_name: string; country: string; resource_title: string; resource_url: string; created_at: string; alert_snippet: string }>("select * from public.workspace_lead_records where record_type='alert'")).rows;
    assert.equal(alerts.length, 1);assert.equal(alerts[0].company, entry().title);assert.equal(alerts[0].email, '');assert.equal(alerts[0].contact_name, '');
    assert.equal(alerts[0].country, 'Not published');assert.equal(alerts[0].resource_title, 'Google Alerts');assert.equal(alerts[0].resource_url, entry().source_url);
    assert.equal(alerts[0].alert_snippet, entry().snippet);assert.ok(alerts[0].created_at);
    await assert.rejects(db.exec("update public.workspace_lead_records set stage='Won'"), /permission denied|cannot update view/);
    await auth(other);assert.equal((await db.query('select id from public.workspace_lead_records')).rows.length, 0);
  } finally { await db.close(); }
});
