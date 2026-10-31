-- Project requirements, not company-fit guesses. Run once after migrations 001–005.
-- Existing contacts are preserved. Old discovery is paused until this source is configured.
begin;

create table public.project_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  title text not null check(length(title) between 1 and 300),
  request_text text not null check(length(request_text) between 30 and 3000),
  service text not null check(service in ('website','application','website_and_application')),
  source_url text not null check(length(source_url) between 10 and 2000),
  source_url_hash text not null check(source_url_hash=md5(source_url)),
  platform text not null,
  published_at timestamptz not null,
  deadline_at timestamptz,
  country_code text not null check(country_code in ('US','GB','CA','AU','AE','DE','FR','NL','IE','NZ','SG','SE','CH')),
  buyer_name text,
  discovery_query text not null check(length(discovery_query) between 1 and 2000),
  evidence jsonb not null,
  discovered_at timestamptz not null default now(),
  unique(owner_id,source_url_hash),
  foreign key(run_id,owner_id) references public.prospecting_runs(id,owner_id)
);
create index project_requests_owner_recent on public.project_requests(owner_id,discovered_at desc);
create index project_requests_owner_service on public.project_requests(owner_id,service);
create table public.project_request_candidates (
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  source_url_hash text not null,
  source_url text not null,
  status text not null check(status in ('processing','rejected','saved')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,run_id,source_url_hash),
  check(source_url_hash=md5(source_url)),
  foreign key(run_id,owner_id) references public.prospecting_runs(id,owner_id)
);
create index project_requests_saved_audit on public.agent_logs(owner_id,created_at)
  where agent='ProjectRequestAgent' and status='completed' and output ? 'project_request_id';
do $$ declare tab text; begin
  foreach tab in array array['project_requests','project_request_candidates'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('create policy own_read on public.%I for select to authenticated using(owner_id=(select auth.uid()))',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
end $$;

-- URL checks do not make network requests. Only normalized public source links are accepted.
create function public.project_source_host(p_url text) returns text
language plpgsql immutable set search_path=public,pg_temp as $$
declare host text;
begin
  if p_url is null or length(p_url) not between 10 and 2000
    or p_url~'[[:space:][:cntrl:]]' or p_url~'#'
    or p_url !~ '^https?://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:80|:443)?([/?]|$)'
    or p_url~*'[?&](api_?key|access_?token|token|secret|password|signature|authorization|auth|utm_[a-z_]+|fbclid|gclid)='
    then return null; end if;
  host:=substring(p_url from '^https?://([^/?#]+)');
  host:=regexp_replace(host,':(80|443)$','');
  if host~'(^|\.)(localhost|local|internal|intranet|invalid|test|example|home|lan|onion)$' then return null; end if;
  return regexp_replace(host,'^www\.','');
end $$;

-- Accept only unambiguous source date tokens. Search-engine estimates cannot substitute for these.
create function public.project_date_value(p_text text) returns date
language plpgsql immutable set search_path=public,pg_temp as $$
declare parsed date;
begin
  if p_text is null or length(p_text)>50 or not(
    p_text~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_text~'^[0-9]{1,2}[[:space:]]+[A-Za-z]{3,9}[[:space:]]+[0-9]{4}$'
    or p_text~'^[A-Za-z]{3,9}[[:space:]]+[0-9]{1,2}(,[[:space:]]*|[[:space:]]+)[0-9]{4}$'
  ) then return null; end if;
  begin parsed:=trim(p_text)::date; exception when others then return null; end;
  return parsed;
end $$;
-- Date labels must carry a whole unambiguous date. Times and estimate-only dates are rejected.
create function public.project_source_dates(p_source text,p_kind text) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare line text; normalized text; label text; prefix text; date_text text; parsed date; earliest date; seen boolean:=false; invalid boolean:=false;
begin
  label:=case p_kind when 'published' then '(published([ \t]+(on|date))?|posted([ \t]+(on|date))?|publication[ \t]+date|date[ \t]+(published|posted|issued)|issued([ \t]+on)?|notice[ \t]+date|issue[ \t]+date|date[ \t]+of[ \t]+publication)'
    when 'deadline' then '(deadline([ \t]+date)?|closing[ \t]+date|closes([ \t]+on)?|bid[ \t]+closing([ \t]+date)?|proposal[ \t]+deadline|response[ \t]+deadline|submission[ \t]+deadline|applications?[ \t]+close|due[ \t]+date)'
    else null end;
  if label is null then return jsonb_build_object('has_label',false,'invalid',true,'date',null); end if;
  prefix:='^[ \t]*([-*][ \t]+)?'||label||'[ \t]*(:|[-–])[ \t]*';
  for line in select regexp_split_to_table(p_source,E'[\\r\\n]+') loop
    normalized:=regexp_replace(line,'[*]','','g');
    if normalized~*prefix then
      seen:=true; date_text:=trim(regexp_replace(normalized,prefix,'','i'));
      parsed:=public.project_date_value(date_text);
      if parsed is null then invalid:=true;
      elsif earliest is null or parsed<earliest then earliest:=parsed; end if;
    end if;
  end loop;
  return jsonb_build_object('has_label',seen,'invalid',invalid,'date',earliest);
end $$;
create function public.project_country_value(p_text text) returns text
language plpgsql immutable set search_path=public,pg_temp as $$
declare code text; normalized text;
begin
  normalized:=regexp_replace(regexp_replace(p_text,'[*]','','g'),'^[[:space:]]*-[[:space:]]+','');
  if p_text is null or length(p_text)>300 or normalized!~*'^(((buyer|client|project|organi[sz]ation|contracting[[:space:]]+authority|authority)[[:space:]]+)?(country|location|address)|headquarters|place of performance)[[:space:]*_:–-]+' then return null; end if;
  code:=upper(substring(normalized from '(?i)country[[:space:]*_:–-]+(US|GB|CA|AU|AE|DE|FR|NL|IE|NZ|SG|SE|CH)[[:space:]]*$'));
  if code is not null then return code; end if;
  return case
    when normalized~*'(^|[^[:alpha:]])(United States( of America)?|USA|U[.]S[.]A[.]?)([^[:alpha:]]|$)' then 'US'
    when normalized~*'(^|[^[:alpha:]])(United Kingdom|UK|Great Britain|Northern[[:space:]]+Ireland)([^[:alpha:]]|$)' then 'GB'
    when normalized~*'(^|[^[:alpha:]])Canada([^[:alpha:]]|$)' then 'CA'
    when normalized~*'(^|[^[:alpha:]])Australia([^[:alpha:]]|$)' then 'AU'
    when normalized~*'(^|[^[:alpha:]])(United Arab Emirates|UAE)([^[:alpha:]]|$)' then 'AE'
    when normalized~*'(^|[^[:alpha:]])(Germany|Deutschland)([^[:alpha:]]|$)' then 'DE'
    when normalized~*'(^|[^[:alpha:]])France([^[:alpha:]]|$)' then 'FR'
    when normalized~*'(^|[^[:alpha:]])Netherlands([^[:alpha:]]|$)' then 'NL'
    when normalized~*'(^|[^[:alpha:]])Ireland([^[:alpha:]]|$)' and normalized!~*'Northern Ireland' then 'IE'
    when normalized~*'(^|[^[:alpha:]])New Zealand([^[:alpha:]]|$)' then 'NZ'
    when normalized~*'(^|[^[:alpha:]])Singapore([^[:alpha:]]|$)' then 'SG'
    when normalized~*'(^|[^[:alpha:]])Sweden([^[:alpha:]]|$)' then 'SE'
    when normalized~*'(^|[^[:alpha:]])Switzerland([^[:alpha:]]|$)' then 'CH'
    else null end;
end $$;

-- Raw page text is only a running-job checkpoint; retain short evidence after completion/cancellation.
create function public.trim_project_search_result(p_result jsonb) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if p_result is null or jsonb_typeof(p_result)<>'object' then return p_result; end if;
  if jsonb_typeof(p_result->'page')='object' then return jsonb_set(p_result,'{page}',public.trim_project_search_result(p_result->'page')); end if;
  if jsonb_typeof(p_result->'results') is distinct from 'array' then return p_result; end if;
  return jsonb_set(p_result,'{results}',coalesce((select jsonb_agg(value-'rawContent'-'raw_content'-'content') from jsonb_array_elements(p_result->'results')),'[]'::jsonb));
end $$;

-- Retire active company-only work without deleting previously saved contacts or audit history.
update public.prospecting_runs set status='cancelled',finished_at=now(),lease_until=null,
  error_code='PROJECT_REQUIREMENTS_REQUIRED',message='Discovery now requires a dated public website/application project request.'
  where status in ('queued','running');
update public.prospecting_requests set result=public.trim_project_search_result(result) where provider='tavily';
update public.prospecting_settings set data=data||jsonb_build_object(
    'enabled',false,'discoveryMode','project_requests','services',jsonb_build_array('website','application'),
    'maxAgeDays',30,'keywords',jsonb_build_array('website development','application development')),
  version=version+1,next_run_at=null,search_index=0,cursors='{}'::jsonb,updated_at=now();

alter table public.prospecting_requests drop constraint prospecting_requests_provider_check;
alter table public.prospecting_requests add constraint prospecting_requests_provider_check check(provider in ('hunter','anthropic','tavily'));

create or replace function public.save_prospecting_settings(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); item jsonb; field text; n numeric; old public.prospecting_settings; saved public.prospecting_settings; changed boolean;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if payload is null or jsonb_typeof(payload)<>'object'
     or payload-array['enabled','countries','keywords','intervalHours','companiesPerRun','dailyLeadLimit','dailyRequestLimit','minScore','paginationEnabled','lawfulBasis','aiEnabled','aiPrompt','discoveryMode','services','maxAgeDays']<>'{}'::jsonb
     or not(payload ?& array['enabled','countries','keywords','intervalHours','companiesPerRun','dailyLeadLimit','dailyRequestLimit','minScore','paginationEnabled','lawfulBasis','aiEnabled','aiPrompt','discoveryMode','services','maxAgeDays']) then
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
  foreach field in array array['intervalHours','companiesPerRun','dailyLeadLimit','dailyRequestLimit','minScore','maxAgeDays'] loop
    if jsonb_typeof(payload->field) is distinct from 'number' then raise exception 'PROSPECTING_INVALID'; end if;
    n:=(payload->>field)::numeric;
    if n<>trunc(n) or (field='intervalHours' and n not between 6 and 168)
      or (field='companiesPerRun' and n not between 1 and 20)
      or (field='dailyLeadLimit' and n not between 1 and 100)
      or (field='dailyRequestLimit' and n not between 5 and 500)
      or (field='minScore' and n not between 0 and 100)
      or (field='maxAgeDays' and n not between 1 and 90) then raise exception 'PROSPECTING_INVALID'; end if;
  end loop;
  if payload->>'discoveryMode' is distinct from 'project_requests' or jsonb_typeof(payload->'services') is distinct from 'array' then raise exception 'PROSPECTING_INVALID'; end if;
  if jsonb_array_length(payload->'services') not between 1 and 2 then raise exception 'PROSPECTING_INVALID'; end if;
  for item in select value from jsonb_array_elements(payload->'services') loop
    if jsonb_typeof(item)<>'string' or item#>>'{}' not in ('website','application') then raise exception 'PROSPECTING_INVALID'; end if;
  end loop;
  if (select count(distinct value) from jsonb_array_elements(payload->'services'))<>jsonb_array_length(payload->'services') then raise exception 'PROSPECTING_INVALID'; end if;
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
  update public.prospecting_requests request set result=public.trim_project_search_result(request.result)
    where request.owner_id=actor and request.provider='tavily' and exists(select 1 from public.prospecting_runs run where run.id=request.run_id and run.owner_id=actor and run.status='cancelled');
  insert into public.agent_logs(owner_id,agent,input,output,status) values(actor,'ProspectorSettings','{"action":"save"}',jsonb_build_object('enabled',payload->'enabled','version',saved.version),'completed');
  return jsonb_build_object('data',saved.data,'version',saved.version,'next_run_at',saved.next_run_at);
end $$;

create or replace function public.queue_prospecting_run() returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); config public.prospecting_settings; active uuid; created uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into config from public.prospecting_settings where owner_id=actor for update;
  if not found or config.data->>'discoveryMode' is distinct from 'project_requests' or not coalesce((config.data->>'enabled')::boolean,false) then raise exception 'PROSPECTING_PAUSED'; end if;
  select id into active from public.prospecting_runs where owner_id=actor and status in ('queued','running');
  if active is not null then return active; end if;
  if (select count(*) from public.prospecting_runs where owner_id=actor and created_at>now()-interval '1 minute')>=5 then raise exception 'PROSPECTING_RATE_LIMIT'; end if;
  insert into public.prospecting_runs(owner_id,trigger_source,config_snapshot,config_version,search_index,cursors)
    values(actor,'manual',config.data,config.version,config.search_index,config.cursors) returning id into created;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(actor,'ProspectorAgent','{"action":"queue","source":"manual"}',jsonb_build_object('run_id',created),'queued');
  return created;
end $$;

create or replace function public.queue_due_prospecting_run(p_owner uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare config public.prospecting_settings; active uuid; created uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  select * into config from public.prospecting_settings where owner_id=p_owner for update;
  if not found or config.data->>'discoveryMode' is distinct from 'project_requests' or not coalesce((config.data->>'enabled')::boolean,false) then return null; end if;
  select id into active from public.prospecting_runs where owner_id=p_owner and status in ('queued','running');
  if active is not null then return active; end if;
  if config.next_run_at is null or config.next_run_at>now() then return null; end if;
  insert into public.prospecting_runs(owner_id,trigger_source,config_snapshot,config_version,search_index,cursors)
    values(p_owner,'scheduled',config.data,config.version,config.search_index,config.cursors) returning id into created;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(p_owner,'ProspectorAgent','{"action":"queue","source":"scheduled"}',jsonb_build_object('run_id',created),'queued');
  return created;
end $$;

create or replace function public.prospecting_run_gate(p_owner uuid,p_run uuid,p_claim_token text) returns text
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare run public.prospecting_runs; config public.prospecting_settings;
begin
  select * into run from public.prospecting_runs where id=p_run and owner_id=p_owner;
  if not found then return 'NOT_FOUND'; end if;
  select * into config from public.prospecting_settings where owner_id=p_owner;
  if not found or not coalesce((config.data->>'enabled')::boolean,false) then return 'PAUSED'; end if;
  if config.data->>'discoveryMode' is distinct from 'project_requests' or run.config_snapshot->>'discoveryMode' is distinct from 'project_requests' then return 'PROJECT_SOURCE_REQUIRED'; end if;
  if run.config_version<>config.version then return 'CONFIG_CHANGED'; end if;
  if run.status<>'running' or p_claim_token is null or run.claim_token is distinct from p_claim_token or run.lease_until is null or run.lease_until<now() then return 'LEASE_LOST'; end if;
  return null;
end $$;

create or replace function public.claim_prospecting_run(p_owner uuid,p_run uuid,p_claim_token text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare run public.prospecting_runs; config public.prospecting_settings;
begin
  if p_claim_token is null or length(p_claim_token) not between 16 and 128 then raise exception 'PROSPECTING_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  select * into config from public.prospecting_settings where owner_id=p_owner for update;
  if not found or config.data->>'discoveryMode' is distinct from 'project_requests' or not coalesce((config.data->>'enabled')::boolean,false) then return null; end if;
  select * into run from public.prospecting_runs where id=p_run and owner_id=p_owner for update;
  if not found or run.status not in ('queued','running') or run.config_snapshot->>'discoveryMode' is distinct from 'project_requests' or run.config_version<>config.version then return null; end if;
  if run.status='running' and run.claim_token is distinct from p_claim_token and run.lease_until>now() then return null; end if;
  update public.prospecting_runs set status='running',claim_token=p_claim_token,lease_until=now()+interval '15 minutes',started_at=coalesce(started_at,now()) where id=p_run returning * into run;
  return jsonb_build_object('run',to_jsonb(run),'config',run.config_snapshot,'config_version',run.config_version,'search_index',run.search_index,'cursors',run.cursors,'claim_token',p_claim_token);
end $$;

create or replace function public.reserve_prospecting_request(p_owner uuid,p_run uuid,p_operation text,p_provider text,p_claim_token text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text; existing public.prospecting_requests; config public.prospecting_settings; day_start timestamptz:=date_trunc('day',timezone('UTC',now())) at time zone 'UTC';
begin
  if p_operation is null or length(p_operation) not between 1 and 200 or p_provider not in ('hunter','anthropic','tavily') or p_provider is null then raise exception 'PROSPECTING_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  reason:=public.prospecting_run_gate(p_owner,p_run,p_claim_token);
  if reason is not null then return jsonb_build_object('state','paused','status','paused','reason',reason); end if;
  if p_provider<>'tavily' then return jsonb_build_object('state','paused','status','paused','reason','PROJECT_SOURCE_REQUIRED'); end if;
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

create or replace function public.complete_prospecting_request(p_owner uuid,p_run uuid,p_operation text,p_claim_token text,p_result jsonb,p_error_code text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare run public.prospecting_runs; request public.prospecting_requests;
begin
  if p_error_code is not null and p_error_code!~'^[A-Z0-9_:-]{1,80}$' then raise exception 'PROSPECTING_INVALID'; end if;
  if p_result is not null and (pg_column_size(p_result)>1500000 or p_result::text~*'"(api_?key|authorization|access_?token|secret|password)"[[:space:]]*:' or p_result::text~*'(api_key|apikey|access_token|authorization)=') then raise exception 'PROSPECTING_UNSAFE_RESULT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  select * into run from public.prospecting_runs where id=p_run and owner_id=p_owner;
  if not found or p_claim_token is null or run.claim_token is distinct from p_claim_token then return jsonb_build_object('status','paused'); end if;
  select * into request from public.prospecting_requests where owner_id=p_owner and run_id=p_run and operation=p_operation for update;
  if not found then raise exception 'PROSPECTING_REQUEST_NOT_RESERVED'; end if;
  if request.provider<>'tavily' and p_result is not null and pg_column_size(p_result)>65536 then raise exception 'PROSPECTING_UNSAFE_RESULT'; end if;
  if request.provider='tavily' and run.status not in ('queued','running') then p_result:=public.trim_project_search_result(p_result); end if;
  if request.status<>'reserved' then return jsonb_build_object('status',request.status); end if;
  -- Recording an already-paid response is allowed after pause, but never creates a lead.
  update public.prospecting_requests set status=case when p_error_code is null then 'completed' else 'failed' end,result=p_result,error_code=p_error_code,finished_at=now() where id=request.id;
  return jsonb_build_object('status',case when p_error_code is null then 'completed' else 'failed' end);
end $$;

create or replace function public.prospecting_usage() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); day_start timestamptz:=date_trunc('day',timezone('UTC',now())) at time zone 'UTC';
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  return jsonb_build_object('day_start',day_start,
    'requests',(select count(*) from public.prospecting_requests where owner_id=actor and created_at>=day_start),
    'leads_saved',(select count(*) from public.agent_logs where owner_id=actor and status='completed' and ((agent='QualifierAgent' and output ? 'lead_id') or (agent='ProjectRequestAgent' and output ? 'project_request_id')) and created_at>=day_start),
    'project_requests_saved',(select count(*) from public.agent_logs where owner_id=actor and agent='ProjectRequestAgent' and status='completed' and output ? 'project_request_id' and created_at>=day_start));
end $$;

create or replace function public.finish_prospecting_run(p_owner uuid,p_run uuid,p_claim_token text,p_status text,p_counts jsonb,p_message text,p_error_code text,p_next_search_index integer,p_cursors jsonb) returns boolean
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
  select count(*) into actual_leads from public.agent_logs where owner_id=p_owner and status='completed' and ((agent='QualifierAgent' and output ? 'lead_id') or (agent='ProjectRequestAgent' and output ? 'project_request_id')) and input->>'run_id'=p_run::text;
  select count(*) into actual_requests from public.prospecting_requests where owner_id=p_owner and run_id=p_run;
  select (select count(*) from public.prospecting_candidates where owner_id=p_owner and run_id=p_run)+(select count(*) from public.project_request_candidates where owner_id=p_owner and run_id=p_run) into actual_companies;
  update public.prospecting_runs set status=p_status,finished_at=now(),lease_until=null,
    companies_found=actual_companies,leads_saved=actual_leads,request_count=actual_requests,skipped_count=skipped,
    error_code=p_error_code,message=p_message where id=p_run and owner_id=p_owner;
  if config.version=run.config_version and coalesce((config.data->>'enabled')::boolean,false) then
    update public.prospecting_settings set next_run_at=now()+make_interval(hours=>(config.data->>'intervalHours')::integer),
      search_index=case when p_status='completed' then p_next_search_index else search_index end,
      cursors=case when p_status='completed' then p_cursors else cursors end where owner_id=p_owner;
  end if;
  update public.prospecting_requests set result=public.trim_project_search_result(result) where owner_id=p_owner and run_id=p_run and provider='tavily';
  insert into public.agent_logs(owner_id,agent,input,output,status) values(p_owner,'ProspectorAgent',jsonb_build_object('run_id',p_run,'action','finish'),jsonb_build_object('companies_found',actual_companies,'leads_saved',actual_leads,'requests',actual_requests,'skipped',skipped,'error_code',p_error_code),p_status);
  return true;
end $$;

create function public.project_discovery_readiness() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  return jsonb_build_object('schema_version',6);
end $$;

create function public.check_project_request_capacity(p_owner uuid,p_run uuid,p_claim_token text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text; config public.prospecting_settings; day_start timestamptz:=date_trunc('day',timezone('UTC',now())) at time zone 'UTC';
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  reason:=public.prospecting_run_gate(p_owner,p_run,p_claim_token);
  if reason is not null then return jsonb_build_object('allowed',false,'reason',reason); end if;
  select * into config from public.prospecting_settings where owner_id=p_owner;
  if (select count(*) from public.agent_logs where owner_id=p_owner and agent='ProjectRequestAgent' and status='completed' and output ? 'project_request_id' and created_at>=day_start)>=(config.data->>'dailyLeadLimit')::integer then
    return jsonb_build_object('allowed',false,'reason','daily_lead_limit');
  end if;
  if (select count(*) from public.prospecting_requests where owner_id=p_owner and created_at>=day_start)>=(config.data->>'dailyRequestLimit')::integer then
    return jsonb_build_object('allowed',false,'reason','daily_request_limit');
  end if;
  update public.prospecting_runs set lease_until=now()+interval '15 minutes' where id=p_run and owner_id=p_owner;
  return jsonb_build_object('allowed',true,'reason',null);
end $$;

create function public.record_project_request_candidate(p_owner uuid,p_run uuid,p_claim_token text,p_source_url text,p_status text,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text; existing public.project_request_candidates;
begin
  if public.project_source_host(p_source_url) is null or p_status is null or p_status not in ('processing','rejected','saved')
    or (p_reason is not null and (length(p_reason)>300 or p_reason~*'(api_key|apikey|access_token|authorization)=')) then raise exception 'PROJECT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  reason:=public.prospecting_run_gate(p_owner,p_run,p_claim_token);
  if reason is not null then return jsonb_build_object('status','paused','reason',reason); end if;
  select * into existing from public.project_request_candidates where owner_id=p_owner and run_id=p_run and source_url_hash=md5(p_source_url) for update;
  if found then
    if existing.source_url<>p_source_url then raise exception 'PROJECT_INVALID'; end if;
    if existing.status='processing' or p_status<>'processing' then
      update public.project_request_candidates set status=p_status,reason=p_reason,updated_at=now()
        where owner_id=p_owner and run_id=p_run and source_url_hash=md5(p_source_url) returning * into existing;
    end if;
    return jsonb_build_object('status','existing','candidate_status',existing.status);
  end if;
  insert into public.project_request_candidates(owner_id,run_id,source_url_hash,source_url,status,reason)
    values(p_owner,p_run,md5(p_source_url),p_source_url,p_status,p_reason);
  update public.prospecting_runs set companies_found=companies_found+1 where id=p_run and owner_id=p_owner;
  return jsonb_build_object('status','created','candidate_status',p_status);
end $$;

create function public.save_discovered_project_request(p_owner uuid,p_run uuid,p_claim_token text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb; source_text text; query text; source_host text; quote_text text; reason text; request_id uuid;
  config public.prospecting_settings; country text; published_date date; deadline_date date; published_at timestamptz; deadline_at timestamptz;
  posted_token text; deadline_token text; source_dates jsonb; website_work boolean; application_work boolean; expected_service text;
  day_start timestamptz:=date_trunc('day',timezone('UTC',now())) at time zone 'UTC';
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>350000
    or p_payload-array['evidence','sourceText','discoveryQuery']<>'{}'::jsonb
    or jsonb_typeof(p_payload->'evidence') is distinct from 'object'
    or jsonb_typeof(p_payload->'sourceText') is distinct from 'string'
    or jsonb_typeof(p_payload->'discoveryQuery') is distinct from 'string' then return jsonb_build_object('status','invalid'); end if;
  e:=p_payload->'evidence'; source_text:=p_payload->>'sourceText'; query:=trim(p_payload->>'discoveryQuery');
  if length(source_text) not between 30 and 60000 or length(query) not between 1 and 2000
    or e-array['version','title','requestText','service','sourceUrl','platform','publishedAt','publishedDateText','deadlineAt','deadlineText','countryCode','countryEvidence','buyerName']<>'{}'::jsonb
    or not(e ?& array['version','title','requestText','service','sourceUrl','platform','publishedAt','publishedDateText','deadlineAt','deadlineText','countryCode','countryEvidence','buyerName'])
    or jsonb_typeof(e->'version') is distinct from 'number' or e->>'version'<>'1'
    or jsonb_typeof(e->'title') is distinct from 'string' or length(trim(e->>'title')) not between 1 and 300
    or jsonb_typeof(e->'requestText') is distinct from 'string' or length(e->>'requestText') not between 30 and 3000
    or jsonb_typeof(e->'service') is distinct from 'string' or e->>'service' not in ('website','application','website_and_application')
    or jsonb_typeof(e->'sourceUrl') is distinct from 'string' or jsonb_typeof(e->'platform') is distinct from 'string'
    or jsonb_typeof(e->'publishedAt') is distinct from 'string' or jsonb_typeof(e->'publishedDateText') is distinct from 'string'
    or jsonb_typeof(e->'countryCode') is distinct from 'string' or jsonb_typeof(e->'countryEvidence') is distinct from 'string'
    or (jsonb_typeof(e->'buyerName') not in ('string','null')) or coalesce(length(e->>'buyerName'),0)>300
    or jsonb_typeof(e->'deadlineAt') not in ('string','null') or jsonb_typeof(e->'deadlineText') not in ('string','null')
    then return jsonb_build_object('status','invalid'); end if;
  source_host:=public.project_source_host(e->>'sourceUrl');
  if source_host is null or e->>'platform' is distinct from source_host then return jsonb_build_object('status','evidence_required'); end if;
  quote_text:=e->>'requestText'; posted_token:=e->>'publishedDateText';
  if position(quote_text in source_text)=0 or position(posted_token in source_text)=0 or position(e->>'countryEvidence' in source_text)=0
    or (e->>'buyerName' is not null and position(e->>'buyerName' in source_text)=0)
    or quote_text!~*'(build|building|develop|development|design|redesign|redevelop|rebuild|create|implement|upgrade|migrate|migration|customi[sz]|integrat)'
    or not(quote_text~*'(request[[:space:]]+for[[:space:]]+(proposals?|quotations?|bids?|tenders?)|invitation[[:space:]]+to[[:space:]]+(bid|tender|quote)|(seeks?|invites?|requests?)[[:space:]]+(qualified[[:space:]]+)?(proposals?|quotations?|bids?|tenders?))'
      or (quote_text~*'((we|i)[[:space:]]+(are[[:space:]]+|am[[:space:]]+)?(looking for|seeking|need|require)|(is|are)[[:space:]]+(looking for|seeking)|seeks?[[:space:]]+(a[[:space:]]+|an[[:space:]]+|qualified[[:space:]]+|experienced[[:space:]]+)?(agency|vendor|contractor|freelancer|development team|development partner))'
        and quote_text~*'(agenc(y|ies)|vendors?|suppliers?|contractors?|freelancers?|consultants?|development[[:space:]]+(team|partner)|software[[:space:]]+(team|partner)|external[[:space:]]+(team|developer)|outsourc|proposals?|quotations?|bids?|tenders?)'))
    then return jsonb_build_object('status','evidence_required'); end if;
  website_work:=quote_text~*'(web[[:space:]-]?sites?|wordpress|shopify|e[[:space:]-]?commerce|online[[:space:]]+(store|shop)|landing[[:space:]]+pages?|web[[:space:]]+portal)';
  application_work:=quote_text~*'((mobile|web|software|business|android|ios|iphone|customer|booking)[[:space:]]+(applications?|apps?)|(android|ios)[[:space:]]+(development|developer)|application[[:space:]]+development|app[[:space:]]+development|(custom|bespoke)[[:space:]]+software)';
  expected_service:=case when website_work and application_work then 'website_and_application' when website_work then 'website' when application_work then 'application' end;
  if expected_service is null or e->>'service' is distinct from expected_service then return jsonb_build_object('status','evidence_required'); end if;
  published_date:=public.project_date_value(posted_token);
  if published_date is null then return jsonb_build_object('status','evidence_required'); end if;
  -- A date copied from a footer or a search estimate is not a posting date.
  if source_text !~* ('(^|[\n\r])[ \t]*([-*][ \t]+)?[*]{0,2}(published([ \t]+(on|date))?|posted([ \t]+(on|date))?|publication[ \t]+date|date[ \t]+(published|posted|issued)|issued([ \t]+on)?|notice[ \t]+date|issue[ \t]+date|date[ \t]+of[ \t]+publication)[ \t]*[*]{0,2}[ \t]*(:|[-–])[ \t]*[*]{0,2}[ \t]*'||posted_token||'([^0-9A-Za-z]|$)') then return jsonb_build_object('status','evidence_required'); end if;
  source_dates:=public.project_source_dates(source_text,'published');
  if (source_dates->>'invalid')::boolean or not(source_dates->>'has_label')::boolean or (source_dates->>'date')::date is distinct from published_date then return jsonb_build_object('status','evidence_required'); end if;
  published_at:=published_date::timestamp at time zone 'UTC';
  begin
    if (e->>'publishedAt')::timestamptz is distinct from published_at then return jsonb_build_object('status','invalid'); end if;
  exception when others then return jsonb_build_object('status','invalid'); end;
  deadline_token:=e->>'deadlineText';
  if deadline_token is not null then
    if length(deadline_token)>50 or position(deadline_token in source_text)=0 then return jsonb_build_object('status','evidence_required'); end if;
    deadline_date:=public.project_date_value(deadline_token);
    if deadline_date is null then return jsonb_build_object('status','evidence_required'); end if;
    if source_text !~* ('(^|[\n\r])[ \t]*([-*][ \t]+)?[*]{0,2}(deadline([ \t]+date)?|closing[ \t]+date|closes([ \t]+on)?|bid[ \t]+closing([ \t]+date)?|proposal[ \t]+deadline|response[ \t]+deadline|submission[ \t]+deadline|applications?[ \t]+close|due[ \t]+date)[ \t]*[*]{0,2}[ \t]*(:|[-–])[ \t]*[*]{0,2}[ \t]*'||deadline_token||'([^0-9A-Za-z]|$)') then return jsonb_build_object('status','evidence_required'); end if;
    deadline_at:=((deadline_date+1)::timestamp at time zone 'UTC')-interval '1 millisecond';
    begin
      if (e->>'deadlineAt')::timestamptz is distinct from deadline_at then return jsonb_build_object('status','invalid'); end if;
    exception when others then return jsonb_build_object('status','invalid'); end;
  elsif e->>'deadlineAt' is not null then return jsonb_build_object('status','evidence_required'); end if;
  source_dates:=public.project_source_dates(source_text,'deadline');
  if (source_dates->>'invalid')::boolean or ((source_dates->>'has_label')::boolean and deadline_date is null) or ((source_dates->>'date')::date is distinct from deadline_date) then return jsonb_build_object('status','evidence_required'); end if;
  if source_text~*'(^|[\n\r])[ \t]*([*]{0,2})?(project[ \t]+status|notice[ \t]+status|status)[ \t]*[*]{0,2}[ \t]*[:–-][ \t]*[*]{0,2}[ \t]*(closed|cancelled|canceled|awarded|expired)' then return jsonb_build_object('status','evidence_required'); end if;
  country:=public.project_country_value(e->>'countryEvidence');
  if country is null or country is distinct from e->>'countryCode' then return jsonb_build_object('status','country_excluded'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  reason:=public.prospecting_run_gate(p_owner,p_run,p_claim_token);
  if reason is not null then return jsonb_build_object('status','paused','reason',reason); end if;
  select * into config from public.prospecting_settings where owner_id=p_owner;
  if not(config.data->'countries' ? country) then return jsonb_build_object('status','country_excluded'); end if;
  if (e->>'service'='website' and not(config.data->'services' ? 'website'))
    or (e->>'service'='application' and not(config.data->'services' ? 'application'))
    or (e->>'service'='website_and_application' and not(config.data->'services' ?& array['website','application'])) then return jsonb_build_object('status','service_excluded'); end if;
  if published_at<now()-make_interval(days=>(config.data->>'maxAgeDays')::integer) or published_at>now()+interval '1 day' then return jsonb_build_object('status','stale'); end if;
  if deadline_at is not null and (deadline_at<now() or deadline_at<published_at) then return jsonb_build_object('status','stale'); end if;
  select id into request_id from public.project_requests where owner_id=p_owner and source_url_hash=md5(e->>'sourceUrl');
  if request_id is null then
    select (output->>'project_request_id')::uuid into request_id from public.agent_logs where owner_id=p_owner and agent='ProjectRequestAgent' and status='completed' and output ? 'project_request_id' and input->>'source_url_hash'=md5(e->>'sourceUrl') limit 1;
  end if;
  if request_id is not null then return jsonb_build_object('status','duplicate','request_id',request_id); end if;
  if (select count(*) from public.agent_logs where owner_id=p_owner and agent='ProjectRequestAgent' and status='completed' and output ? 'project_request_id' and created_at>=day_start)>=(config.data->>'dailyLeadLimit')::integer then return jsonb_build_object('status','daily_limit'); end if;
  insert into public.project_requests(owner_id,run_id,title,request_text,service,source_url,source_url_hash,platform,published_at,deadline_at,country_code,buyer_name,discovery_query,evidence)
    values(p_owner,p_run,trim(e->>'title'),quote_text,e->>'service',e->>'sourceUrl',md5(e->>'sourceUrl'),source_host,published_at,deadline_at,country,e->>'buyerName',query,e)
    returning id into request_id;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(p_owner,'ProjectRequestAgent',
    jsonb_build_object('run_id',p_run,'source_url_hash',md5(e->>'sourceUrl'),'source_host',source_host,'evidence_version',1),
    jsonb_build_object('project_request_id',request_id,'service',e->>'service','review_status','review_required'),'completed');
  update public.prospecting_runs set leads_saved=leads_saved+1 where owner_id=p_owner and id=p_run;
  update public.project_request_candidates set status='saved',reason=null,updated_at=now() where owner_id=p_owner and run_id=p_run and source_url_hash=md5(e->>'sourceUrl');
  return jsonb_build_object('status','saved','request_id',request_id);
end $$;

-- Old company-only workers cannot create another supposedly qualified inquiry.
create or replace function public.persist_discovered_lead(p_owner uuid,p_run uuid,p_payload jsonb,p_claim_token text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return jsonb_build_object('status','project_evidence_required');
end $$;

revoke all on function public.project_discovery_readiness() from public,anon;
grant execute on function public.project_discovery_readiness() to authenticated;
revoke all on function public.project_source_host(text),public.project_date_value(text),public.project_source_dates(text,text),public.project_country_value(text),public.trim_project_search_result(jsonb),
  public.check_project_request_capacity(uuid,uuid,text),public.record_project_request_candidate(uuid,uuid,text,text,text,text),public.save_discovered_project_request(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.project_source_host(text),public.project_date_value(text),public.project_source_dates(text,text),public.project_country_value(text),public.trim_project_search_result(jsonb),
  public.check_project_request_capacity(uuid,uuid,text),public.record_project_request_candidate(uuid,uuid,text,text,text,text),public.save_discovered_project_request(uuid,uuid,text,jsonb) to service_role;
-- Replaced functions retain their intended owner-scoped/service-only API privileges.
revoke all on function public.persist_discovered_lead(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.persist_discovered_lead(uuid,uuid,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
