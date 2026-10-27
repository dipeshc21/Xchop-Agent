-- Run after migrations 001, 002, and 003. Safe to run again.
-- Restores the API role's existing intended privileges on a hardened/restored project.
-- This does not create missing application objects, change RLS/policies, insert data,
-- or grant direct write access. It cannot change Supabase's exposed-schema setting.
begin;

do $$
declare
  required_tables text[] := array[
    'users', 'companies', 'leads', 'enrichment_data', 'sequences', 'sequence_steps',
    'email_messages', 'replies', 'suppression_list', 'quotes', 'payments', 'projects',
    'project_files', 'tasks', 'notes', 'testimonials', 'agent_logs', 'settings', 'prompts'
  ];
  required_functions text[] := array[
    'public.save_workspace_settings(jsonb)',
    'public.create_workspace_lead(jsonb)',
    'public.update_workspace_lead(jsonb)',
    'public.workspace_dashboard(text)'
  ];
  object_name text;
  missing_tables text[] := '{}';
  missing_functions text[] := '{}';
  unprotected_tables text[] := '{}';
begin
  if not exists(select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'Supabase role authenticated is missing. Run this script in your Supabase project SQL Editor.';
  end if;

  foreach object_name in array required_tables loop
    if to_regclass(format('public.%I', object_name)) is null then
      missing_tables := array_append(missing_tables, 'public.' || object_name);
    elsif not exists(
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = object_name
        and c.relkind in ('r', 'p') and c.relrowsecurity
    ) then
      unprotected_tables := array_append(unprotected_tables, 'public.' || object_name);
    end if;
  end loop;
  foreach object_name in array required_functions loop
    if to_regprocedure(object_name) is null then
      missing_functions := array_append(missing_functions, object_name);
    end if;
  end loop;

  if cardinality(missing_tables) > 0 or cardinality(missing_functions) > 0 then
    raise exception 'Required workspace migrations are incomplete. Missing tables: %. Missing functions: %. Apply the missing migrations 001, 002, and 003 in numeric order before running 004; do not rerun 001 over existing tables.',
      coalesce(nullif(array_to_string(missing_tables, ', '), ''), 'none'),
      coalesce(nullif(array_to_string(missing_functions, ', '), ''), 'none');
  end if;
  if cardinality(unprotected_tables) > 0 then
    raise exception 'Workspace access repair stopped because row-level security is not enabled on: %. Restore the intended migration/policies before granting access.',
      array_to_string(unprotected_tables, ', ');
  end if;

  grant usage on schema public to authenticated;
  foreach object_name in array required_tables loop
    execute format('grant select on table public.%I to authenticated', object_name);
  end loop;
  grant execute on function public.save_workspace_settings(jsonb) to authenticated;
  grant execute on function public.create_workspace_lead(jsonb) to authenticated;
  grant execute on function public.update_workspace_lead(jsonb) to authenticated;
  grant execute on function public.workspace_dashboard(text) to authenticated;
end;
$$;

-- PostgREST normally refreshes automatically; explicitly reload after repaired grants.
notify pgrst, 'reload schema';
commit;
