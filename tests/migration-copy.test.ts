import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const filename of ['005_automatic_prospecting.sql', '006_project_requests.sql', '007_project_contacts.sql', '008_discovery_reliability.sql', '009_restore_hunter_discovery.sql', '010_free_alert_sources.sql']) {
  test(`the downloadable ${filename} exactly matches the reviewed migration`, async () => {
    const [migration, downloadable] = await Promise.all([
      readFile(`supabase/migrations/${filename}`),
      readFile(`public/migrations/${filename}`),
    ]);
    assert.ok(migration.length > 1000, 'The database migration must not be an empty placeholder');
    assert.deepEqual(downloadable, migration, `Update the downloadable SQL whenever ${filename} changes`);
  });
}
