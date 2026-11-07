import { inngest, dispatchProspectingRun, prospectingEventName, prospectingRequestSchema } from '@/lib/inngest/client';
import { getProspectingReadiness } from '@/lib/prospecting/server-config';
import { queueDueProspectingRun } from '@/lib/prospecting/repository';
import { runProspecting } from '@/lib/prospecting/runner';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { alertFunctions } from '@/lib/alerts/jobs';

async function hunterDatabaseReady() {
  try {
    const { data, error } = await supabaseAdmin().rpc('hunter_discovery_readiness');
    return !error && data?.schema_version === 9;
  } catch { return false; }
}

export const prospectorSchedule = inngest.createFunction({
  id: 'prospector-agent-schedule',
  name: 'ProspectorAgent · hourly schedule',
  triggers: { cron: '0 * * * *' },
  concurrency: 1,
  retries: 2,
}, async ({ step, logger }) => {
  const ownerId = process.env.AUTOMATION_OWNER_ID?.trim() ?? '';
  if (!getProspectingReadiness(ownerId).ready) {
    return { status: 'disabled', message: 'Prospecting connections are incomplete. No providers were called.' };
  }
  if (!await hunterDatabaseReady()) {
    return { status: 'disabled', message: 'Install the Hunter restoration database update 009 before scheduled contact discovery. No providers were called.' };
  }
  const runId = await step.run('ProspectorAgent-queue-due-run', () => queueDueProspectingRun(ownerId));
  if (!runId) return { status: 'idle', message: 'Discovery is paused, not due, or at its configured limit.' };
  await step.run('ProspectorAgent-dispatch-durable-run', () => dispatchProspectingRun(ownerId, runId));
  logger.info('ProspectorAgent dispatched a queued discovery run.');
  return { status: 'queued', runId };
});

export const prospectorAgent = inngest.createFunction({
  id: 'prospector-agent',
  name: 'ProspectorAgent · Hunter verified business contacts',
  triggers: { event: prospectingEventName },
  concurrency: { limit: 1, key: 'event.data.ownerId' },
  retries: 3,
}, async ({ event, step, runId, logger }) => {
  const payload = prospectingRequestSchema.safeParse(event.data);
  if (!payload.success || !getProspectingReadiness(payload.data.ownerId).ready) {
    logger.warn('ProspectorAgent rejected an invalid event or an unconfigured owner.');
    return { status: 'disabled', message: 'No discovery providers were called.' };
  }
  if (!await hunterDatabaseReady()) {
    logger.warn('ProspectorAgent requires the Hunter restoration database update before running.');
    return { status: 'disabled', message: 'Install the Hunter restoration database update 009. No discovery providers were called.' };
  }
  logger.info('ProspectorAgent accepted a configured Hunter contact-discovery run.');
  const result = await runProspecting({
    ownerId: payload.data.ownerId,
    runId: payload.data.runId,
    // One claim token survives this execution's retries. Hourly recovery is a new
    // execution and may reclaim an expired lease. Database guards own deduplication.
    executionId: runId,
  }, {
    async run<T>(id: string, task: () => Promise<T>): Promise<T> {
      // Runner steps return JSON-safe values; the SDK restores those checkpoints on retry.
      return await step.run(id, task) as T;
    },
    async sleep(id: string, milliseconds: number): Promise<void> {
      // Inngest checkpoints this wait; no server process stays awake between polls.
      await step.sleep(id, `${milliseconds}ms`);
    },
  });
  return result;
});

export const prospectingFunctions = [prospectorSchedule, prospectorAgent, ...alertFunctions];
