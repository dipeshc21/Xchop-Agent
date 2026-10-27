-- Phase 2: official-API prospecting only. Run after 001–004. No provider keys or sample leads are stored.
begin;

create table public.prospecting_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  version integer not null default 1 check(version > 0),
  next_run_at timestamptz,
  search_index integer not null default 0 check(search_index >= 0),
  cursors jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table public.prospecting_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
  trigger_source text not null check(trigger_source in ('manual','scheduled')),
  config_snapshot jsonb not null,
  config_version integer not null,
  search_index integer not null default 0,
  cursors jsonb not null default '{}',
  started_at timestamptz,
  finished_at timestamptz,
  lease_until timestamptz,
  claim_token text,
  companies_found integer not null default 0 check(companies_found >= 0),
  leads_saved integer not null default 0 check(leads_saved >= 0),
  skipped_count integer not null default 0 check(skipped_count >= 0),
  request_count integer not null default 0 check(request_count >= 0),
  error_code text,
  message text,
  created_at timestamptz not null default now(),
  unique(id,owner_id)
);
create unique index prospecting_one_active_run on public.prospecting_runs(owner_id) where status in ('queued','running');
create index prospecting_runs_owner_created on public.prospecting_runs(owner_id,created_at desc);
create index prospecting_settings_due on public.prospecting_settings(next_run_at) where next_run_at is not null;

create table public.prospecting_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  operation text not null check(length(operation) between 1 and 200),
  provider text not null check(provider in ('hunter','anthropic')),
  status text not null default 'reserved' check(status in ('reserved','completed','failed')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(owner_id,run_id,operation),
  foreign key(run_id,owner_id) references public.prospecting_runs(id,owner_id) on delete cascade
);
create index prospecting_requests_daily on public.prospecting_requests(owner_id,created_at);
create table public.prospecting_candidates (
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  run_id uuid not null,
  status text not null default 'processing' check(status in ('processing','skipped','saved','needs_review')),
  reason text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key(owner_id,domain),
  foreign key(run_id,owner_id) references public.prospecting_runs(id,owner_id) on delete cascade,
  check(domain=lower(trim(domain)) and domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$')
);

alter table public.leads
  add column email_verification_status text not null default 'unverified'
    check(email_verification_status in ('unverified','valid','invalid','accept_all','webmail','disposable','unknown','pending','claimed')),
  add column email_verified_at timestamptz,
  add column contact_review_status text not null default 'needs_review' check(contact_review_status in ('needs_review','approved','rejected')),
  add column discovery_run_id uuid,
  add column discovered_at timestamptz,
  add constraint leads_discovery_owner_fk foreign key(discovery_run_id,owner_id) references public.prospecting_runs(id,owner_id);
create index leads_discovered_daily on public.leads(owner_id,discovered_at) where discovery_run_id is not null;
create index prospecting_saved_domains on public.agent_logs(owner_id,(input->>'domain'))
  where agent='QualifierAgent' and status='completed' and output ? 'lead_id';

do $$ declare tab text; begin
  foreach tab in array array['prospecting_settings','prospecting_runs','prospecting_requests','prospecting_candidates'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('create policy own_read on public.%I for select to authenticated using(owner_id=(select auth.uid()))',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
end $$;
grant select on public.prospecting_settings,public.prospecting_requests,public.prospecting_candidates to authenticated;
-- Claims are worker-owned. Browser status queries select these safe columns explicitly.
grant select(id,owner_id,status,trigger_source,config_snapshot,config_version,search_index,cursors,
  started_at,finished_at,lease_until,companies_found,leads_saved,skipped_count,request_count,error_code,message,created_at)
  on public.prospecting_runs to authenticated;
grant usage on schema public to authenticated,service_role;
-- Suppression changes are audited through the RPC below, rather than removable by a browser.
revoke insert,update,delete on public.suppression_list from authenticated;
grant select,insert,update on public.suppression_list to service_role;
grant select on public.leads to service_role;

create function public.save_prospecting_settings(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); item jsonb; field text; n numeric; old public.prospecting_settings; saved public.prospecting_settings; changed boolean;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if payload is null or jsonb_typeof(payload)<>'object'
     or payload-array['enabled','countries','keywords','intervalHours','companiesPerRun','dailyLeadLimit','dailyRequestLimit','minScore','paginationEnabled','lawfulBasis','aiEnabled','aiPrompt']<>'{}'::jsonb
     or not(payload ?& array['enabled','countries','keywords','intervalHours','companiesPerRun','dailyLeadLimit','dailyRequestLimit','minScore','paginationEnabled','lawfulBasis','aiEnabled','aiPrompt']) then
    raise exception 'PROSPECTING_INVALID';
  end if;
  foreach field in array array['enabled','paginationEnabled','aiEnabled'] loop
    if jsonb_typeof(payload->field) is distinct from 'boolean' then raise exception 'PROSPECTING_INVALID'; end if;
  end loop;
  foreach field in array array['lawfulBasis','aiPrompt'] loop
    if jsonb_typeof(payload->field) is distinct from 'string' then raise exception 'PROSPECTING_INVALID'; end if;
  end loop;
  if length(trim(payload->>'lawfulBasis'))>2000 or ((payload->>'enabled')::boolean and length(trim(payload->>'lawfulBasis'))<10)
    or length(trim(payload->>'aiPrompt')) not between 10 and 4000 then raise exception 'PROSPECTING_INVALID'; end if;
  foreach field in array array['countries','keywords'] loop
    if jsonb_typeof(payload->field) is distinct from 'array' or jsonb_array_length(payload->field) not between 1 and 8 then raise exception 'PROSPECTING_INVALID'; end if;
    for item in select value from jsonb_array_elements(payload->field) loop
      if jsonb_typeof(item)<>'string' then raise exception 'PROSPECTING_INVALID'; end if;
      if field='countries' and not((item#>>'{}')=any(array['US','GB','CA','AU','AE','DE','FR','NL','IE','NZ','SG','SE','CH'])) then raise exception 'PROSPECTING_INVALID'; end if;
      if field='keywords' and length(trim(item#>>'{}')) not between 3 and 100 then raise exception 'PROSPECTING_INVALID'; end if;
    end loop;
  end loop;
  foreach field in array array['intervalHours','companiesPerRun','dailyLeadLimit','dailyRequestLimit','minScore'] loop
    if jsonb_typeof(payload->field) is distinct from 'number' then raise exception 'PROSPECTING_INVALID'; end if;
    n:=(payload->>field)::numeric;
    if n<>trunc(n) or (field='intervalHours' and n not between 6 and 168)
      or (field='companiesPerRun' and n not between 1 and 20)
      or (field='dailyLeadLimit' and n not between 1 and 100)
      or (field='dailyRequestLimit' and n not between 5 and 500)
      or (field='minScore' and n not between 0 and 100) then raise exception 'PROSPECTING_INVALID'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if (select count(*) from public.agent_logs where owner_id=actor and agent='ProspectorSettings' and created_at>now()-interval '1 minute')>=20 then raise exception 'PROSPECTING_RATE_LIMIT'; end if;
  select * into old from public.prospecting_settings where owner_id=actor for update;
  changed:=not found or old.data is distinct from payload;
  insert into public.prospecting_settings(owner_id,data,version,next_run_at)
  values(actor,payload,1,case when (payload->>'enabled')::boolean then now() end)
  on conflict(owner_id) do update set data=excluded.data,
    version=case when changed then public.prospecting_settings.version+1 else public.prospecting_settings.version end,
    next_run_at=case when not(payload->>'enabled')::boolean then null when changed then now() else public.prospecting_settings.next_run_at end,
    search_index=case when changed then 0 else public.prospecting_settings.search_index end,
    cursors=case when changed then '{}'::jsonb else public.prospecting_settings.cursors end,updated_at=now()
  returning * into saved;
  if changed then update public.prospecting_runs set status='cancelled',finished_at=now(),message='Discovery settings changed.',error_code='CONFIG_CHANGED' where owner_id=actor and status in ('queued','running'); end if;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(actor,'ProspectorSettings','{"action":"save"}',jsonb_build_object('enabled',payload->'enabled','version',saved.version),'completed');
  return jsonb_build_object('data',saved.data,'version',saved.version,'next_run_at',saved.next_run_at);
end $$;

create function public.queue_prospecting_run() returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); config public.prospecting_settings; active uuid; created uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into config from public.prospecting_settings where owner_id=actor for update;
  if not found or not coalesce((config.data->>'enabled')::boolean,false) then raise exception 'PROSPECTING_PAUSED'; end if;
  select id into active from public.prospecting_runs where owner_id=actor and status in ('queued','running');
  if active is not null then return active; end if;
  if (select count(*) from public.prospecting_runs where owner_id=actor and created_at>now()-interval '1 minute')>=5 then raise exception 'PROSPECTING_RATE_LIMIT'; end if;
  insert into public.prospecting_runs(owner_id,trigger_source,config_snapshot,config_version,search_index,cursors)
    values(actor,'manual',config.data,config.version,config.search_index,config.cursors) returning id into created;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(actor,'ProspectorAgent','{"action":"queue","source":"manual"}',jsonb_build_object('run_id',created),'queued');
  return created;
end $$;

create function public.prospecting_usage() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); day_start timestamptz:=date_trunc('day',timezone('UTC',now())) at time zone 'UTC';
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  return jsonb_build_object('day_start',day_start,
    'requests',(select count(*) from public.prospecting_requests where owner_id=actor and created_at>=day_start),
    'leads_saved',(select count(*) from public.agent_logs where owner_id=actor and agent='QualifierAgent' and status='completed' and output ? 'lead_id' and created_at>=day_start));
end $$;

create function public.suppress_workspace_email(payload jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); email_address text; suppression_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if payload is null or jsonb_typeof(payload)<>'object' or payload-array['email','reason']<>'{}'::jsonb
    or jsonb_typeof(payload->'email') is distinct from 'string' or jsonb_typeof(payload->'reason') is distinct from 'string'
    or length(trim(payload->>'email')) not between 3 and 254
    or trim(payload->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or not(payload->>'reason'=any(array['unsubscribed','bounced','do-not-contact'])) then raise exception 'SUPPRESSION_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if (select count(*) from public.agent_logs where owner_id=actor and agent='Suppression' and created_at>now()-interval '1 minute')>=30 then raise exception 'SUPPRESSION_RATE_LIMIT'; end if;
  email_address:=lower(trim(payload->>'email'));
  insert into public.suppression_list(owner_id,email,reason) values(actor,email_address,payload->>'reason')
    on conflict(owner_id,email) do update set reason=excluded.reason returning id into suppression_id;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(actor,'Suppression',jsonb_build_object('reason',payload->>'reason'),jsonb_build_object('suppression_id',suppression_id),'completed');
  return suppression_id;
end $$;

create function public.queue_due_prospecting_run(p_owner uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare config public.prospecting_settings; active uuid; created uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  select * into config from public.prospecting_settings where owner_id=p_owner for update;
  if not found or not coalesce((config.data->>'enabled')::boolean,false) then return null; end if;
  select id into active from public.prospecting_runs where owner_id=p_owner and status in ('queued','running');
  if active is not null then return active; end if;
  if config.next_run_at is null or config.next_run_at>now() then return null; end if;
  insert into public.prospecting_runs(owner_id,trigger_source,config_snapshot,config_version,search_index,cursors)
    values(p_owner,'scheduled',config.data,config.version,config.search_index,config.cursors) returning id into created;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(p_owner,'ProspectorAgent','{"action":"queue","source":"scheduled"}',jsonb_build_object('run_id',created),'queued');
  return created;
end $$;

-- Internal guard: all service operations recheck the saved kill switch, version and worker lease.
create function public.prospecting_run_gate(p_owner uuid,p_run uuid,p_claim_token text) returns text
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare run public.prospecting_runs; config public.prospecting_settings;
begin
  select * into run from public.prospecting_runs where id=p_run and owner_id=p_owner;
  if not found then return 'NOT_FOUND'; end if;
  select * into config from public.prospecting_settings where owner_id=p_owner;
  if not found or not coalesce((config.data->>'enabled')::boolean,false) then return 'PAUSED'; end if;
  if run.config_version<>config.version then return 'CONFIG_CHANGED'; end if;
  if run.status<>'running' or p_claim_token is null or run.claim_token is distinct from p_claim_token or run.lease_until is null or run.lease_until<now() then return 'LEASE_LOST'; end if;
  return null;
end $$;

create function public.claim_prospecting_run(p_owner uuid,p_run uuid,p_claim_token text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare run public.prospecting_runs; config public.prospecting_settings;
begin
  if p_claim_token is null or length(p_claim_token) not between 16 and 128 then raise exception 'PROSPECTING_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  select * into config from public.prospecting_settings where owner_id=p_owner for update;
  if not found or not coalesce((config.data->>'enabled')::boolean,false) then return null; end if;
  select * into run from public.prospecting_runs where id=p_run and owner_id=p_owner for update;
  if not found or run.status not in ('queued','running') or run.config_version<>config.version then return null; end if;
  if run.status='running' and run.claim_token is distinct from p_claim_token and run.lease_until>now() then return null; end if;
  update public.prospecting_runs set status='running',claim_token=p_claim_token,lease_until=now()+interval '15 minutes',started_at=coalesce(started_at,now()) where id=p_run returning * into run;
  return jsonb_build_object('run',to_jsonb(run),'config',run.config_snapshot,'config_version',run.config_version,'search_index',run.search_index,'cursors',run.cursors,'claim_token',p_claim_token);
end $$;

create function public.check_prospecting_run(p_owner uuid,p_run uuid,p_claim_token text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  reason:=public.prospecting_run_gate(p_owner,p_run,p_claim_token);
  if reason is null then update public.prospecting_runs set lease_until=now()+interval '15 minutes' where id=p_run and owner_id=p_owner; end if;
  return jsonb_build_object('allowed',reason is null,'reason',reason);
end $$;

create function public.reserve_prospecting_request(p_owner uuid,p_run uuid,p_operation text,p_provider text,p_claim_token text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text; existing public.prospecting_requests; config public.prospecting_settings; day_start timestamptz:=date_trunc('day',timezone('UTC',now())) at time zone 'UTC';
begin
  if p_operation is null or length(p_operation) not between 1 and 200 or p_provider not in ('hunter','anthropic') or p_provider is null then raise exception 'PROSPECTING_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  reason:=public.prospecting_run_gate(p_owner,p_run,p_claim_token);
  if reason is not null then return jsonb_build_object('state','paused','status','paused','reason',reason); end if;
  select * into existing from public.prospecting_requests where owner_id=p_owner and run_id=p_run and operation=p_operation;
  if found then
    if existing.provider<>p_provider then raise exception 'PROSPECTING_INVALID'; end if;
    if existing.status='completed' then return jsonb_build_object('state','completed','status','cached','result',existing.result); end if;
    return jsonb_build_object('state',case when existing.status='failed' then 'failed' else 'inflight' end,'status','uncertain','reason',coalesce(existing.error_code,'REQUEST_UNCERTAIN'));
  end if;
  select * into config from public.prospecting_settings where owner_id=p_owner;
  if (select count(*) from public.prospecting_requests where owner_id=p_owner and created_at>=day_start)>=(config.data->>'dailyRequestLimit')::integer then return jsonb_build_object('state','limit','status','budget_exhausted','reason','DAILY_REQUEST_LIMIT'); end if;
  insert into public.prospecting_requests(owner_id,run_id,operation,provider) values(p_owner,p_run,p_operation,p_provider);
  update public.prospecting_runs set request_count=request_count+1,lease_until=now()+interval '15 minutes' where id=p_run and owner_id=p_owner;
  return jsonb_build_object('state','reserved','status','reserved');
end $$;

create function public.complete_prospecting_request(p_owner uuid,p_run uuid,p_operation text,p_claim_token text,p_result jsonb,p_error_code text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare run public.prospecting_runs; request public.prospecting_requests;
begin
  if p_error_code is not null and p_error_code!~'^[A-Z0-9_:-]{1,80}$' then raise exception 'PROSPECTING_INVALID'; end if;
  if p_result is not null and (pg_column_size(p_result)>65536 or p_result::text~*'"(api_?key|authorization|access_?token|secret|password)"[[:space:]]*:' or p_result::text~*'(api_key|apikey|access_token|authorization)=') then raise exception 'PROSPECTING_UNSAFE_RESULT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  select * into run from public.prospecting_runs where id=p_run and owner_id=p_owner;
  if not found or p_claim_token is null or run.claim_token is distinct from p_claim_token then return jsonb_build_object('status','paused'); end if;
  select * into request from public.prospecting_requests where owner_id=p_owner and run_id=p_run and operation=p_operation for update;
  if not found then raise exception 'PROSPECTING_REQUEST_NOT_RESERVED'; end if;
  if request.status<>'reserved' then return jsonb_build_object('status',request.status); end if;
  -- Recording an already-paid response is allowed after pause, but never creates a lead.
  update public.prospecting_requests set status=case when p_error_code is null then 'completed' else 'failed' end,result=p_result,error_code=p_error_code,finished_at=now() where id=request.id;
  return jsonb_build_object('status',case when p_error_code is null then 'completed' else 'failed' end);
end $$;

create function public.record_prospecting_candidate(p_owner uuid,p_run uuid,p_claim_token text,p_domain text,p_status text,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare domain_name text:=lower(trim(p_domain)); reason text; existing public.prospecting_candidates;
begin
  if domain_name is null or domain_name!~'^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$' or length(domain_name)>253
    or p_status is null or p_status not in ('processing','skipped','saved','needs_review')
    or (p_reason is not null and (length(p_reason)>300 or p_reason~*'(api_key|apikey|access_token|authorization)=')) then raise exception 'PROSPECTING_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  reason:=public.prospecting_run_gate(p_owner,p_run,p_claim_token);
  if reason is not null then return jsonb_build_object('status','paused','reason',reason); end if;
  select * into existing from public.prospecting_candidates where owner_id=p_owner and domain=domain_name for update;
  if found then
    if existing.run_id=p_run then
      -- A replayed processing step must not undo a decision already recorded for this run.
      if existing.status='processing' or p_status<>'processing' then
        update public.prospecting_candidates set status=p_status,reason=p_reason,last_seen_at=now()
          where owner_id=p_owner and domain=domain_name returning * into existing;
      end if;
    elsif existing.status='processing' and p_status='processing' and exists(
      select 1 from public.prospecting_runs previous where previous.id=existing.run_id and previous.owner_id=p_owner
        and previous.status in ('completed','failed','cancelled')
        and previous.error_code is distinct from 'REQUEST_UNCERTAIN'
        and not exists(select 1 from public.prospecting_requests request where request.owner_id=p_owner and request.run_id=previous.id and request.status='reserved')
    ) then
      -- A quota, pause or plan failure leaves unfinished companies eligible for a later run.
      -- Uncertain provider calls require manual investigation; a later run must not repeat them.
      update public.prospecting_candidates set run_id=p_run,status='processing',reason=null,last_seen_at=now()
        where owner_id=p_owner and domain=domain_name;
      update public.prospecting_runs set companies_found=companies_found+1 where id=p_run and owner_id=p_owner;
      return jsonb_build_object('status','reclaimed','candidate_status','processing','run_id',p_run);
    end if;
    return jsonb_build_object('status','existing','candidate_status',existing.status,'run_id',existing.run_id);
  end if;
  insert into public.prospecting_candidates(owner_id,domain,run_id,status,reason) values(p_owner,domain_name,p_run,p_status,p_reason);
  update public.prospecting_runs set companies_found=companies_found+1 where id=p_run and owner_id=p_owner;
  return jsonb_build_object('status','created','candidate_status',p_status,'run_id',p_run);
end $$;

create function public.persist_discovered_lead(p_owner uuid,p_run uuid,p_payload jsonb,p_claim_token text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text; run public.prospecting_runs; config public.prospecting_settings; company jsonb; contact jsonb; verification jsonb; fit jsonb;
  email_address text; domain_name text; country_code text; country_name text; contact_name text; company_id uuid; lead_id uuid; fit_value integer; verified_at timestamptz;
  day_start timestamptz:=date_trunc('day',timezone('UTC',now())) at time zone 'UTC';
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>65536 then raise exception 'PROSPECTING_INVALID'; end if;
  company:=p_payload->'company'; contact:=p_payload->'contact'; verification:=p_payload->'verification'; fit:=p_payload->'score';
  if jsonb_typeof(company) is distinct from 'object' or jsonb_typeof(contact) is distinct from 'object' or jsonb_typeof(verification) is distinct from 'object' or jsonb_typeof(fit) is distinct from 'object' then raise exception 'PROSPECTING_INVALID'; end if;
  domain_name:=lower(trim(company->>'domain')); email_address:=lower(trim(contact->>'email')); country_code:=upper(trim(company->>'countryCode'));
  if domain_name is null or length(domain_name)>253 or domain_name!~'^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    or coalesce(length(trim(company->>'name')),0) not between 1 and 200
    or coalesce(length(email_address),0) not between 3 and 254 or email_address!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or jsonb_typeof(fit->'score') is distinct from 'number' or (fit->>'score')::numeric<>trunc((fit->>'score')::numeric)
    or (fit->>'score')::numeric not between 0 and 100 or coalesce(length(trim(fit->>'reason')),0) not between 1 and 2000
    or coalesce(length(fit->>'segment'),0)>100 or coalesce(length(contact->>'role'),0)>150
    or coalesce(length(contact->>'firstName'),0)>100 or coalesce(length(contact->>'lastName'),0)>100
    or (p_payload->'aiDraft' is not null and p_payload->'aiDraft'<>'null'::jsonb and (jsonb_typeof(p_payload->'aiDraft') is distinct from 'object' or coalesce(length(p_payload->'aiDraft'->>'summary'),0)>8000 or p_payload->'aiDraft'->>'status' is distinct from 'pending_approval' or coalesce(length(p_payload->'aiDraft'->>'prompt'),0)>4000)) then raise exception 'PROSPECTING_INVALID'; end if;
  -- Provider provenance is required even for an address that verifies successfully.
  -- A guessed mailbox, an unrelated domain, or a contact without a published source cannot be saved.
  if contact->>'provenance' is distinct from 'found'
    or not(split_part(email_address,'@',2)=domain_name or right(split_part(email_address,'@',2),length(domain_name)+1)='.'||domain_name)
    or jsonb_typeof(contact->'sources') is distinct from 'array' then return jsonb_build_object('status','provenance_required'); end if;
  if jsonb_array_length(contact->'sources') not between 1 and 20 or exists(
    select 1 from jsonb_array_elements(contact->'sources') source
    where jsonb_typeof(source) is distinct from 'object'
      or jsonb_typeof(source->'uri') is distinct from 'string'
      or length(source->>'uri') not between 10 and 2000
      or (source->>'uri') !~* '^https?://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:80|:443)?([/?#]|$)'
  ) then return jsonb_build_object('status','provenance_required'); end if;
  if verification->>'status' is distinct from 'valid' or coalesce((verification->>'disposable')::boolean,true) or coalesce((verification->>'webmail')::boolean,true) or coalesce((verification->>'acceptAll')::boolean,true) then return jsonb_build_object('status','verification_required'); end if;
  begin verified_at:=(verification->>'checkedAt')::timestamptz; exception when others then raise exception 'PROSPECTING_INVALID'; end;
  -- Hunter may return a cached verification date from the past month. Preserve that date.
  if verified_at is null or verified_at>now()+interval '5 minutes' or verified_at<now()-interval '31 days' then return jsonb_build_object('status','verification_required'); end if;
  fit_value:=(fit->>'score')::integer;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  reason:=public.prospecting_run_gate(p_owner,p_run,p_claim_token);
  if reason is not null then return jsonb_build_object('status','paused','reason',reason); end if;
  select * into run from public.prospecting_runs where id=p_run and owner_id=p_owner;
  select * into config from public.prospecting_settings where owner_id=p_owner;
  if exists(select 1 from public.suppression_list where owner_id=p_owner and email=email_address) then return jsonb_build_object('status','suppressed'); end if;
  if exists(select 1 from public.leads where owner_id=p_owner and email=email_address) then
    select id into lead_id from public.leads where owner_id=p_owner and email=email_address;
    return jsonb_build_object('status','duplicate','lead_id',lead_id);
  end if;
  select (output->>'lead_id')::uuid into lead_id from public.agent_logs
    where owner_id=p_owner and agent='QualifierAgent' and status='completed' and output ? 'lead_id' and input->>'domain'=domain_name limit 1;
  if lead_id is not null then return jsonb_build_object('status','duplicate','lead_id',lead_id); end if;
  if country_code is null or country_code='IN' or not(config.data->'countries' ? country_code) then return jsonb_build_object('status','country_excluded'); end if;
  country_name:=case country_code when 'US' then 'United States' when 'GB' then 'United Kingdom' when 'CA' then 'Canada' when 'AU' then 'Australia' when 'AE' then 'United Arab Emirates' when 'DE' then 'Germany' when 'FR' then 'France' when 'NL' then 'Netherlands' when 'IE' then 'Ireland' when 'NZ' then 'New Zealand' when 'SG' then 'Singapore' when 'SE' then 'Sweden' when 'CH' then 'Switzerland' end;
  if country_name is null then return jsonb_build_object('status','country_excluded'); end if;
  if fit_value<(config.data->>'minScore')::integer then return jsonb_build_object('status','low_score'); end if;
  if (select count(*) from public.agent_logs where owner_id=p_owner and agent='QualifierAgent' and status='completed' and output ? 'lead_id' and created_at>=day_start)>=(config.data->>'dailyLeadLimit')::integer then return jsonb_build_object('status','daily_limit'); end if;
  select id into company_id from public.companies where owner_id=p_owner and lower(website)='https://'||domain_name limit 1;
  if company_id is null then insert into public.companies(owner_id,name,website,country) values(p_owner,trim(company->>'name'),'https://'||domain_name,country_name) returning id into company_id; end if;
  contact_name:=trim(coalesce(contact->>'firstName','')||' '||coalesce(contact->>'lastName',''));
  insert into public.leads(owner_id,company_id,company,website,contact_name,email,country,role,source,lawful_basis,stage,score,score_reason,segment,value,
    email_verification_status,email_verified_at,contact_review_status,discovery_run_id,discovered_at)
  values(p_owner,company_id,trim(company->>'name'),'https://'||domain_name,contact_name,email_address,country_name,nullif(contact->>'role',''),
    'Hunter official APIs: company discovery, enrichment, contact search and email verification',trim(config.data->>'lawfulBasis'),'New',fit_value,trim(fit->>'reason'),coalesce(fit->>'segment',''),0,
    'valid',verified_at,'needs_review',p_run,now()) returning id into lead_id;
  insert into public.enrichment_data(owner_id,lead_id,summary,data) values(p_owner,lead_id,coalesce(company->>'description',''),
    jsonb_build_object('provider','hunter','company',company,'contact',contact,'verification',verification,'score',fit,
      'emailVerification',verification,'sources',coalesce(contact->'sources','[]'::jsonb),
      'aiDraft',case when coalesce((config.data->>'aiEnabled')::boolean,false) then p_payload->'aiDraft' end,
      'ai_draft_requires_review',true,'consent_inferred',false,'run_id',p_run));
  update public.prospecting_runs set leads_saved=leads_saved+1 where id=p_run and owner_id=p_owner;
  update public.prospecting_candidates set status='saved',reason=null,last_seen_at=now() where owner_id=p_owner and domain=domain_name and run_id=p_run;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(p_owner,'QualifierAgent',jsonb_build_object('run_id',p_run,'domain',domain_name,'verification_status','valid'),jsonb_build_object('lead_id',lead_id,'score',fit_value,'review_status','needs_review'),'completed');
  if coalesce((config.data->>'aiEnabled')::boolean,false) and jsonb_typeof(p_payload->'aiDraft')='object' then
    insert into public.agent_logs(owner_id,agent,input,output,status) values(p_owner,'QualifierAgent',
      jsonb_build_object('run_id',p_run,'company',company,'prompt',coalesce(p_payload->'aiDraft'->>'prompt',config.data->>'aiPrompt')),
      jsonb_build_object('lead_id',lead_id,'summary',p_payload->'aiDraft'->>'summary','consent_inferred',false),'pending_approval');
  end if;
  return jsonb_build_object('status','saved','lead_id',lead_id);
end $$;

create function public.finish_prospecting_run(p_owner uuid,p_run uuid,p_claim_token text,p_status text,p_counts jsonb,p_message text,p_error_code text,p_next_search_index integer,p_cursors jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare run public.prospecting_runs; config public.prospecting_settings; reason text; cursor_value jsonb; actual_leads integer; actual_requests integer; actual_companies integer; skipped integer;
begin
  if p_status is null or p_status not in ('completed','failed','cancelled') or p_next_search_index is null or p_next_search_index<0
    or p_next_search_index>64 or jsonb_typeof(p_cursors) is distinct from 'object' or pg_column_size(p_cursors)>65536
    or (p_message is not null and (length(p_message)>500 or p_message~*'(api_key|apikey|access_token|authorization)='))
    or (p_error_code is not null and p_error_code!~'^[A-Z0-9_:-]{1,80}$') then raise exception 'PROSPECTING_INVALID'; end if;
  for cursor_value in select value from jsonb_each(p_cursors) loop
    if jsonb_typeof(cursor_value)<>'number' or (cursor_value#>>'{}')::numeric<>trunc((cursor_value#>>'{}')::numeric) or (cursor_value#>>'{}')::numeric not between 0 and 10000 then raise exception 'PROSPECTING_INVALID'; end if;
  end loop;
  skipped:=coalesce((p_counts->>'skipped_count')::integer,(p_counts->>'skipped')::integer,0);
  if skipped<0 or skipped>1000 then raise exception 'PROSPECTING_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  select * into run from public.prospecting_runs where id=p_run and owner_id=p_owner for update;
  if not found or p_claim_token is null or run.claim_token is distinct from p_claim_token then return false; end if;
  if run.status in ('completed','failed','cancelled') then return run.status=p_status; end if;
  select * into config from public.prospecting_settings where owner_id=p_owner;
  reason:=public.prospecting_run_gate(p_owner,p_run,p_claim_token);
  if reason is not null and p_status<>'cancelled' then return false; end if;
  select count(*) into actual_leads from public.agent_logs where owner_id=p_owner and agent='QualifierAgent' and status='completed' and output ? 'lead_id' and input->>'run_id'=p_run::text;
  select count(*) into actual_requests from public.prospecting_requests where owner_id=p_owner and run_id=p_run;
  select count(*) into actual_companies from public.prospecting_candidates where owner_id=p_owner and run_id=p_run;
  update public.prospecting_runs set status=p_status,finished_at=now(),lease_until=null,
    companies_found=actual_companies,leads_saved=actual_leads,request_count=actual_requests,skipped_count=skipped,
    error_code=p_error_code,message=p_message where id=p_run and owner_id=p_owner;
  if config.version=run.config_version and coalesce((config.data->>'enabled')::boolean,false) then
    update public.prospecting_settings set next_run_at=now()+make_interval(hours=>(config.data->>'intervalHours')::integer),
      search_index=case when p_status='completed' then p_next_search_index else search_index end,
      cursors=case when p_status='completed' then p_cursors else cursors end where owner_id=p_owner;
  end if;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(p_owner,'ProspectorAgent',jsonb_build_object('run_id',p_run,'action','finish'),jsonb_build_object('companies_found',actual_companies,'leads_saved',actual_leads,'requests',actual_requests,'skipped',skipped,'error_code',p_error_code),p_status);
  return true;
end $$;

-- Browser callers get only owner-bound configuration, queue, usage and suppression functions.
revoke all on function public.save_prospecting_settings(jsonb), public.queue_prospecting_run(), public.prospecting_usage(), public.suppress_workspace_email(jsonb) from public,anon;
grant execute on function public.save_prospecting_settings(jsonb), public.queue_prospecting_run(), public.prospecting_usage(), public.suppress_workspace_email(jsonb) to authenticated;
-- Service credentials are never sent to browsers; all provider/network operations run server-side.
revoke all on function public.queue_due_prospecting_run(uuid),public.prospecting_run_gate(uuid,uuid,text),
 public.claim_prospecting_run(uuid,uuid,text),public.check_prospecting_run(uuid,uuid,text),
 public.reserve_prospecting_request(uuid,uuid,text,text,text),public.complete_prospecting_request(uuid,uuid,text,text,jsonb,text),
 public.record_prospecting_candidate(uuid,uuid,text,text,text,text),public.persist_discovered_lead(uuid,uuid,jsonb,text),
 public.finish_prospecting_run(uuid,uuid,text,text,jsonb,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.queue_due_prospecting_run(uuid),public.prospecting_run_gate(uuid,uuid,text),
 public.claim_prospecting_run(uuid,uuid,text),public.check_prospecting_run(uuid,uuid,text),
 public.reserve_prospecting_request(uuid,uuid,text,text,text),public.complete_prospecting_request(uuid,uuid,text,text,jsonb,text),
 public.record_prospecting_candidate(uuid,uuid,text,text,text,text),public.persist_discovered_lead(uuid,uuid,jsonb,text),
 public.finish_prospecting_run(uuid,uuid,text,text,jsonb,text,text,integer,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
