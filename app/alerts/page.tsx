import { redirect } from 'next/navigation';
import AlertsWorkspace from '@/components/alerts/workspace';
import { isSupabaseConfigured } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AlertsPage() {
  if (!isSupabaseConfigured()) redirect('/setup');
  const db = await supabaseServer();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) redirect('/login');
  return <AlertsWorkspace userEmail={user.email ?? ''} />;
}
