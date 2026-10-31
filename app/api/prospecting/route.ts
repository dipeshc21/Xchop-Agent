import { NextResponse, type NextRequest } from 'next/server';
import { defaultProspectingConfig, prospectingConfigSchema } from '@/lib/prospecting/types';
import { getProspectingReadiness } from '@/lib/prospecting/server-config';
import { discoveryDatabaseError, discoverySession, migrationMessage, missingMigration, readSmallJson, runColumns } from './support';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await discoverySession();
  if (session.response) return session.response;
  const { db, user } = session;
  try {
    const migration = await db.rpc('project_discovery_readiness');
    if (migration.error) {
      if (!missingMigration(migration.error)) return discoveryDatabaseError(migration.error);
      const readiness = getProspectingReadiness(user.id);
      return NextResponse.json({
        config: defaultProspectingConfig, enabled: false, migrationReady: false,
        readiness: { ...readiness, ready: false, checks: [...readiness.checks, { id: 'migration', label: 'Project-request database', ready: false, message: migrationMessage }] },
        runs: [], nextRunAt: null, usage: { requestsToday: 0, leadsToday: 0 },
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (migration.data?.schema_version !== 6) return discoveryDatabaseError(null);
    const [settings, runs, usage] = await Promise.all([
      db.from('prospecting_settings').select('data,next_run_at').eq('owner_id', user.id).maybeSingle(),
      db.from('prospecting_runs').select(runColumns).eq('owner_id', user.id).eq('config_snapshot->>discoveryMode', 'project_requests').order('created_at', { ascending: false }).limit(30),
      db.rpc('prospecting_usage'),
    ]);
    const failures = [settings.error, runs.error, usage.error].filter(Boolean);
    if (failures.length) {
      if (failures.every(missingMigration)) {
        const readiness = getProspectingReadiness(user.id);
        return NextResponse.json({
          config: defaultProspectingConfig, enabled: false, migrationReady: false,
          readiness: { ...readiness, ready: false, checks: [...readiness.checks, { id: 'migration', label: 'Project-request database', ready: false, message: migrationMessage }] },
          runs: [], nextRunAt: null, usage: { requestsToday: 0, leadsToday: 0 },
        });
      }
      return discoveryDatabaseError(failures[0]);
    }
    const parsed = prospectingConfigSchema.safeParse(settings.data?.data ?? defaultProspectingConfig);
    if (!parsed.success || !usage.data || !Number.isSafeInteger(usage.data.requests) || !Number.isSafeInteger(usage.data.project_requests_saved)) {
      return NextResponse.json({ error: 'Project-request settings or usage could not be read. Check database migration 006 and refresh.' }, { status: 503 });
    }
    return NextResponse.json({
      config: parsed.data, enabled: parsed.data.enabled, migrationReady: true,
      readiness: getProspectingReadiness(user.id, parsed.data),
      runs: runs.data ?? [], nextRunAt: settings.data?.next_run_at ?? null,
      usage: { requestsToday: usage.data.requests, leadsToday: usage.data.project_requests_saved, dayStart: usage.data.day_start },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return discoveryDatabaseError(null); }
}

export async function PUT(request: NextRequest) {
  const session = await discoverySession(request);
  if (session.response) return session.response;
  const body = await readSmallJson(request);
  if (body.response) return body.response;
  const parsed = prospectingConfigSchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the discovery targeting and limits.' }, { status: 400 });
  const readiness = getProspectingReadiness(session.user.id, parsed.data);
  if (parsed.data.enabled && !readiness.ready) {
    return NextResponse.json({ error: 'Complete the connection checks before enabling automatic discovery.', readiness }, { status: 409 });
  }
  try {
    const migration = await session.db.rpc('project_discovery_readiness');
    if (migration.error) return discoveryDatabaseError(migration.error);
    if (migration.data?.schema_version !== 6) return discoveryDatabaseError(null);
    const { data, error } = await session.db.rpc('save_prospecting_settings', { payload: parsed.data });
    if (error) return discoveryDatabaseError(error);
    return NextResponse.json({ config: data?.data ?? parsed.data, nextRunAt: data?.next_run_at ?? null });
  } catch { return discoveryDatabaseError(null); }
}
