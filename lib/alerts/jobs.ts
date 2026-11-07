import { z } from 'zod';
import { inngest, inngestDevelopmentEnabled, inngestEndpointStatus } from '../inngest/client';
import { getAutomationOwnerId } from '../prospecting/server-config';
import { getAlertReadiness, runAlertFeeds } from './runner';

export const alertEventName = 'growth/alerts.requested';
const eventSchema = z.object({ ownerId: z.uuid() }).strict();

export async function dispatchAlertCheck(ownerId: string): Promise<void> {
  const parsed = eventSchema.parse({ ownerId });
  if (getAutomationOwnerId() !== parsed.ownerId || !getAlertReadiness(ownerId).ready || !inngestEndpointStatus().enabled) throw new Error('ALERTS_NOT_CONFIGURED');
  if (!inngestDevelopmentEnabled() && !process.env.INNGEST_EVENT_KEY?.trim()) throw new Error('ALERTS_NOT_CONFIGURED');
  try { await inngest.send({ name: alertEventName, data: parsed }); }
  catch { throw new Error('ALERT_DISPATCH_FAILED'); }
}

export const freeAlertSchedule = inngest.createFunction({
  id: 'free-alerts-schedule', name: 'Free alerts · hourly feed checks',
  triggers: { cron: '0 * * * *' }, concurrency: 1, retries: 2,
}, async ({ step, runId }) => {
  const ownerId = getAutomationOwnerId();
  if (!ownerId) return { status: 'disabled', message: 'Configure the alert worker account. No feeds were requested.' };
  return runAlertFeeds({ ownerId, executionId: runId }, { step: {
    async run<T>(id: string, task: () => Promise<T>) { return await step.run(id, task) as T; },
  } });
});

export const freeAlertAgent = inngest.createFunction({
  id: 'free-alerts-agent', name: 'Free alerts · Google and LinkedIn public requests',
  triggers: { event: alertEventName }, concurrency: { limit: 1, key: 'event.data.ownerId' }, retries: 2,
}, async ({ event, step, runId }) => {
  const parsed = eventSchema.safeParse(event.data);
  if (!parsed.success) return { status: 'disabled', message: 'Invalid alert event. No feeds were requested.' };
  return runAlertFeeds({ ownerId: parsed.data.ownerId, executionId: runId, force: true }, { step: {
    async run<T>(id: string, task: () => Promise<T>) { return await step.run(id, task) as T; },
  } });
});

export const alertFunctions = [freeAlertSchedule, freeAlertAgent];
