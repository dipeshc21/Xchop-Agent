import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../supabase/admin';
import { createProspectingRepository, RepositoryError, type ProspectingRepository } from '../prospecting/repository';
import { assertAutomationOwner } from '../prospecting/server-config';
import type { ProjectEvidence } from './types';
import type { PublishedProjectContact } from './contact';
import { normalizeProjectUrl } from './evidence';

export type ProjectCandidateStatus = 'processing' | 'rejected' | 'saved';
export type ProjectCandidateResult = { status: 'created' | 'existing' | 'paused'; candidate_status?: ProjectCandidateStatus; reason?: string };
export type ProjectPersistPayload = { evidence: ProjectEvidence; sourceText: string; discoveryQuery: string; contact?: PublishedProjectContact };
export type ProjectPersistResult = {
  status: 'saved' | 'duplicate' | 'paused' | 'daily_limit' | 'evidence_required' | 'contact_evidence_required' | 'country_excluded' | 'service_excluded' | 'stale' | 'invalid';
  request_id?: string;
};
export type ProjectRunCapacity = { allowed: boolean; reason?: string | null };
export type ProjectDiscoveryRepository = Pick<ProspectingRepository, 'claim' | 'active' | 'reserve' | 'complete' | 'finish'> & {
  supportsContacts?(ownerId: string): Promise<boolean>;
  knownSources?(ownerId: string, sourceUrls: string[]): Promise<string[]>;
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
    async knownSources(ownerId, sourceUrls) {
      assertAutomationOwner(ownerId);
      if (!Array.isArray(sourceUrls) || sourceUrls.length > 20) throw new RepositoryError();
      const normalized: string[] = [];
      for (const value of sourceUrls) {
        const url = typeof value === 'string' ? normalizeProjectUrl(value) : null;
        if (!url) throw new RepositoryError();
        if (!normalized.includes(url)) normalized.push(url);
      }
      if (!normalized.length) return [];
      const byHash = new Map(normalized.map(url => [createHash('md5').update(url).digest('hex'), url]));
      const hashes = [...byHash.keys()];
      try {
        const results = await Promise.all([
          db.from('project_requests').select('source_url_hash').eq('owner_id', ownerId).in('source_url_hash', hashes),
          // The immutable save audit keeps deleted requests from reappearing as
          // new. Read only the hash projection, never its source/result payload.
          db.from('agent_logs').select('source_url_hash:input->>source_url_hash')
            .eq('owner_id', ownerId).eq('agent', 'ProjectRequestAgent').eq('status', 'completed')
            .not('output->>project_request_id', 'is', null).in('input->>source_url_hash', hashes),
        ]);
        const known = new Set<string>();
        for (const result of results) {
          if (result.error || !Array.isArray(result.data)) throw new RepositoryError();
          for (const row of result.data) {
            if (!row || typeof row !== 'object' || typeof row.source_url_hash !== 'string' || !/^[a-f0-9]{32}$/.test(row.source_url_hash)) throw new RepositoryError();
            // Unexpected rows cannot cause a URL outside this input batch to be
            // returned or turn another public page into a previously saved one.
            if (byHash.has(row.source_url_hash)) known.add(row.source_url_hash);
          }
        }
        return normalized.filter(url => known.has(createHash('md5').update(url).digest('hex')));
      } catch {
        throw new RepositoryError();
      }
    },
    async supportsContacts(ownerId) {
      assertAutomationOwner(ownerId);
      const { data, error } = await db.rpc('project_contact_readiness');
      if (error) {
        if (['PGRST202', '42883'].includes(error.code ?? '')) return false;
        throw new RepositoryError();
      }
      return data?.schema_version === 7;
    },
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
