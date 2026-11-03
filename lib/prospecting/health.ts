import type { ConnectionCheck, ProspectingConfig, ProspectingRun } from './types';

export type DiscoveryHealth = {
  code: 'paused' | 'configuration' | 'queue_stalled' | 'worker_stalled' | 'queued' | 'running' | 'not_scheduled' | 'overdue' | 'never_run' | 'failed' | 'cancelled' | 'search_not_run' | 'zero_results' | 'verified';
  level: 'attention' | 'waiting' | 'healthy';
  label: string;
  message: string;
  lastSuccessfulRunAt: string | null;
  lastRun: { status: ProspectingRun['status']; requests: number; pages: number; saved: number; finishedAt: string | null } | null;
};

type HealthInput = {
  config: Pick<ProspectingConfig, 'enabled' | 'intervalHours'>;
  readiness: { ready: boolean; checks: Pick<ConnectionCheck, 'label' | 'ready'>[] };
  runs: ProspectingRun[];
  nextRunAt: string | null;
  now?: Date;
};

const graceMs = 90 * 60 * 1000;
function time(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
const failedReasons: Record<string, string> = {
  authentication: 'The search provider rejected its credential. Update the server search key.',
  quota: 'The search account reached its credit allowance. Check the provider account and available credits.',
  rate_limit: 'The search provider asked discovery to slow down. Review the next retry and provider limits.',
  unavailable: 'The search provider was unavailable. Review the run history and next retry.',
  invalid_response: 'The search provider returned an incomplete response. Review the run history before retrying.',
  invalid_input: 'The search targeting could not be validated. Review and save your targeting.',
  database: 'The worker could not save progress. Check the database update and worker configuration.',
  configuration: 'The worker configuration was incomplete. Complete the connection checks.',
  request_uncertain: 'A paid search has no confirmed response. Review its provider usage before retrying.',
  recorded_failure: 'A previous provider attempt failed. Inspect its Inngest step for the cause before retrying.',
  checkpoint_rejected: 'Returned search data did not pass database content checks. Inspect the Inngest step; the paid request was not repeated.',
  checkpoint_unavailable: 'The app could not confirm that a response was saved. Inspect the Inngest step and database access; the paid request was not repeated.',
};

/** Presence of keys is not proof that the hosted scheduler has executed. This
 * assessment uses owner-scoped execution records and never calls a provider. */
export function discoveryHealth({ config, readiness, runs, nextRunAt, now = new Date() }: HealthInput): DiscoveryHealth {
  const current = now.getTime();
  const ordered = [...runs].sort((a, b) => (time(b.created_at) ?? 0) - (time(a.created_at) ?? 0));
  const latest = ordered[0];
  const successful = ordered.filter(run => run.status === 'completed' && (!run.error_code || ['DAILY_LEAD_LIMIT', 'DAILY_REQUEST_LIMIT'].includes(run.error_code.toUpperCase())) && run.request_count > 0 && time(run.finished_at) !== null)
    .sort((a, b) => (time(b.finished_at) ?? 0) - (time(a.finished_at) ?? 0))[0];
  const shared = {
    lastSuccessfulRunAt: successful?.finished_at ?? null,
    lastRun: latest ? { status: latest.status, requests: latest.request_count, pages: latest.companies_found, saved: latest.leads_saved, finishedAt: latest.finished_at } : null,
  };
  function result(code: DiscoveryHealth['code'], level: DiscoveryHealth['level'], label: string, message: string): DiscoveryHealth {
    return { code, level, label, message, ...shared };
  }
  if (!config.enabled) return result('paused', 'attention', 'Discovery is paused',
    'Scheduled searches are switched off. Confirm your targeting and connection checks, then select Start automatic discovery.');
  if (!readiness.ready) {
    const missing = readiness.checks.filter(check => !check.ready).map(check => check.label).join(', ');
    return result('configuration', 'attention', 'Connections need attention',
      `Scheduled searches cannot run until the connection checks are complete.${missing ? ` Pending: ${missing}.` : ''}`);
  }
  const active = ordered.find(run => run.status === 'queued' || run.status === 'running');
  if (active) {
    const started = time(active.status === 'running' ? active.started_at ?? active.created_at : active.created_at);
    if (started !== null && current - started > graceMs) {
      return active.status === 'queued'
        ? result('queue_stalled', 'attention', 'Worker has not started', 'A run has waited more than 90 minutes. Check the Inngest app connection, signed endpoint access and run history. A saved queue entry alone does not confirm a search.')
        : result('worker_stalled', 'attention', 'Run needs attention', 'A run has no recorded completion more than 90 minutes after starting. Inspect its Inngest execution and run history; it may need lease recovery.');
    }
    return active.status === 'queued'
      ? result('queued', 'waiting', 'Waiting for the worker', 'A run is queued. Its search is not confirmed until the worker starts and records progress.')
      : result('running', 'waiting', 'Discovery is running', 'The worker has started a run. Review its completed result to see whether any new project requests qualify.');
  }
  const due = time(nextRunAt);
  if (due === null) return result('not_scheduled', 'attention', 'Next search is not scheduled',
    'Discovery is enabled but has no valid next-run time. Save your targeting again, then run a search. Check the setup guide if the schedule remains missing.');
  if (current - due > graceMs) return result('overdue', 'attention', 'Scheduled search is overdue',
    'The next search is more than 90 minutes overdue with no active run. Check that the hosted Inngest hourly schedule is connected and running. Configured keys alone do not confirm scheduling.');
  if (!latest) return result('never_run', 'waiting', 'First search is not verified',
    `No project-request run is recorded yet. Run discovery now to verify the worker; the saved interval is ${config.intervalHours} hours.`);
  if (latest.status === 'failed') return result('failed', 'attention', 'Last discovery run failed',
    failedReasons[latest.error_code?.toLowerCase() ?? ''] ?? 'The last run did not finish successfully. Review Run history and the Inngest execution before retrying.');
  if (latest.status === 'cancelled') return result('cancelled', 'attention', 'Last discovery run was cancelled',
    'The last run was cancelled, for example after targeting changed or discovery was paused. Confirm the saved targeting and run discovery again.');
  if (latest.request_count < 1) return result('search_not_run', 'attention', 'Last run made no search request',
    'The last run finished without a recorded provider request. Review Run history for a daily limit or setup issue; completion alone does not confirm a search.');
  if (latest.leads_saved < 1) return result('zero_results', 'attention', 'Last search saved no new requests',
    'The search completed but no new project requests were saved. Review Run history for rejected evidence or duplicates. A working schedule does not guarantee new matching requests every day.');
  return result('verified', 'healthy', 'Discovery execution verified',
    `The last run completed and saved ${latest.leads_saved} project ${latest.leads_saved === 1 ? 'request' : 'requests'}. The next search follows your saved ${config.intervalHours}-hour interval.`);
}
