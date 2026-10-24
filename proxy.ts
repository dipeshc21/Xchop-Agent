import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';
import {demoMode,publicConfig} from '@/lib/config';
export async function proxy(request:NextRequest){let response=NextResponse.next({request});if(demoMode)return response;const {url,key}=publicConfig();const client=createServerClient(url,key,{cookies:{getAll:()=>request.cookies.getAll(),setAll(values){values.forEach(({name,value})=>request.cookies.set(name,value));response=NextResponse.next({request});values.forEach(({name,value,options})=>response.cookies.set(name,value,options));}}});await client.auth.getUser();return response;}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
