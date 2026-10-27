import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../supabase/admin';
import { assertAutomationOwner } from './server-config';
import type { CompanyFacts, EmailVerification, FitScore, FoundContact, ProspectingConfig, ProspectingRun, RunStatus } from './types';

export type ClaimedRun = {
  run: ProspectingRun; config: ProspectingConfig; config_version: number;
  search_index: number; cursors: Record<string, number>; claim_token: string;
};
export type Reservation = {
  status: 'reserved' | 'cached' | 'uncertain' | 'budget_exhausted' | 'paused';
  result?: unknown; reason?: string;
};
export type PersistPayload = {
  company: CompanyFacts; contact: FoundContact; verification: EmailVerification; score: FitScore;
  lawfulBasis: string; aiDraft: { summary: string; status: 'pending_approval'; prompt: string } | null;
};
export type PersistResult = { status: 'saved'|'duplicate'|'suppressed'|'daily_limit'|'paused'|'verification_required'|'provenance_required'|'country_excluded'|'low_score'|'invalid'|'skipped'; lead_id?: string };
export interface ProspectingRepository {
  claim(ownerId: string, runId: string, claimToken: string): Promise<ClaimedRun | null>;
  active(ownerId: string, runId: string, claimToken: string): Promise<{ allowed: boolean; reason?: string }>;
  reserve(ownerId: string, runId: string, claimToken: string, operation: string, provider: string): Promise<Reservation>;
  complete(ownerId: string, runId: string, claimToken: string, operation: string, result: unknown, errorCode?: string): Promise<void>;
  candidate(ownerId: string, domain: string): Promise<{ run_id: string; status: string } | null>;
  recordCandidate(ownerId: string, runId: string, claimToken: string, domain: string, status: string, reason?: string): Promise<{ status: string; candidate_status?: string; run_id?: string }>;
  suppressed(ownerId: string, email: string): Promise<boolean>;
  existingEmail(ownerId: string, email: string): Promise<boolean>;
  suppress(ownerId: string, email: string): Promise<void>;
  persist(ownerId: string, runId: string, claimToken: string, payload: PersistPayload): Promise<PersistResult>;
  finish(ownerId: string, runId: string, claimToken: string, status: Exclude<RunStatus, 'queued'|'running'>, counts: { companies_found: number; skipped_count: number }, message: string, errorCode: string | null, nextSearchIndex: number | null, cursors: Record<string, number> | null): Promise<boolean>;
}
export class RepositoryError extends Error {
  readonly code = 'database';
  constructor() { super('Discovery could not save its progress. Check the database migration and worker configuration.'); }
}
export function createProspectingRepository(client?: SupabaseClient): ProspectingRepository {
  const db = client ?? supabaseAdmin();
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new RepositoryError();
    return data as T;
  }
  function ownerArgs(ownerId: string, runId: string, claimToken: string) {
    assertAutomationOwner(ownerId);
    return { p_owner: ownerId, p_run: runId, p_claim_token: claimToken };
  }
  return {
    async claim(ownerId, runId, claimToken) { return rpc<ClaimedRun|null>('claim_prospecting_run', ownerArgs(ownerId, runId, claimToken)); },
    async active(ownerId, runId, claimToken) { return rpc('check_prospecting_run', ownerArgs(ownerId, runId, claimToken)); },
    async reserve(ownerId, runId, claimToken, operation, provider) { return rpc('reserve_prospecting_request', { ...ownerArgs(ownerId, runId, claimToken), p_operation: operation, p_provider: provider }); },
    async complete(ownerId, runId, claimToken, operation, result, errorCode) { await rpc('complete_prospecting_request', { ...ownerArgs(ownerId, runId, claimToken), p_operation: operation, p_result: result, p_error_code: errorCode?.toUpperCase() ?? null }); },
    async candidate(ownerId, domain) { assertAutomationOwner(ownerId); const { data, error } = await db.from('prospecting_candidates').select('run_id,status').eq('owner_id', ownerId).eq('domain', domain).maybeSingle(); if (error) throw new RepositoryError(); return data; },
    async recordCandidate(ownerId, runId, claimToken, domain, status, reason) { return rpc('record_prospecting_candidate', { ...ownerArgs(ownerId, runId, claimToken), p_domain: domain, p_status: status, p_reason: reason ?? null }); },
    async suppressed(ownerId, email) { assertAutomationOwner(ownerId); const { data, error } = await db.from('suppression_list').select('id').eq('owner_id', ownerId).eq('email', email).limit(1); if (error) throw new RepositoryError(); return Boolean(data?.length); },
    async existingEmail(ownerId, email) { assertAutomationOwner(ownerId); const { data, error } = await db.from('leads').select('id').eq('owner_id', ownerId).eq('email', email).limit(1); if (error) throw new RepositoryError(); return Boolean(data?.length); },
    async suppress(ownerId, email) { assertAutomationOwner(ownerId); const { error } = await db.from('suppression_list').upsert({ owner_id: ownerId, email, reason: 'do-not-contact' }, { onConflict: 'owner_id,email', ignoreDuplicates: true }); if (error) throw new RepositoryError(); },
    async persist(ownerId, runId, claimToken, payload) { return rpc('persist_discovered_lead', { ...ownerArgs(ownerId, runId, claimToken), p_payload: payload }); },
    async finish(ownerId, runId, claimToken, status, counts, message, errorCode, nextSearchIndex, cursors) { return rpc('finish_prospecting_run', { ...ownerArgs(ownerId, runId, claimToken), p_status: status, p_counts: counts, p_message: message, p_error_code: errorCode?.toUpperCase() ?? null, p_next_search_index: nextSearchIndex, p_cursors: cursors }); },
  };
}
export async function queueDueProspectingRun(ownerId: string): Promise<string | null> {
  assertAutomationOwner(ownerId);
  const db = supabaseAdmin();
  const { data, error } = await db.rpc('queue_due_prospecting_run', { p_owner: ownerId });
  if (error) throw new RepositoryError();
  return typeof data === 'string' ? data : null;
}
