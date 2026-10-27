import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the public SQL used by Copy prospecting SQL exactly matches the reviewed migration', async () => {
  const [migration, downloadable] = await Promise.all([
    readFile('supabase/migrations/005_automatic_prospecting.sql'),
    readFile('public/migrations/005_automatic_prospecting.sql'),
  ]);
  assert.ok(migration.length > 1000, 'The database migration must not be an empty placeholder');
  assert.deepEqual(downloadable, migration, 'Update the downloadable SQL whenever migration 005 changes');
});
