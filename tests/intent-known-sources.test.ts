import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createProjectDiscoveryRepository } from '../lib/intent/repository';
import { RepositoryError } from '../lib/prospecting/repository';

const owner = '99000000-0000-4000-8000-000000000001';
const old = 'https://buyer.org/projects/old';
const deleted = 'https://buyer.org/projects/deleted';
const fresh = 'https://buyer.org/projects/new';
const hash = (value: string) => createHash('md5').update(value).digest('hex');
type Query = { table: string; select?: string; filters: unknown[][] };
function fixture(responses: Record<string, { data: unknown; error?: unknown } | Error> = {}) {
  const queries: Query[] = [];
  const client = { from(table: string) {
    const query: Query = { table, filters: [] }; queries.push(query);
    const chain = { select(value: string) { query.select = value; return chain; },
      eq(...args: unknown[]) { query.filters.push(['eq', ...args]); return chain; },
      in(...args: unknown[]) { query.filters.push(['in', ...args]); return chain; },
      not(...args: unknown[]) { query.filters.push(['not', ...args]); return chain; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        const response = responses[table] ?? { data: [] };
        return (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)).then(resolve, reject);
      },
    }; return chain;
  } } as unknown as SupabaseClient;
  return { queries, repository: createProjectDiscoveryRepository(client) };
}
async function asOwner(task: () => Promise<void>) {
  const before = process.env.AUTOMATION_OWNER_ID; process.env.AUTOMATION_OWNER_ID = owner;
  try { await task(); } finally { if (before === undefined) delete process.env.AUTOMATION_OWNER_ID; else process.env.AUTOMATION_OWNER_ID = before; }
}

test('known-source reads combine saved records and deleted-record audit without exposing source payloads', () => asOwner(async () => {
  const { repository, queries } = fixture({
    project_requests: { data: [{ source_url_hash: hash(old) }] },
    agent_logs: { data: [{ source_url_hash: hash(deleted) }, { source_url_hash: hash('https://foreign.org/unrequested') }] },
  });
  assert.deepEqual(await repository.knownSources!(owner, [old, deleted, fresh, old]), [old, deleted]);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.ok(query.filters.some(filter => filter[0] === 'eq' && filter[1] === 'owner_id' && filter[2] === owner));
    assert.ok(query.select?.includes('source_url_hash')); assert.ok(!query.select?.includes('*'));
  }
  const audit = queries.find(query => query.table === 'agent_logs')!;
  assert.equal(audit.select, 'source_url_hash:input->>source_url_hash');
  assert.ok(audit.filters.some(filter => filter[1] === 'agent' && filter[2] === 'ProjectRequestAgent'));
  assert.ok(audit.filters.some(filter => filter[1] === 'status' && filter[2] === 'completed'));
  assert.ok(audit.filters.some(filter => filter[0] === 'not' && filter[1] === 'output->>project_request_id'));
  assert.ok(audit.filters.some(filter => filter[0] === 'in' && filter[1] === 'input->>source_url_hash'));
}));

test('tracking variants use the canonical source identity while different project URLs remain distinct', () => asOwner(async () => {
  const source = 'https://buyer.org/project?id=1';
  const { repository, queries } = fixture({ project_requests: { data: [{ source_url_hash: hash(source) }] } });
  assert.deepEqual(await repository.knownSources!(owner, ['https://BUYER.org/project?utm_source=mail&id=1#top', source, fresh]), [source]);
  assert.deepEqual(queries[0].filters.find(filter => filter[0] === 'in')?.[2], [hash(source), hash(fresh)]);
}));

test('unknown sources stay new and empty batches do not make database calls', () => asOwner(async () => {
  const { repository, queries } = fixture();
  assert.deepEqual(await repository.knownSources!(owner, []), []); assert.equal(queries.length, 0);
  assert.deepEqual(await repository.knownSources!(owner, [fresh]), []);
}));

test('foreign owners, unsafe URLs and excessive batches fail before database access', () => asOwner(async () => {
  const { repository, queries } = fixture();
  await assert.rejects(repository.knownSources!('99000000-0000-4000-8000-000000000002', [old]), /not bound/);
  for (const urls of [['http://127.0.0.1/private'], ['https://buyer.org/?api_key=private'], Array(21).fill(old)]) {
    await assert.rejects(repository.knownSources!(owner, urls), RepositoryError);
  }
  assert.equal(queries.length, 0);
}));

test('lookup errors and malformed hash projections cannot silently produce new leads', () => asOwner(async () => {
  for (const response of [{ data: null, error: { message: 'private-database-detail' } }, new Error('private-transport-detail'), { data: [{ source_url_hash: 'bad' }] }]) {
    const { repository } = fixture({ agent_logs: response });
    await assert.rejects(repository.knownSources!(owner, [old]), error => error instanceof RepositoryError && !error.message.includes('private'));
  }
}));
