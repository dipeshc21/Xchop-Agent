import test from 'node:test';
import assert from 'node:assert/strict';
import { isSupabaseConfigured, publicConfig, supabaseConfigurationStatus } from '../lib/config';

const names = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;
type Configuration = Partial<Record<(typeof names)[number], string>>;
const valid: Configuration = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://config-test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_config_test_fixture',
};

/** Every test gets isolated values and restores the caller's environment even on failure. */
function withConfiguration(values: Configuration, check: () => void) {
  const previous = new Map(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    for (const name of names) {
      if (values[name] !== undefined) process.env[name] = values[name];
    }
    check();
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function legacyKey(role: string) {
  // Deliberately unsigned test fixture, never used to contact Supabase.
  return [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role })).toString('base64url'),
    'config-test-signature',
  ].join('.');
}

test('missing Supabase configuration requires setup instead of falling back to data', () => {
  withConfiguration({}, () => {
    assert.equal(isSupabaseConfigured(), false);
    assert.equal(supabaseConfigurationStatus().urlPresent, false);
    assert.equal(supabaseConfigurationStatus().keyPresent, false);
    assert.throws(() => publicConfig(), /Add your Supabase project URL/);
  });
});

test('a root https project URL and publishable key are accepted', () => {
  withConfiguration(valid, () => {
    assert.equal(isSupabaseConfigured(), true);
    assert.deepEqual(publicConfig(), {
      url: valid.NEXT_PUBLIC_SUPABASE_URL,
      key: valid.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
  });
  withConfiguration({ ...valid, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321/' }, () => {
    assert.equal(isSupabaseConfigured(), true);
  });
});

test('example values keep setup pending until replaced with real configuration', () => {
  for (const values of [
    { ...valid, NEXT_PUBLIC_SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co' },
    { ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'YOUR-PUBLISHABLE-KEY' },
    { ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'your-anon-key' },
  ]) {
    withConfiguration(values, () => {
      assert.equal(isSupabaseConfigured(), false);
      assert.throws(() => publicConfig(), /Replace the example/);
    });
  }
});

test('invalid protocols, dashboard paths, embedded credentials, queries and fragments are rejected', () => {
  for (const url of [
    'not a URL',
    'javascript:alert(1)',
    'ftp://config-test.supabase.co',
    'https://supabase.com/dashboard/project/config-test',
    'https://user:password@config-test.supabase.co',
    'https://config-test.supabase.co?token=fixture',
    'https://config-test.supabase.co#fragment',
  ]) {
    withConfiguration({ ...valid, NEXT_PUBLIC_SUPABASE_URL: url }, () => {
      assert.equal(isSupabaseConfigured(), false);
      assert.throws(() => publicConfig());
    });
  }
});

test('private Supabase keys are rejected without disclosing them in status', () => {
  for (const key of ['sb_secret_config_test_fixture', legacyKey('service_role')]) {
    withConfiguration({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }, () => {
      assert.equal(isSupabaseConfigured(), false);
      const status = supabaseConfigurationStatus();
      assert.match(status.message, /secret\/service-role key/);
      assert.equal(JSON.stringify(status).includes(key), false);
      assert.throws(() => publicConfig(), /secret\/service-role key/);
    });
  }
});

test('legacy anon key works when no publishable key is supplied', () => {
  const key = legacyKey('anon');
  withConfiguration({
    NEXT_PUBLIC_SUPABASE_URL: valid.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
  }, () => {
    assert.equal(isSupabaseConfigured(), true);
    assert.equal(publicConfig().key, key);
  });
});
