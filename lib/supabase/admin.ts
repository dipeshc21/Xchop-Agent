import { createClient } from '@supabase/supabase-js';
import { publicConfig } from '../config';
import { serviceRoleConfiguration } from '../prospecting/server-config';

/** Trusted server workers only. User-facing handlers must use their authenticated RLS client. */
export function supabaseAdmin() {
  if (typeof window !== 'undefined') throw new Error('Server database access is unavailable in the browser.');
  const status = serviceRoleConfiguration();
  if (!status.ready) throw new Error(status.message);
  const { url } = publicConfig();
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
