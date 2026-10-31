import { redirect } from 'next/navigation';
import { isSupabaseConfigured } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';
import InquiryWorkspace from '@/components/intent/workspace';

export const dynamic = 'force-dynamic';
type Query = { q?: string | string[]; country?: string | string[]; service?: string | string[]; p?: string | string[] };
const scalar = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? '' : value ?? '';

export default async function InquiriesPage({ searchParams }: { searchParams: Promise<Query> }) {
  if (!isSupabaseConfigured()) redirect('/setup');
  const db = await supabaseServer();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) redirect('/login');
  const params = await searchParams;
  return <InquiryWorkspace userEmail={user.email ?? ''} filters={{
    q: scalar(params.q).trim().slice(0, 100), country: scalar(params.country).trim().toUpperCase(),
    service: scalar(params.service), p: Math.max(1, Math.min(100000, Number.parseInt(scalar(params.p) || '1', 10) || 1)),
  }} />;
}
