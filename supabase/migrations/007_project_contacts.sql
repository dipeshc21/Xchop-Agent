-- Add published project contact details without replacing requirement/source evidence.
-- Run after migrations 001–006. Existing leads and project requests are preserved.
begin;

alter table public.project_requests
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_source_url text;

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.project_requests'::regclass and conname='project_requests_contact_name_check') then
    alter table public.project_requests add constraint project_requests_contact_name_check
      check(contact_name is null or (length(contact_name) between 1 and 200 and contact_name=trim(contact_name) and contact_name!~'[[:cntrl:]]'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.project_requests'::regclass and conname='project_requests_contact_email_check') then
    alter table public.project_requests add constraint project_requests_contact_email_check
      check(contact_email is null or (length(contact_email) between 3 and 254 and contact_email=lower(trim(contact_email)) and contact_email~'^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.project_requests'::regclass and conname='project_requests_contact_source_check') then
    alter table public.project_requests add constraint project_requests_contact_source_check
      check((contact_name is null and contact_email is null and contact_source_url is null)
        or ((contact_name is not null or contact_email is not null) and contact_source_url is not null and contact_source_url=source_url));
  end if;
end $$;

-- Explicit proposal-routing prose is also a published contact source. It does not
-- identify a person or establish mailbox deliverability.
create or replace function public.project_submission_contact_matches(p_text text,p_email text) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare route text; after_route text;
begin
  if p_text is null or p_email is null or length(p_text)>800
    or p_text~*'(privacy|data protection|unsubscribe|newsletter|webmaster|customer support|job application)'
    or split_part(p_email,'@',1)~*'(^|[._+-])(support|privacy|dpo|dataprotection|data-protection|webmaster|security|abuse|legal|careers?|jobs?|recruitment|recruiting|noreply|no-reply|donotreply|do-not-reply|postmaster)($|[._+-])'
    then return false; end if;
  route:=substring(lower(p_text) from '(?:(?:proposals?|bids?|tenders?|submissions?|responses? to (?:this|the) (?:rfp|request|tender))[^.!?\r\n]{0,180}(?:e-?mailed|sent|send|submitted|submit|forwarded|delivered|e-?mail)[^.!?\r\n]{0,80}to|(?:send|submit|e-?mail|forward|deliver)[^.!?\r\n]{0,80}(?:proposals?|bids?|tenders?|submissions?)[^.!?\r\n]{0,80}to)');
  if route is null then return false; end if;
  after_route:=substring(lower(p_text) from position(route in lower(p_text))+length(route));
  if position(p_email in after_route) not between 1 and 160 then return false; end if;
  return (select count(*) from regexp_matches(after_route,'[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@([a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63})','g'))=1;
end $$;

-- This is proof of publication, not a mailbox-deliverability or identity verification.
create or replace function public.project_contact_source_matches(p_source text,p_name text,p_email text) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare lines text[]; i integer; j integer; normalized text; block text; heading text; paragraph text; line text; blocked_section boolean:=false;
begin
  if p_source is null or length(p_source)>60000 then return false; end if;
  if p_name is null and p_email is null then return true; end if;
  lines:=regexp_split_to_array(p_source,E'[\r\n]+');
  for i in 1..coalesce(array_length(lines,1),0) loop
    normalized:=regexp_replace(trim(regexp_replace(lines[i],'[*#]','','g')),'^-[[:space:]]+','');
    if normalized~*'^((project|buyer|client|procurement|tender|rfp|contracting[[:space:]]+authority)[[:space:]]+(contact([[:space:]]+(person|name|information|details))?|e-?mail([[:space:]]+address)?)|contact[[:space:]]+(person|name|information|details|e-?mail([[:space:]]+address)?))([[:space:]]*[:–—-]|[[:space:]]*$)' then
      heading:=normalized;
      block:=lines[i];
      for j in i+1..least(i+8,array_length(lines,1)) loop
        normalized:=trim(regexp_replace(lines[j],'[*#]','','g'));
        exit when normalized~*'^(privacy|terms|copyright|data[[:space:]]+protection|technical[[:space:]]+support|webmaster|careers?|jobs?|footer)([[:space:]:–—-]|$)';
        block:=block||E'\n'||lines[j];
      end loop;
      -- A bare "Contact email" is useful only for an explicitly procurement-oriented mailbox.
      if heading~*'^contact[[:space:]]+e-?mail([[:space:]]+address)?[[:space:]]*[:–—-]' and (p_email is null or split_part(p_email,'@',1)!~*'(^|[._+-])(procurement|purchasing|tenders?|contracts?|bids?|rfp)([._+-]|$)') then continue; end if;
      if (p_name is null or position(p_name in block)>0) and (p_email is null or position(p_email in lower(block))>0) then return true; end if;
    end if;
  end loop;
  if p_name is null and p_email is not null then
    for paragraph in select regexp_split_to_table(replace(p_source,E'\r\n',E'\n'),E'\n[ \t]*\n') loop
      if paragraph~*'(request for (proposals?|quotations?|bids?|tenders?)|invitation to (bid|tender|quote))' then blocked_section:=false; end if;
      if paragraph~*'(^|[\n\r])[ \t#*]*(privacy|cookies?|terms|data protection|accessibility|website (contact|support)|platform (contact|support)|marketplace (contact|support)|technical support|customer support|webmaster|careers?|jobs?|recruitment|related (posts|articles)|newsletter|contact us)([[:space:]:–—-]|$)' then
        blocked_section:=true; continue;
      end if;
      if blocked_section then continue; end if;
      if length(paragraph)<=800 then
        if public.project_submission_contact_matches(paragraph,p_email) then return true; end if;
      else
        for line in select regexp_split_to_table(paragraph,E'\n') loop
          if public.project_submission_contact_matches(line,p_email) then return true; end if;
        end loop;
      end if;
    end loop;
  end if;
  return false;
end $$;

create or replace function public.project_contact_readiness() returns jsonb
language sql stable set search_path=public,pg_temp as $$select jsonb_build_object('schema_version',7)$$;

create or replace function public.save_discovered_project_request(p_owner uuid,p_run uuid,p_claim_token text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb; source_text text; query text; source_host text; quote_text text; reason text; request_id uuid;
  config public.prospecting_settings; country text; published_date date; deadline_date date; published_at timestamptz; deadline_at timestamptz;
  posted_token text; deadline_token text; source_dates jsonb; website_work boolean; application_work boolean; expected_service text;
  contact jsonb; published_contact_name text; published_contact_email text; published_contact_source_url text; enriched_id uuid;
  day_start timestamptz:=date_trunc('day',timezone('UTC',now())) at time zone 'UTC';
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>350000
    or p_payload-array['evidence','sourceText','discoveryQuery','contact']<>'{}'::jsonb
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
  -- Contact values are optional, but every provided value must be supported by the same published request.
  contact:=p_payload->'contact';
  if contact is not null and contact<>'null'::jsonb then
    if jsonb_typeof(contact) is distinct from 'object'
      or contact-array['contactName','contactEmail','contactSourceUrl']<>'{}'::jsonb
      or not(contact ?& array['contactName','contactEmail','contactSourceUrl'])
      or jsonb_typeof(contact->'contactName') not in ('string','null')
      or jsonb_typeof(contact->'contactEmail') not in ('string','null')
      or jsonb_typeof(contact->'contactSourceUrl') not in ('string','null') then return jsonb_build_object('status','invalid'); end if;
    published_contact_name:=nullif(trim(contact->>'contactName'),'');
    published_contact_email:=nullif(lower(trim(contact->>'contactEmail')),'');
    published_contact_source_url:=nullif(trim(contact->>'contactSourceUrl'),'');
    if (published_contact_name is not null and (length(published_contact_name)>200 or published_contact_name~'[[:cntrl:]]' or position(published_contact_name in source_text)=0))
      or (published_contact_email is not null and (length(published_contact_email)>254 or published_contact_email!~'^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$' or position(published_contact_email in lower(source_text))=0))
      or ((published_contact_name is not null or published_contact_email is not null) and published_contact_source_url is distinct from e->>'sourceUrl')
      or (published_contact_name is null and published_contact_email is null and published_contact_source_url is not null)
      then return jsonb_build_object('status','contact_evidence_required'); end if;
    if (published_contact_name is not null or published_contact_email is not null) and not public.project_contact_source_matches(source_text,published_contact_name,published_contact_email) then
      return jsonb_build_object('status','contact_evidence_required');
    end if;
  end if;
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
  if source_text~*'(^|[\n\r])[ \t]*([*]{0,2})?(project[ \t]+status|notice[ \t]+status|status)[ \t]*[*]{0,2}[ \t]*[:–—-][ \t]*[*]{0,2}[ \t]*(closed|cancelled|canceled|awarded|expired)' then return jsonb_build_object('status','evidence_required'); end if;
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
  if request_id is not null then
    -- A repeat discovery can fill missing, consistent contact details from the same source.
    -- It cannot overwrite a known person/email or count the request twice.
    if published_contact_source_url is not null then
      update public.project_requests existing set
        contact_name=coalesce(existing.contact_name,published_contact_name),
        contact_email=coalesce(existing.contact_email,published_contact_email),
        contact_source_url=coalesce(existing.contact_source_url,published_contact_source_url)
      where existing.id=request_id and existing.owner_id=p_owner and existing.source_url=published_contact_source_url
        and (existing.contact_name is null or (published_contact_name is not null and existing.contact_name=published_contact_name))
        and (existing.contact_email is null or (published_contact_email is not null and existing.contact_email=published_contact_email))
        and ((existing.contact_name is null and published_contact_name is not null) or (existing.contact_email is null and published_contact_email is not null))
      returning existing.id into enriched_id;
      if enriched_id is not null then
        insert into public.agent_logs(owner_id,agent,input,output,status) values(p_owner,'ProjectContactEnrichment',
          jsonb_build_object('run_id',p_run,'source_url_hash',md5(e->>'sourceUrl')),
          jsonb_build_object('project_request_id',request_id,'has_name',published_contact_name is not null,'has_email',published_contact_email is not null,'email_verified',false),'completed');
      end if;
    end if;
    return jsonb_build_object('status','duplicate','request_id',request_id);
  end if;
  if (select count(*) from public.agent_logs where owner_id=p_owner and agent='ProjectRequestAgent' and status='completed' and output ? 'project_request_id' and created_at>=day_start)>=(config.data->>'dailyLeadLimit')::integer then return jsonb_build_object('status','daily_limit'); end if;
  insert into public.project_requests(owner_id,run_id,title,request_text,service,source_url,source_url_hash,platform,published_at,deadline_at,country_code,buyer_name,discovery_query,evidence,contact_name,contact_email,contact_source_url)
    values(p_owner,p_run,trim(e->>'title'),quote_text,e->>'service',e->>'sourceUrl',md5(e->>'sourceUrl'),source_host,published_at,deadline_at,country,e->>'buyerName',query,e,published_contact_name,published_contact_email,published_contact_source_url)
    returning id into request_id;
  insert into public.agent_logs(owner_id,agent,input,output,status) values(p_owner,'ProjectRequestAgent',
    jsonb_build_object('run_id',p_run,'source_url_hash',md5(e->>'sourceUrl'),'source_host',source_host,'evidence_version',1),
    jsonb_build_object('project_request_id',request_id,'service',e->>'service','review_status','review_required'),'completed');
  update public.prospecting_runs set leads_saved=leads_saved+1 where owner_id=p_owner and id=p_run;
  update public.project_request_candidates set status='saved',reason=null,updated_at=now() where owner_id=p_owner and run_id=p_run and source_url_hash=md5(e->>'sourceUrl');
  return jsonb_build_object('status','saved','request_id',request_id);
end $$;

revoke all on function public.project_submission_contact_matches(text,text), public.project_contact_source_matches(text,text,text), public.save_discovered_project_request(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.project_submission_contact_matches(text,text), public.project_contact_source_matches(text,text,text), public.save_discovered_project_request(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.project_contact_readiness() from public,anon;
grant execute on function public.project_contact_readiness() to authenticated,service_role;
notify pgrst,'reload schema';
commit;
