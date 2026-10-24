type OriginRequest = Pick<Request, 'url' | 'headers'>;

function parseRootOrigin(value: string) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Browser mutation requests must originate from the authority the browser actually requested.
 * Next may reconstruct request.url with an internal hostname (for example localhost), so its
 * hostname alone cannot identify the public authority. Browsers control Host and Origin; a
 * website cannot override them in a cross-site fetch. Authentication and RLS remain separate.
 * Deployments must route only their intended public Host values to this app. Forwarded-host
 * headers are deliberately ignored. A trusted configured origin can optionally bind requests
 * more strictly, including the external scheme when a trusted proxy terminates HTTPS.
 */
export function hasSameOrigin(request: OriginRequest, expectedOrigin?: string) {
  const rawOrigin = request.headers.get('origin');
  if (!rawOrigin || rawOrigin === 'null') return false;
  const origin = parseRootOrigin(rawOrigin);
  if (!origin) return false;

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(requestUrl.protocol)) return false;

  const configured = expectedOrigin === undefined ? null : parseRootOrigin(expectedOrigin);
  if (expectedOrigin !== undefined && !configured) return false;
  const protocol = configured?.protocol ?? requestUrl.protocol;
  const rawHost = request.headers.get('host') ?? requestUrl.host;
  // An authority cannot contain path/query fragments, credentials, multiple hosts or spaces.
  if (!rawHost || /[\s/\\@?#,]/.test(rawHost)) return false;
  const authority = parseRootOrigin(`${protocol}//${rawHost}`);
  if (!authority) return false;
  if (configured && authority.host !== configured.host) return false;
  return origin.origin === authority.origin && (!configured || origin.origin === configured.origin);
}
