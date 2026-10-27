import { redirect } from 'next/navigation';
import Workspace from '@/components/workspace';
import { isSupabaseConfigured } from '@/lib/config';
import { defaults, settingsSchema } from '@/lib/schema';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Settings has no dependency on leads, dashboard totals, or later feature tables. */
export default async function SettingsPage() {
  if (!isSupabaseConfigured()) redirect('/setup');
  const db = await supabaseServer();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) redirect('/login');
  const { data, error } = await db.from('settings').select('data').eq('owner_id', user.id).maybeSingle();
  if (error) redirect('/setup?reason=settings');
  const parsed = settingsSchema.safeParse({ ...defaults, ...data?.data });
  return <Workspace
    settingsOnly
    initialSettings={parsed.success ? parsed.data : defaults}
    userEmail={user.email ?? ''}
  />;
}
