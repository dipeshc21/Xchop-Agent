import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../supabase/admin';
import { createProspectingRepository, RepositoryError, type ProspectingRepository } from '../prospecting/repository';
import { assertAutomationOwner } from '../prospecting/server-config';
import type { ProjectEvidence } from './types';

export type ProjectCandidateStatus = 'processing' | 'rejected' | 'saved';
export type ProjectCandidateResult = { status: 'created' | 'existing' | 'paused'; candidate_status?: ProjectCandidateStatus; reason?: string };
export type ProjectPersistPayload = { evidence: ProjectEvidence; sourceText: string; discoveryQuery: string };
export type ProjectPersistResult = {
  status: 'saved' | 'duplicate' | 'paused' | 'daily_limit' | 'evidence_required' | 'country_excluded' | 'service_excluded' | 'stale' | 'invalid';
  request_id?: string;
};
export type ProjectRunCapacity = { allowed: boolean; reason?: string | null };
export type ProjectDiscoveryRepository = Pick<ProspectingRepository, 'claim' | 'active' | 'reserve' | 'complete' | 'finish'> & {
  capacity(ownerId: string, runId: string, claimToken: string): Promise<ProjectRunCapacity>;
  recordCandidate(ownerId: string, runId: string, claimToken: string, sourceUrl: string, status: ProjectCandidateStatus, reason?: string): Promise<ProjectCandidateResult>;
  persist(ownerId: string, runId: string, claimToken: string, payload: ProjectPersistPayload): Promise<ProjectPersistResult>;
};

/** All callers are trusted workers. Browser APIs continue to use their own RLS session. */
export function createProjectDiscoveryRepository(client?: SupabaseClient): ProjectDiscoveryRepository {
  const db = client ?? supabaseAdmin();
  const base = createProspectingRepository(db);
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new RepositoryError();
    return data as T;
  }
  function runArgs(ownerId: string, runId: string, claimToken: string) {
    assertAutomationOwner(ownerId);
    return { p_owner: ownerId, p_run: runId, p_claim_token: claimToken };
  }
  return {
    claim: base.claim, active: base.active, reserve: base.reserve,
    complete: base.complete, finish: base.finish,
    capacity(ownerId, runId, claimToken) {
      return rpc('check_project_request_capacity', runArgs(ownerId, runId, claimToken));
    },
    recordCandidate(ownerId, runId, claimToken, sourceUrl, status, reason) {
      return rpc('record_project_request_candidate', {
        ...runArgs(ownerId, runId, claimToken), p_source_url: sourceUrl,
        p_status: status, p_reason: reason ?? null,
      });
    },
    persist(ownerId, runId, claimToken, payload) {
      return rpc('save_discovered_project_request', { ...runArgs(ownerId, runId, claimToken), p_payload: payload });
    },
  };
}
