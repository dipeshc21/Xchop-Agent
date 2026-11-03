import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createProspectingRepository, RequestCheckpointError } from '../lib/prospecting/repository';

const owner = '77000000-0000-4000-8000-000000000001';
const run = '77000000-0000-4000-8000-000000000002';
const claim = 'request-checkpoint-fixture-claim-token';
type Receipt = { data: unknown; error: { code?: string; message: string } | null };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<Receipt>;

async function withOwner(task: () => Promise<void>) {
  const previous = process.env.AUTOMATION_OWNER_ID;
  process.env.AUTOMATION_OWNER_ID = owner;
  try { await task(); }
  finally {
    if (previous === undefined) delete process.env.AUTOMATION_OWNER_ID;
    else process.env.AUTOMATION_OWNER_ID = previous;
  }
}
function repository(rpc: Rpc) {
  return createProspectingRepository({ rpc } as unknown as SupabaseClient);
}
function expectCode(code: RequestCheckpointError['code']) {
  return (error: unknown) => {
    assert.ok(error instanceof RequestCheckpointError);
    assert.equal(error.code, code);
    assert.equal(error.message.includes('private-fixture-value'), false);
    assert.equal(String(error.stack).includes('private-fixture-value'), false);
    return true;
  };
}

test('successful search completion requires a completed SQL receipt and keeps its exact owner/run/operation binding', async () => {
  await withOwner(async () => {
    const result = { query: 'literal fixture query', page: { results: [] } };
    let calls = 0;
    const db = repository(async (name, args) => {
      calls++;
      assert.equal(name, 'complete_prospecting_request');
      assert.deepEqual(args, { p_owner: owner, p_run: run, p_claim_token: claim, p_operation: 'public-project-search:2', p_result: result, p_error_code: null });
      return { data: { status: 'completed' }, error: null };
    });
    assert.equal(await db.complete(owner, run, claim, 'public-project-search:2', result), undefined);
    assert.equal(calls, 1);
  });
});

test('provider failures are confirmed only by a failed SQL receipt and their safe code is normalized', async () => {
  await withOwner(async () => {
    const db = repository(async (_name, args) => {
      assert.equal(args.p_error_code, 'UNAVAILABLE'); assert.equal(args.p_result, null);
      return { data: { status: 'failed' }, error: null };
    });
    await db.complete(owner, run, claim, 'public-project-search', null, 'unavailable');
  });
});

test('unsafe result rejection has a distinct static error and does not expose database details', async () => {
  await withOwner(async () => {
    const db = repository(async () => ({ data: null, error: { code: 'P0001', message: 'PROSPECTING_UNSAFE_RESULT' } }));
    await assert.rejects(db.complete(owner, run, claim, 'public-project-search', { text: 'private-fixture-value' }), expectCode('checkpoint_rejected'));
  });
});

test('database and transport failures never acknowledge a response or expose private error messages', async () => {
  await withOwner(async () => {
    for (const rpc of [
      async () => ({ data: null, error: { code: '57014', message: 'private-fixture-value' } }),
      async () => { throw new Error('private-fixture-value'); },
    ]) {
      const db = repository(rpc);
      await assert.rejects(db.complete(owner, run, claim, 'public-project-search', { page: { results: [] } }), expectCode('checkpoint_unavailable'));
    }
  });
});

test('paused, absent and contradictory HTTP-success receipts cannot become a confirmed checkpoint', async () => {
  await withOwner(async () => {
    for (const data of [null, {}, { status: 'paused' }, { status: 'reserved' }, { status: 'failed' }, { status: 'private-fixture-value' }]) {
      const db = repository(async () => ({ data, error: null }));
      await assert.rejects(db.complete(owner, run, claim, 'public-project-search', { page: { results: [] } }), expectCode('checkpoint_unavailable'));
    }
    const contradictoryFailure = repository(async () => ({ data: { status: 'completed' }, error: null }));
    await assert.rejects(contradictoryFailure.complete(owner, run, claim, 'public-project-search', null, 'quota'), expectCode('checkpoint_unavailable'));
  });
});

test('an unbound account cannot submit a checkpoint even when the RPC stub would accept it', async () => {
  await withOwner(async () => {
    let calls = 0;
    const db = repository(async () => { calls++; return { data: { status: 'completed' }, error: null }; });
    await assert.rejects(db.complete('77000000-0000-4000-8000-000000000099', run, claim, 'public-project-search', {}), /not bound/);
    assert.equal(calls, 0);
  });
});
