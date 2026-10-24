import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { DashboardSummary } from '../lib/dashboard';

const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const ids = Array.from({length: 8}, (_, i) => `10000000-0000-4000-8000-${String(10 + i).padStart(12, '0')}`);

test('dashboard RPC aggregates actual records, isolates accounts and keeps currencies separate', async () => {
  const db = new PGlite();
  const summary = async (period = 'all') => (await db.query<{data: DashboardSummary}>(
    'select public.workspace_dashboard($1) as data', [period])).rows[0].data;
  try {
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
      grant usage on schema public,auth,storage to authenticated;
      grant execute on function auth.uid() to authenticated;
      alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
    `);
    await db.exec(await readFile('supabase/migrations/001_foundation.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/003_dashboard_summary.sql', 'utf8'));
    await db.exec(`
      insert into auth.users(id) values('${owner}'),('${other}');
      insert into public.leads(id,owner_id,company,email,country,source,lawful_basis,stage,value,created_at) values
        ('${ids[0]}','${owner}','A','a@example.test','United States','test','test','New',200,now()),
        ('${ids[1]}','${owner}','B','b@example.test','United Kingdom','test','test','Qualified',300,now()),
        ('${ids[2]}','${owner}','C','c@example.test','United Kingdom','test','test','Won',400,now()),
        ('${ids[3]}','${owner}','D','d@example.test','Canada','test','test','Lost',500,now()),
        ('${ids[4]}','${other}','Other','other@example.test','Canada','test','test','New',999,now()),
        ('${ids[5]}','${owner}','Old','old@example.test','United States','test','test','Delivered',600,
          (date_trunc('month',timezone('UTC',now())) at time zone 'UTC')-interval '1 second');
      insert into public.email_messages(owner_id,lead_id,subject,body,status,sent_at) values
        ('${owner}','${ids[0]}','One','body','sent',now()-interval '1 hour'),
        ('${owner}','${ids[0]}','Follow-up','body','sent',now()-interval '30 minutes'),
        ('${owner}','${ids[1]}','Two','body','sent',now()-interval '1 hour'),
        ('${owner}','${ids[2]}','Draft','body','draft',null),
        ('${other}','${ids[4]}','Other','body','sent',now());
      insert into public.replies(owner_id,lead_id,body,created_at) values
        ('${owner}','${ids[0]}','Reply one',now()),
        ('${owner}','${ids[0]}','Reply two',now()),
        ('${owner}','${ids[1]}','Old reply before send',now()-interval '2 hours'),
        ('${owner}','${ids[2]}','Unrelated inbound',now()),
        ('${other}','${ids[4]}','Other reply',now());
      insert into public.quotes(id,owner_id,lead_id,amount,currency) values
        ('${ids[6]}','${owner}','${ids[0]}',100,'USD'),
        ('${ids[7]}','${other}','${ids[4]}',999,'USD');
      insert into public.payments(owner_id,quote_id,provider,provider_event_id,amount,currency,status) values
        ('${owner}','${ids[6]}','test','usd-paid',100,'USD','paid'),
        ('${owner}','${ids[6]}','test','usd-succeeded',50,'usd','succeeded'),
        ('${owner}','${ids[6]}','test','eur-completed',80,'EUR','completed'),
        ('${owner}','${ids[6]}','test','usd-pending',700,'USD','pending'),
        ('${other}','${ids[7]}','test','other-payment',999,'USD','paid');
      insert into public.tasks(owner_id,title,due_at,completed_at) values
        ('${owner}','Overdue task',now()-interval '1 day',null),
        ('${owner}','Completed task',now(),now()),
        ('${owner}','Future task',now()+interval '8 days',null),
        ('${other}','Other task',now(),null);
      insert into public.projects(owner_id,lead_id,title,status,deadline) values
        ('${owner}','${ids[0]}','Due project','In Progress',now()+interval '1 day'),
        ('${owner}','${ids[0]}','Closed project','Closed',now()),
        ('${owner}','${ids[0]}','Delivered project','Delivered',now());
      set role authenticated;
      set request.jwt.claim.sub='${owner}';
    `);
    const data = await summary();
    assert.equal(data.leadCount, 5);
    assert.equal(data.sentCount, 3);
    assert.equal(data.replyRate, 50); // One of two distinct contacted leads, not three of three replies/messages.
    assert.equal(data.wonCount, 2);
    assert.equal(data.pipelineValue, 500);
    assert.equal(data.quoteCount, 1);
    assert.deepEqual(data.revenue, [{currency:'EUR',amount:80},{currency:'USD',amount:150}]);
    assert.equal(data.funnel.length, 11);
    assert.equal(data.funnel.find(s => s.stage === 'New')?.count, 1);
    assert.equal(data.funnel.find(s => s.stage === 'Negotiation')?.count, 0);
    assert.equal(data.markets.reduce((n,m) => n+m.count,0), 5);
    assert.deepEqual(data.attention.map(item => item.title), ['Overdue task','Due project']);

    await db.exec("set timezone='Pacific/Honolulu'");
    const month = await summary('month');
    assert.equal(month.leadCount, 4); // Previous UTC month excluded, even with non-UTC server timezone.
    assert.equal(month.wonCount, 2); // Current won and pipeline are all-time snapshots.
    const week = await summary('week');
    assert.ok(week.leadCount >= 4 && week.leadCount <= 5);
    await assert.rejects(summary('year'), /Invalid reporting period/);

    await db.exec(`set request.jwt.claim.sub='${other}'`);
    const second = await summary();
    assert.equal(second.leadCount, 1);
    assert.equal(second.pipelineValue, 999);
    assert.equal(second.replyRate, 100);
    assert.deepEqual(second.revenue, [{currency:'USD',amount:999}]);
    assert.equal(second.attention[0]?.title, 'Other task');

    await db.exec("set request.jwt.claim.sub=''");
    await assert.rejects(summary(), /Authentication required/);
    await db.exec('reset role; set role anon');
    await assert.rejects(summary(), /permission denied/);
  } finally { await db.close(); }
});

test('new authenticated workspace returns zeros and empty records', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
      grant usage on schema public,auth,storage to authenticated;
      grant execute on function auth.uid() to authenticated;
      alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
    `);
    await db.exec(await readFile('supabase/migrations/001_foundation.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/003_dashboard_summary.sql','utf8'));
    await db.exec(`insert into auth.users(id) values('${owner}');set role authenticated;set request.jwt.claim.sub='${owner}'`);
    const data = (await db.query<{data:DashboardSummary}>("select public.workspace_dashboard('all') as data")).rows[0].data;
    assert.equal(data.leadCount,0);
    assert.equal(data.sentCount,0);
    assert.equal(data.replyRate,0);
    assert.equal(data.pipelineValue,0);
    assert.equal(data.wonCount,0);
    assert.equal(data.quoteCount,0);
    assert.deepEqual(data.revenue,[]);
    assert.deepEqual(data.markets,[]);
    assert.deepEqual(data.attention,[]);
    assert.ok(data.funnel.every(item=>item.count===0));
  } finally { await db.close(); }
});
