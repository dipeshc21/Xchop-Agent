import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '40000000-0000-4000-8000-000000000001';
const other = '40000000-0000-4000-8000-000000000002';
const bootstrap = async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema auth, storage to authenticated;
    grant execute on function auth.uid() to authenticated;
    revoke all on schema public from public, anon, authenticated;
  `);
  return db;
};
const migration = (name: string) => readFile(`supabase/migrations/${name}`, 'utf8');

// Unlike earlier database tests, this intentionally does NOT pregrant public schema USAGE.
test('access repair restores hardened schema/API privileges without changing records or account rules', async () => {
  const db = await bootstrap();
  try {
    await db.exec(await migration('001_foundation.sql'));
    await db.exec(await migration('002_live_workspace.sql'));
    await db.exec(await migration('003_dashboard_summary.sql'));
    await db.exec(`
      insert into auth.users(id) values('${owner}'),('${other}');
      insert into public.leads(owner_id,company,email,country,source,lawful_basis) values
        ('${owner}','Own agency','own@example.test','United States','test','test'),
        ('${other}','Other agency','other@example.test','Canada','test','test');
      revoke select on public.leads, public.email_messages from authenticated;
      revoke execute on function public.workspace_dashboard(text) from authenticated;
    `);
    const policySnapshot = async () => (await db.query(`
      select n.nspname, c.relname, c.relrowsecurity, p.polname,
             pg_get_expr(p.polqual,p.polrelid) as using_expression,
             pg_get_expr(p.polwithcheck,p.polrelid) as check_expression
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      left join pg_policy p on p.polrelid=c.oid
      where n.nspname='public' and c.relkind='r'
      order by c.relname,p.polname
    `)).rows;
    const policiesBefore = await policySnapshot();
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    await assert.rejects(db.query('select * from public.leads'), /permission denied for schema public/);
    await assert.rejects(db.query("select public.workspace_dashboard('month')"), /permission denied for schema public/);
    await db.exec('reset role');
    const repair = await migration('004_restore_workspace_access.sql');
    await db.exec(repair);
    await db.exec(repair); // The repair must remain idempotent.
    assert.deepEqual(await policySnapshot(), policiesBefore);
    assert.equal((await db.query<{count:number}>('select count(*)::int as count from public.leads')).rows[0].count, 2);

    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    const owned = await db.query<{company:string}>('select company from public.leads');
    assert.deepEqual(owned.rows, [{company:'Own agency'}]);
    const dashboard = await db.query<{data:{leadCount:number}}>("select public.workspace_dashboard('all') as data");
    assert.equal(dashboard.rows[0].data.leadCount, 1);
    assert.equal((await db.query('select id from public.email_messages')).rows.length, 0);
    await assert.rejects(db.exec(`insert into public.leads(company,email,country,source,lawful_basis) values('Bypass','bypass@example.test','US','test','test')`), /permission denied/);
    await assert.rejects(db.exec("update public.leads set stage='Won'"), /permission denied/);
    await assert.rejects(db.exec("insert into public.settings(data) values('{}')"), /permission denied/);
    await assert.rejects(db.exec("insert into public.agent_logs(agent,status) values('tamper','completed')"), /permission denied/);
    await assert.rejects(db.exec("delete from public.payments"), /permission denied/);
    const realLead = await db.query<{owner_id:string}>(
      'select * from public.create_workspace_lead($1::jsonb)',
      [JSON.stringify({company:'New agency',email:'new@example.test',country:'United Kingdom',source:'Business enquiry',lawful_basis:'Requested a quote'})],
    );
    assert.equal(realLead.rows[0].owner_id, owner);
    await db.exec(`set request.jwt.claim.sub='${other}'`);
    assert.deepEqual((await db.query<{company:string}>('select company from public.leads')).rows, [{company:'Other agency'}]);
    await db.exec("set request.jwt.claim.sub=''");
    await assert.rejects(db.query("select public.workspace_dashboard('all')"), /Authentication required/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.leads'), /permission denied/);
    await assert.rejects(db.query("select public.workspace_dashboard('all')"), /permission denied/);
  } finally { await db.close(); }
});

test('access repair refuses incomplete migrations rather than creating a partial database', async () => {
  const db = await bootstrap();
  try {
    await db.exec(await migration('001_foundation.sql'));
    await assert.rejects(db.exec(await migration('004_restore_workspace_access.sql')),
      /Required workspace migrations are incomplete.*create_workspace_lead.*workspace_dashboard/s);
    await db.exec('rollback');
    const access = await db.query<{allowed:boolean}>("select has_schema_privilege('authenticated','public','USAGE') as allowed");
    assert.equal(access.rows[0].allowed, false);
    assert.equal((await db.query<{count:number}>('select count(*)::int as count from public.leads')).rows[0].count, 0);
  } finally { await db.close(); }
});

test('access repair refuses granting reads when an application table has RLS disabled', async () => {
  const db = await bootstrap();
  try {
    for (const filename of ['001_foundation.sql','002_live_workspace.sql','003_dashboard_summary.sql']) {
      await db.exec(await migration(filename));
    }
    await db.exec('alter table public.leads disable row level security');
    await assert.rejects(db.exec(await migration('004_restore_workspace_access.sql')), /row-level security is not enabled on: public.leads/);
    await db.exec('rollback');
    assert.equal((await db.query<{allowed:boolean}>("select has_schema_privilege('authenticated','public','USAGE') as allowed")).rows[0].allowed, false);
  } finally { await db.close(); }
});
