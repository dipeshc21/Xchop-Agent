import { publicSourceUrl } from '../prospecting/hunter';
import type { ProjectSearchPage, ProjectSearchResult } from './types';

export type IntentProviderErrorCode = 'configuration' | 'authentication' | 'quota' | 'rate_limit' | 'invalid_input' | 'invalid_response' | 'unavailable';
const messages: Record<IntentProviderErrorCode, string> = {
  configuration: 'Add your actual Tavily API key to the server before searching for project requests.',
  authentication: 'Tavily rejected its server credential. Check the configured API key.',
  quota: 'The Tavily account reached its usage or spending limit. Check the provider dashboard.',
  rate_limit: 'Tavily asked the worker to slow down. This request was not retried.',
  invalid_input: 'The project search query or search limits could not be validated.',
  invalid_response: 'Tavily returned an incomplete or oversized search response. No project was accepted from it.',
  unavailable: 'Project search is temporarily unavailable or did not respond in time. This request was not retried.',
};

/** Never expose provider response bodies, transport messages, URLs or credentials. */
export class IntentProviderError extends Error {
  constructor(readonly code: IntentProviderErrorCode) {
    super(messages[code]);
    this.name = 'IntentProviderError';
  }
}

export function hasTavilyKey(value: string | undefined): boolean {
  const key = value?.trim() ?? '';
  return /^tvly-[A-Za-z0-9_-]{16,495}$/.test(key) &&
    !/(?:your[-_ ]|replace[-_ ]|placeholder|example|changeme|test-api-key|tavily_api_key)/i.test(key);
}
export const hasRealTavilyKey = hasTavilyKey;

export const tavilyResponseLimits = { bytes: 2_000_000, perResultCharacters: 60_000, totalContentCharacters: 200_000 } as const;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const cleanText = (value: unknown, limit: number) => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, limit)
  : '';
const dateHint = (value: unknown) => typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value)) ? value : null;

function sourceLink(value: unknown) {
  const link = publicSourceUrl(value);
  if (!link) return null;
  const url = new URL(link);
  // Published page addresses should never carry access credentials into saved evidence.
  if ([...url.searchParams.keys()].some(key => /^(?:api[-_]?key|access[-_]?token|auth(?:orization)?|secret|password|token)$/i.test(key))) return null;
  return url.href;
}

function statusError(status: number) {
  if ([401, 403].includes(status)) return new IntentProviderError('authentication');
  if ([402, 432, 433].includes(status)) return new IntentProviderError('quota');
  if (status === 429) return new IntentProviderError('rate_limit');
  // 434 is Tavily's temporary flex-tier live-fetch capacity limit, not a credit limit.
  if (status === 434 || status === 408 || status >= 500) return new IntentProviderError('unavailable');
  return new IntentProviderError([400, 422].includes(status) ? 'invalid_input' : 'invalid_response');
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length') ?? 0) > tavilyResponseLimits.bytes) {
    await response.body?.cancel();
    throw new IntentProviderError('invalid_response');
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > tavilyResponseLimits.bytes) {
        await reader.cancel();
        throw new IntentProviderError('invalid_response');
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new IntentProviderError('invalid_response'); }
}

export type TavilyOptions = {
  /** Injection is for isolated tests. Runtime callers use the fixed Tavily endpoint. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};
export type ProjectSearchInput = { query: string; limit: number; maxAgeDays: number };

/** Searches public project requests. Returned text is evidence input, never proof of intent by itself. */
export class TavilyClient {
  private readonly key: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  constructor(apiKey: string, options: TavilyOptions = {}) {
    if (!hasTavilyKey(apiKey)) throw new IntentProviderError('configuration');
    this.key = apiKey.trim();
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(25_000, options.timeoutMs!)) : 25_000;
  }

  async search(input: ProjectSearchInput): Promise<ProjectSearchPage> {
    if (typeof input.query !== 'string' || input.query.trim().length < 3 || input.query.length > 500 || /[\u0000-\u001f\u007f]/.test(input.query) ||
      !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20 ||
      !Number.isInteger(input.maxAgeDays) || input.maxAgeDays < 1 || input.maxAgeDays > 90) throw new IntentProviderError('invalid_input');
    const now = new Date();
    const date = (value: Date) => value.toISOString().slice(0, 10);
    const body = {
      query: input.query.trim(), topic: 'general', search_depth: 'basic', max_results: input.limit,
      start_date: date(new Date(now.getTime() - input.maxAgeDays * 86_400_000)), end_date: date(now),
      include_published_date: true, filter_by_published_date: true, max_age_hours: 24,
      include_raw_content: 'text', include_answer: false, include_images: false,
      auto_parameters: false, safe_search: true, include_usage: true,
    };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new IntentProviderError('unavailable')); }, this.timeoutMs);
    });
    try {
      const operation = (async () => {
        const response = await this.fetcher('https://api.tavily.com/search', {
          method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body), signal: controller.signal, redirect: 'error', cache: 'no-store',
        });
        if (!response.ok) { await response.body?.cancel(); throw statusError(response.status); }
        const data = object(await readBoundedJson(response));
        if (data.error || data.detail || !Array.isArray(data.results) || data.results.length > input.limit) throw new IntentProviderError('invalid_response');
        const results: ProjectSearchResult[] = [];
        const seen = new Set<string>();
        let contentCharacters = 0;
        for (const value of data.results) {
          const row = object(value);
          const url = sourceLink(row.url);
          if (!url || seen.has(url)) continue;
          seen.add(url);
          // Never chop a request midway: that could hide a closed/expired status or
          // change which statement qualifies as the buyer's current requirement.
          const rawContent = typeof row.raw_content === 'string'
            ? row.raw_content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
            : '';
          if (rawContent.length > tavilyResponseLimits.perResultCharacters ||
            contentCharacters + rawContent.length > tavilyResponseLimits.totalContentCharacters) continue;
          contentCharacters += rawContent.length;
          results.push({
            title: cleanText(row.title, 300), url, rawContent,
            // This is the engine's estimated publication/update date, not an authoritative request date.
            publishedDate: dateHint(row.published_date),
          });
        }
        return { results };
      })();
      return await Promise.race([operation, timeout]);
    } catch (error) { throw error instanceof IntentProviderError ? error : new IntentProviderError('unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }
}
