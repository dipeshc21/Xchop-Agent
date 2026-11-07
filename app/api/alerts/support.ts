import { NextResponse } from 'next/server';

export const alertMigrationMessage = 'Run 010_free_alert_sources.sql from Free alert sources → Setup guide in your existing Supabase project, then refresh. Existing leads and Hunter settings are preserved.';
type DatabaseError = { code?: string; message?: string } | null;

export function alertMigrationMissing(error: DatabaseError) {
  return Boolean(error && ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code ?? ''));
}

export function alertDatabaseError(error: DatabaseError) {
  if (alertMigrationMissing(error)) return NextResponse.json({ error: alertMigrationMessage }, { status: 503 });
  if (error?.message === 'ALERT_RATE_LIMIT') return NextResponse.json({ error: 'Please wait a minute before changing the feed again.' }, { status: 429 });
  if (error?.message === 'ALERT_INVALID') return NextResponse.json({ error: 'Check the source title and the RSS feed URL copied from Google Alerts.' }, { status: 400 });
  return NextResponse.json({ error: 'Alert sources could not access your database. Check the connection and setup update, then try again.' }, { status: 503 });
}
