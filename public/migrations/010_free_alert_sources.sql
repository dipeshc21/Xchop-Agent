-- Free owner-created Google Alerts feeds, including indexed public LinkedIn posts.
-- Additive after the workspace migrations. Existing Hunter settings and records are untouched.
begin;

create table if not exists public.alert_feed_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_type text not null check(resource_type in ('google_alerts','linkedin_posts')),
  title text not null check(length(trim(title)) between 1 and 120),
  feed_url text not null check(feed_url ~ '^https://www\.google\.com/alerts/feeds/[0-9]+/[0-9]+$'),
  enabled boolean not null default false,
  version integer not null default 1 check(version>0),
  next_check_at timestamptz,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  error_code text,
  lease_token text,
  lease_until timestamptz,
  current_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,resource_type), unique(id,owner_id)
);
create table if not exists public.alert_feed_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null,
  resource_type text not null check(resource_type in ('google_alerts','linkedin_posts')),
  source_version integer not null,
  status text not null default 'running' check(status in ('running','completed','failed','cancelled')),
  started_at timestamptz not null default now(), created_at timestamptz not null default now(), finished_at timestamptz,
  entries_seen integer not null default 0 check(entries_seen>=0),
  leads_saved integer not null default 0 check(leads_saved>=0),
  skipped_count integer not null default 0 check(skipped_count>=0),
  error_code text, message text,
  unique(id,owner_id),
  foreign key(source_id,owner_id) references public.alert_feed_sources(id,owner_id) on delete cascade
);
create table if not exists public.alert_leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null, run_id uuid not null,
  resource_type text not null check(resource_type in ('google_alerts','linkedin_posts')),
  resource_title text not null check(length(trim(resource_title)) between 1 and 120),
  source_url text not null check(length(source_url) between 10 and 2000),
  title text not null check(length(trim(title)) between 1 and 500),
  snippet text not null check(length(trim(snippet)) between 1 and 3000),
  service text not null check(service in ('website','application','website_and_application')),
  source_platform text not null check(length(source_platform) between 3 and 253),
  feed_published_at timestamptz,
  discovered_at timestamptz not null default now(),
  contact_name text, email text,
  unique(owner_id,source_url), unique(id,owner_id),
  foreign key(source_id,owner_id) references public.alert_feed_sources(id,owner_id),
  foreign key(run_id,owner_id) references public.alert_feed_runs(id,owner_id),
  check(contact_name is null or length(trim(contact_name)) between 1 and 200),
  check(email is null or (length(email) between 3 and 254 and email=lower(trim(email))))
);
create index if not exists alert_leads_owner_discovered on public.alert_leads(owner_id,discovered_at desc,id desc);
create index if not exists alert_feed_runs_owner_started on public.alert_feed_runs(owner_id,started_at desc);
create index if not exists alert_feed_sources_due on public.alert_feed_sources(next_check_at) where enabled;
create index if not exists alert_saved_source_audit on public.agent_logs(owner_id,(input->>'source_url'))
  where agent='AlertLeadSaved' and status='completed';

do $$ declare tab text; begin
  foreach tab in array array['alert_feed_sources','alert_feed_runs','alert_leads'] loop
    execute format('alter table public.%I enable row level security',tab);
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=tab and policyname='own_read') then
      execute format('create policy own_read on public.%I for select to authenticated using(owner_id=(select auth.uid()))',tab);
    end if;
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
end $$;

create or replace function public.alert_sources_readiness() returns jsonb
language sql stable set search_path=public,pg_temp as $$ select jsonb_build_object('schema_version',10) $$;

create or replace function public.save_alert_feed(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); old public.alert_feed_sources; saved public.alert_feed_sources; changed boolean;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
  if payload is null or jsonb_typeof(payload)<>'object'
    or payload-array['resource_type','title','feed_url','enabled']<>'{}'::jsonb
    or not(payload ?& array['resource_type','title','feed_url','enabled'])
    or jsonb_typeof(payload->'resource_type') is distinct from 'string'
    or payload->>'resource_type' not in ('google_alerts','linkedin_posts')
    or jsonb_typeof(payload->'title') is distinct from 'string' or length(trim(payload->>'title')) not between 1 and 120
    or jsonb_typeof(payload->'feed_url') is distinct from 'string' or length(payload->>'feed_url')>500
    or payload->>'feed_url' !~ '^https://www\.google\.com/alerts/feeds/[0-9]+/[0-9]+$'
    or jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'ALERT_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,10));
  if (select count(*) from public.agent_logs where owner_id=actor and agent='AlertFeedSettings' and created_at>now()-interval '1 minute')>=20 then raise exception 'ALERT_RATE_LIMIT';end if;
  select * into old from public.alert_feed_sources where owner_id=actor and resource_type=payload->>'resource_type' for update;
  changed:=not found or old.feed_url is distinct from payload->>'feed_url' or old.enabled is distinct from (payload->>'enabled')::boolean or old.title is distinct from trim(payload->>'title');
  if changed and old.current_run_id is not null then
    update public.alert_feed_runs set status='cancelled',finished_at=now(),error_code='SOURCE_CHANGED',message='Alert source settings changed.',
      leads_saved=(select count(*) from public.agent_logs where owner_id=actor and agent='AlertLeadSaved' and status='completed' and input->>'run_id'=old.current_run_id::text)
      where id=old.current_run_id and owner_id=actor and status='running';
  end if;
  insert into public.alert_feed_sources(owner_id,resource_type,title,feed_url,enabled,next_check_at)
    values(actor,payload->>'resource_type',trim(payload->>'title'),payload->>'feed_url',(payload->>'enabled')::boolean,
      case when (payload->>'enabled')::boolean then now() end)
  on conflict(owner_id,resource_type) do update set title=excluded.title,feed_url=excluded.feed_url,enabled=excluded.enabled,
    version=case when changed then public.alert_feed_sources.version+1 else public.alert_feed_sources.version end,
    next_check_at=case when not excluded.enabled then null when changed then now() else public.alert_feed_sources.next_check_at end,
    lease_token=case when changed then null else public.alert_feed_sources.lease_token end,
    lease_until=case when changed then null else public.alert_feed_sources.lease_until end,
    current_run_id=case when changed then null else public.alert_feed_sources.current_run_id end,
    error_code=case when changed then null else public.alert_feed_sources.error_code end,updated_at=now()
  returning * into saved;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(actor,'AlertFeedSettings',
    jsonb_build_object('resource_type',saved.resource_type),jsonb_build_object('source_id',saved.id,'enabled',saved.enabled),'completed');
  return to_jsonb(saved);
end $$;

create or replace function public.claim_alert_feed(p_owner uuid,p_source uuid,p_claim_token text,p_force boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare source public.alert_feed_sources; run public.alert_feed_runs;
begin
  if p_claim_token is null or length(p_claim_token) not between 16 and 128 then raise exception 'ALERT_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,10));
  select * into source from public.alert_feed_sources where id=p_source and owner_id=p_owner for update;
  if not found or not source.enabled then return null;end if;
  if source.current_run_id is not null then
    select * into run from public.alert_feed_runs where id=source.current_run_id and owner_id=p_owner and status='running' for update;
    if found and run.source_version=source.version then
      if source.lease_until>now() and source.lease_token is distinct from p_claim_token then return null;end if;
      update public.alert_feed_sources set lease_token=p_claim_token,lease_until=now()+interval '10 minutes' where id=p_source;
      return jsonb_build_object('source',to_jsonb(source)||jsonb_build_object('lease_token',p_claim_token), 'run_id',run.id,'claim_token',p_claim_token);
    end if;
  end if;
  if coalesce(p_force,false) then
    if source.last_checked_at>now()-interval '2 minutes' then return null;end if;
  elsif source.next_check_at is null or source.next_check_at>now() then return null;
  end if;
  insert into public.alert_feed_runs(owner_id,source_id,resource_type,source_version)
    values(p_owner,p_source,source.resource_type,source.version) returning * into run;
  update public.alert_feed_sources set current_run_id=run.id,lease_token=p_claim_token,lease_until=now()+interval '10 minutes',last_checked_at=now()
    where id=p_source returning * into source;
  return jsonb_build_object('source',to_jsonb(source),'run_id',run.id,'claim_token',p_claim_token);
end $$;

create or replace function public.persist_alert_lead(p_owner uuid,p_source uuid,p_claim_token text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare source public.alert_feed_sources; run public.alert_feed_runs; source_address text; host text; email_address text; person text; published timestamptz; saved uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,10));
  select * into source from public.alert_feed_sources where id=p_source and owner_id=p_owner for update;
  if not found or not source.enabled or p_claim_token is null or source.lease_token is distinct from p_claim_token or source.lease_until is null or source.lease_until<now() then return jsonb_build_object('status','paused');end if;
  select * into run from public.alert_feed_runs where id=source.current_run_id and owner_id=p_owner and source_id=p_source and status='running' and source_version=source.version;
  if not found then return jsonb_build_object('status','paused');end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>32768
    or p_payload-array['title','snippet','service','source_url','source_platform','feed_published_at','contact_name','email']<>'{}'::jsonb
    or not(p_payload ?& array['title','snippet','service','source_url','source_platform'])
    or jsonb_typeof(p_payload->'title') is distinct from 'string' or length(trim(p_payload->>'title')) not between 1 and 500
    or jsonb_typeof(p_payload->'snippet') is distinct from 'string' or length(trim(p_payload->>'snippet')) not between 1 and 3000
    or jsonb_typeof(p_payload->'service') is distinct from 'string' or p_payload->>'service' not in ('website','application','website_and_application')
    or jsonb_typeof(p_payload->'source_url') is distinct from 'string' or length(p_payload->>'source_url') not between 10 and 2000
    or jsonb_typeof(p_payload->'source_platform') is distinct from 'string' then return jsonb_build_object('status','invalid');end if;
  source_address:=p_payload->>'source_url';host:=lower(substring(source_address from '^https?://([^/?#]+)'));
  if host is null or host!~'^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    or host~'(^|\.)(localhost|local|internal|invalid|test|example|home|lan|onion)$'
    or source_address~'[[:space:]\\]'
    or source_address~*'[?&][^=&#]*(api[-_]?key|access[-_]?token|authorization|password|secret|signature|token)[^=&#]*='
    or p_payload->>'source_platform' is distinct from host then return jsonb_build_object('status','invalid');end if;
  if source.resource_type='linkedin_posts' and (host not in ('linkedin.com','www.linkedin.com')
    or source_address!~*'^https?://(www\.)?linkedin\.com/(posts/[^/?#]+|feed/update/(urn:li:activity:|urn%3Ali%3Aactivity%3A)[^/?#]+)') then return jsonb_build_object('status','invalid');end if;
  if (p_payload ? 'feed_published_at') and p_payload->'feed_published_at'<>'null'::jsonb then
    if jsonb_typeof(p_payload->'feed_published_at') is distinct from 'string' then return jsonb_build_object('status','invalid');end if;
    begin published:=(p_payload->>'feed_published_at')::timestamptz;exception when others then return jsonb_build_object('status','invalid');end;
    if not isfinite(published) or published>now()+interval '1 day' then return jsonb_build_object('status','invalid');end if;
  end if;
  if p_payload ? 'email' and p_payload->'email'<>'null'::jsonb then
    if jsonb_typeof(p_payload->'email') is distinct from 'string' then return jsonb_build_object('status','invalid');end if;
    email_address:=lower(trim(p_payload->>'email'));
    if length(email_address) not between 3 and 254 or email_address!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or position(email_address in lower((p_payload->>'title')||' '||(p_payload->>'snippet')))=0
      or exists(select 1 from public.suppression_list where owner_id=p_owner and email=email_address) then return jsonb_build_object('status','invalid');end if;
  end if;
  if p_payload ? 'contact_name' and p_payload->'contact_name'<>'null'::jsonb then
    if jsonb_typeof(p_payload->'contact_name') is distinct from 'string' then return jsonb_build_object('status','invalid');end if;
    person:=trim(p_payload->>'contact_name');
    if length(person) not between 1 and 200 or position(lower(person) in lower((p_payload->>'title')||' '||(p_payload->>'snippet')))=0 then return jsonb_build_object('status','invalid');end if;
  end if;
  if exists(select 1 from public.alert_leads where owner_id=p_owner and source_url=source_address)
    or exists(select 1 from public.agent_logs where owner_id=p_owner and agent='AlertLeadSaved' and status='completed' and input->>'source_url'=source_address) then return jsonb_build_object('status','duplicate');end if;
  insert into public.alert_leads(owner_id,source_id,run_id,resource_type,resource_title,source_url,title,snippet,service,source_platform,feed_published_at,contact_name,email)
    values(p_owner,p_source,run.id,source.resource_type,source.title,source_address,trim(p_payload->>'title'),trim(p_payload->>'snippet'),p_payload->>'service',host,published,person,email_address)
    returning id into saved;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(p_owner,'AlertLeadSaved',
    jsonb_build_object('source_url',source_address,'source_id',p_source,'run_id',run.id),jsonb_build_object('lead_id',saved),'completed');
  return jsonb_build_object('status','saved','lead_id',saved);
end $$;

create or replace function public.finish_alert_feed(p_owner uuid,p_source uuid,p_claim_token text,p_status text,p_counts jsonb,p_error_code text,p_message text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare source public.alert_feed_sources; run public.alert_feed_runs; seen numeric; skipped numeric; saved_count integer; safe_message text;
  reason_label text; reason_match text[]; reason_count integer; reason_total integer:=0; reason_summary text:='';
begin
  if p_status is null or p_status not in ('completed','failed') or p_counts is null or jsonb_typeof(p_counts)<>'object'
    or p_counts-array['entries_seen','skipped_count','leads_saved']<>'{}'::jsonb then raise exception 'ALERT_INVALID';end if;
  if p_status='completed' and p_error_code is not null then raise exception 'ALERT_INVALID';end if;
  if p_status='failed' and (p_error_code is null or p_error_code not in ('FEED_INVALID','FEED_UNAVAILABLE','FEED_RATE_LIMIT','FEED_TOO_LARGE','FEED_PARSE','DATABASE_UNAVAILABLE')) then raise exception 'ALERT_INVALID';end if;
  if jsonb_typeof(p_counts->'entries_seen') is distinct from 'number' or jsonb_typeof(p_counts->'skipped_count') is distinct from 'number' then raise exception 'ALERT_INVALID';end if;
  seen:=(p_counts->>'entries_seen')::numeric;skipped:=(p_counts->>'skipped_count')::numeric;
  if seen<>trunc(seen) or skipped<>trunc(skipped) or seen not between 0 and 10000 or skipped not between 0 and 10000 then raise exception 'ALERT_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,10));
  select * into source from public.alert_feed_sources where id=p_source and owner_id=p_owner for update;
  if not found or not source.enabled or p_claim_token is null or source.lease_token is distinct from p_claim_token or source.lease_until is null or source.lease_until<now() then return false;end if;
  select * into run from public.alert_feed_runs where id=source.current_run_id and owner_id=p_owner and source_id=p_source and status='running' and source_version=source.version for update;
  if not found then return false;end if;
  select count(*) into saved_count from public.agent_logs where owner_id=p_owner and agent='AlertLeadSaved' and status='completed' and input->>'run_id'=run.id::text;
  safe_message:=case when p_status='completed' then 'Alert feed checked. '||saved_count||' new requests saved for review.'
    else 'The alert feed could not be checked. No paid discovery provider was called. Error: '||p_error_code||'.' end;
  -- Keep useful diagnostics without persisting provider text, private feed URLs
  -- or arbitrary messages. Only fixed labels and bounded integer counts survive.
  if skipped>0 then
    if length(coalesce(p_message,''))<=2000 then
      foreach reason_label in array array['missing or oversized text','unsafe or wrong source','duplicate in feed','missing or old alert date',
        'employment','supplier marketing','closed','no buyer request','service mismatch','previously saved source','storage validation'] loop
        reason_match:=regexp_match(coalesce(p_message,''),'(^|[;[:space:]—])'||reason_label||':[[:space:]]*([1-9][0-9]?)($|[;.,[:space:]])','i');
        if reason_match is not null then
          reason_count:=reason_match[2]::integer;
          if reason_count<=50 and reason_total+reason_count<=skipped then
            reason_summary:=concat_ws('; ',nullif(reason_summary,''),reason_label||': '||reason_count);
            reason_total:=reason_total+reason_count;
          end if;
        end if;
      end loop;
    end if;
    if skipped>reason_total then
      reason_summary:=concat_ws('; ',nullif(reason_summary,''),'other skipped results: '||(skipped::integer-reason_total));
    end if;
    safe_message:=safe_message||' Skipped — '||reason_summary||'.';
  end if;
  update public.alert_feed_runs set status=p_status,finished_at=now(),entries_seen=seen::integer,skipped_count=skipped::integer,leads_saved=saved_count,
    error_code=p_error_code,message=safe_message where id=run.id;
  update public.alert_feed_sources set lease_token=null,lease_until=null,current_run_id=null,next_check_at=now()+interval '1 hour',
    last_success_at=case when p_status='completed' then now() else last_success_at end,error_code=p_error_code,updated_at=now() where id=p_source;
  return true;
end $$;

-- Invoker security retains each base table's owner policy. Unknown alert identity
-- stays blank, rather than fabricating an email to fit the contact table.
create or replace view public.workspace_lead_records with (security_invoker=true) as
select l.id,l.owner_id,l.company,l.website,l.contact_name,l.email,l.country,l.role,l.stage,l.score,l.score_reason,l.value,l.segment,
  l.created_at,l.updated_at,l.source,l.lawful_basis,
  coalesce(to_jsonb(l)->>'email_verification_status','unverified') as email_verification_status,
  nullif(to_jsonb(l)->>'email_verified_at','')::timestamptz as email_verified_at,
  coalesce(to_jsonb(l)->>'contact_review_status','needs_review') as contact_review_status,
  nullif(to_jsonb(l)->>'discovery_run_id','')::uuid as discovery_run_id,
  case when to_jsonb(l)->>'discovery_run_id' is not null or l.source ilike '%hunter%' then 'Hunter' else l.source end as resource_title,
  null::text as resource_url,'contact'::text as record_type,null::text as alert_snippet,null::text as alert_service,null::timestamptz as feed_published_at
from public.leads l
union all
select a.id,a.owner_id,a.title as company,null::text as website,coalesce(a.contact_name,'') as contact_name,coalesce(a.email,'') as email,
  'Not published'::text as country,null::text as role,'New'::text as stage,0::integer as score,'Not scored'::text as score_reason,0::numeric(12,2) as value,
  case a.service when 'website' then 'Website request' when 'application' then 'Application request' else 'Website and application request' end as segment,
  a.discovered_at as created_at,a.discovered_at as updated_at,a.resource_title as source,'Review the original public request before responding.'::text as lawful_basis,
  'unverified'::text as email_verification_status,null::timestamptz as email_verified_at,'needs_review'::text as contact_review_status,null::uuid as discovery_run_id,
  a.resource_title,a.source_url as resource_url,'alert'::text as record_type,a.snippet as alert_snippet,a.service as alert_service,a.feed_published_at
from public.alert_leads a;
revoke all on public.workspace_lead_records from public,anon,authenticated;
grant select on public.workspace_lead_records to authenticated,service_role;
revoke all on function public.alert_sources_readiness() from public,anon;
grant execute on function public.alert_sources_readiness() to authenticated,service_role;
revoke all on function public.save_alert_feed(jsonb) from public,anon,service_role;
grant execute on function public.save_alert_feed(jsonb) to authenticated;
revoke all on function public.claim_alert_feed(uuid,uuid,text,boolean),public.persist_alert_lead(uuid,uuid,text,jsonb),public.finish_alert_feed(uuid,uuid,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.claim_alert_feed(uuid,uuid,text,boolean),public.persist_alert_lead(uuid,uuid,text,jsonb),public.finish_alert_feed(uuid,uuid,text,text,jsonb,text,text) to service_role;
notify pgrst,'reload schema';
commit;
