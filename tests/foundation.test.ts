import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, settingsSchema } from '../lib/schema';

test('live defaults require approval, pause automation and exclude India', () => {
  assert.equal(defaults.automation, false);
  assert.equal(defaults.mode, 'approval');
  assert.equal(defaults.excludeIndia, true);
});
test('settings reject malformed email, unsafe website and invalid sending limits', () => {
  for (const invalid of [
    { ownerEmail: 'bad' }, { website: 'javascript:alert(1)' }, { website: 'not a URL' },
    { dailyLimit: 31 }, { dailyLimit: 0 }, { businessName: '' },
  ]) assert.equal(settingsSchema.safeParse({ ...defaults, ...invalid }).success, false);
});
