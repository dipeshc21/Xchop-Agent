import { NextResponse } from 'next/server';
import { inspectSupabaseSetup } from '@/lib/supabase/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await inspectSupabaseSetup(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
