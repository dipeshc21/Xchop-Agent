import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL('/setup', request.url));
  const code = request.nextUrl.searchParams.get('code');
  if (code) {
    try {
      const db = await supabaseServer();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL('/', request.url));
    } catch {
      // Do not expose provider details or tokens in the redirect URL.
    }
  }
  return NextResponse.redirect(new URL('/login?error=expired', request.url));
}
