-- Accept source-backed public-request layouts and retry transient discovery failures.
-- Run after 006 and, if used, 007. Safe to run again. Does not pause or enable discovery.
begin;

create or replace function public.project_date_details(p_text text) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare token text:=trim(p_text); parts text[]; date_text text; suffix text; parsed date; ordinal_parts text[]; ordinal_expected text;
  year_value integer; month_value integer; day_value integer; clock_parts text[];
  hour_value integer; minute_value integer; second_value numeric; offset_minutes integer; zone_value text; sign_value integer;
  instant_value timestamptz;
begin
  if token is null or length(token)>100 then return null; end if;
  parts:=regexp_match(token,'^([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}(?:st|nd|rd|th)?[ \t]+[A-Za-z]{3,9}[ \t]+[0-9]{4}|[A-Za-z]{3,9}[ \t]+[0-9]{1,2}(?:st|nd|rd|th)?(?:,[ \t]*|[ \t]+)[0-9]{4})(.*)$','i');
  if parts is null then return null; end if;
  ordinal_parts:=regexp_match(parts[1],'([0-9]{1,2})(st|nd|rd|th)','i');
  if ordinal_parts is not null then
    day_value:=ordinal_parts[1]::integer;
    ordinal_expected:=case when day_value%100 between 11 and 13 then 'th' else case day_value%10 when 1 then 'st' when 2 then 'nd' when 3 then 'rd' else 'th' end end;
    if lower(ordinal_parts[2])<>ordinal_expected then return null;end if;
  end if;
  date_text:=regexp_replace(parts[1],'([0-9])(st|nd|rd|th)','\1','gi'); suffix:=parts[2];
  if date_text~'^[0-9]{4}-' then
    year_value:=split_part(date_text,'-',1)::integer;month_value:=split_part(date_text,'-',2)::integer;day_value:=split_part(date_text,'-',3)::integer;
  else
    parts:=regexp_match(date_text,'^([0-9]{1,2})[ \t]+([A-Za-z]{3,9})[ \t]+([0-9]{4})$');
    if parts is not null then day_value:=parts[1]::integer;date_text:=parts[2];year_value:=parts[3]::integer;
    else
      parts:=regexp_match(date_text,'^([A-Za-z]{3,9})[ \t]+([0-9]{1,2})(?:,[ \t]*|[ \t]+)([0-9]{4})$');
      if parts is null then return null; end if;
      date_text:=parts[1];day_value:=parts[2]::integer;year_value:=parts[3]::integer;
    end if;
    month_value:=case lower(date_text) when 'jan' then 1 when 'january' then 1 when 'feb' then 2 when 'february' then 2 when 'mar' then 3 when 'march' then 3 when 'apr' then 4 when 'april' then 4 when 'may' then 5 when 'jun' then 6 when 'june' then 6 when 'jul' then 7 when 'july' then 7 when 'aug' then 8 when 'august' then 8 when 'sep' then 9 when 'sept' then 9 when 'september' then 9 when 'oct' then 10 when 'october' then 10 when 'nov' then 11 when 'november' then 11 when 'dec' then 12 when 'december' then 12 end;
  end if;
  if year_value not between 2000 and 2100 or month_value is null then return null; end if;
  begin parsed:=make_date(year_value,month_value,day_value);exception when others then return null;end;
  if suffix='' then return jsonb_build_object('date',parsed,'instant',null); end if;
  -- A clock requires an explicit known zone. Never infer one from a country or host.
  if suffix!~*'^(T|[ \t]+(at[ \t]+)?|,[ \t]+(at[ \t]+)?)[0-9]' then return null; end if;
  suffix:=regexp_replace(suffix,'^(T|[ \t]+(at[ \t]+)?|,[ \t]+(at[ \t]+)?)','','i');
  clock_parts:=regexp_match(suffix,'^([0-9]{1,2})(?::([0-9]{2}))?(?::([0-9]{2}(?:[.][0-9]{1,3})?))?[ \t]*(AM|PM)?[ \t]*(Z|UTC|GMT|CET|CEST|EST|EDT|PST|PDT|BST|(?:UTC|GMT)?[+-][0-9]{2}:?[0-9]{2})$','i');
  if clock_parts is null or (clock_parts[2] is null and clock_parts[4] is null) then return null;end if;
  hour_value:=clock_parts[1]::integer;minute_value:=coalesce(clock_parts[2],'0')::integer;second_value:=coalesce(clock_parts[3],'0')::numeric;
  if minute_value>59 or second_value>=60 then return null;end if;
  if clock_parts[4] is not null then
    if hour_value not between 1 and 12 then return null;end if;
    hour_value:=hour_value%12+case when upper(clock_parts[4])='PM' then 12 else 0 end;
  elsif hour_value>23 then return null;end if;
  zone_value:=upper(clock_parts[5]);
  offset_minutes:=case zone_value when 'Z' then 0 when 'UTC' then 0 when 'GMT' then 0 when 'CET' then 60 when 'CEST' then 120 when 'EST' then -300 when 'EDT' then -240 when 'PST' then -480 when 'PDT' then -420 when 'BST' then 60 end;
  if offset_minutes is null then
    zone_value:=regexp_replace(zone_value,'^(UTC|GMT)','');sign_value:=case left(zone_value,1) when '-' then -1 else 1 end;
    zone_value:=replace(substring(zone_value from 2),':','');
    if left(zone_value,2)::integer>14 or right(zone_value,2)::integer>59 or (left(zone_value,2)::integer=14 and right(zone_value,2)::integer<>0) then return null;end if;
    offset_minutes:=sign_value*(left(zone_value,2)::integer*60+right(zone_value,2)::integer);
  end if;
  instant_value:=parsed::timestamp at time zone 'UTC';
  instant_value:=instant_value+make_interval(hours=>hour_value,mins=>minute_value,secs=>second_value::double precision)-make_interval(mins=>offset_minutes);
  return jsonb_build_object('date',parsed,'instant',instant_value);
exception when others then return null;
end $$;

create or replace function public.project_date_value(p_text text) returns date
language sql immutable set search_path=public,pg_temp as $$select (public.project_date_details(p_text)->>'date')::date$$;

create or replace function public.project_source_dates(p_source text,p_kind text) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare line text; normalized text; label text; prefix text; value_text text; details jsonb; chosen jsonb;
  parsed date; earliest date; cutoff timestamptz; earliest_cutoff timestamptz; seen boolean:=false; invalid boolean:=false;
  pending boolean:=false; blanks integer:=0; tokens jsonb:='[]'::jsonb; values_text text[]; cells text[]; cell_index integer;
begin
  label:=case p_kind when 'published' then '(published([ \t]+(on|date))?|posted([ \t]+(on|date))?|publication[ \t]+date|date[ \t]+(published|posted|issued)|issued([ \t]+on)?|notice[ \t]+date|issue[ \t]+date|date[ \t]+of[ \t]+publication)'
    when 'deadline' then '(deadline([ \t]+date)?|closing[ \t]+date|closes([ \t]+on)?|bid[ \t]+closing([ \t]+date)?|proposal[ \t]+deadline|response[ \t]+deadline|submission[ \t]+deadline|applications?[ \t]+close|due[ \t]+date)' else null end;
  if label is null then return jsonb_build_object('has_label',false,'invalid',true,'date',null,'instant',null,'token',null,'tokens',tokens);end if;
  prefix:='^'||label||'([ \t]*(:|[-–])[ \t]*|[ \t]+)';
  for line in select regexp_split_to_table(p_source,E'\r?\n') loop
    normalized:=trim(regexp_replace(line,'^[ \t]*(#{1,6}[ \t]+|[-*][ \t]+)?',''));
    normalized:=trim(replace(normalized,'*',''));
    values_text:='{}';value_text:=null;
    if position('|' in normalized)>0 then
      if pending then invalid:=true;pending:=false;end if;
      cells:=string_to_array(normalized,'|');
      for cell_index in 1..cardinality(cells)-1 loop
        if trim(cells[cell_index])~*('^'||label||'[ \t]*[:–-]?[ \t]*$') then
          seen:=true;values_text:=array_append(values_text,trim(cells[cell_index+1]));
        end if;
      end loop;
    else
      if normalized~*('^'||label||'[ \t]*[:–-]?[ \t]*$') then
        if pending then invalid:=true;end if;seen:=true;pending:=true;blanks:=0;continue;
      elsif normalized~*prefix then
        if pending then invalid:=true;pending:=false;end if;
        seen:=true;value_text:=trim(regexp_replace(normalized,prefix,'','i'));
      elsif pending then
        if normalized='' and blanks<2 then blanks:=blanks+1;continue;end if;
        pending:=false;value_text:=normalized;
      end if;
      if value_text is not null then values_text:=array_append(values_text,value_text);end if;
    end if;
    foreach value_text in array values_text loop
      details:=public.project_date_details(value_text);
      if details is null or position(value_text in p_source)=0 then invalid:=true;continue;end if;
      tokens:=tokens||jsonb_build_array(value_text);parsed:=(details->>'date')::date;
      cutoff:=coalesce((details->>'instant')::timestamptz,((parsed+1)::timestamp at time zone 'UTC')-interval '1 millisecond');
      if earliest is null or (p_kind='published' and parsed<earliest) or (p_kind='deadline' and cutoff<earliest_cutoff) then
        earliest:=parsed;earliest_cutoff:=cutoff;chosen:=details||jsonb_build_object('token',value_text);
      end if;
    end loop;
  end loop;
  if pending then invalid:=true;end if;
  return jsonb_build_object('has_label',seen,'invalid',invalid,'date',earliest,'instant',case when p_kind='deadline' then earliest_cutoff else null end,'token',chosen->>'token','tokens',tokens);
end $$;

create or replace function public.project_country_value(p_text text) returns text
language plpgsql immutable set search_path=public,pg_temp as $$
declare normalized text; value_text text; code text; found_codes text[]:='{}'; cells text[];cell_index integer;label_pattern text;
begin
  if p_text is null or length(p_text)>600 then return null;end if;
  normalized:=replace(p_text,'*','');
  normalized:=regexp_replace(normalized,'^[ \t]*(#{1,6}[ \t]+|[-*][ \t]+)?','');
  if position('|' in normalized)>0 then
    -- Read only adjacent labelled cells; another column's country is not evidence.
    cells:=string_to_array(normalized,'|');
    label_pattern:='^(((buyer|client|project|organi[sz]ation|contracting authority|authority)[ \t]+)?(country|location|address)|headquarters|place of performance)[ \t]*[:–-]?[ \t]*$';
    for cell_index in 1..cardinality(cells)-1 loop
      if trim(cells[cell_index])~*label_pattern then
        code:=public.project_country_value(trim(cells[cell_index])||': '||trim(cells[cell_index+1]));
        if code is not null and not(code=any(found_codes)) then found_codes:=array_append(found_codes,code);end if;
      end if;
    end loop;
    if 'IN'=any(found_codes) then return 'IN';end if;
    return case when cardinality(found_codes)=1 then found_codes[1] else null end;
  end if;
  normalized:=regexp_replace(normalized,'^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$','','g');
  normalized:=regexp_replace(normalized,'[ \t]*\|[ \t]*',': ');
  normalized:=trim(regexp_replace(normalized,'[[:space:]]+',' ','g'));
  if normalized!~*'^(((buyer|client|project|organi[sz]ation|contracting authority|authority) )?(country|location|address)|headquarters|place of performance)([ :–-]+)' then return null;end if;
  value_text:=trim(regexp_replace(normalized,'^(((buyer|client|project|organi[sz]ation|contracting authority|authority) )?(country|location|address)|headquarters|place of performance)[ :–-]+','','i'));
  if value_text~*'(^|[^[:alpha:]])(worldwide|global|anywhere|remote only)([^[:alpha:]]|$)' then return null;end if;
  if normalized~*'country[ :–-]+' and upper(value_text)=any(array['US','GB','CA','AU','AE','DE','FR','NL','IE','NZ','SG','SE','CH','IN']) then return upper(value_text);end if;
  for code in select unnest(array['US','GB','CA','AU','AE','DE','FR','NL','IE','NZ','SG','SE','CH','IN']) loop
    if value_text~*('(^|[^[:alpha:]])'||case code when 'US' then '(United States( of America)?|USA)' when 'GB' then '(United Kingdom|UK|Great Britain|Northern Ireland)' when 'CA' then 'Canada' when 'AU' then 'Australia' when 'AE' then '(United Arab Emirates|UAE)' when 'DE' then '(Germany|Deutschland)' when 'FR' then 'France' when 'NL' then 'Netherlands' when 'IE' then 'Ireland' when 'NZ' then 'New Zealand' when 'SG' then 'Singapore' when 'SE' then 'Sweden' when 'CH' then 'Switzerland' when 'IN' then 'India' end||'([^[:alpha:]]|$)') then
      if code<>'IE' or value_text!~*'Northern Ireland' then found_codes:=array_append(found_codes,code);end if;
    end if;
  end loop;
  if 'IN'=any(found_codes) then return 'IN';end if;
  return case when cardinality(found_codes)=1 then found_codes[1] else null end;
end $$;

-- Preserve the installed 006/007 contact implementation; replace only its date-validation block.
do $migration$
declare definition text; start_at integer; end_at integer; replacement text;
begin
  definition:=pg_get_functiondef('public.save_discovered_project_request(uuid,uuid,text,jsonb)'::regprocedure);
  if position('-- Discovery reliability source validation v8' in definition)=0 then
    start_at:=position('  published_date:=public.project_date_value(posted_token);' in definition);
    end_at:=position('  if source_text~*' in substring(definition from start_at));
    if start_at=0 or end_at=0 then raise exception 'Discovery repair requires migration 006 (and optional 007)';end if;
    replacement:=$block$  -- Discovery reliability source validation v8
  source_dates:=public.project_source_dates(source_text,'published');
  published_date:=public.project_date_value(posted_token);
  if published_date is null or (source_dates->>'invalid')::boolean or not(source_dates->>'has_label')::boolean
    or not(source_dates->'tokens' ? posted_token) or (source_dates->>'date')::date is distinct from published_date then return jsonb_build_object('status','evidence_required');end if;
  published_at:=published_date::timestamp at time zone 'UTC';
  if (public.project_date_details(posted_token)->>'instant')::timestamptz>now() then return jsonb_build_object('status','stale');end if;
  begin
    if (e->>'publishedAt')::timestamptz is distinct from published_at then return jsonb_build_object('status','invalid');end if;
  exception when others then return jsonb_build_object('status','invalid');end;
  deadline_token:=e->>'deadlineText';
  source_dates:=public.project_source_dates(source_text,'deadline');
  if (source_dates->>'invalid')::boolean then return jsonb_build_object('status','evidence_required');end if;
  if deadline_token is not null then
    if length(deadline_token)>100 or position(deadline_token in source_text)=0 or not(source_dates->'tokens' ? deadline_token)
      or deadline_token is distinct from source_dates->>'token' then return jsonb_build_object('status','evidence_required');end if;
    deadline_date:=public.project_date_value(deadline_token);deadline_at:=(source_dates->>'instant')::timestamptz;
    if deadline_date is null or deadline_at is null then return jsonb_build_object('status','evidence_required');end if;
    begin
      if (e->>'deadlineAt')::timestamptz is distinct from deadline_at then return jsonb_build_object('status','invalid');end if;
    exception when others then return jsonb_build_object('status','invalid');end;
  elsif e->>'deadlineAt' is not null or (source_dates->>'has_label')::boolean then return jsonb_build_object('status','evidence_required');end if;
$block$;
    definition:=substring(definition from 1 for start_at-1)||replacement||substring(definition from start_at+end_at-1);
    execute definition;
  end if;
end $migration$;

-- A transient provider failure should not consume the whole daily search interval.
do $migration$
declare definition text; old_text text:='next_run_at=now()+make_interval(hours=>(config.data->>''intervalHours'')::integer)';
begin
  definition:=pg_get_functiondef('public.finish_prospecting_run(uuid,uuid,text,text,jsonb,text,text,integer,jsonb)'::regprocedure);
  if position('-- Discovery transient retry v8' in definition)=0 then
    if position(old_text in definition)=0 then raise exception 'Discovery finish function is not compatible with this repair';end if;
    definition:=replace(definition,old_text,$replacement$next_run_at=now()+case -- Discovery transient retry v8
      when p_status='failed' and p_error_code in ('UNAVAILABLE','RATE_LIMIT') then interval '1 hour'
      else make_interval(hours=>(config.data->>'intervalHours')::integer) end$replacement$);
    execute definition;
  end if;
end $migration$;

create or replace function public.project_discovery_reliability_readiness() returns jsonb
language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('schema_version',case when position('-- Discovery reliability source validation v8' in pg_get_functiondef('public.save_discovered_project_request(uuid,uuid,text,jsonb)'::regprocedure))>0 then 8 else 0 end)
$$;
revoke all on function public.project_date_details(text),public.project_date_value(text),public.project_source_dates(text,text),public.project_country_value(text),public.save_discovered_project_request(uuid,uuid,text,jsonb),public.finish_prospecting_run(uuid,uuid,text,text,jsonb,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.project_date_details(text),public.project_date_value(text),public.project_source_dates(text,text),public.project_country_value(text),public.save_discovered_project_request(uuid,uuid,text,jsonb),public.finish_prospecting_run(uuid,uuid,text,text,jsonb,text,text,integer,jsonb) to service_role;
revoke all on function public.project_discovery_reliability_readiness() from public,anon;
grant execute on function public.project_discovery_reliability_readiness() to authenticated,service_role;
notify pgrst,'reload schema';
commit;
