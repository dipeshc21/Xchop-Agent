import { supabaseConfigurationStatus } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';

export type SetupHealth = {
  configured: boolean;
  urlPresent: boolean;
  keyPresent: boolean;
  connection: 'not-configured' | 'not-checked' | 'available' | 'unavailable';
  authenticated: boolean;
  database: 'not-checked' | 'ready' | 'needs-setup';
  message: string;
};

/** Read-only readiness check. Keys, tokens and provider error details are never returned. */
export async function inspectSupabaseSetup(): Promise<SetupHealth> {
  const configuration = supabaseConfigurationStatus();
  const health: SetupHealth = {
    configured: configuration.ready,
    urlPresent: configuration.urlPresent,
    keyPresent: configuration.keyPresent,
    connection: configuration.ready ? 'not-checked' : 'not-configured',
    authenticated: false,
    database: 'not-checked',
    message: configuration.message,
  };
  if (!configuration.ready) return health;
  try {
    const db = await supabaseServer();
    const { data: { user }, error } = await db.auth.getUser();
    // Missing session is expected before first sign-in, not a configuration failure.
    if (error && error.name !== 'AuthSessionMissingError') {
      health.connection = 'unavailable';
      health.message = 'Supabase could not verify your session. Check the project URL/key and sign in again.';
      return health;
    }
    if (!user) {
      health.message = 'Connection values are present. Sign in with your owner account to verify database access.';
      return health;
    }
    health.connection = 'available';
    health.authenticated = true;
    const results = await Promise.all([
      db.from('leads').select('id').limit(1),
      db.from('settings').select('owner_id').limit(1),
      db.from('agent_logs').select('id').limit(1),
      db.from('email_messages').select('id').limit(1),
      db.from('replies').select('id').limit(1),
      db.from('payments').select('id').limit(1),
      db.from('projects').select('id').limit(1),
      db.from('tasks').select('id').limit(1),
      db.from('quotes').select('id').limit(1),
      db.rpc('workspace_dashboard', { period: 'month' }),
    ]);
    if (results.some(result => result.error)) {
      health.database = 'needs-setup';
      health.message = 'Sign-in works, but the database tables or dashboard function are not ready. Run every SQL migration in numeric order in Supabase SQL Editor.';
    } else {
      health.database = 'ready';
      health.message = 'You are signed in and the workspace database tables can be read. This check does not test sending, payments, storage uploads, or write permissions.';
    }
    return health;
  } catch {
    health.connection = 'unavailable';
    health.message = 'We could not reach Supabase. Check your network and project connection values, then retry.';
    return health;
  }
}
