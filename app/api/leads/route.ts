import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/config';
import { hasSameOrigin } from '@/lib/request';
import { leadSchema, leadUpdateSchema } from '@/lib/lead-schema';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: 'Please submit this form from your workspace.' }, { status: 403 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Connect Supabase using the setup guide before adding leads.' }, { status: 503 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 20000) {
    return NextResponse.json({ error: 'This lead is too large. Shorten the text fields.' }, { status: 413 });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 20000) {
      return NextResponse.json({ error: 'This lead is too large. Shorten the text fields.' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'The lead form could not be read. Please try again.' }, { status: 400 });
  }
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the company, email, country, source, contact permission note, and value.' }, { status: 400 });
  }
  try {
    const db = await supabaseServer();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Your session has expired. Sign in and try again.' }, { status: 401 });
    }
    const { data, error } = await db.rpc('create_workspace_lead', { payload: parsed.data }).single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A lead with this email already exists in your workspace.' }, { status: 409 });
      }
      if (error.message === 'LEAD_RATE_LIMIT') {
        return NextResponse.json({ error: 'You have added 30 leads in a minute. Please wait before adding another.' }, { status: 429 });
      }
      if (error.message === 'LEAD_INDIA_EXCLUDED') {
        return NextResponse.json({ error: 'India is excluded from targeting. Change this preference in Settings if appropriate.' }, { status: 422 });
      }
      if (error.message === 'LEAD_SUPPRESSED') {
        return NextResponse.json({ error: 'This email is on your do-not-contact, unsubscribe, or bounce list.' }, { status: 422 });
      }
      if (error.message === 'LEAD_INVALID') {
        return NextResponse.json({ error: 'Check the lead fields and try again.' }, { status: 400 });
      }
      if (error.code === 'PGRST202' || error.code === '42883') {
        return NextResponse.json({ error: 'Run database migration 002_live_workspace.sql in Supabase, then refresh this page.' }, { status: 503 });
      }
      return NextResponse.json({ error: 'The lead could not be saved. Check your database connection and try again.' }, { status: 500 });
    }
    return NextResponse.json({ lead: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'The database is unavailable. Please try again shortly.' }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: 'Please submit this form from your workspace.' }, { status: 403 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Connect Supabase using the setup guide before updating leads.' }, { status: 503 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 20000) {
    return NextResponse.json({ error: 'This update is too large.' }, { status: 413 });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 20000) {
      return NextResponse.json({ error: 'This update is too large.' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'The update could not be read. Please try again.' }, { status: 400 });
  }
  const parsed = leadUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose a valid lead stage and a non-negative opportunity value.' }, { status: 400 });
  }
  try {
    const db = await supabaseServer();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Your session has expired. Sign in and try again.' }, { status: 401 });
    }
    const { data, error } = await db.rpc('update_workspace_lead', { payload: parsed.data }).single();
    if (error) {
      if (error.message === 'LEAD_NOT_FOUND') {
        return NextResponse.json({ error: 'This lead is not available in your workspace.' }, { status: 404 });
      }
      if (error.message === 'LEAD_RATE_LIMIT') {
        return NextResponse.json({ error: 'You have updated 30 leads in a minute. Please wait before making another change.' }, { status: 429 });
      }
      if (error.message === 'LEAD_INVALID') {
        return NextResponse.json({ error: 'Choose a valid lead stage and opportunity value.' }, { status: 400 });
      }
      if (error.code === 'PGRST202' || error.code === '42883') {
        return NextResponse.json({ error: 'Run database migration 002_live_workspace.sql in Supabase, then refresh this page.' }, { status: 503 });
      }
      return NextResponse.json({ error: 'The update could not be saved. Please try again.' }, { status: 500 });
    }
    return NextResponse.json({ lead: data });
  } catch {
    return NextResponse.json({ error: 'The database is unavailable. Please try again shortly.' }, { status: 503 });
  }
}
