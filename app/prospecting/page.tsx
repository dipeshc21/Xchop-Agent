import { redirect } from 'next/navigation';
import { isSupabaseConfigured } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';
import ProspectingWorkspace from '@/components/prospecting/workspace';

export const dynamic = 'force-dynamic';
export default async function ProspectingPage() {
  if (!isSupabaseConfigured()) redirect('/setup');
  const db = await supabaseServer();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) redirect('/login');
  return <ProspectingWorkspace userEmail={user.email ?? ''} />;
}
