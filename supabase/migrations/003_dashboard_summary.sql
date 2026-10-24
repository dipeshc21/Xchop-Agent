-- Live dashboard aggregates. Run after 001_foundation.sql and 002_live_workspace.sql.
-- Calendar-month reporting uses UTC. "week" means the preceding seven rolling days.
-- Current stage, market, won-lead, and pipeline totals are all-time snapshots.
-- Only created leads, sends, created quotes, and completed payments use the selected period.
begin;

create or replace function public.workspace_dashboard(period text default 'month')
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  period_start timestamptz;
  result jsonb;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if period not in ('month', 'week', 'all') or period is null then
    raise exception 'Invalid reporting period' using errcode = '22023';
  end if;
  period_start := case period
    when 'month' then date_trunc('month', timezone('UTC', now())) at time zone 'UTC'
    when 'week' then now() - interval '7 days'
    else '-infinity'::timestamptz
  end;

  with sent_cohort as (
    select e.lead_id, min(e.sent_at) as first_sent_at
    from public.email_messages e
    where e.owner_id = actor and e.sent_at >= period_start and e.sent_at <= now()
    group by e.lead_id
  ), replied_cohort as (
    select s.lead_id
    from sent_cohort s
    where exists (
      select 1 from public.replies r
      where r.owner_id = actor and r.lead_id = s.lead_id
        and r.created_at >= s.first_sent_at and r.created_at <= now()
    )
  ), stage_list as (
    select stage, position from unnest(array[
      'New', 'Qualified', 'Contacted', 'Replied', 'Quote Sent', 'Negotiation',
      'Won', 'In Delivery', 'Delivered', 'Reviewed', 'Lost'
    ]) with ordinality as s(stage, position)
  ), stage_counts as (
    select s.stage, s.position, count(l.id) as count
    from stage_list s
    left join public.leads l on l.owner_id = actor and l.stage = s.stage
    group by s.stage, s.position
  ), market_counts as (
    select l.country, count(*) as count from public.leads l
    where l.owner_id = actor
    group by l.country
  ), revenue_totals as (
    select upper(p.currency) as currency, sum(p.amount) as amount
    from public.payments p
    where p.owner_id = actor and p.status in ('succeeded', 'paid', 'completed')
      and p.created_at >= period_start and p.created_at <= now()
    group by upper(p.currency)
  ), attention_items as (
    select t.id::text as id, t.title,
      case when t.due_at < now() then 'Task overdue' else 'Task due soon' end as detail,
      'task'::text as kind, t.due_at
    from public.tasks t
    where t.owner_id = actor and t.completed_at is null
      and t.due_at <= now() + interval '7 days'
    union all
    select p.id::text as id, p.title,
      case when p.deadline < now() then 'Project overdue' else 'Project due soon' end as detail,
      'project'::text as kind, p.deadline as due_at
    from public.projects p
    where p.owner_id = actor and p.status not in ('Closed', 'Delivered')
      and p.deadline <= now() + interval '7 days'
  ), attention_limited as (
    select * from attention_items order by due_at, kind, id limit 10
  )
  select jsonb_build_object(
    'leadCount', (select count(*) from public.leads l where l.owner_id = actor
      and l.created_at >= period_start and l.created_at <= now()),
    'sentCount', (select count(*) from public.email_messages e where e.owner_id = actor
      and e.sent_at >= period_start and e.sent_at <= now()),
    'replyRate', coalesce(round(
      100.0 * (select count(*) from replied_cohort)
      / nullif((select count(*) from sent_cohort), 0), 1), 0),
    'wonCount', (select count(*) from public.leads l where l.owner_id = actor
      and l.stage in ('Won', 'In Delivery', 'Delivered', 'Reviewed')),
    'pipelineValue', (select coalesce(sum(l.value), 0) from public.leads l where l.owner_id = actor
      and l.stage not in ('Won', 'In Delivery', 'Delivered', 'Reviewed', 'Lost')),
    'revenue', coalesce((select jsonb_agg(jsonb_build_object('currency', r.currency, 'amount', r.amount)
      order by r.currency) from revenue_totals r), '[]'::jsonb),
    'quoteCount', (select count(*) from public.quotes q where q.owner_id = actor
      and q.created_at >= period_start and q.created_at <= now()),
    'funnel', (select jsonb_agg(jsonb_build_object('stage', s.stage, 'count', s.count)
      order by s.position) from stage_counts s),
    'markets', coalesce((select jsonb_agg(jsonb_build_object('country', m.country, 'count', m.count)
      order by m.count desc, m.country) from market_counts m), '[]'::jsonb),
    'attention', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'detail', a.detail, 'kind', a.kind, 'due_at', a.due_at)
      order by a.due_at, a.kind, a.id) from attention_limited a), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.workspace_dashboard(text) from public, anon;
grant execute on function public.workspace_dashboard(text) to authenticated;

create index if not exists email_messages_owner_sent_idx
  on public.email_messages(owner_id, sent_at, lead_id) where sent_at is not null;
create index if not exists payments_owner_created_idx on public.payments(owner_id, created_at);
create index if not exists quotes_owner_created_idx on public.quotes(owner_id, created_at);
commit;
