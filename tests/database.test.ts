import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('database migrations enforce account boundaries, guarded settings, and real lead creation',async()=>{
  const db=new PGlite();
  const a='00000000-0000-4000-8000-000000000001';
  const b='00000000-0000-4000-8000-000000000002';
  try{
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
      grant usage on schema public,auth,storage to authenticated;
      grant execute on function auth.uid() to authenticated;
      alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
    `);
    await db.exec(await readFile('supabase/migrations/001_foundation.sql','utf8'));
    await db.exec(`
      insert into auth.users(id) values('${a}'),('${b}');
      set role authenticated;set request.jwt.claim.sub='${a}';
      insert into public.companies(id,name) values('00000000-0000-4000-8000-000000000003','Private Agency');
      insert into public.leads(company,email,country,source,lawful_basis) values('A','a@example.test','US','test','test');
    `);
    assert.equal((await db.query('select * from public.leads')).rows.length,1);
    await db.exec(`set request.jwt.claim.sub='${b}';`);
    assert.equal((await db.query('select * from public.leads')).rows.length,0);
    await assert.rejects(db.exec(`insert into public.leads(owner_id,company,email,country,source,lawful_basis) values('${a}','B','b@example.test','US','test','test')`));
    await assert.rejects(db.exec(`insert into public.leads(company_id,company,email,country,source,lawful_basis) values('00000000-0000-4000-8000-000000000003','B','b@example.test','US','test','test')`));
    await assert.rejects(db.exec(`insert into public.agent_logs(agent,status) values('Tamper','done')`));
    await assert.rejects(db.exec(`insert into public.settings(data) values('{}')`));
    await assert.rejects(db.exec(`select public.save_workspace_settings('{"automation":true,"mode":"approval"}')`));
    await assert.rejects(db.exec(`select public.save_workspace_settings('{"automation":false,"mode":"auto"}')`));
    for(let i=0;i<20;i++)await db.exec(`select public.save_workspace_settings('{"automation":false,"mode":"approval"}')`);
    assert.equal((await db.query('select * from public.agent_logs')).rows.length,20);
    await assert.rejects(db.exec(`select public.save_workspace_settings('{"automation":false,"mode":"approval"}')`),/Rate limit exceeded/);
    await db.exec(`set request.jwt.claim.sub='${a}';`);
    assert.equal((await db.query('select * from public.agent_logs')).rows.length,0);
    assert.equal((await db.query('select * from public.settings')).rows.length,0);

    // Lead entry requires the second migration; existing foundation records are preserved.
    await db.exec('reset role');
    await db.exec(await readFile('supabase/migrations/002_live_workspace.sql','utf8'));
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${a}';`);
    await assert.rejects(db.exec(`insert into public.leads(company,email,country,source,lawful_basis) values('Bypass','bypass@example.test','US','test','test')`),/permission denied/);
    const base={company:'Agency',email:' HELLO@AGENCY.EXAMPLE ',country:'United States',source:'Business enquiry',lawful_basis:'Requested a quote'};
    const create=(changes:Record<string,unknown>={})=>db.query<Record<string,unknown>>('select * from public.create_workspace_lead($1::jsonb)',[JSON.stringify({...base,...changes})]);
    const first=(await create()).rows[0];
    assert.equal(first.owner_id,a);
    assert.equal(first.email,'hello@agency.example');
    assert.equal(first.stage,'New');
    assert.equal(first.score,0);
    assert.equal(first.score_reason,'Not scored');
    await assert.rejects(create(),/duplicate key/);
    await assert.rejects(create({owner_id:b,email:'spoof@example.test'}),/LEAD_INVALID/);
    await assert.rejects(create({source:''}),/LEAD_INVALID/);
    await assert.rejects(create({email:'india@example.test',country:'India'}),/LEAD_INDIA_EXCLUDED/);
    await assert.rejects(create({email:'india@example.test',country:'IN'}),/LEAD_INDIA_EXCLUDED/);
    await db.exec(`insert into public.suppression_list(email,reason) values('suppressed@example.test','unsubscribed');`);
    await assert.rejects(create({email:' SUPPRESSED@EXAMPLE.TEST '}),/LEAD_SUPPRESSED/);

    // Suppression entries are global within an account, never leaked across account boundaries.
    await db.exec(`set request.jwt.claim.sub='${b}';insert into public.suppression_list(email,reason) values('another@example.test','do-not-contact');set request.jwt.claim.sub='${a}';`);
    assert.equal((await create({email:'another@example.test'})).rows.length,1);
    await db.exec(`select public.save_workspace_settings('{"automation":false,"mode":"approval","excludeIndia":false}')`);
    assert.equal((await create({email:'indiaallowed@example.test',country:'India'})).rows.length,1);
    await db.exec(`select public.save_workspace_settings('{"automation":false,"mode":"approval","excludeIndia":true}')`);
    for(let i=3;i<30;i++)await create({email:`contact-${i}@agency.example`});
    await assert.rejects(create({email:'over-limit@agency.example'}),/LEAD_RATE_LIMIT/);
    assert.equal((await db.query("select * from public.agent_logs where agent='LeadEntry'")).rows.length,30);
    const update=(changes:Record<string,unknown>={})=>db.query<Record<string,unknown>>('select * from public.update_workspace_lead($1::jsonb)',[JSON.stringify({id:first.id,stage:'Qualified',value:150.75,...changes})]);
    await assert.rejects(db.exec(`update public.leads set value=1 where id='${first.id}'`),/permission denied/);
    const changed=(await update()).rows[0];
    assert.equal(changed.stage,'Qualified');
    assert.equal(Number(changed.value),150.75);
    await assert.rejects(update({owner_id:b}),/LEAD_INVALID/);
    await assert.rejects(update({email:'suppressed@example.test'}),/LEAD_INVALID/);
    await assert.rejects(update({stage:'Invalid stage'}),/LEAD_INVALID/);
    for(let i=1;i<30;i++)await update({value:i});
    await assert.rejects(update({value:99}),/LEAD_RATE_LIMIT/);
    assert.equal((await db.query("select * from public.agent_logs where agent='LeadUpdate'")).rows.length,30);
    await db.exec(`set request.jwt.claim.sub='${b}';`);
    assert.equal((await db.query('select * from public.leads')).rows.length,0);
    await assert.rejects(update(),/LEAD_NOT_FOUND/);
    const other=(await create({email:'hello@agency.example'})).rows[0];
    assert.equal(other.owner_id,b);
    assert.equal((await update({id:other.id,stage:'Won',value:500})).rows[0].stage,'Won');
    await db.exec(`set request.jwt.claim.sub='';`);
    await assert.rejects(create({email:'unsigned@agency.example'}),/Authentication required/);
  }finally{await db.close();}
});
