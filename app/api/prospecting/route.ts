import { NextResponse, type NextRequest } from 'next/server';
import { defaultProspectingConfig, prospectingConfigSchema } from '@/lib/prospecting/types';
import { getProspectingReadiness } from '@/lib/prospecting/server-config';
import { discoveryHealth } from '@/lib/prospecting/health';
import { discoveryDatabaseError, discoverySession, migrationMessage, missingMigration, readSmallJson, runColumns } from './support';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await discoverySession();
  if (session.response) return session.response;
  const { db, user } = session;
  try {
    const migration = await db.rpc('hunter_discovery_readiness');
    if (migration.error || migration.data?.schema_version !== 9) {
      if (migration.error && !missingMigration(migration.error)) return discoveryDatabaseError(migration.error);
      const readiness = getProspectingReadiness(user.id);
      return NextResponse.json({
        provider: 'hunter', config: defaultProspectingConfig, enabled: false, migrationReady: false, restorationPending: true,
        readiness: { ...readiness, ready: false, checks: [...readiness.checks, { id: 'migration', label: 'Hunter database restoration', ready: false, message: migrationMessage }] },
        runs: [], nextRunAt: null, usage: { requestsToday: 0, leadsToday: 0 },
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const [settings, runs, usage] = await Promise.all([
      db.from('prospecting_settings').select('data,next_run_at').eq('owner_id', user.id).maybeSingle(),
      db.from('prospecting_runs').select(runColumns).eq('owner_id', user.id)
        .or('config_snapshot->>discoveryMode.is.null,config_snapshot->>discoveryMode.eq.company_contacts')
        .order('created_at', { ascending: false }).limit(30),
      db.rpc('prospecting_usage'),
    ]);
    const failure = [settings.error, runs.error, usage.error].find(Boolean);
    if (failure) return discoveryDatabaseError(failure);
    const restorationPending = settings.data?.data?.discoveryMode === 'project_requests';
    let config = settings.data?.data ?? defaultProspectingConfig;
    if (restorationPending) {
      const preview = await db.rpc('hunter_restoration_config');
      if (preview.error) return discoveryDatabaseError(preview.error);
      config = preview.data;
    }
    const parsed = prospectingConfigSchema.safeParse(config);
    if (!parsed.success || parsed.data.discoveryMode !== 'company_contacts' || !usage.data ||
      !Number.isSafeInteger(usage.data.requests) || !Number.isSafeInteger(usage.data.company_leads_saved)) {
      return NextResponse.json({ error: 'Hunter settings or usage could not be read. Check restoration migration 009 and refresh.' }, { status: 503 });
    }
    const enabled = !restorationPending && parsed.data.enabled;
    const readiness = getProspectingReadiness(user.id, parsed.data);
    const nextRunAt = enabled ? settings.data?.next_run_at ?? null : null;
    return NextResponse.json({
      provider: 'hunter', config: parsed.data, enabled, migrationReady: true, restorationPending, readiness,
      health: discoveryHealth({ config: { ...parsed.data, enabled }, readiness, runs: runs.data ?? [], nextRunAt }),
      runs: runs.data ?? [], nextRunAt,
      usage: { requestsToday: usage.data.requests, leadsToday: usage.data.company_leads_saved, dayStart: usage.data.day_start },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return discoveryDatabaseError(null); }
}

export async function PUT(request: NextRequest) {
  const session = await discoverySession(request);
  if (session.response) return session.response;
  const body = await readSmallJson(request);
  if (body.response) return body.response;
  const parsed = prospectingConfigSchema.safeParse(body.body);
  if (!parsed.success || parsed.data.discoveryMode !== 'company_contacts') return NextResponse.json({ error: 'Check the Hunter targeting and limits.' }, { status: 400 });
  const readiness = getProspectingReadiness(session.user.id, parsed.data);
  if (parsed.data.enabled && !readiness.ready) {
    return NextResponse.json({ error: 'Complete the Hunter connection checks before enabling automatic discovery.', readiness }, { status: 409 });
  }
  try {
    const migration = await session.db.rpc('hunter_discovery_readiness');
    if (migration.error) return discoveryDatabaseError(migration.error);
    if (migration.data?.schema_version !== 9) return NextResponse.json({ error: migrationMessage }, { status: 503 });
    const { data, error } = await session.db.rpc('save_prospecting_settings', { payload: parsed.data });
    if (error) return discoveryDatabaseError(error);
    return NextResponse.json({ config: data?.data ?? parsed.data, nextRunAt: data?.next_run_at ?? null });
  } catch { return discoveryDatabaseError(null); }
}
