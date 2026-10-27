import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSupabaseConfigured } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Connect your database first.' }, { status: 503 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Choose a valid lead.' }, { status: 400 });
  try {
    const db = await supabaseServer();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Sign in to view research.' }, { status: 401 });
    const { data: lead, error: leadError } = await db.from('leads').select('id').eq('owner_id', user.id).eq('id', id).maybeSingle();
    if (leadError) return NextResponse.json({ error: 'Lead access could not be checked.' }, { status: 503 });
    if (!lead) return NextResponse.json({ error: 'This lead is not available in your workspace.' }, { status: 404 });
    const { data, error } = await db.from('enrichment_data').select('summary,data,created_at').eq('owner_id', user.id).eq('lead_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) return NextResponse.json({ error: 'Research could not be loaded.' }, { status: 503 });
    // Project only the normalized fields the review panel needs. Provider credentials
    // and operation request logs are never part of this response.
    const details = data?.data;
    return NextResponse.json({ research: data ? {
      summary: data.summary,
      industry: typeof details?.company?.industry === 'string' ? details.company.industry : '',
      employeeCount: typeof details?.company?.employeeCount === 'number' ? details.company.employeeCount : null,
      timeZone: typeof details?.company?.timeZone === 'string' ? details.company.timeZone : null,
      sources: Array.isArray(details?.sources) ? details.sources.slice(0, 10).map((source: { uri?: unknown; lastSeenOn?: unknown }) => ({
        uri: typeof source?.uri === 'string' ? source.uri : '',
        lastSeenOn: typeof source?.lastSeenOn === 'string' ? source.lastSeenOn : null,
      })) : [],
      aiDraft: typeof details?.aiDraft?.summary === 'string' ? details.aiDraft.summary : null,
    } : null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'The database is unavailable. Please try again.' }, { status: 503 });
  }
}
