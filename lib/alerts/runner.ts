import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseConfigurationStatus } from '../config';
import { supabaseAdmin } from '../supabase/admin';
import { assertAutomationOwner, getAutomationOwnerId, isLocalInngestDevelopment, serviceRoleConfiguration } from '../prospecting/server-config';
import type { ConnectionCheck } from '../prospecting/types';
import { fetchGoogleAlertsFeed, parseGoogleAlertsFeed, type ParsedAlertFeed } from './feed';
import { AlertImportError, alertErrorMessages, alertFeedInputSchema, type AlertEntry, type AlertErrorCode, type AlertFeedSource } from './types';

export function getAlertReadiness(ownerId: string): { ready: boolean; ownerBound: boolean; checks: ConnectionCheck[] } {
  const publicStatus = supabaseConfigurationStatus();
  const admin = serviceRoleConfiguration();
  const ownerBound = Boolean(getAutomationOwnerId() && getAutomationOwnerId() === ownerId);
  const secret = (name: string) => {
    const value = process.env[name]?.trim() ?? '';
    return value.length >= 20 && !/(?:your[-_ ]|placeholder|example|replace[-_ ]|changeme|dummy|test[-_ ]key)/i.test(value);
  };
  const unsafeDev = process.env.NODE_ENV === 'production' && Boolean(process.env.INNGEST_DEV?.trim());
  const scheduler = !unsafeDev && (isLocalInngestDevelopment() || (secret('INNGEST_EVENT_KEY') && secret('INNGEST_SIGNING_KEY')));
  const checks: ConnectionCheck[] = [
    { id: 'supabase', label: 'Supabase connection', ready: publicStatus.ready, message: publicStatus.message },
    { id: 'server-key', label: 'Server database access', ready: admin.ready, message: admin.message },
    { id: 'owner', label: 'Worker account', ready: ownerBound, message: ownerBound ? 'Alert imports are bound to your signed-in account.' : 'Set AUTOMATION_OWNER_ID to this account’s Supabase Auth user UUID on the server.' },
    { id: 'scheduler', label: 'Alert scheduler', ready: scheduler, message: scheduler
      ? 'The scheduler is configured. Sync the hosted Inngest endpoint to register the separate free-alert functions.'
      : unsafeDev ? 'Remove INNGEST_DEV from production before connecting signed hosted jobs.' : 'Configure the Inngest Event and Signing keys, or run the local Inngest development server.' },
  ];
  return { ready: checks.every(check => check.ready), ownerBound, checks };
}

export type ClaimedAlertFeed = { source: AlertFeedSource; run_id: string; claim_token: string };
export interface AlertRepository {
  ready(): Promise<boolean>;
  sources(ownerId: string): Promise<Pick<AlertFeedSource, 'id' | 'resource_type'>[]>;
  claim(ownerId: string, sourceId: string, token: string, force: boolean): Promise<ClaimedAlertFeed | null>;
  persist(ownerId: string, sourceId: string, token: string, entry: AlertEntry): Promise<{ status: 'saved' | 'duplicate' | 'paused' | 'invalid'; lead_id?: string }>;
  finish(ownerId: string, sourceId: string, token: string, status: 'completed' | 'failed', counts: { entries_seen: number; skipped_count: number }, errorCode: AlertErrorCode | null, message: string): Promise<boolean>;
}
const sourceSchema = alertFeedInputSchema.extend({ id: z.uuid(), owner_id: z.uuid(), version: z.number().int().positive() }).passthrough();
const claimedSchema = z.object({ source: sourceSchema, run_id: z.uuid(), claim_token: z.string().min(16).max(128) });

export function createAlertRepository(client?: SupabaseClient): AlertRepository {
  const db = client ?? supabaseAdmin();
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new AlertImportError('DATABASE_UNAVAILABLE');
    return data;
  }
  const args = (ownerId: string, sourceId: string, token: string) => {
    assertAutomationOwner(ownerId);
    return { p_owner: ownerId, p_source: sourceId, p_claim_token: token };
  };
  return {
    async ready() {
      const { data, error } = await db.rpc('alert_sources_readiness');
      return !error && data?.schema_version === 10;
    },
    async sources(ownerId) {
      assertAutomationOwner(ownerId);
      const { data, error } = await db.from('alert_feed_sources').select('id,resource_type').eq('owner_id', ownerId).eq('enabled', true).order('resource_type').limit(2);
      const parsed = z.array(z.object({ id: z.uuid(), resource_type: z.enum(['google_alerts', 'linkedin_posts']) })).max(2).safeParse(data);
      if (error || !parsed.success) throw new AlertImportError('DATABASE_UNAVAILABLE');
      return parsed.data;
    },
    async claim(ownerId, sourceId, token, force) {
      const data = await rpc('claim_alert_feed', { ...args(ownerId, sourceId, token), p_force: force });
      if (data === null) return null;
      const parsed = claimedSchema.safeParse(data);
      if (!parsed.success || parsed.data.source.owner_id !== ownerId || parsed.data.source.id !== sourceId || parsed.data.claim_token !== token) throw new AlertImportError('DATABASE_UNAVAILABLE');
      return parsed.data;
    },
    async persist(ownerId, sourceId, token, entry) {
      const data = await rpc('persist_alert_lead', { ...args(ownerId, sourceId, token), p_payload: entry });
      const parsed = z.object({ status: z.enum(['saved', 'duplicate', 'paused', 'invalid']), lead_id: z.uuid().optional() }).safeParse(data);
      if (!parsed.success) throw new AlertImportError('DATABASE_UNAVAILABLE');
      return parsed.data;
    },
    async finish(ownerId, sourceId, token, status, counts, errorCode, message) {
      return await rpc('finish_alert_feed', { ...args(ownerId, sourceId, token), p_status: status, p_counts: counts, p_error_code: errorCode, p_message: message }) === true;
    },
  };
}

export type AlertFeedOutcome = { sourceId: string; status: 'completed' | 'failed' | 'idle'; entriesSeen: number; saved: number; skipped: number; errorCode?: AlertErrorCode; message: string };
export type AlertRunOutcome = { status: 'completed' | 'failed' | 'idle' | 'disabled'; saved: number; sources: AlertFeedOutcome[]; message: string };
type AlertStep = { run<T>(id: string, task: () => Promise<T>): Promise<T> };
type RunnerDependencies = {
  repository?: AlertRepository;
  fetchFeed?: (url: string) => Promise<string>;
  now?: Date;
  readiness?: (ownerId: string) => { ready: boolean };
  step?: AlertStep;
};

/** Both sources use owner-created Google RSS feeds. No source page is fetched. */
export async function runAlertFeeds(input: { ownerId: string; executionId: string; force?: boolean }, dependencies: RunnerDependencies = {}): Promise<AlertRunOutcome> {
  try { assertAutomationOwner(input.ownerId); }
  catch { return { status: 'disabled', saved: 0, sources: [], message: 'The alert worker is not bound to this account. No feeds were requested.' }; }
  if (!(dependencies.readiness ?? getAlertReadiness)(input.ownerId).ready) return { status: 'disabled', saved: 0, sources: [], message: 'Complete the alert connection checks. No feeds were requested.' };
  const repository = dependencies.repository ?? createAlertRepository();
  if (!await repository.ready()) return { status: 'disabled', saved: 0, sources: [], message: 'Install migration 010 before importing alerts. No feeds were requested.' };
  const sources = await repository.sources(input.ownerId);
  const step = dependencies.step ?? { async run<T>(_id: string, task: () => Promise<T>) { return task(); } };
  const outcomes: AlertFeedOutcome[] = [];
  for (const source of sources.slice(0, 2)) {
    const token = createHash('sha256').update(`${input.executionId}|${input.ownerId}|${source.id}`).digest('hex');
    const outcome = await step.run(`free-alert-feed-${source.id}`, async (): Promise<AlertFeedOutcome> => {
      const claimed = await repository.claim(input.ownerId, source.id, token, input.force ?? false);
      if (!claimed) return { sourceId: source.id, status: 'idle', entriesSeen: 0, saved: 0, skipped: 0, message: 'The feed is paused, recently checked, not due, or already being processed.' };
      let parsed: ParsedAlertFeed | null = null;
      let saved = 0;
      let skipped = 0;
      try {
        const xml = await (dependencies.fetchFeed ?? fetchGoogleAlertsFeed)(claimed.source.feed_url);
        parsed = parseGoogleAlertsFeed(xml, claimed.source.resource_type, { now: dependencies.now });
        skipped = parsed.skippedCount;
        for (const entry of parsed.entries) {
          const receipt = await repository.persist(input.ownerId, source.id, token, entry);
          if (receipt.status === 'paused') return { sourceId: source.id, status: 'idle', entriesSeen: parsed.entriesSeen, saved, skipped, message: 'The feed changed or was paused; no further results were saved.' };
          if (receipt.status === 'saved') saved++; else skipped++;
        }
        const reasons = Object.entries(parsed.rejections).map(([reason, count]) => `${reason.replaceAll('_', ' ')}: ${count}`).join('; ');
        const message = `Feed checked: ${parsed.entriesSeen} entries reviewed, ${saved} new review-required requests saved.${reasons ? ` Skipped — ${reasons}.` : ''} Open the original source to confirm availability and contact instructions.`;
        const finished = await repository.finish(input.ownerId, source.id, token, 'completed', { entries_seen: parsed.entriesSeen, skipped_count: skipped }, null, message);
        return finished ? { sourceId: source.id, status: 'completed', entriesSeen: parsed.entriesSeen, saved, skipped, message }
          : { sourceId: source.id, status: 'idle', entriesSeen: parsed.entriesSeen, saved, skipped, message: 'The feed changed before its completion was recorded.' };
      } catch (error) {
        const code = error instanceof AlertImportError ? error.code : 'DATABASE_UNAVAILABLE';
        const message = alertErrorMessages[code];
        if (!await repository.finish(input.ownerId, source.id, token, 'failed', { entries_seen: parsed?.entriesSeen ?? 0, skipped_count: skipped }, code, message)) {
          throw new AlertImportError('DATABASE_UNAVAILABLE');
        }
        return { sourceId: source.id, status: 'failed', entriesSeen: parsed?.entriesSeen ?? 0, saved, skipped, errorCode: code, message };
      }
    });
    outcomes.push(outcome);
  }
  const saved = outcomes.reduce((sum, outcome) => sum + outcome.saved, 0);
  const status = outcomes.some(outcome => outcome.status === 'failed') ? 'failed' : outcomes.some(outcome => outcome.status === 'completed') ? 'completed' : 'idle';
  return { status, saved, sources: outcomes, message: status === 'idle' ? 'No enabled alert feeds are due. No Hunter credits were used.' : `Alert checks finished with ${saved} new requests for review. No Hunter credits were used.` };
}
