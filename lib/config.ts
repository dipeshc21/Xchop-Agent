/** Public Supabase connection values. A service-role/secret key is never accepted here. */
function configuredValues() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '',
    key: (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      ''
    ).trim(),
  };
}

export function supabaseConfigurationStatus() {
  const { url, key } = configuredValues();
  let validUrl = false;
  try {
    const parsed = new URL(url);
    validUrl = ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username && !parsed.password &&
      !parsed.search && !parsed.hash && parsed.pathname === '/';
  } catch {
    // The setup page explains the missing or invalid value.
  }
  const exampleValues = /your-project/i.test(url) || /^your[-_ ](?:publishable|anon)[-_ ]key$/i.test(key);
  const secretKey = key.startsWith('sb_secret_');
  // Legacy JWT role checks prevent the common mistake of putting service_role in a public variable.
  let legacySecretKey = false;
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      legacySecretKey = payload.role === 'service_role';
    } catch {
      // Supabase validates an otherwise opaque publishable/anon key when connecting.
    }
  }
  const ready = validUrl && Boolean(key) && !exampleValues && !secretKey && !legacySecretKey;
  return {
    ready,
    urlPresent: Boolean(url),
    keyPresent: Boolean(key),
    message: ready
      ? 'Supabase connection values are configured.'
      : secretKey || legacySecretKey
        ? 'Use a publishable or anon key. A secret/service-role key must never be placed in a NEXT_PUBLIC_ variable.'
        : exampleValues
          ? 'Replace the example URL and key with the values from your own Supabase project, then restart the app.'
          : !url || !key
          ? 'Add your Supabase project URL and publishable key to .env.local, then restart the app.'
          : 'The Supabase project URL must be the project’s root http or https address, without an extra path, credentials, a query, or a fragment.',
  };
}

export function isSupabaseConfigured() {
  return supabaseConfigurationStatus().ready;
}

export function publicConfig() {
  const status = supabaseConfigurationStatus();
  if (!status.ready) throw new Error(status.message);
  return configuredValues();
}
