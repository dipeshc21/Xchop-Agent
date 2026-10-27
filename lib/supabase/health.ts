import { supabaseConfigurationStatus } from '@/lib/config';
import { supabaseServer } from '@/lib/supabase/server';
import {
  classifySetupFailure, classifySetupResult, isSetupSessionFailure, setupCheck, setupTargets,
  type DatabaseCheckId, type SetupCheck, type SetupCheckId,
} from '@/lib/setup-diagnostics';

export type SetupHealth = {
  configured: boolean;
  urlPresent: boolean;
  keyPresent: boolean;
  connection: 'not-configured' | 'not-checked' | 'available' | 'unavailable';
  authenticated: boolean;
  database: 'not-checked' | 'ready' | 'needs-setup';
  message: string;
  checks: SetupCheck[];
};

/** Read-only checks return allowlisted labels, status and bounded codes, never rows or provider text. */
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
    checks: (Object.keys(setupTargets) as SetupCheckId[]).map(id => id === 'configuration'
      ? setupCheck(id, configuration.ready ? 'ready' : 'blocked', configuration.message)
      : setupCheck(id, 'not-checked', 'Connect Supabase and sign in before checking this item.')),
  };
  const replaceCheck = (check: SetupCheck) => {
    health.checks = health.checks.map(existing => existing.id === check.id ? check : existing);
  };
  if (!configuration.ready) return health;
  try {
    const db = await supabaseServer();
    const { data: { user }, error } = await db.auth.getUser();
    if (error) {
      replaceCheck(classifySetupFailure('authentication', error));
      health.connection = isSetupSessionFailure(error) ? 'not-checked' : 'unavailable';
      health.message = isSetupSessionFailure(error)
        ? 'Sign in to verify database access. The connection values are present; database checks have not run.'
        : 'The account check could not finish. Review the result below and retry; do not reinstall the database for an unknown connection error.';
      return health;
    }
    if (!user) {
      replaceCheck(setupCheck('authentication', 'not-checked', 'Sign in with your owner account to check database access.'));
      health.message = 'Connection values are present. Sign in with your owner account to check database access.';
      return health;
    }
    health.connection = 'available';
    health.authenticated = true;
    replaceCheck(setupCheck('authentication', 'ready', 'Your account is signed in and verified. You do not need to sign in again to repair a database check.'));
    const ids = (Object.keys(setupTargets) as SetupCheckId[])
      .filter((id): id is DatabaseCheckId => id !== 'configuration' && id !== 'authentication');
    const checks = await Promise.all(ids.map(async id => {
      try {
        const target = setupTargets[id];
        const result = target.kind === 'rpc'
          ? await db.rpc('workspace_dashboard', { period: 'month' })
          : await db.from(target.table).select(target.column).limit(1);
        return classifySetupResult(id, result);
      } catch (error) {
        return classifySetupFailure(id, error);
      }
    }));
    for (const check of checks) replaceCheck(check);
    const requiredBlocked = checks.some(check => setupTargets[check.id].required && check.status !== 'ready');
    const optionalBlocked = checks.some(check => !setupTargets[check.id].required && check.status !== 'ready');
    health.database = requiredBlocked ? 'needs-setup' : 'ready';
    health.message = requiredBlocked
      ? 'You are signed in. A database check is blocked; review its result below. Settings can still open if its own check is ready.'
      : optionalBlocked
        ? 'The main workspace reads are ready. Some supporting tables need attention; review their results below.'
        : 'You are signed in and the workspace read checks passed. Save a setting and add a lead to verify writes separately.';
    return health;
  } catch (error) {
    health.connection = 'unavailable';
    replaceCheck(classifySetupFailure('authentication', error));
    health.message = 'The connection check could not finish. Refresh and review the result below. No database reinstall is recommended for an unknown error.';
    return health;
  }
}
