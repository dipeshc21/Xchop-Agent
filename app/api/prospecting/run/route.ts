import { NextResponse, type NextRequest } from 'next/server';
import { prospectingConfigSchema } from '@/lib/prospecting/types';
import { getProspectingReadiness } from '@/lib/prospecting/server-config';
import { dispatchProspectingRun } from '@/lib/inngest/client';
import { discoveryDatabaseError, discoverySession } from '../support';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await discoverySession(request);
  if (session.response) return session.response;
  try {
    const migration = await session.db.rpc('project_discovery_readiness');
    if (migration.error) return discoveryDatabaseError(migration.error);
    if (migration.data?.schema_version !== 6) return discoveryDatabaseError(null);
    const settings = await session.db.from('prospecting_settings').select('data').eq('owner_id', session.user.id).maybeSingle();
    if (settings.error) return discoveryDatabaseError(settings.error);
    const parsed = prospectingConfigSchema.safeParse(settings.data?.data);
    if (!parsed.success || !parsed.data.enabled) return NextResponse.json({ error: 'Save your targeting and enable automatic discovery first.' }, { status: 409 });
    if (!getProspectingReadiness(session.user.id, parsed.data).ready) return NextResponse.json({ error: 'Complete the connection checks before starting discovery.' }, { status: 409 });
    const { data: runId, error } = await session.db.rpc('queue_prospecting_run');
    if (error) return discoveryDatabaseError(error);
    if (typeof runId !== 'string') return discoveryDatabaseError(null);
    try {
      await dispatchProspectingRun(session.user.id, runId);
      return NextResponse.json({ runId, status: 'queued', message: 'Discovery is queued. Its actual progress appears in Run history.' }, { status: 202 });
    } catch {
      return NextResponse.json({ runId, status: 'queued', message: 'Your run is saved in the queue, but the scheduler could not receive it. Check Inngest and hosting. The hourly scheduler will retry dispatch.' }, { status: 202 });
    }
  } catch { return discoveryDatabaseError(null); }
}
