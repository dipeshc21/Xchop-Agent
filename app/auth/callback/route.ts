import {NextResponse,type NextRequest} from 'next/server';
import {supabaseServer} from '@/lib/supabase/server';
export async function GET(request:NextRequest){const code=request.nextUrl.searchParams.get('code');if(code){const db=await supabaseServer();const {error}=await db.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL('/',request.url));}return NextResponse.redirect(new URL('/login?error=expired',request.url));}
