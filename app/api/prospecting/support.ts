import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/config';
import { hasSameOrigin } from '@/lib/request';
import { supabaseServer } from '@/lib/supabase/server';

export const migrationMessage = 'Run migration 005_automatic_prospecting.sql using the Lead discovery setup guide, then refresh this page.';
export const runColumns = 'id,owner_id,status,trigger_source,created_at,started_at,finished_at,companies_found,leads_saved,skipped_count,request_count,error_code,message';
type DatabaseError = { code?: string; message?: string } | null;

export function missingMigration(error: DatabaseError) {
  return Boolean(error && ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code ?? ''));
}

export function discoveryDatabaseError(error: DatabaseError) {
  if (missingMigration(error)) return NextResponse.json({ error: migrationMessage }, { status: 503 });
  if (error?.message === 'PROSPECTING_RATE_LIMIT' || error?.message === 'SUPPRESSION_RATE_LIMIT') {
    return NextResponse.json({ error: 'Too many changes in a minute. Wait briefly and try again.' }, { status: 429 });
  }
  if (error?.message === 'PROSPECTING_PAUSED') {
    return NextResponse.json({ error: 'Automatic discovery is paused. Save and enable your targeting first.' }, { status: 409 });
  }
  if (error?.message === 'PROSPECTING_INVALID' || error?.message === 'SUPPRESSION_INVALID') {
    return NextResponse.json({ error: 'Check the submitted fields and try again.' }, { status: 400 });
  }
  return NextResponse.json({ error: 'Discovery could not access your database. Check the connection and database access, then try again.' }, { status: 503 });
}

export async function discoverySession(request?: NextRequest) {
  if (request && !hasSameOrigin(request, process.env.APP_URL?.trim() || undefined)) {
    return { response: NextResponse.json({ error: 'Submit this request from your workspace.' }, { status: 403 }) };
  }
  if (!isSupabaseConfigured()) {
    return { response: NextResponse.json({ error: 'Connect Supabase using the setup guide first.' }, { status: 503 }) };
  }
  try {
    const db = await supabaseServer();
    const { data: { user }, error } = await db.auth.getUser();
    if (error || !user) return { response: NextResponse.json({ error: 'Your session has expired. Sign in and try again.' }, { status: 401 }) };
    return { db, user };
  } catch {
    return { response: NextResponse.json({ error: 'The database connection is unavailable. Try again shortly.' }, { status: 503 }) };
  }
}

export async function readSmallJson(request: NextRequest) {
  if (Number(request.headers.get('content-length') ?? 0) > 20000) return { response: NextResponse.json({ error: 'This request is too large. Shorten the text fields.' }, { status: 413 }) };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 20000) return { response: NextResponse.json({ error: 'This request is too large. Shorten the text fields.' }, { status: 413 }) };
    return { body: JSON.parse(raw) as unknown };
  } catch { return { response: NextResponse.json({ error: 'The form could not be read. Try again.' }, { status: 400 }) }; }
}
