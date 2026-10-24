-- Apply after 001_foundation.sql. Adds real, audited manual lead entry.
-- Existing leads and settings are preserved. No sample data is inserted.
begin;

create or replace function public.create_workspace_lead(payload jsonb)
returns setof public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  lead_email text;
  lead_country text;
  lead_value numeric;
  exclude_india boolean := true;
  recent integer;
  created public.leads;
  field_name text;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object'
     or payload - array['company', 'website', 'contact_name', 'email', 'country', 'role', 'segment', 'source', 'lawful_basis', 'value'] <> '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'LEAD_INVALID';
  end if;

  -- Reject non-text values even when a direct RPC call skips the web form.
  foreach field_name in array array['company', 'email', 'country', 'source', 'lawful_basis'] loop
    if jsonb_typeof(payload->field_name) is distinct from 'string' then
      raise exception using errcode = 'P0001', message = 'LEAD_INVALID';
    end if;
  end loop;
  foreach field_name in array array['website', 'contact_name', 'role', 'segment'] loop
    if payload ? field_name and jsonb_typeof(payload->field_name) is distinct from 'string' then
      raise exception using errcode = 'P0001', message = 'LEAD_INVALID';
    end if;
  end loop;

  -- Repeat essential validation here: authenticated clients can call this RPC directly.
  if coalesce(length(trim(payload->>'company')), 0) not between 1 and 200
     or coalesce(length(trim(payload->>'email')), 0) not between 3 and 254
     or coalesce(length(trim(payload->>'country')), 0) not between 1 and 100
     or coalesce(length(trim(payload->>'source')), 0) not between 1 and 500
     or coalesce(length(trim(payload->>'lawful_basis')), 0) not between 1 and 2000
     or coalesce(length(payload->>'contact_name'), 0) > 200
     or coalesce(length(payload->>'role'), 0) > 150
     or coalesce(length(payload->>'segment'), 0) > 100
     or coalesce(length(payload->>'website'), 0) > 500
     or coalesce(payload->>'website', '') !~ '^(https?://[^[:space:]]+)?$'
     or trim(payload->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or (payload ? 'value' and jsonb_typeof(payload->'value') <> 'number') then
    raise exception using errcode = 'P0001', message = 'LEAD_INVALID';
  end if;

  lead_email := lower(trim(payload->>'email'));
  lead_country := trim(payload->>'country');
  lead_value := coalesce((payload->>'value')::numeric, 0);
  if lead_value < 0 or lead_value > 9999999999.99 then
    raise exception using errcode = 'P0001', message = 'LEAD_INVALID';
  end if;

  -- One transaction lock per account makes the database-backed limit reliable.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select count(*) into recent from public.agent_logs
    where owner_id = actor and agent = 'LeadEntry'
      and created_at > now() - interval '1 minute';
  if recent >= 30 then
    raise exception using errcode = 'P0001', message = 'LEAD_RATE_LIMIT';
  end if;

  select coalesce(data->'excludeIndia', 'true'::jsonb) <> 'false'::jsonb
    into exclude_india from public.settings where owner_id = actor;
  if coalesce(exclude_india, true) and lower(lead_country) in ('india', 'in', 'ind') then
    raise exception using errcode = 'P0001', message = 'LEAD_INDIA_EXCLUDED';
  end if;
  if exists(select 1 from public.suppression_list where owner_id = actor and email = lead_email) then
    raise exception using errcode = 'P0001', message = 'LEAD_SUPPRESSED';
  end if;

  insert into public.leads(owner_id, company, website, contact_name, email, country, role,
                           segment, source, lawful_basis, stage, score, score_reason, value)
  values (actor, trim(payload->>'company'), nullif(trim(payload->>'website'), ''),
          coalesce(trim(payload->>'contact_name'), ''), lead_email, lead_country,
          nullif(trim(payload->>'role'), ''), coalesce(trim(payload->>'segment'), ''),
          trim(payload->>'source'), trim(payload->>'lawful_basis'), 'New', 0, 'Not scored', lead_value)
  returning * into created;

  insert into public.agent_logs(owner_id, agent, input, output, status)
  values(actor, 'LeadEntry', '{"action":"create"}', jsonb_build_object('lead_id', created.id), 'completed');
  return next created;
end;
$$;

revoke all on function public.create_workspace_lead(jsonb) from public, anon;
grant execute on function public.create_workspace_lead(jsonb) to authenticated;
-- Mutation must go through guarded RPCs, not direct table writes.
revoke insert, update on public.leads from authenticated;

create or replace function public.update_workspace_lead(payload jsonb)
returns setof public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  target_id uuid;
  next_value numeric;
  recent integer;
  changed public.leads;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object'
     or payload - array['id', 'stage', 'value'] <> '{}'::jsonb
     or jsonb_typeof(payload->'id') is distinct from 'string'
     or jsonb_typeof(payload->'stage') is distinct from 'string'
     or jsonb_typeof(payload->'value') is distinct from 'number'
     or payload->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not (payload->>'stage' = any(array['New', 'Qualified', 'Contacted', 'Replied', 'Quote Sent', 'Negotiation', 'Won', 'In Delivery', 'Delivered', 'Reviewed', 'Lost'])) then
    raise exception using errcode = 'P0001', message = 'LEAD_INVALID';
  end if;
  target_id := (payload->>'id')::uuid;
  next_value := (payload->>'value')::numeric;
  if next_value < 0 or next_value > 9999999999.99 then
    raise exception using errcode = 'P0001', message = 'LEAD_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select count(*) into recent from public.agent_logs
    where owner_id = actor and agent = 'LeadUpdate'
      and created_at > now() - interval '1 minute';
  if recent >= 30 then
    raise exception using errcode = 'P0001', message = 'LEAD_RATE_LIMIT';
  end if;

  update public.leads set stage = payload->>'stage', value = next_value, updated_at = now()
    where id = target_id and owner_id = actor
    returning * into changed;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEAD_NOT_FOUND';
  end if;
  insert into public.agent_logs(owner_id, agent, input, output, status)
    values(actor, 'LeadUpdate', jsonb_build_object('stage', payload->>'stage', 'value', next_value),
           jsonb_build_object('lead_id', changed.id), 'completed');
  return next changed;
end;
$$;
revoke all on function public.update_workspace_lead(jsonb) from public, anon;
grant execute on function public.update_workspace_lead(jsonb) to authenticated;

commit;
