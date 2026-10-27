import { Inngest } from 'inngest';
import { z } from 'zod';
import { isLocalInngestDevelopment } from '@/lib/prospecting/server-config';

export const prospectingRequestSchema = z.object({ ownerId: z.uuid(), runId: z.uuid() }).strict();
export const prospectingEventName = 'growth/prospecting.requested';

export function inngestDevelopmentEnabled() {
  return isLocalInngestDevelopment();
}

export function inngestEndpointStatus() {
  if (process.env.NODE_ENV === 'production' && process.env.INNGEST_DEV?.trim()) {
    return { enabled: false, message: 'Remove INNGEST_DEV from production. Hosted background jobs require signed requests.' };
  }
  if (process.env.NODE_ENV !== 'production' && ['1', 'true'].includes((process.env.INNGEST_DEV ?? '').trim()) && !inngestDevelopmentEnabled()) {
    return { enabled: false, message: 'Local Inngest development requires a localhost APP_URL.' };
  }
  if (!inngestDevelopmentEnabled() && !process.env.INNGEST_SIGNING_KEY?.trim()) {
    return { enabled: false, message: 'Configure the Inngest signing key before connecting hosted background jobs.' };
  }
  return { enabled: true, message: 'Background job handler is configured.' };
}

// Force cloud/signature mode in production, even if an unsafe development variable is present.
export const inngest = new Inngest({
  id: 'xhtmlchop-growth-agent',
  isDev: inngestDevelopmentEnabled(),
  aiMetadata: false,
});

export async function dispatchProspectingRun(ownerId: string, runId: string) {
  const parsed = prospectingRequestSchema.parse({ ownerId, runId });
  if (parsed.ownerId !== process.env.AUTOMATION_OWNER_ID?.trim()) throw new Error('PROSPECTING_OWNER_MISMATCH');
  if (!inngestEndpointStatus().enabled) throw new Error('INNGEST_NOT_CONFIGURED');
  if (!inngestDevelopmentEnabled() && !process.env.INNGEST_EVENT_KEY?.trim()) throw new Error('INNGEST_EVENT_KEY_MISSING');
  try {
    await inngest.send({
      name: prospectingEventName,
      data: parsed,
    });
  } catch {
    // Provider errors may contain request URLs. Never persist an event key in logs.
    throw new Error('INNGEST_DISPATCH_FAILED');
  }
}
