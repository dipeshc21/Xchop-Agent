import { NextResponse, type NextRequest } from 'next/server';
import { getAlertReadiness } from '@/lib/alerts/runner';
import { dispatchAlertCheck } from '@/lib/alerts/jobs';
import { discoverySession } from '../../prospecting/support';
import { alertDatabaseError, alertMigrationMessage } from '../support';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await discoverySession(request);
  if (session.response) return session.response;
  const readiness = getAlertReadiness(session.user.id);
  if (!readiness.ready) return NextResponse.json({ error: 'Complete the free-alert connection checks first.', readiness }, { status: 409 });
  try {
    const migration = await session.db.rpc('alert_sources_readiness');
    if (migration.error) return alertDatabaseError(migration.error);
    if (migration.data?.schema_version !== 10) return NextResponse.json({ error: alertMigrationMessage }, { status: 503 });
    const sources = await session.db.from('alert_feed_sources').select('id').eq('owner_id', session.user.id).eq('enabled', true).limit(2);
    if (sources.error) return alertDatabaseError(sources.error);
    if (!sources.data?.length) return NextResponse.json({ error: 'Save and enable at least one Google Alerts RSS feed first.' }, { status: 409 });
    try { await dispatchAlertCheck(session.user.id); }
    catch { return NextResponse.json({ error: 'The feed check could not reach Inngest. Check the hosted scheduler connection and try again.' }, { status: 503 }); }
    return NextResponse.json({ status: 'queued', message: 'Feed check requested. Results appear in import history after the worker runs. Checks less than two minutes apart are skipped.' }, { status: 202 });
  } catch { return alertDatabaseError(null); }
}
