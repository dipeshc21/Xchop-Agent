import { NextResponse, type NextRequest } from 'next/server';
import { alertFeedInputSchema } from '@/lib/alerts/types';
import { getAlertReadiness } from '@/lib/alerts/runner';
import { discoverySession, readSmallJson } from '../prospecting/support';
import { alertDatabaseError, alertMigrationMessage, alertMigrationMissing } from './support';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const sourceColumns = 'id,resource_type,title,feed_url,enabled,next_check_at,last_checked_at,last_success_at,error_code,created_at,updated_at';
const runColumns = 'id,resource_type,status,created_at,finished_at,entries_seen,leads_saved,skipped_count,error_code,message';

export async function GET() {
  const session = await discoverySession();
  if (session.response) return session.response;
  try {
    const readiness = getAlertReadiness(session.user.id);
    const migration = await session.db.rpc('alert_sources_readiness');
    if (migration.error || migration.data?.schema_version !== 10) {
      if (migration.error && !alertMigrationMissing(migration.error)) return alertDatabaseError(migration.error);
      return NextResponse.json({ migrationReady: false, sources: [], runs: [], readiness: {
        ...readiness, ready: false, checks: [...readiness.checks, { id: 'alerts-migration', label: 'Free alert database setup', ready: false, message: alertMigrationMessage }],
      } }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const [sources, runs] = await Promise.all([
      session.db.from('alert_feed_sources').select(sourceColumns).eq('owner_id', session.user.id).order('resource_type'),
      session.db.from('alert_feed_runs').select(runColumns).eq('owner_id', session.user.id).order('created_at', { ascending: false }).limit(20),
    ]);
    if (sources.error || runs.error) return alertDatabaseError(sources.error ?? runs.error);
    return NextResponse.json({ migrationReady: true, readiness, sources: sources.data ?? [], runs: runs.data ?? [] },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return alertDatabaseError(null); }
}

export async function PUT(request: NextRequest) {
  const session = await discoverySession(request);
  if (session.response) return session.response;
  const body = await readSmallJson(request);
  if (body.response) return body.response;
  const parsed = alertFeedInputSchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ error: 'Enter a source title and the RSS feed URL copied from Google Alerts.' }, { status: 400 });
  const readiness = getAlertReadiness(session.user.id);
  if (parsed.data.enabled && !readiness.ready) return NextResponse.json({ error: 'Complete the free-alert connection checks before enabling this feed.', readiness }, { status: 409 });
  try {
    const migration = await session.db.rpc('alert_sources_readiness');
    if (migration.error) return alertDatabaseError(migration.error);
    if (migration.data?.schema_version !== 10) return NextResponse.json({ error: alertMigrationMessage }, { status: 503 });
    const saved = await session.db.rpc('save_alert_feed', { payload: parsed.data });
    if (saved.error) return alertDatabaseError(saved.error);
    if (!saved.data || typeof saved.data.id !== 'string') return alertDatabaseError(null);
    const source = Object.fromEntries(sourceColumns.split(',').map(column => [column, saved.data[column] ?? null]));
    return NextResponse.json({ source, message: parsed.data.enabled ? 'Feed saved and enabled. Check feeds now to import available matching requests.' : 'Feed saved and paused.' });
  } catch { return alertDatabaseError(null); }
}
