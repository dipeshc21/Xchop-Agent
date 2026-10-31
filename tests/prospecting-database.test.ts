import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { defaultProspectingConfig as currentConfig } from '../lib/prospecting/types';
// Migration 005 is intentionally tested with its original configuration contract.
const { discoveryMode: _mode, services: _services, maxAgeDays: _age, ...legacyFields } = currentConfig;
const defaultProspectingConfig = { ...legacyFields, keywords: ['web design agency', 'branding agency'] };

const owner = '50000000-0000-4000-8000-000000000001';
const other = '50000000-0000-4000-8000-000000000002';
const token = 'lease-token-for-primary-worker';
const token2 = 'lease-token-for-replacement-worker';
const enabled = { ...defaultProspectingConfig, enabled: true, lawfulBasis: 'Relevant B2B prospects with documented legitimate interest assessment', dailyLeadLimit: 2, dailyRequestLimit: 5 };

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema auth,storage to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
  `);
  for (const name of ['001_foundation.sql','002_live_workspace.sql','003_dashboard_summary.sql','004_restore_workspace_access.sql','005_automatic_prospecting.sql']) {
    await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  }
  await db.exec(`insert into auth.users(id) values('${owner}'),('${other}');`);
  const auth = async (id = owner) => db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
  const service = async () => db.exec('reset role;set role service_role;');
  const rpc = async <T = Record<string,unknown>>(sql:string,args:unknown[] = []) => (await db.query<{result:T}>(`select public.${sql} as result`,args)).rows[0].result;
  return {db,auth,service,rpc};
}

const payload = (email = 'person@agency.test', changes: Record<string,unknown> = {}) => ({
  company:{domain:'agency.test',name:'Agency',description:'Web design studio',industry:'Design',countryCode:'US',country:'United States',timeZone:null,employeeCount:5,tags:['design']},
  contact:{email,firstName:'Alex',lastName:'Lee',role:'Founder',confidence:99,provenance:'found',sources:[{uri:'https://agency.test/contact',lastSeenOn:null}]},
  verification:{status:'valid',checkedAt:new Date().toISOString(),disposable:false,webmail:false,acceptAll:false},
  score:{score:80,reason:'Documented design-agency segment in selected market',segment:'Design agency'},lawfulBasis:'Not authoritative; run configuration is used',aiDraft:null,
  ...changes,
});
const domainPayload = (domain: string, local = 'person', changes: Record<string,unknown> = {}) => payload(`${local}@${domain}`, {
  company: { ...payload().company, domain }, ...changes,
});

test('prospecting configuration, service claims, request reservations and saving obey atomic owner policies', async () => {
  const {db,auth,service,rpc}=await setup();
  try {
    await auth();
    await assert.rejects(rpc('queue_prospecting_run()'),/PROSPECTING_PAUSED/);
    for(const invalid of [{...enabled,countries:['IN']},{...enabled,enabled:true,lawfulBasis:''},{...enabled,dailyRequestLimit:4},{...enabled,minScore:101},{...enabled,aiEnabled:'true'}]) {
      await assert.rejects(rpc('save_prospecting_settings($1::jsonb)',[JSON.stringify(invalid)]),/PROSPECTING_INVALID/);
    }
    const config=await rpc<{version:number}>('save_prospecting_settings($1::jsonb)',[JSON.stringify(enabled)]);
    assert.equal(config.version,1);
    await assert.rejects(db.exec(`update public.prospecting_settings set version=999`),/permission denied/);
    const run=await rpc<string>('queue_prospecting_run()');
    assert.equal(await rpc('queue_prospecting_run()'),run);
    assert.equal((await db.query('select id from public.prospecting_runs')).rows.length,1);
    await assert.rejects(db.query('select claim_token from public.prospecting_runs'),/permission denied/);
    await assert.rejects(rpc('claim_prospecting_run($1,$2,$3)',[owner,run,token]),/permission denied/);
    await assert.rejects(rpc('reserve_prospecting_request($1,$2,$3,$4,$5)',[owner,run,'search','hunter',token]),/permission denied/);
    await auth(other);
    assert.equal((await db.query('select id from public.prospecting_runs')).rows.length,0);
    assert.equal((await db.query('select owner_id from public.prospecting_settings')).rows.length,0);
    await service();
    assert.equal(await rpc('queue_due_prospecting_run($1)',[owner]),run);
    assert.equal(await rpc('claim_prospecting_run($1,$2,$3)',[other,run,token]),null);
    const claim=await rpc<{run:{id:string};config:{enabled:boolean};claim_token:string}>('claim_prospecting_run($1,$2,$3)',[owner,run,token]);
    assert.equal(claim.run.id,run); assert.equal(claim.config.enabled,true); assert.equal(claim.claim_token,token);
    assert.equal(await rpc('claim_prospecting_run($1,$2,$3)',[owner,run,token2]),null);
    assert.ok(await rpc('claim_prospecting_run($1,$2,$3)',[owner,run,token]));
    assert.equal((await rpc<{allowed:boolean}>('check_prospecting_run($1,$2,$3)',[owner,run,token])).allowed,true);
    const reserve=async(operation:string,claimToken=token)=>rpc<{state:string;status:string;result?:unknown}>('reserve_prospecting_request($1,$2,$3,$4,$5)',[owner,run,operation,'hunter',claimToken]);
    assert.equal((await reserve('search')).state,'reserved');
    assert.equal((await reserve('search')).status,'uncertain');
    assert.equal((await reserve('wrong-token',token2)).status,'paused');
    await rpc('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)',[owner,run,'search',token,JSON.stringify({companies:[{domain:'agency.test',name:'Agency'}]}),null]);
    const cached=await reserve('search'); assert.equal(cached.status,'cached'); assert.deepEqual(cached.result,{companies:[{domain:'agency.test',name:'Agency'}]});
    await rpc('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)',[owner,run,'search',token,JSON.stringify({ignored:'second completion'}),null]);
    assert.deepEqual((await reserve('search')).result,cached.result);
    for(let i=0;i<4;i++)assert.equal((await reserve(`paid-${i}`)).state,'reserved');
    assert.equal((await reserve('beyond-budget')).state,'limit');
    await assert.rejects(rpc('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)',[owner,run,'paid-0',token,JSON.stringify({api_key:'never-store'}),null]),/PROSPECTING_UNSAFE_RESULT/);
    assert.equal((await rpc<{status:string}>('record_prospecting_candidate($1,$2,$3,$4,$5,$6)',[owner,run,token,'AGENCY.TEST','processing',null])).status,'created');
    assert.equal((await rpc<{status:string}>('record_prospecting_candidate($1,$2,$3,$4,$5,$6)',[owner,run,token,'agency.test','processing',null])).status,'existing');
    const persist=async (data:Record<string,unknown>,claimToken=token)=>rpc<{status:string;lead_id?:string}>('persist_discovered_lead($1,$2,$3::jsonb,$4)',[owner,run,JSON.stringify(data),claimToken]);
    assert.equal((await persist(payload('outside@agency.test',{company:{...(payload().company),countryCode:'IN'}}))).status,'country_excluded');
    assert.equal((await persist(payload('low@agency.test',{score:{score:50,reason:'Low fit',segment:'Other'}}))).status,'low_score');
    assert.equal((await persist(payload('unverified@agency.test',{verification:{status:'unknown'}}))).status,'verification_required');
    for (const contact of [
      {...payload().contact,provenance:'inferred'},
      {...payload().contact,sources:[]},
      {...payload().contact,email:'person@unrelated.test'},
      {...payload().contact,sources:[{uri:'javascript:alert(1)'}]},
      {...payload().contact,sources:[{uri:'https://user:password@agency.test'}]},
    ]) assert.equal((await persist(payload(undefined,{contact}))).status,'provenance_required');
    for (const checkedAt of [new Date(Date.now()-32*86400000).toISOString(),new Date(Date.now()+3600000).toISOString(),null]) {
      assert.equal((await persist(payload(undefined,{verification:{...payload().verification,checkedAt}}))).status,'verification_required');
    }
    await auth();
    await rpc('suppress_workspace_email($1::jsonb)',[JSON.stringify({email:' SUPPRESSED@AGENCY.TEST ',reason:'unsubscribed'})]);
    await assert.rejects(db.exec('delete from public.suppression_list'),/permission denied/);
    await assert.rejects(db.exec("update public.suppression_list set reason='bounced'"),/permission denied/);
    // An existing manually entered contact does not prevent a different found contact at the same company.
    await rpc('create_workspace_lead($1::jsonb)',[JSON.stringify({company:'Manual existing company',website:'https://second.test',email:'manual@second.test',country:'United States',source:'Owner referral',lawful_basis:'Existing customer business inquiry'})]);
    await service();
    assert.equal((await persist(payload('suppressed@agency.test'))).status,'suppressed');
    const cachedDate=new Date(Date.now()-30*86400000).toISOString();
    const first=await persist(payload(undefined,{verification:{...payload().verification,checkedAt:cachedDate}})); assert.equal(first.status,'saved');
    assert.equal((await persist(payload())).status,'duplicate');
    assert.equal((await persist(payload('another@agency.test'))).status,'duplicate');
    assert.equal((await persist(domainPayload('second.test','second'))).status,'saved');
    assert.equal((await persist(domainPayload('third.test','third'))).status,'daily_limit');
    await auth();
    await db.exec("set timezone='Asia/Kolkata'");
    const usage=await rpc<{requests:number;leads_saved:number;day_start:string}>('prospecting_usage()');
    assert.deepEqual({requests:usage.requests,leads_saved:usage.leads_saved},{requests:5,leads_saved:2});
    assert.equal(new Date(usage.day_start).getUTCHours(),0);assert.equal(new Date(usage.day_start).getUTCMinutes(),0);
    const verified=(await db.query<{email_verified_at:Date|string}>("select email_verified_at from public.leads where email='person@agency.test'")).rows[0];
    assert.equal(new Date(verified.email_verified_at).toISOString(),cachedDate);
    const leads=await db.query<{contact_review_status:string;email_verification_status:string;lawful_basis:string;score:number}>('select contact_review_status,email_verification_status,lawful_basis,score from public.leads where discovery_run_id is not null');
    assert.equal(leads.rows.length,2);
    assert.ok(leads.rows.every(row=>row.contact_review_status==='needs_review'&&row.email_verification_status==='valid'&&row.lawful_basis===enabled.lawfulBasis&&row.score===80));
    // Deleting an owned CRM row cannot reset the immutable daily save budget.
    await db.exec(`delete from public.leads where email='second@second.test'`);
    assert.equal((await rpc<{leads_saved:number}>('prospecting_usage()')).leads_saved,2);
    await service();
    assert.equal((await persist(domainPayload('third.test','third'))).status,'daily_limit');
    assert.equal((await persist(domainPayload('second.test','replacement'))).status,'duplicate');
    assert.equal(await rpc('finish_prospecting_run($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)',[owner,run,token,'completed',JSON.stringify({skipped_count:3,leads_saved:999,request_count:999}),'Finished',null,1,JSON.stringify({'US|web design agency':10})]),true);
    assert.equal(await rpc('queue_due_prospecting_run($1)',[owner]),null);
    await auth();
    const finished=(await db.query<{status:string;request_count:number;companies_found:number;leads_saved:number}>('select status,request_count,companies_found,leads_saved from public.prospecting_runs')).rows[0];
    assert.equal(finished.status,'completed');assert.equal(finished.request_count,5);assert.equal(finished.companies_found,1);assert.equal(finished.leads_saved,2);
  }finally{await db.close();}
});

test('pause/config changes cancel queued and running work, and lease replacement rejects stale workers',async()=>{
  const {db,auth,service,rpc}=await setup();
  try{
    await auth();await rpc('save_prospecting_settings($1::jsonb)',[JSON.stringify(enabled)]);
    const run=await rpc<string>('queue_prospecting_run()');
    await service();await rpc('claim_prospecting_run($1,$2,$3)',[owner,run,token]);
    await db.exec('reset role');await db.exec(`update public.prospecting_runs set lease_until=now()-interval '1 minute' where id='${run}'`);await service();
    assert.ok(await rpc('claim_prospecting_run($1,$2,$3)',[owner,run,token2]));
    assert.equal((await rpc<{allowed:boolean}>('check_prospecting_run($1,$2,$3)',[owner,run,token])).allowed,false);
    assert.equal((await rpc<{state:string}>('reserve_prospecting_request($1,$2,$3,$4,$5)',[owner,run,'stale','hunter',token])).state,'paused');
    assert.equal((await rpc<{state:string}>('reserve_prospecting_request($1,$2,$3,$4,$5)',[owner,run,'inflight-before-pause','hunter',token2])).state,'reserved');
    await auth();const changed=await rpc<{version:number}>('save_prospecting_settings($1::jsonb)',[JSON.stringify({...enabled,enabled:false})]);assert.equal(changed.version,2);
    assert.equal((await db.query<{status:string}>('select status from public.prospecting_runs')).rows[0].status,'cancelled');
    await service();
    // A response already paid for may be cached after pause, while further paid work and lead saves stay blocked.
    assert.equal((await rpc<{status:string}>('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)',[owner,run,'inflight-before-pause',token2,JSON.stringify({companies:[]}),null])).status,'completed');
    assert.equal(await rpc('queue_due_prospecting_run($1)',[owner]),null);
    assert.equal((await rpc<{status:string}>('persist_discovered_lead($1,$2,$3::jsonb,$4)',[owner,run,JSON.stringify(payload()),token2])).status,'paused');
    assert.equal((await rpc<{status:string}>('reserve_prospecting_request($1,$2,$3,$4,$5)',[owner,run,'paused','hunter',token2])).status,'paused');
    await auth();await rpc('save_prospecting_settings($1::jsonb)',[JSON.stringify(enabled)]);
    const next=await rpc<string>('queue_prospecting_run()');assert.notEqual(next,run);
    await service();await rpc('claim_prospecting_run($1,$2,$3)',[owner,next,token]);
    await auth();await rpc('save_prospecting_settings($1::jsonb)',[JSON.stringify({...enabled,keywords:['branding studios']})]);
    await service();
    assert.equal((await rpc<{allowed:boolean}>('check_prospecting_run($1,$2,$3)',[owner,next,token])).allowed,false);
    assert.equal(await rpc('claim_prospecting_run($1,$2,$3)',[owner,next,token]),null);
    await db.exec('reset role;set role anon;');
    await assert.rejects(rpc('queue_prospecting_run()'),/permission denied/);
    await assert.rejects(rpc('queue_due_prospecting_run($1)',[owner]),/permission denied/);
  }finally{await db.close();}
});

test('a later run reclaims only unfinished candidates from terminal runs and preserves historical totals',async()=>{
  const {db,auth,service,rpc}=await setup();
  try{
    await auth();await rpc('save_prospecting_settings($1::jsonb)',[JSON.stringify(enabled)]);
    const run=await rpc<string>('queue_prospecting_run()');
    await service();await rpc('claim_prospecting_run($1,$2,$3)',[owner,run,token]);
    const record=async(runId:string,claim:string,domain:string,status='processing')=>rpc<{status:string;candidate_status:string;run_id:string}>(
      'record_prospecting_candidate($1,$2,$3,$4,$5,$6)',[owner,runId,claim,domain,status,null]);
    assert.equal((await record(run,token,'unfinished.test')).status,'created');
    for(const status of ['saved','skipped','needs_review']) await record(run,token,`${status.replace('_','-')}.test`,status);
    // Replaying an earlier processing step cannot erase a saved/skip/review decision.
    assert.equal((await record(run,token,'saved.test')).candidate_status,'saved');
    await auth();assert.equal(await rpc('queue_prospecting_run()'),run);
    await service();assert.equal(await rpc('claim_prospecting_run($1,$2,$3)',[owner,run,token2]),null);
    assert.equal(await rpc('finish_prospecting_run($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)',[owner,run,token,'failed','{}','Plan stopped this run','PLAN',0,'{}']),true);
    await auth();const next=await rpc<string>('queue_prospecting_run()');assert.notEqual(next,run);
    await service();await rpc('claim_prospecting_run($1,$2,$3)',[owner,next,token2]);
    const reclaimed=await record(next,token2,'unfinished.test');
    assert.deepEqual(reclaimed,{status:'reclaimed',candidate_status:'processing',run_id:next});
    assert.equal((await record(run,token,'unfinished.test')).status,'paused');
    for(const status of ['saved','skipped','needs_review']){
      const decided=await record(next,token2,`${status.replace('_','-')}.test`);
      assert.equal(decided.status,'existing');assert.equal(decided.candidate_status,status);assert.equal(decided.run_id,run);
    }
    // The old run's stored totals survive transfer of an unfinished candidate.
    assert.equal(await rpc('finish_prospecting_run($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)',[owner,run,token,'failed','{}','Repeated completion','PLAN',0,'{}']),true);
    const counts=(await db.query<{id:string;companies_found:number}>('select id,companies_found from public.prospecting_runs order by created_at,id')).rows;
    assert.equal(counts.find(row=>row.id===run)?.companies_found,4);
    assert.equal(counts.find(row=>row.id===next)?.companies_found,1);
    await auth();await rpc('save_prospecting_settings($1::jsonb)',[JSON.stringify({...enabled,enabled:false})]);
    await rpc('save_prospecting_settings($1::jsonb)',[JSON.stringify(enabled)]);
    const third=await rpc<string>('queue_prospecting_run()');
    await service();await rpc('claim_prospecting_run($1,$2,$3)',[owner,third,token]);
    assert.equal((await record(third,token,'unfinished.test')).status,'reclaimed');
    assert.equal(await rpc('finish_prospecting_run($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)',[owner,next,token2,'cancelled','{}','Stale worker completion','PAUSED',0,'{}']),true);
    assert.equal((await db.query<{companies_found:number}>('select companies_found from public.prospecting_runs where id=$1',[next])).rows[0].companies_found,1);
  }finally{await db.close();}
});

test('unfinished candidates with uncertain paid requests require investigation before a later run can repeat work',async()=>{
  const {db,auth,service,rpc}=await setup();
  try{
    await auth();await rpc('save_prospecting_settings($1::jsonb)',[JSON.stringify(enabled)]);
    const run=await rpc<string>('queue_prospecting_run()');
    await service();await rpc('claim_prospecting_run($1,$2,$3)',[owner,run,token]);
    const record=async(runId:string,claim:string)=>rpc<{status:string;run_id:string}>(
      'record_prospecting_candidate($1,$2,$3,$4,$5,$6)',[owner,runId,claim,'uncertain.test','processing',null]);
    await record(run,token);
    await rpc('reserve_prospecting_request($1,$2,$3,$4,$5)',[owner,run,'company:uncertain.test','hunter',token]);
    await rpc('finish_prospecting_run($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)',[owner,run,token,'failed','{}','A paid response could not be stored','DATABASE',0,'{}']);
    await auth();const next=await rpc<string>('queue_prospecting_run()');
    await service();await rpc('claim_prospecting_run($1,$2,$3)',[owner,next,token2]);
    const reserved=await record(next,token2);assert.equal(reserved.status,'existing');assert.equal(reserved.run_id,run);
    // Recording an already-paid response resolves the reserved ledger entry without paying again.
    await rpc('complete_prospecting_request($1,$2,$3,$4,$5::jsonb,$6)',[owner,run,'company:uncertain.test',token,'{"company":null}',null]);
    assert.equal((await record(next,token2)).status,'reclaimed');
    await rpc('finish_prospecting_run($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)',[owner,next,token2,'failed','{}','A request may already have reached the provider','REQUEST_UNCERTAIN',0,'{}']);
    await auth();const third=await rpc<string>('queue_prospecting_run()');
    await service();await rpc('claim_prospecting_run($1,$2,$3)',[owner,third,token]);
    const uncertain=await record(third,token);assert.equal(uncertain.status,'existing');assert.equal(uncertain.run_id,next);
  }finally{await db.close();}
});
