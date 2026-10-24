import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Complete database setup first.' }, { status: 503 });
  try {
    const db = await supabaseServer();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Sign in to export your records.' }, { status: 401 });
    const { count, error: countError } = await db.from('leads').select('id', { count: 'exact', head: true });
    if (countError) throw countError;
    if ((count ?? 0) > 20000) return NextResponse.json({ error: 'This download supports up to 20,000 leads. Export a larger database from your Supabase dashboard.' }, { status: 413 });
    const leads: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    for (;;) {
      let query = db.from('leads').select('*').order('id').limit(1000);
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error) throw error;
      leads.push(...(data ?? []));
      if (leads.length > 20000) return NextResponse.json({ error: 'The export grew beyond 20,000 leads. Try a database export in Supabase.' }, { status: 413 });
      if (!data?.length) break;
      cursor = data[data.length - 1].id;
    }
    const { data: settings, error } = await db.from('settings').select('data').eq('owner_id', user.id).maybeSingle();
    if (error) throw error;
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), contents: ['leads', 'business_settings'], leads, settings: settings?.data ?? null }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="xhtmlchop-leads-and-settings.json"', 'Cache-Control': 'private, no-store' },
    });
  } catch { return NextResponse.json({ error: 'Export failed. Check your database connection and try again.' }, { status: 503 }); }
}
