import { NextResponse, type NextRequest } from 'next/server';
import { prospectingConfigSchema } from '@/lib/prospecting/types';
import { getProspectingReadiness } from '@/lib/prospecting/server-config';
import { dispatchProspectingRun } from '@/lib/inngest/client';
import { discoveryDatabaseError, discoverySession, migrationMessage } from '../support';

export const runtime = 'nodejs';

/** An explicit owner action restores Hunter targeting and starts a run. */
export async function POST(request: NextRequest) {
  const session = await discoverySession(request);
  if (session.response) return session.response;
  try {
    const migration = await session.db.rpc('hunter_discovery_readiness');
    if (migration.error) return discoveryDatabaseError(migration.error);
    if (migration.data?.schema_version !== 9) return NextResponse.json({ error: migrationMessage }, { status: 503 });
    const preview = await session.db.rpc('hunter_restoration_config');
    if (preview.error) return discoveryDatabaseError(preview.error);
    const parsed = prospectingConfigSchema.safeParse({ ...preview.data, enabled: true });
    if (!parsed.success || parsed.data.discoveryMode !== 'company_contacts') return NextResponse.json({ error: 'Record your collection basis in Hunter targeting before restoring discovery.' }, { status: 409 });
    const readiness = getProspectingReadiness(session.user.id, parsed.data);
    if (!readiness.ready) return NextResponse.json({ error: 'Complete the Hunter connection checks before restoring discovery.', readiness }, { status: 409 });
    const restored = await session.db.rpc('restore_hunter_discovery');
    if (restored.error) return discoveryDatabaseError(restored.error);
    const confirmed = prospectingConfigSchema.safeParse(restored.data?.data);
    if (!confirmed.success || confirmed.data.discoveryMode !== 'company_contacts' || !confirmed.data.enabled) return discoveryDatabaseError(null);
    const { data: runId, error } = await session.db.rpc('queue_prospecting_run');
    if (error) return discoveryDatabaseError(error);
    if (typeof runId !== 'string') return discoveryDatabaseError(null);
    try {
      await dispatchProspectingRun(session.user.id, runId);
      return NextResponse.json({ runId, status: 'queued', message: 'Hunter discovery restored and queued. Check Run history for actual results.' }, { status: 202 });
    } catch {
      return NextResponse.json({ runId, status: 'queued', message: 'Hunter settings are restored and the run is saved. Check Inngest delivery; the hourly scheduler will retry dispatch.' }, { status: 202 });
    }
  } catch { return discoveryDatabaseError(null); }
}
