-- Run once in a new Supabase project's SQL Editor. Never run against an existing app without review.
begin;
create table public.users (id uuid primary key references auth.users(id) on delete cascade, display_name text not null default '', role text not null default 'owner' check (role in ('owner','member')), created_at timestamptz not null default now());
create function public.create_user_profile() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.users(id) values(new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_user_profile();
insert into public.users(id) select id from auth.users on conflict do nothing;
create table public.companies (id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, name text not null, website text, country text, created_at timestamptz not null default now(),unique(id,owner_id));
create table public.leads (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, company_id uuid,company text not null,website text,contact_name text not null default '',email text not null check(email=lower(trim(email))),country text not null,role text,source text not null,lawful_basis text not null,stage text not null default 'New' check(stage in ('New','Qualified','Contacted','Replied','Quote Sent','Negotiation','Won','In Delivery','Delivered','Reviewed','Lost')),score integer not null default 0 check(score between 0 and 100),score_reason text,segment text not null default '',value numeric(12,2) not null default 0 check(value>=0),tags text[] not null default '{}',next_follow_up_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(), unique(owner_id,email),unique(id,owner_id),foreign key(company_id,owner_id) references public.companies(id,owner_id));
create table public.enrichment_data (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,lead_id uuid not null,summary text, data jsonb not null default '{}',created_at timestamptz not null default now(),foreign key(lead_id,owner_id) references public.leads(id,owner_id) on delete cascade);
create table public.sequences (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,name text not null,enabled boolean not null default false,created_at timestamptz not null default now(),unique(id,owner_id));
create table public.sequence_steps (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,sequence_id uuid not null,position integer not null check(position>=0),delay_days integer not null check(delay_days>=0),subject text not null,body text not null,unique(sequence_id,position),foreign key(sequence_id,owner_id) references public.sequences(id,owner_id) on delete cascade);
create table public.email_messages (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,lead_id uuid not null,subject text not null,body text not null,status text not null default 'draft',provider_id text,scheduled_at timestamptz,sent_at timestamptz,created_at timestamptz not null default now(),unique(id,owner_id),foreign key(lead_id,owner_id) references public.leads(id,owner_id) on delete cascade);
create table public.replies (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,lead_id uuid not null,message_id uuid,body text not null,classification text,suggested_response text,created_at timestamptz not null default now(),foreign key(lead_id,owner_id) references public.leads(id,owner_id) on delete cascade,foreign key(message_id,owner_id) references public.email_messages(id,owner_id));
create table public.suppression_list (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,email text not null check(email=lower(trim(email))),reason text not null check(reason in ('unsubscribed','bounced','do-not-contact')),created_at timestamptz not null default now(),unique(owner_id,email));
create table public.quotes (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,lead_id uuid not null,amount numeric(12,2) not null check(amount>=0),currency text not null default 'USD',status text not null default 'draft',line_items jsonb not null default '[]',payment_url text,created_at timestamptz not null default now(),unique(id,owner_id),foreign key(lead_id,owner_id) references public.leads(id,owner_id));
create table public.payments (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,quote_id uuid not null,provider text not null,provider_event_id text not null unique,amount numeric(12,2) not null check(amount>=0),currency text not null,status text not null,created_at timestamptz not null default now(),foreign key(quote_id,owner_id) references public.quotes(id,owner_id));
create table public.projects (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,lead_id uuid not null,quote_id uuid,title text not null,status text not null default 'Awaiting Files' check(status in ('Awaiting Files','In Progress','QA','Delivered','Revision','Closed')),deadline timestamptz,created_at timestamptz not null default now(),unique(id,owner_id),foreign key(lead_id,owner_id) references public.leads(id,owner_id),foreign key(quote_id,owner_id) references public.quotes(id,owner_id));
create table public.project_files (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,project_id uuid not null,storage_path text not null,file_name text not null,kind text not null default 'input',created_at timestamptz not null default now(),foreign key(project_id,owner_id) references public.projects(id,owner_id) on delete cascade);
create table public.tasks (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,lead_id uuid,project_id uuid,title text not null,due_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now(),foreign key(lead_id,owner_id) references public.leads(id,owner_id),foreign key(project_id,owner_id) references public.projects(id,owner_id));
create table public.notes (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,lead_id uuid not null,body text not null,created_at timestamptz not null default now(),foreign key(lead_id,owner_id) references public.leads(id,owner_id) on delete cascade);
create table public.testimonials (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,lead_id uuid,quote text not null,approved boolean not null default false,created_at timestamptz not null default now(),foreign key(lead_id,owner_id) references public.leads(id,owner_id));
create table public.agent_logs (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,agent text not null,input jsonb not null default '{}',output jsonb not null default '{}',status text not null,created_at timestamptz not null default now());
create table public.settings (owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,data jsonb not null default '{"automation":false,"mode":"approval"}',updated_at timestamptz not null default now(),check(coalesce((data->>'automation')::boolean,false)=false and coalesce(data->>'mode','approval')='approval'));
create table public.prompts (id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,agent text not null,content text not null,version integer not null default 1,updated_at timestamptz not null default now(),unique(owner_id,agent));
-- Every row belongs to the signed-in account. Composite foreign keys prevent cross-account links.
do $$ declare t text; begin foreach t in array array['companies','leads','enrichment_data','sequences','sequence_steps','email_messages','replies','suppression_list','quotes','payments','projects','project_files','tasks','notes','testimonials','settings','prompts'] loop
execute format('revoke all on public.%I from anon',t);
execute format('grant select,insert,update,delete on public.%I to authenticated',t);
execute format('alter table public.%I enable row level security',t);
execute format('create policy own_rows on public.%I for all to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()))',t);
execute format('create index on public.%I(owner_id)',t);
end loop; end $$;
alter table public.users enable row level security;
create policy own_profile on public.users for select to authenticated using(id=(select auth.uid()));
alter table public.agent_logs enable row level security;
create policy own_audit_read on public.agent_logs for select to authenticated using(owner_id=(select auth.uid()));
create index on public.agent_logs(owner_id,created_at desc);
create index on public.leads(owner_id,stage);
create index on public.leads(owner_id,created_at desc);
create index on public.leads(owner_id,country);
create index on public.leads(owner_id,next_follow_up_at);
create index on public.email_messages(owner_id,status,scheduled_at);
create index on public.replies(owner_id,lead_id,created_at);
create index on public.projects(owner_id,deadline);
create index on public.tasks(owner_id,due_at) where completed_at is null;
-- Explicit API grants; RLS still applies. Financial and audit records are server-write only.
revoke all on public.agent_logs,public.payments from anon,authenticated;
grant select on public.agent_logs,public.payments to authenticated;
revoke all on public.users from anon,authenticated;
grant select on public.users to authenticated;
revoke all on public.settings from anon,authenticated;
grant select on public.settings to authenticated;
-- Serialized, database-backed rate limit: at most 20 settings saves per minute per account.
create function public.save_workspace_settings(payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); recent integer;
begin
if actor is null then raise exception 'Authentication required'; end if;
perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
select count(*) into recent from public.agent_logs where owner_id=actor and agent='Settings' and created_at>now()-interval '1 minute';
if recent>=20 then raise exception 'Rate limit exceeded'; end if;
if coalesce((payload->>'automation')::boolean,false) or coalesce(payload->>'mode','approval')<>'approval' then raise exception 'Live automation is unavailable in Phase 1'; end if;
insert into public.settings(owner_id,data) values(actor,payload) on conflict(owner_id) do update set data=excluded.data,updated_at=now();
insert into public.agent_logs(owner_id,agent,input,output,status) values(actor,'Settings','{"action":"save"}',jsonb_build_object('mode',payload->>'mode','automation',false),'completed');
end $$;
revoke all on function public.save_workspace_settings(jsonb) from public,anon;
grant execute on function public.save_workspace_settings(jsonb) to authenticated;
-- Private file storage foundation. Client portal access is added in Phase 6.
insert into storage.buckets(id,name,public,file_size_limit) values('project-files','project-files',false,20971520) on conflict(id) do nothing;
create policy own_project_files on storage.objects for all to authenticated using(bucket_id='project-files' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='project-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
commit;
