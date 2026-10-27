import { z } from 'zod';
import { countryNames } from './types';
import type { CompanyFacts, DiscoveryPage, EmailVerification, FoundContact } from './types';

export type ProviderErrorCode = 'configuration' | 'authentication' | 'plan' | 'pagination' | 'quota' | 'rate_limit' | 'unavailable' | 'invalid_response' | 'invalid_input';
const errorMessages: Record<ProviderErrorCode, string> = {
  configuration: 'Provider credentials are missing or contain example values.',
  authentication: 'The provider rejected the API key. Check the server configuration.',
  plan: 'This provider feature is not included in the connected account plan.',
  pagination: 'This search page is unavailable. Check your provider plan and pagination settings.',
  quota: 'The provider account has reached its usage allowance.',
  rate_limit: 'The provider request limit was reached. Try again later.',
  unavailable: 'The provider did not respond in time or is temporarily unavailable.',
  invalid_response: 'The provider returned an unexpected response. No prospect was accepted.',
  invalid_input: 'The prospecting request contains an invalid domain, email, or search filter.',
};

/** Only static messages escape this boundary. Provider bodies, request URLs and credentials do not. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode) { super(errorMessages[code]); this.name = 'ProviderError'; this.code = code; }
}

type JsonObject = Record<string, unknown>;
const record = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, limit) : '';
const date = (value: unknown) => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : null;
const positiveInteger = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function hasRealProviderKey(value: string | undefined): boolean {
  const key = value?.trim() ?? '';
  return key.length >= 16 && key.length <= 500 && !/[\s\u0000-\u001f]/.test(key) &&
    !/^(?:test-api-key|your[-_ ]|replace[-_ ]|placeholder|demo[-_ ]|changeme|hunter_api_key|anthropic_api_key)/i.test(key);
}

/** A domain is submitted to Hunter as data; this app never fetches the company website. */
export function normalizePublicDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  const labels = domain.split('.');
  if (domain.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels.at(-1) ?? '') ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test|example|home|lan|onion)$/.test(domain)) throw new ProviderError('invalid_input');
  return domain;
}

export function publicSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return null;
    normalizePublicDomain(url.hostname);
    return url.href;
  } catch { return null; }
}

function validEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!z.email().max(254).safeParse(email).success) return null;
  try { normalizePublicDomain(email.split('@')[1]); return email; } catch { return null; }
}

function responseError(status: number, payload: unknown): ProviderError {
  const errors = record(payload).errors;
  const ids = Array.isArray(errors) ? errors.map(item => record(item).id).filter((id): id is string => typeof id === 'string') : [];
  if (ids.includes('pagination_error')) return new ProviderError('pagination');
  if (ids.some(id => ['no_discover_access', 'no_enrichment_access', 'no_domain_search_access', 'premium_required', 'requires_premium', 'feature_not_available'].includes(id))) return new ProviderError('plan');
  if (status === 401) return new ProviderError('authentication');
  if (status === 402 || status === 429 || ids.some(id => ['limit_reached', 'credits_exhausted', 'usage_limit_reached'].includes(id))) return new ProviderError('quota');
  if (status === 403 || ids.some(id => ['rate_limit', 'too_many_requests'].includes(id))) return new ProviderError('rate_limit');
  if (status >= 500 || status === 408) return new ProviderError('unavailable');
  return new ProviderError(status === 400 || status === 422 ? 'invalid_input' : 'invalid_response');
}

async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > 1_000_000) throw new ProviderError('invalid_response');
  if (!response.body) throw new ProviderError('invalid_response');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) { await reader.cancel(); throw new ProviderError('invalid_response'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ProviderError('invalid_response'); }
}

export type HunterOptions = {
  /** Injection is for tests; production callers use the built-in fetch and fixed API origin. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};
export type DiscoveryRequest = { countryCode: string; keywords: string[]; limit: number; offset: number };

export class HunterClient {
  private readonly key: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  constructor(apiKey: string, options: HunterOptions = {}) {
    if (!hasRealProviderKey(apiKey)) throw new ProviderError('configuration');
    this.key = apiKey.trim();
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = Math.max(1, Math.min(25_000, options.timeoutMs ?? 25_000));
  }

  private async request(path: '/discover' | '/companies/find' | '/domain-search' | '/email-verifier', params: Record<string, string> = {}, body?: JsonObject): Promise<{ status: number; payload: unknown }> {
    const url = new URL(`https://api.hunter.io/v2${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ProviderError('unavailable')); }, this.timeoutMs); });
    try {
      const operation = (async () => {
        const response = await this.fetcher(url, {
          method: body ? 'POST' : 'GET',
          headers: { 'X-API-KEY': this.key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error', cache: 'no-store',
        });
        if ((path === '/companies/find' && response.status === 404) || (path === '/email-verifier' && [202, 222, 451].includes(response.status))) {
          await response.body?.cancel();
          return { status: response.status, payload: null };
        }
        let payload: unknown;
        try { payload = await boundedJson(response); }
        catch { throw response.ok ? new ProviderError('invalid_response') : responseError(response.status, null); }
        if (!response.ok) throw responseError(response.status, payload);
        if (Object.hasOwn(record(payload), 'errors')) throw responseError(response.status, payload);
        return { status: response.status, payload };
      })();
      return await Promise.race([operation, timeout]);
    } catch (error) { throw error instanceof ProviderError ? error : new ProviderError('unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }

  async discover(input: DiscoveryRequest): Promise<DiscoveryPage> {
    const countryCode = input.countryCode.toUpperCase();
    if (!Object.hasOwn(countryNames, countryCode) || countryCode === 'IN' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 ||
        !Number.isInteger(input.offset) || input.offset < 0 || input.offset > 10_000 || !input.keywords.length || input.keywords.length > 8 ||
        input.keywords.some(keyword => typeof keyword !== 'string' || keyword.trim().length < 3 || keyword.length > 100)) throw new ProviderError('invalid_input');
    const { payload } = await this.request('/discover', {}, {
      headquarters_location: { include: [{ country: countryCode }], exclude: [{ country: 'IN' }] },
      keywords: { include: input.keywords.map(keyword => keyword.trim()), match: 'any' },
      limit: input.limit, offset: input.offset,
    });
    const root = record(payload);
    if (!Array.isArray(root.data) || root.data.length > input.limit) throw new ProviderError('invalid_response');
    const companies: DiscoveryPage['companies'] = [];
    const seen = new Set<string>();
    for (const row of root.data.slice(0, input.limit)) {
      const company = record(row);
      if (typeof company.domain !== 'string') continue;
      let domain: string;
      try { domain = normalizePublicDomain(company.domain); } catch { continue; }
      if (seen.has(domain)) continue;
      seen.add(domain);
      companies.push({ domain, name: text(company.organization, 200) || domain });
    }
    const total = positiveInteger(record(root.meta).results);
    const next = input.offset + root.data.length;
    const nextOffset = root.data.length === input.limit && next <= 10_000 && (total === null || next < total) ? next : null;
    return { companies, total, nextOffset };
  }

  async enrichCompany(value: string): Promise<CompanyFacts | null> {
    const domain = normalizePublicDomain(value);
    const { status, payload } = await this.request('/companies/find', { domain });
    if (status === 404) return null;
    const data = record(record(payload).data);
    if (typeof data.domain !== 'string') throw new ProviderError('invalid_response');
    let returnedDomain: string;
    try { returnedDomain = normalizePublicDomain(data.domain); } catch { throw new ProviderError('invalid_response'); }
    if (returnedDomain !== domain) throw new ProviderError('invalid_response');
    const geo = record(data.geo);
    const countryCode = text(geo.countryCode, 20).toUpperCase();
    return {
      domain, name: text(data.name, 200) || domain, description: text(data.description, 6000),
      industry: text(record(data.category).industry, 300),
      countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : '',
      country: text(geo.country, 100), timeZone: text(data.timeZone, 100) || null,
      employeeCount: positiveInteger(record(data.metrics).employeesCount),
      tags: Array.isArray(data.tags) ? data.tags.map(item => text(item, 100)).filter(Boolean).slice(0, 30) : [],
    };
  }

  async domainSearch(value: string): Promise<FoundContact[]> {
    const domain = normalizePublicDomain(value);
    const { payload } = await this.request('/domain-search', { domain, limit: '10', offset: '0', provenance: 'found' });
    const data = record(record(payload).data);
    if (!Array.isArray(data.emails)) throw new ProviderError('invalid_response');
    if (data.disposable === true || data.webmail === true || data.accept_all === true) return [];
    const candidates: { contact: FoundContact; rank: number }[] = [];
    for (const raw of data.emails.slice(0, 100)) {
      const row = record(raw);
      const email = validEmail(row.value);
      if (!email || row.provenance !== 'found') continue;
      const [local, emailDomain] = email.split('@');
      if (emailDomain !== domain && !emailDomain.endsWith(`.${domain}`)) continue;
      const role = text(row.position_raw, 150) || text(row.position, 150);
      if (/^(?:support|careers?|jobs?|recruitment|recruiting|security|billing|abuse|privacy|legal|noreply|no-reply|do-not-reply|postmaster)(?:[.+_-]|$)/i.test(local) ||
          /\b(?:customer support|technical support|support engineer|recruiter|talent acquisition|security|billing|accounts payable)\b/i.test(role)) continue;
      const sources: FoundContact['sources'] = [];
      if (Array.isArray(row.sources)) for (const rawSource of row.sources.slice(0, 20)) {
        const source = record(rawSource);
        const uri = publicSourceUrl(source.uri);
        if (uri && source.still_on_page !== false && !sources.some(existing => existing.uri === uri)) sources.push({ uri, lastSeenOn: date(source.last_seen_on) });
      }
      if (!sources.length) continue;
      const confidence = typeof row.confidence === 'number' && Number.isFinite(row.confidence) ? Math.max(0, Math.min(100, row.confidence)) : 0;
      const contact: FoundContact = { email, firstName: text(row.first_name, 100), lastName: text(row.last_name, 100), role, confidence, provenance: 'found', sources };
      const rank = (row.decision_maker === true ? 100 : 0) + (/\b(?:founder|owner|partner|ceo|chief|director|president|managing|head of|creative lead)\b/i.test(role) ? 60 : 0) + (/^(?:hello|contact|business|partnerships|sales|info)$/.test(local) ? 10 : 0);
      candidates.push({ contact, rank });
    }
    candidates.sort((a, b) => b.rank - a.rank || b.contact.confidence - a.contact.confidence || a.contact.email.localeCompare(b.contact.email));
    const seen = new Set<string>();
    return candidates.filter(item => { if (seen.has(item.contact.email)) return false; seen.add(item.contact.email); return true; }).slice(0, 10).map(item => item.contact);
  }

  async verifyEmail(value: string): Promise<EmailVerification> {
    const email = validEmail(value);
    if (!email) throw new ProviderError('invalid_input');
    const { status: responseStatus, payload } = await this.request('/email-verifier', { email });
    const empty = { checkedAt: null, disposable: false, webmail: false, acceptAll: false };
    if (responseStatus === 202) return { ...empty, status: 'pending' };
    if (responseStatus === 222) return { ...empty, status: 'unknown' };
    if (responseStatus === 451) return { ...empty, status: 'claimed' };
    const data = record(record(payload).data);
    if (typeof data.status !== 'string') throw new ProviderError('invalid_response');
    if (data.email && validEmail(data.email) !== email) throw new ProviderError('invalid_response');
    const disposable = data.disposable === true;
    const webmail = data.webmail === true;
    const acceptAll = data.accept_all === true;
    const allowed: EmailVerification['status'][] = ['valid', 'invalid', 'accept_all', 'webmail', 'disposable', 'unknown', 'pending', 'claimed'];
    let status: EmailVerification['status'] = allowed.includes(data.status as EmailVerification['status']) ? data.status as EmailVerification['status'] : 'unknown';
    if (disposable) status = 'disposable';
    else if (webmail) status = 'webmail';
    else if (acceptAll) status = 'accept_all';
    else if (status === 'valid' && [data.disposable, data.webmail, data.accept_all].some(flag => typeof flag !== 'boolean')) status = 'unknown';
    return { status, checkedAt: date(record(data.verification).date), disposable, webmail, acceptAll };
  }
}
