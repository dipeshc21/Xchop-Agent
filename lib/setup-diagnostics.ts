/** Allowlisted diagnostic targets. Provider text and row data never enter a setup report. */
export const setupTargets = {
  configuration: { label: 'Supabase connection values', required: true, kind: 'configuration' },
  authentication: { label: 'Signed-in account', required: true, kind: 'authentication' },
  leads: { label: 'Lead records', required: true, kind: 'table', table: 'leads', column: 'id' },
  settings: { label: 'Business settings', required: true, kind: 'table', table: 'settings', column: 'owner_id' },
  dashboard: { label: 'Dashboard summary function', required: true, kind: 'rpc' },
  agent_logs: { label: 'Activity log table', required: false, kind: 'table', table: 'agent_logs', column: 'id' },
  email_messages: { label: 'Email records table', required: false, kind: 'table', table: 'email_messages', column: 'id' },
  replies: { label: 'Reply records table', required: false, kind: 'table', table: 'replies', column: 'id' },
  payments: { label: 'Payment records table', required: false, kind: 'table', table: 'payments', column: 'id' },
  projects: { label: 'Project records table', required: false, kind: 'table', table: 'projects', column: 'id' },
  tasks: { label: 'Task records table', required: false, kind: 'table', table: 'tasks', column: 'id' },
  quotes: { label: 'Quote records table', required: false, kind: 'table', table: 'quotes', column: 'id' },
} as const;

export type SetupCheckId = keyof typeof setupTargets;
export type DatabaseCheckId = Exclude<SetupCheckId, 'configuration' | 'authentication'>;
export type SetupCheck = {
  id: SetupCheckId;
  label: string;
  status: 'ready' | 'blocked' | 'not-checked';
  code?: string;
  message: string;
  migration?: string;
};

export const ACCESS_REPAIR_MIGRATION = '004_restore_workspace_access.sql';
const authCodes = new Set([
  'PGRST301', 'PGRST302', 'PGRST303', '28000', '28P01',
  'bad_jwt', 'invalid_jwt', 'session_expired', 'session_not_found',
  'refresh_token_not_found', 'refresh_token_already_used', 'invalid_grant',
]);

type ProviderError = { code?: unknown; name?: unknown; status?: unknown };
function errorFields(error: unknown): ProviderError {
  return error && typeof error === 'object' ? error as ProviderError : {};
}

/** SQLSTATE and PostgREST codes are bounded identifiers; free-form provider text is omitted. */
export function safeSetupErrorCode(error: unknown): string | undefined {
  const value = errorFields(error).code;
  return typeof value === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(value) ? value : undefined;
}

export function isSetupSessionFailure(error: unknown) {
  const value = errorFields(error);
  return value.name === 'AuthSessionMissingError' || value.status === 401 ||
    (typeof value.code === 'string' && authCodes.has(value.code));
}

export function setupCheck(id: SetupCheckId, status: SetupCheck['status'], message: string): SetupCheck {
  return { id, label: setupTargets[id].label, status, message };
}

export function classifySetupFailure(id: SetupCheckId, error: unknown): SetupCheck {
  const check = setupCheck(id, 'blocked', 'This check could not finish. Refresh the status and check your connection. If it continues, share the check name and error code shown here. Do not rerun the foundation migration to fix an unknown error.');
  const code = safeSetupErrorCode(error);
  if (code) check.code = code;
  if (isSetupSessionFailure(error)) {
    check.message = 'The session could not be verified for this check. Sign in again if your session has expired, then refresh the status. Database installation is not the fix for a session error.';
    return check;
  }
  if (code === 'PGRST106') {
    check.message = 'The database API is not exposing the public schema. In Supabase, open Integrations → Data API and include public in the exposed schemas, while keeping row-level security enabled. Refresh the connection checks afterward.';
    return check;
  }
  if (code === '42501') {
    check.message = 'Database permissions block this check. After migrations 001–003 are installed, run the additive access-repair migration in Supabase SQL Editor, then refresh. It restores required access without replacing your tables or records.';
    check.migration = ACCESS_REPAIR_MIGRATION;
    return check;
  }
  if (id === 'dashboard' && (code === 'PGRST202' || code === '42883')) {
    check.message = 'The dashboard function is missing or is not visible to the database API. If migration 003 has not run, run it once. If it already ran, use the additive access-repair migration to restore execution access and refresh the API schema cache.';
    check.migration = '003_dashboard_summary.sql';
    return check;
  }
  if (code === '42P01' || code === 'PGRST205') {
    check.message = id === 'dashboard'
      ? 'The dashboard function depends on a table that is missing or not visible to the API. Check the table results below. For a new empty project, install migration 001 once, then the later migrations in order. For an existing project, do not rerun 001; repair the missing object or access instead.'
      : 'This table is missing or is not visible to the database API. For a new empty project, install migration 001 once, then the later migrations in order. For an existing project, do not rerun 001; check whether the table exists and use the additive access repair if the table is present.';
    check.migration = '001_foundation.sql';
    return check;
  }
  return check;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function nonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** An error-free but null/incomplete function response is not a working dashboard. */
export function isReadableDashboardSummary(value: unknown): boolean {
  if (!record(value)) return false;
  if (!['leadCount', 'sentCount', 'replyRate', 'wonCount', 'pipelineValue', 'quoteCount']
    .every(name => nonNegativeNumber(value[name]))) return false;
  if ((value.replyRate as number) > 100) return false;
  if (!Array.isArray(value.revenue) || !value.revenue.every(item => record(item) && typeof item.currency === 'string' && nonNegativeNumber(item.amount))) return false;
  if (!Array.isArray(value.funnel) || !value.funnel.every(item => record(item) && typeof item.stage === 'string' && nonNegativeNumber(item.count))) return false;
  if (!Array.isArray(value.markets) || !value.markets.every(item => record(item) && typeof item.country === 'string' && nonNegativeNumber(item.count))) return false;
  return Array.isArray(value.attention) && value.attention.every(item => record(item) &&
    typeof item.id === 'string' && typeof item.title === 'string' && typeof item.detail === 'string' &&
    ['task', 'project'].includes(item.kind as string) && typeof item.due_at === 'string');
}

export function classifySetupResult(id: DatabaseCheckId, result: { data?: unknown; error?: unknown }): SetupCheck {
  if (result.error) return classifySetupFailure(id, result.error);
  const readable = id === 'dashboard' ? isReadableDashboardSummary(result.data) : Array.isArray(result.data);
  if (!readable) {
    return setupCheck(id, 'blocked', id === 'dashboard'
      ? 'The dashboard function returned no usable summary. Refresh once; if this continues, check migration 003. An empty workspace should still return a complete summary with zero totals.'
      : 'The table check returned no readable result. Refresh and check your connection; this response does not prove the table is ready.');
  }
  return setupCheck(id, 'ready', id === 'dashboard'
    ? 'The dashboard function returned a complete summary for your signed-in account.'
    : 'Your signed-in account can read this table. An empty table is valid.');
}

const reasons = {
  database: 'The dashboard could not finish loading database records. The checks below identify which part needs attention.',
  dashboard: 'The dashboard summary could not load. You can still open Settings when its table check is ready.',
  settings: 'Business settings could not be read. Check the settings result below.',
  leads: 'Lead records could not be read. Check the lead records result below.',
  configuration: 'The app needs valid Supabase connection values before it can load your workspace.',
  connection: 'The app could not complete a connection check. Refresh and review the results below.',
} as const;

/** Only fixed reason text is reflected into the UI; URLs cannot inject provider details. */
export function setupReasonMessage(value: unknown): string | null {
  return typeof value === 'string' && Object.hasOwn(reasons, value)
    ? reasons[value as keyof typeof reasons] : null;
}
