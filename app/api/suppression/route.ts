import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { discoveryDatabaseError, discoverySession, readSmallJson } from '../prospecting/support';

export const dynamic = 'force-dynamic';
const suppressionSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  reason: z.enum(['unsubscribed', 'bounced', 'do-not-contact']),
}).strict();

export async function GET() {
  const session = await discoverySession();
  if (session.response) return session.response;
  try {
    const { data, error } = await session.db.from('suppression_list').select('id,email,reason,created_at').eq('owner_id', session.user.id).order('created_at', { ascending: false }).limit(100);
    if (error) return discoveryDatabaseError(error);
    return NextResponse.json({ entries: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return discoveryDatabaseError(null); }
}

export async function POST(request: NextRequest) {
  const session = await discoverySession(request);
  if (session.response) return session.response;
  const body = await readSmallJson(request);
  if (body.response) return body.response;
  const parsed = suppressionSchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid email address and suppression reason.' }, { status: 400 });
  try {
    const { data, error } = await session.db.rpc('suppress_workspace_email', { payload: parsed.data });
    if (error) return discoveryDatabaseError(error);
    return NextResponse.json({ id: data, message: 'This address is suppressed across your workspace.' }, { status: 201 });
  } catch { return discoveryDatabaseError(null); }
}
