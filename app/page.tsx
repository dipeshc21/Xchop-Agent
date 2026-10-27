import { redirect } from 'next/navigation';
import { isSupabaseConfigured } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';
import type { Lead } from '@/lib/models';
import type { DashboardPeriod, DashboardSummary } from '@/lib/dashboard';
import { defaults, settingsSchema } from '@/lib/schema';
import { isReadableDashboardSummary } from '@/lib/setup-diagnostics';
import Workspace from '@/components/workspace';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 50;

type Query = { period?: string | string[]; q?: string | string[]; country?: string | string[]; p?: string | string[]; view?: string | string[] };
const scalar = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? '' : value ?? '';
export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  if (!isSupabaseConfigured()) redirect('/setup');
  const db = await supabaseServer();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) redirect('/login');
  const params = await searchParams;
  const period: DashboardPeriod = ['month', 'week', 'all'].includes(scalar(params.period))
    ? scalar(params.period) as DashboardPeriod : 'month';
  const search = scalar(params.q).trim().slice(0, 100);
  const country = scalar(params.country).trim().slice(0, 100);
  const pageNumber = Math.max(1, Math.min(100000, Number.parseInt(scalar(params.p) || '1', 10) || 1));
  let leadQuery = db.from('leads').select('*', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE - 1);
  if (search) leadQuery = leadQuery.ilike('company', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
  if (country) leadQuery = leadQuery.eq('country', country);
  const [leads, settings, summary] = await Promise.all([
    leadQuery,
    db.from('settings').select('data').eq('owner_id', user.id).maybeSingle(),
    db.rpc('workspace_dashboard', { period }),
  ]);
  if (settings.error) redirect('/setup?reason=settings');
  if (leads.error) redirect('/setup?reason=leads');
  if (summary.error || !isReadableDashboardSummary(summary.data)) redirect('/setup?reason=dashboard');
  if (pageNumber > 1 && (leads.count ?? 0) <= (pageNumber - 1) * PAGE_SIZE) {
    const target = new URLSearchParams({ period, ...(search ? { q: search } : {}), ...(country ? { country } : {}) });
    redirect(`/?${target}`);
  }
  const parsed = settingsSchema.safeParse({ ...defaults, ...settings.data?.data });
  return <Workspace
    initialLeads={(leads.data ?? []).map(row => ({ ...row, value: Number(row.value) })) as Lead[]}
    initialSettings={parsed.success ? parsed.data : defaults}
    summary={summary.data as DashboardSummary}
    period={period} search={search} country={country}
    pageNumber={pageNumber} pageSize={PAGE_SIZE} totalLeads={leads.count ?? 0}
    userEmail={user.email ?? ''}
    initialPage={scalar(params.view).toLowerCase() === 'leads' ? 'Leads' : scalar(params.view).toLowerCase() === 'settings' ? 'Settings' : 'Dashboard'}
  />;
}
