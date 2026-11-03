import type { EvidenceRejection, ProjectEvidence, ProjectQualification, ProjectSearchResult, RequestedService } from './types';

export type QualificationOptions = {
  countries: string[];
  services: ('website' | 'application')[];
  maxAgeDays: number;
  now?: Date;
};

const credentialParameter = /(?:^|[-_])(?:key|api[-_]?key|access[-_]?token|auth(?:orization)?|password|secret|signature|session(?:id)?|token)(?:$|[-_])/i;
const trackingParameter = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;

/** Source URLs are provenance, not fetch targets. The app never connects to them here. */
export function normalizeProjectUrl(value: string): string | null {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) ||
      hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(hostname) ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test|example|home|lan|onion)$/.test(hostname) ||
      /(?:^|\.)example\.(?:com|org|net)$/.test(hostname)) return null;
    for (const name of url.searchParams.keys()) if (credentialParameter.test(name) || /^x-amz-/i.test(name)) return null;
    for (const name of [...url.searchParams.keys()]) if (trackingParameter.test(name)) url.searchParams.delete(name);
    url.hostname = hostname;
    url.hash = '';
    url.searchParams.sort();
    return url.href.length <= 2000 ? url.href : null;
  } catch { return null; }
}

const monthNumbers: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const monthPattern = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const datePattern = `(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}(?:st|nd|rd|th)?[ \\t]+${monthPattern}[ \\t]+[0-9]{4}|${monthPattern}[ \\t]+[0-9]{1,2}(?:st|nd|rd|th)?(?:,[ \\t]*|[ \\t]+)[0-9]{4})`;
const publishedLabel = '(?:published(?:[ \\t]+(?:on|date))?|posted(?:[ \\t]+on)?|publication[ \\t]+date|date[ \\t]+(?:published|posted|issued)|issued(?:[ \\t]+on)?|notice[ \\t]+date|issue[ \\t]+date|date[ \\t]+of[ \\t]+publication)';
const deadlineLabel = '(?:deadline(?:[ \\t]+date)?|closing[ \\t]+date|closes(?:[ \\t]+on)?|bid[ \\t]+closing(?:[ \\t]+date)?|proposal[ \\t]+deadline|response[ \\t]+deadline|submission[ \\t]+deadline|applications?[ \\t]+close|due[ \\t]+date)';
type SourceField = { value: string; evidence: string };
const unmarkField = (value: string) => value.trim().replace(/^#{1,6}[ \t]+/, '').replace(/^[-*][ \t]+/, '').replace(/\*{1,2}/g, '').trim();

/** Recognize a field's layout, not its facts. Keep the untouched source fragment
 * for attribution and never turn a search snippet or footer into a source date. */
function sourceFields(content: string, label: string, directValue = false): SourceField[] {
  const lines = [...content.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)].map(match => ({ raw: match[1], start: match.index!, end: match.index! + match[1].length }));
  const labelOnly = new RegExp(`^${label}[ \\t]*(?::|[-–])?[ \\t]*$`, 'i');
  const inline = new RegExp(`^${label}(?:[ \\t]*(?::|[-–])[ \\t]*${directValue ? '|[ \\t]+' : ''})(.+)$`, 'i');
  const fields: SourceField[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], normalized = unmarkField(line.raw);
    if (!normalized) continue;
    if (normalized.includes('|')) {
      const cells = normalized.split('|').map(unmarkField);
      let tableField = false;
      for (let cell = 0; cell < cells.length - 1; cell++) {
        if (labelOnly.test(cells[cell])) { fields.push({ value: cells[cell + 1], evidence: line.raw.trim() }); tableField = true; }
      }
      if (tableField) continue;
    }
    if (labelOnly.test(normalized)) {
      let next = index + 1;
      while (next < lines.length && next <= index + 3 && !lines[next].raw.trim()) next++;
      const valueLine = next < lines.length && next <= index + 3 ? lines[next] : null;
      fields.push({ value: valueLine ? unmarkField(valueLine.raw) : '', evidence: content.slice(line.start, valueLine?.end ?? line.end).trim() });
      continue;
    }
    const match = inline.exec(normalized);
    if (match) fields.push({ value: unmarkField(match[1]), evidence: line.raw.trim() });
  }
  return fields;
}

const zoneOffsets: Record<string, number> = { Z: 0, UTC: 0, GMT: 0, CET: 60, CEST: 120, EST: -300, EDT: -240, PST: -480, PDT: -420, BST: 60 };
/** The date is the source's literal calendar date at UTC midnight. An explicitly
 * zoned clock additionally supplies an exact instant. Naked clocks, ambiguous
 * slash dates and unknown timezone abbreviations cannot supply an instant. */
export function parseProjectDateToken(token: string): { date: number; instant: number | null } | null {
  if (typeof token !== 'string' || token.length > 100) return null;
  const parts = new RegExp(`^(${datePattern})(.*)$`, 'i').exec(token);
  if (!parts) return null;
  const dateToken = parts[1];
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateToken);
  if (iso) { year = Number(iso[1]); month = Number(iso[2]) - 1; day = Number(iso[3]); }
  else {
    const dayFirst = /^(\d{1,2})(st|nd|rd|th)?[ \t]+([A-Za-z]+)[ \t]+(\d{4})$/i.exec(dateToken);
    const monthFirst = /^([A-Za-z]+)[ \t]+(\d{1,2})(st|nd|rd|th)?(?:,[ \t]*|[ \t]+)(\d{4})$/i.exec(dateToken);
    let ordinal: string | undefined;
    if (dayFirst) { year = Number(dayFirst[4]); month = monthNumbers[dayFirst[3].toLowerCase()]; day = Number(dayFirst[1]); ordinal = dayFirst[2]; }
    else if (monthFirst) { year = Number(monthFirst[4]); month = monthNumbers[monthFirst[1].toLowerCase()]; day = Number(monthFirst[2]); ordinal = monthFirst[3]; }
    else return null;
    const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
    if (ordinal && ordinal.toLowerCase() !== suffix) return null;
  }
  if (!Number.isInteger(month) || year < 2000 || year > 2100 || day < 1 || day > 31) return null;
  const value = new Date(Date.UTC(year, month, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month || value.getUTCDate() !== day) return null;
  const date = value.getTime();
  if (!parts[2]) return { date, instant: null };
  const timePart = /^(?:T|[ \t]+(?:at[ \t]+)?|,[ \t]+(?:at[ \t]+)?)(.+)$/i.exec(parts[2]);
  if (!timePart) return null;
  const clock = /^(\d{1,2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?[ \t]*(AM|PM)?[ \t]*(Z|UTC|GMT|CET|CEST|EST|EDT|PST|PDT|BST|(?:UTC|GMT)?[+-]\d{2}:?\d{2})$/i.exec(timePart[1]);
  if (!clock || (!clock[2] && !clock[5])) return null;
  let hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0), second = Number(clock[3] ?? 0), milliseconds = Number((clock[4] ?? '').padEnd(3, '0'));
  if (minute > 59 || second > 59) return null;
  if (clock[5]) { if (hour < 1 || hour > 12) return null; hour = hour % 12 + (clock[5].toUpperCase() === 'PM' ? 12 : 0); }
  else if (hour > 23) return null;
  const zone = clock[6].toUpperCase();
  let offset = zoneOffsets[zone];
  if (offset === undefined) {
    const numeric = /^(?:UTC|GMT)?([+-])(\d{2}):?(\d{2})$/.exec(zone);
    if (!numeric) return null;
    const hours = Number(numeric[2]), minutes = Number(numeric[3]);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
    offset = (hours * 60 + minutes) * (numeric[1] === '-' ? -1 : 1);
  }
  return { date, instant: date + hour * 3_600_000 + minute * 60_000 + second * 1000 + milliseconds - offset * 60_000 };
}

function labelledDates(content: string, label: string) {
  const dates: { token: string; time: number; instant: number | null }[] = [];
  for (const field of sourceFields(content, label, true)) {
    const parsed = parseProjectDateToken(field.value);
    // Unparsed deadlines must not silently disappear or become an invented cutoff.
    if (!parsed || !content.includes(field.value)) return null;
    dates.push({ token: field.value, time: parsed.date, instant: parsed.instant });
  }
  return dates;
}

const countryPatterns: Record<string, RegExp> = {
  US: /\b(?:United States(?: of America)?|USA)\b/i,
  GB: /\b(?:United Kingdom|Great Britain|Northern[ \t]+Ireland|UK)\b/i,
  CA: /\bCanada\b/i, AU: /\bAustralia\b/i,
  AE: /\b(?:United Arab Emirates|UAE)\b/i,
  DE: /\b(?:Germany|Deutschland)\b/i, FR: /\bFrance\b/i,
  NL: /\bNetherlands\b/i, IE: /\bIreland\b/i,
  NZ: /\bNew Zealand\b/i, SG: /\bSingapore\b/i,
  SE: /\bSweden\b/i, CH: /\bSwitzerland\b/i,
  IN: /\bIndia\b/i,
};
function buyerCountry(content: string) {
  const label = '(?:(?:(?:buyer|client|project|organisation|organization|contracting authority|authority)[ \\t]+)?(?:country|location|address)|headquarters|place of performance)';
  const countries = new Map<string, string>();
  for (const field of sourceFields(content, label)) {
    const value = field.value;
    if (value.length > 180 || field.evidence.length > 300) continue;
    // A location such as "Remote / worldwide" is not a buyer country.
    if (/\b(?:worldwide|global|anywhere|remote only)\b/i.test(value)) continue;
    const explicitCode = value.trim().replace(/\*{1,2}$/, '').trim().toUpperCase();
    if (/country/i.test(field.evidence) && Object.hasOwn(countryPatterns, explicitCode)) countries.set(explicitCode, field.evidence);
    for (const [code, pattern] of Object.entries(countryPatterns)) {
      const countryValue = code === 'IE' ? value.replace(/\bNorthern[ \t]+Ireland\b/gi, '') : value;
      if (pattern.test(countryValue)) countries.set(code, field.evidence);
    }
  }
  if (countries.has('IN')) return { code: 'IN', evidence: countries.get('IN')! };
  if (countries.size !== 1) return null;
  const [code, evidence] = [...countries.entries()][0];
  return { code, evidence };
}

const employment = /\b(?:full[- ]time|part[- ]time|permanent (?:position|role|employment)|salaried|annual salary|salary range|employee benefits|employment type|job vacancy|job opening|career opportunity|apply for (?:this|the) (?:job|position)|join our team as|resume and cover letter|r[eé]sum[eé] and cover letter)\b/i;
const supplier = /\b(?:i will (?:build|develop|design|create)|we (?:offer|provide|speciali[sz]e in) (?:professional |custom |affordable )?(?:web(?:site)?|app(?:lication)?|software|development|digital)|our (?:web(?:site)?|app(?:lication)?|software) development services|hire us|choose our agency|get (?:a|your) free (?:quote|consultation)|we can (?:build|develop|design) your|you(?:'re| are) (?:seeking|looking for) (?:an? |the )?(?:web(?:site)?|app(?:lication)?|software|development)|(?:sample|example|hypothetical|illustrative|fictional) (?:buyer |project )?(?:request|rfp|inquiry|brief)|(?:request|rfp|project brief) (?:sample|example|template))\b/i;
const articleTitle = /\b(?:how to|step[- ]by[- ]step|tutorial|a guide to|complete guide|tips for|case study|case studies|sample (?:rfp|request)|example (?:rfp|request|project brief)|(?:rfp|request for proposal) template|agency directory)\b/i;
const closed = /\b(?:status|notice status|project status|tender status)[ \t]*[:\-][ \t]*(?:closed|cancelled|canceled|awarded|expired|withdrawn)\b|\b(?:this (?:project|request|opportunity|tender|notice) (?:is|has been) (?:closed|cancelled|canceled|awarded|withdrawn)|no longer accepting (?:proposals|bids|applications)|contract award notice)\b/i;
const archived = /\b(?:archived|historical|archive of|past (?:projects?|opportunities|tenders?))\b/i;
const notSoliciting = /\b(?:not (?:a|an) (?:request for proposals?|solicitation|tender)|not (?:currently )?(?:seeking|looking for) (?:an? |new )?(?:agency|vendor|development|developer)|no (?:current|active|open) (?:project|requirement|tender)|for information only|market research only|no (?:proposals?|bids?) (?:are|will be) (?:requested|accepted)|not accepting (?:proposals?|bids?))\b/i;
const procurement = /\b(?:request for (?:proposals?|quotations?|bids?|tenders?)|invitation to (?:bid|tender|quote)|(?:seeks?|invites?|requests?) (?:qualified )?(?:proposals?|quotations?|bids?|tenders?))\b/i;
const buyerAction = /\b(?:(?:we|i) (?:are |am )?(?:looking for|seeking|need|require)|(?:is|are) (?:looking for|seeking)|seeks? (?:a |an |qualified |experienced )?(?:agency|vendor|contractor|freelancer|development team|development partner))\b/i;
const externalProvider = /\b(?:agenc(?:y|ies)|vendors?|suppliers?|contractors?|freelancers?|consultants?|development (?:team|partner)|software (?:team|partner)|external (?:team|developer)|outsourc(?:e|ed|ing)|proposals?|quotations?|bids?|tenders?)\b/i;
const developmentAction = /\b(?:build|building|develop|developing|development|design|designing|redesign|redesigning|redevelop|redevelopment|rebuild|rebuilding|create|creating|implement|implementation|upgrade|upgrading|migrate|migration|customi[sz]e|customi[sz]ation|integrate|integration)\b/i;
const websiteWork = /\b(?:web[ -]?sites?|wordpress|shopify|e[ -]?commerce|online (?:store|shop)|landing pages?|web portal)\b/i;
const applicationWork = /\b(?:(?:mobile|web|software|business|android|ios|iphone|customer|booking) (?:applications?|apps?)|(?:android|ios) (?:development|developer)|application development|app development|(?:custom|bespoke) software)\b/i;

function detectService(text: string): RequestedService | null {
  const website = websiteWork.test(text), application = applicationWork.test(text);
  return website && application ? 'website_and_application' : website ? 'website' : application ? 'application' : null;
}
function buyerRequest(text: string) {
  return developmentAction.test(text) && (procurement.test(text) || (buyerAction.test(text) && externalProvider.test(text)));
}
function requestExcerpt(content: string) {
  const markers = /\b(?:request for (?:proposals?|quotations?|bids?|tenders?)|invitation to (?:bid|tender|quote)|(?:we|i) (?:are |am )?(?:looking for|seeking|need|require)|(?:is|are) (?:looking for|seeking)|seeks?|invites?|requests?)\b/gi;
  for (const marker of content.matchAll(markers)) {
    const index = marker.index!;
    const lineStart = content.lastIndexOf('\n', index) + 1;
    const newline = content.indexOf('\n', index);
    const lineEnd = newline < 0 ? content.length : newline;
    const line = content.slice(lineStart, lineEnd).trim();
    if (line.length >= 30 && line.length <= 3000 && buyerRequest(line) && detectService(line)) return line;
    // A real notice can put its scope on the next line. Preserve the source's
    // literal characters rather than synthesizing a description or search phrase.
    const windowEnd = Math.min(content.length, lineStart + 1800);
    const nextBlank = /\r?\n[ \t]*\r?\n/.exec(content.slice(lineEnd, windowEnd));
    const paragraphEnd = nextBlank ? lineEnd + nextBlank.index : windowEnd;
    const paragraph = content.slice(lineStart, paragraphEnd).trim();
    if (paragraph.length >= 30 && paragraph.length <= 3000 && buyerRequest(paragraph) && detectService(paragraph)) return paragraph;
  }
  return null;
}
function explicitBuyer(content: string) {
  const match = /^[ \t]*(?:[-*][ \t]+)?\*{0,2}(?:buyer|client|contracting authority|organisation|organization)[ \t]*\*{0,2}[ \t]*[:\-][ \t]*\*{0,2}([^\r\n]{2,200})/im.exec(content);
  if (!match) return null;
  const value = match[1].trim().replace(/\*{1,2}$/, '').trim();
  return value.length >= 2 && value.length <= 200 ? value : null;
}
const rejected = (reason: EvidenceRejection): ProjectQualification => ({ qualified: false, reason });

function primaryRequestBody(content: string, requestText: string | null) {
  if (!requestText) return content;
  const requestEnd = content.indexOf(requestText) + requestText.length;
  // Extracted pages commonly append unrelated vacancies or agency promotions.
  // Only an explicit separate footer after the literal request can be ignored;
  // job metadata or supplier claims in the primary notice still veto acceptance.
  const footer = /^[ \t]*(?:#{1,6}[ \t]+)?(?:\*{1,2})?(?:related (?:jobs?|opportunities|posts?|articles?)|recommended (?:jobs?|posts?|articles?)|other (?:jobs?|vacancies|opportunities)|you may also like|more (?:jobs?|opportunities)|footer)(?:\*{1,2})?[ \t]*:?[ \t]*$/gim;
  for (const match of content.matchAll(footer)) if (match.index! >= requestEnd) return content.slice(0, match.index);
  return content;
}

/** Conservative, deterministic qualification of an explicit public buyer request.
 * Search snippets, estimated search dates, relevance scores and app query terms
 * are never evidence of buyer need, location or private search history. */
export function qualifyProjectRequest(result: ProjectSearchResult, options: QualificationOptions): ProjectQualification {
  const sourceUrl = normalizeProjectUrl(result?.url);
  if (!sourceUrl) return rejected('unsafe_source');
  const content = typeof result.rawContent === 'string' ? result.rawContent : '';
  const title = typeof result.title === 'string' ? result.title.trim() : '';
  if (content.length < 80 || content.length > 60_000 || !title || title.length > 300) return rejected('missing_content');
  const url = new URL(sourceUrl);
  const requestText = requestExcerpt(content);
  const primaryBody = primaryRequestBody(content, requestText);
  if (/\/(?:blog|articles?|guides?|tutorials?|case-studies|portfolio|director(?:y|ies))(?:\/|$)/i.test(url.pathname) || articleTitle.test(title) || supplier.test(`${title}\n${primaryBody}`)) return rejected('supplier_marketing');
  if (employment.test(`${title}\n${primaryBody}`)) return rejected('employment');
  if (/\/(?:archive|archives|archived)(?:\/|$)/i.test(url.pathname) || archived.test(title)) return rejected('closed');
  if (closed.test(`${title}\n${content}`) || /^(?:closed|cancelled|canceled|awarded|expired|withdrawn)\b/i.test(title)) return rejected('closed');
  if (notSoliciting.test(content)) return rejected('not_buyer_request');
  if (!requestText) return rejected('not_buyer_request');
  const service = detectService(requestText);
  if (!service || (service === 'website_and_application'
    ? !options.services.includes('website') || !options.services.includes('application')
    : !options.services.includes(service))) return rejected('service_mismatch');

  const publicationDates = labelledDates(content, publishedLabel);
  if (!publicationDates?.length) return rejected('missing_date');
  // Multiple updates or comments must never make an old request appear new.
  const publication = [...publicationDates].sort((a, b) => a.time - b.time)[0];
  const now = options.now?.getTime() ?? Date.now();
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  if (!Number.isFinite(now) || !Number.isInteger(options.maxAgeDays) || options.maxAgeDays < 1 || options.maxAgeDays > 90 ||
    publication.time > today.getTime() || (publication.instant !== null && publication.instant > now) ||
    now - publication.time > options.maxAgeDays * 86400_000) return rejected('stale');

  const deadlines = labelledDates(content, deadlineLabel);
  if (deadlines === null) return rejected('expired');
  const cutoff = (value: { time: number; instant: number | null }) => value.instant ?? value.time + 86400_000 - 1;
  const deadline = deadlines.length ? [...deadlines].sort((a, b) => cutoff(a) - cutoff(b))[0] : null;
  const deadlineTime = deadline ? cutoff(deadline) : null;
  if (deadlineTime !== null && (deadlineTime < now || deadlineTime < (publication.instant ?? publication.time))) return rejected('expired');
  const country = buyerCountry(content);
  if (!country) return rejected('country_unknown');
  if (country.code === 'IN' || !options.countries.includes(country.code)) return rejected('country_excluded');
  const evidence: ProjectEvidence = {
    version: 1, title, requestText, service, sourceUrl,
    platform: url.hostname.toLowerCase().replace(/^www\./, ''),
    publishedAt: new Date(publication.time).toISOString(), publishedDateText: publication.token,
    deadlineAt: deadlineTime === null ? null : new Date(deadlineTime).toISOString(), deadlineText: deadline?.token ?? null,
    countryCode: country.code, countryEvidence: country.evidence, buyerName: explicitBuyer(content),
  };
  return { qualified: true, evidence };
}
