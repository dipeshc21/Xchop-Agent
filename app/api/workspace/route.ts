import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/config';
import { hasSameOrigin } from '@/lib/request';
import { supabaseServer } from '@/lib/supabase/server';
import { settingsSchema } from '@/lib/schema';

export async function PUT(request: NextRequest) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: 'This request must come from your workspace.' }, { status: 403 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Connect Supabase on the setup page first.' }, { status: 503 });
  if (Number(request.headers.get('content-length') ?? 0) > 20000) {
    return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
  }
  try {
    const db = await supabaseServer();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
    let body: unknown;
    try {
      const raw = await request.text();
      if (raw.length > 20000) return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'The settings request is invalid.' }, { status: 400 });
    }
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Please check your business name, website, email, and daily limit.' }, { status: 400 });
    if (parsed.data.automation || parsed.data.mode !== 'approval') {
      return NextResponse.json({ error: 'Sending automation is not implemented yet. Keep automation off and Approval Mode selected.' }, { status: 400 });
    }
    const { error } = await db.rpc('save_workspace_settings', { payload: parsed.data });
    if (error) {
      const limited = error.code === 'P0001' && error.message.includes('Rate limit');
      return NextResponse.json({ error: limited
        ? 'Too many changes. Please wait a minute.'
        : 'Settings could not be saved. Check the database migration on the setup page.' }, { status: limited ? 429 : 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'We could not reach the database. Please check your connection and try again.' }, { status: 503 });
  }
}
