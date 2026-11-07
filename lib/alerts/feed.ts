import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { normalizeProjectUrl } from '../intent/evidence';
import { extractProjectContact } from '../intent/contact';
import { AlertImportError, validateFeedUrl, type AlertEntry, type AlertResourceType, type AlertService } from './types';

export const alertFeedLimits = { bytes: 1_048_576, entries: 50, timeoutMs: 20_000, maxAgeDays: 30 } as const;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const array = (value: unknown): unknown[] => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const item = object(value);
  return [item['#text'], item['#cdata']].filter(value => typeof value === 'string').join(' ');
}
function entities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp|ndash|mdash|hellip);/gi, (original, entity: string) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? original;
    const number = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : ' ';
  });
}
/** RSS snippets remain plain text; their HTML is never rendered or fetched. */
function plainText(value: string): string {
  return entities(entities(value)).replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

export function canonicalAlertSource(value: string, resourceType: AlertResourceType): string | null {
  let original = value;
  try {
    const redirect = new URL(value);
    if (['www.google.com', 'google.com'].includes(redirect.hostname) && redirect.pathname === '/url') {
      original = redirect.searchParams.get('url') || redirect.searchParams.get('q') || '';
    }
  } catch { return null; }
  const normalized = normalizeProjectUrl(original);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.hostname === 'google.com' || url.hostname.endsWith('.google.com')) return null;
  if (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')) {
    if (!/^\/(?:posts\/[^/]+|feed\/update\/urn:li:activity:[0-9]+)\/?$/.test(url.pathname)) return null;
    url.hostname = 'www.linkedin.com';
    url.search = '';
    url.pathname = url.pathname.replace(/\/$/, '');
  } else if (resourceType === 'linkedin_posts') return null;
  return url.href;
}

function serviceIn(value: string): AlertService | null {
  const website = /\b(?:website|web\s+(?:development|design(?:ers?|ing)?|developer|agency)|wordpress|shopify|webflow|woocommerce|landing\s+page|e-?commerce(?:\s+(?:site|website|store))?)\b/i.test(value);
  const application = /\b(?:(?:mobile|web|ios|android|software|custom)\s+(?:apps?|applications?|development)|apps?\s+(?:development|developer|agency)|application\s+(?:development|developer|agency)|(?:ios|android)\s+developer)\b/i.test(value);
  return website && application ? 'website_and_application' : website ? 'website' : application ? 'application' : null;
}
function rejection(value: string): string | null {
  if (/\b(?:full[- ]?time|part[- ]?time|permanent\s+(?:role|position)|salary|job\s+(?:opening|vacancy|description)|internship|join\s+(?:our|the)\s+team|recruitment)\b/i.test(value)) return 'employment';
  if (/\[\s*for\s*hire\s*\]|\b(?:for hire|hire me|looking for clients|seeking clients|(?:my|our) portfolio|our case studies)\b|\b(?:we|i|our agency)\s+(?:offer|provide|speciali[sz]e)\b/i.test(value)) return 'supplier_marketing';
  if (/\b(?:project|tender|rfp|request)\b[^.!?\n]{0,50}\b(?:closed|awarded|cancelled|canceled|withdrawn)\b|\bno longer accepting\b/i.test(value)) return 'closed';
  if (/\b(?:are you|if you(?:['’]re| are))\s+(?:looking|searching)\b/i.test(value)) return 'supplier_marketing';
  if (!/\b(?:i|we)(?:['’](?:re|m)|\s+(?:are|am))?\s+(?:need|require|want|seek|(?:looking|searching)\s+for)\b|\b(?:company|business|team|client|organi[sz]ation|buyer)\s+(?:is|are)\s+(?:looking\s+for|seeking|searching\s+for)\b|\b(?:looking|searching)\s+for\s+(?:an?\s+)?(?:web\s+(?:designers?|designing\s+agenc(?:y|ies))|(?:web(?:site)?|(?:mobile\s+)?app(?:lication)?)\s+(?:developers?|(?:design|development)\s+agenc(?:y|ies))|development\s+(?:agenc(?:y|ies)|partners?))\b|\b(?:request for (?:proposals?|quotations?|tenders?)|rfp|invitation to (?:bid|tender|quote)|seeking\s+(?:an?\s+)?(?:external\s+)?(?:agency|developer|development partner))\b|\[\s*hiring\s*\]/i.test(value)) return 'no_buyer_request';
  return null;
}
export type ParsedAlertFeed = { entries: AlertEntry[]; entriesSeen: number; skippedCount: number; rejections: Record<string, number> };

export function parseGoogleAlertsFeed(xml: string, resourceType: AlertResourceType, options: { now?: Date } = {}): ParsedAlertFeed {
  if (typeof xml !== 'string' || new TextEncoder().encode(xml).byteLength > alertFeedLimits.bytes) throw new AlertImportError('FEED_TOO_LARGE');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) throw new AlertImportError('FEED_PARSE');
  let parsed: unknown;
  try {
    parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false,
      trimValues: false, cdataPropName: '#cdata', processEntities: true, htmlEntities: true }).parse(xml);
  } catch { throw new AlertImportError('FEED_PARSE'); }
  const root = object(parsed);
  if (!Object.hasOwn(root, 'feed')) throw new AlertImportError('FEED_PARSE');
  // removeNSPrefix intentionally drops xmlns attributes, so validate the original
  // root declaration before interpreting any prefixed/default namespace as Atom.
  const feedRoot = /<(?:(?<prefix>[A-Za-z_][\w.-]*):)?feed\b(?<attributes>[^>]*)>/.exec(xml);
  const prefix = feedRoot?.groups?.prefix ?? '';
  const namespaces = [...(feedRoot?.groups?.attributes ?? '').matchAll(/\bxmlns(?::([\w.-]+))?\s*=\s*(["'])(.*?)\2/g)];
  if (!feedRoot || !namespaces.some(match => (match[1] ?? '') === prefix && match[3] === 'http://www.w3.org/2005/Atom')) throw new AlertImportError('FEED_PARSE');
  const feed = object(root.feed);
  const feedNamespace = feed['@_xmlns'];
  if (feedNamespace && feedNamespace !== 'http://www.w3.org/2005/Atom') throw new AlertImportError('FEED_PARSE');
  const rows = array(feed.entry).slice(0, alertFeedLimits.entries);
  const result: ParsedAlertFeed = { entries: [], entriesSeen: rows.length, skippedCount: 0, rejections: {} };
  const seen = new Set<string>();
  const now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(now)) throw new AlertImportError('FEED_PARSE');
  function skip(reason: string) { result.skippedCount++; result.rejections[reason] = (result.rejections[reason] ?? 0) + 1; }
  for (const row of rows) {
    const item = object(row);
    const title = plainText(text(item.title));
    const snippet = plainText(text(item.content) || text(item.summary));
    if (!title || title.length > 500 || !snippet || snippet.length > 3000) { skip('missing_or_oversized_text'); continue; }
    const sourceLink = array(item.link).map(object).find(link => !link['@_rel'] || link['@_rel'] === 'alternate');
    const source = canonicalAlertSource(String(sourceLink?.['@_href'] ?? ''), resourceType);
    if (!source) { skip('unsafe_or_wrong_source'); continue; }
    if (seen.has(source)) { skip('duplicate_in_feed'); continue; }
    seen.add(source);
    const feedTimestamp = Date.parse(text(item.published) || text(item.updated));
    if (!Number.isFinite(feedTimestamp) || feedTimestamp < now - alertFeedLimits.maxAgeDays * 86_400_000 || feedTimestamp > now + 86_400_000) { skip('missing_or_old_alert_date'); continue; }
    const body = `${title}\n${snippet}`;
    const rejected = rejection(body);
    if (rejected) { skip(rejected); continue; }
    const service = serviceIn(body);
    if (!service) { skip('service_mismatch'); continue; }
    // Contact extraction needs an explicit source label; absent details stay null.
    const contact = extractProjectContact(body, source);
    result.entries.push({ title, snippet, service, source_url: source, source_platform: new URL(source).hostname,
      feed_published_at: new Date(feedTimestamp).toISOString(), contact_name: contact.contactName, email: contact.contactEmail });
  }
  return result;
}

export async function fetchGoogleAlertsFeed(feedUrl: string, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<string> {
  if (!validateFeedUrl(feedUrl)) throw new AlertImportError('FEED_INVALID');
  const timeout = Math.min(alertFeedLimits.timeoutMs, Math.max(1, options.timeoutMs ?? alertFeedLimits.timeoutMs));
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(feedUrl, { method: 'GET', redirect: 'manual', cache: 'no-store',
      headers: { Accept: 'application/atom+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(timeout) });
  } catch { throw new AlertImportError('FEED_UNAVAILABLE'); }
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new AlertImportError('FEED_INVALID'); }
  if (!response.ok) { await response.body?.cancel(); throw new AlertImportError(response.status === 429 ? 'FEED_RATE_LIMIT' : 'FEED_UNAVAILABLE'); }
  if (Number(response.headers.get('content-length') ?? 0) > alertFeedLimits.bytes) { await response.body?.cancel(); throw new AlertImportError('FEED_TOO_LARGE'); }
  const reader = response.body?.getReader();
  if (!reader) throw new AlertImportError('FEED_PARSE');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > alertFeedLimits.bytes) { await reader.cancel(); throw new AlertImportError('FEED_TOO_LARGE'); }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof AlertImportError) throw error;
    throw new AlertImportError('FEED_UNAVAILABLE');
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
