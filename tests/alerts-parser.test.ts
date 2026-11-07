import test from 'node:test';
import assert from 'node:assert/strict';
import { alertFeedInputSchema, AlertImportError, validateFeedUrl } from '../lib/alerts/types';
import { alertFeedLimits, canonicalAlertSource, fetchGoogleAlertsFeed, parseGoogleAlertsFeed } from '../lib/alerts/feed';

const now = new Date('2026-11-07T10:00:00.000Z');
const feedUrl = 'https://www.google.com/alerts/feeds/123456789/987654321';
const xml = (entries = '') => `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Private fixture alert</title>${entries}</feed>`;
function entry(options: { url?: string; title?: string; snippet?: string; updated?: string } = {}) {
  return `<entry><id>fixture</id><title type="html"><![CDATA[${options.title ?? 'Website development request'}]]></title><link rel="alternate" href="${(options.url ?? 'https://buyer.org/projects/website').replaceAll('&', '&amp;')}"/><updated>${options.updated ?? now.toISOString()}</updated><content type="html"><![CDATA[${options.snippet ?? 'We are looking for a web development agency to rebuild our website.'}]]></content></entry>`;
}

test('only exact owner-generated Google Alerts RSS URLs are valid configuration', () => {
  assert.equal(validateFeedUrl(feedUrl), true);
  for (const url of ['http://www.google.com/alerts/feeds/1/2', 'https://google.com/alerts/feeds/1/2', 'https://www.google.com/alerts/feeds/1/2?token=private', 'https://www.google.com/alerts/feeds/1/2#fragment', 'https://www.google.com:443/alerts/feeds/1/2', 'https://user:password@www.google.com/alerts/feeds/1/2', 'https://www.google.com/alerts/feeds/a/b', 'https://evil.org/alerts/feeds/1/2', 'https://www.google.com/alerts/feeds/1/../2', `${feedUrl} `, 'http://127.0.0.1/']) assert.equal(validateFeedUrl(url), false, url);
  assert.equal(alertFeedInputSchema.safeParse({ resource_type: 'google_alerts', title: 'Website requests', feed_url: feedUrl, enabled: true }).success, true);
  assert.equal(alertFeedInputSchema.safeParse({ resource_type: 'google_alerts', title: 'Website requests', feed_url: feedUrl, enabled: true, owner_id: 'other' }).success, false);
});

test('Atom HTML/CDATA, Google source links and literal buyer requirements import as review-required requests', () => {
  const body = xml(entry({ title: '<b>Website</b> &amp; app request',
    url: 'https://www.google.com/url?rct=j&url=https%3A%2F%2Fbuyer.org%2Frequest%3Futm_source%3Dgoogle%26ref%3Dnotice&q=unused',
    snippet: 'Our company is looking for an external agency for <b>website development</b> and a mobile application. <br/>Project contact: Alex Taylor<br/>Email: alex@buyer.org' }));
  const result = parseGoogleAlertsFeed(body, 'google_alerts', { now });
  assert.equal(result.entriesSeen, 1); assert.equal(result.skippedCount, 0);
  assert.deepEqual(result.entries[0], { title: 'Website & app request',
    snippet: 'Our company is looking for an external agency for website development and a mobile application.\nProject contact: Alex Taylor\nEmail: alex@buyer.org',
    service: 'website_and_application', source_url: 'https://buyer.org/request?ref=notice', source_platform: 'buyer.org',
    feed_published_at: now.toISOString(), contact_name: 'Alex Taylor', email: 'alex@buyer.org' });
  assert.equal(Object.hasOwn(result.entries[0], 'published_at'), false, 'Feed/index date is never represented as original posting publication.');
});

test('missing contact data stays null; an empty feed is a successful zero-result response', () => {
  const result = parseGoogleAlertsFeed(xml(entry()), 'google_alerts', { now });
  assert.equal(result.entries[0].contact_name, null); assert.equal(result.entries[0].email, null);
  assert.deepEqual(parseGoogleAlertsFeed(xml(), 'google_alerts', { now }), { entries: [], entriesSeen: 0, skippedCount: 0, rejections: {} });
});

test('buyers may ask an agency to send a portfolio and timeline', () => {
  const result = parseGoogleAlertsFeed(xml(entry({ snippet: 'Looking for a web development agency. We need a new website. Please send your portfolio and timeline.' })), 'google_alerts', { now });
  assert.equal(result.entries.length, 1); assert.equal(result.skippedCount, 0);
});

test('the setup guide buyer phrases work without requiring a first-person pronoun', () => {
  for (const phrase of ['Looking for a development agency', 'Looking for a website developer', 'Looking for a web design agency', 'Looking for a mobile app developer']) {
    const result = parseGoogleAlertsFeed(xml(entry({ title: phrase, snippet: 'Website and application project brief. Please send your portfolio and timeline.' })), 'google_alerts', { now });
    assert.equal(result.entries.length, 1, phrase);
  }
});

test('LinkedIn resource retains actual public posts and deduplicates tracking/mobile variants', () => {
  const source = 'https://www.linkedin.com/posts/buyer_website-development-activity-1234?utm_source=google';
  const result = parseGoogleAlertsFeed(xml(entry({ url: source }) + entry({ url: source.replace('www.', '') }) + entry({ url: 'https://buyer.org/request' }) + entry({ url: 'https://www.linkedin.com/in/person' })), 'linkedin_posts', { now });
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].source_url, 'https://www.linkedin.com/posts/buyer_website-development-activity-1234');
  assert.equal(result.rejections.duplicate_in_feed, 1); assert.equal(result.rejections.unsafe_or_wrong_source, 2);
  assert.equal(canonicalAlertSource('https://m.linkedin.com/feed/update/urn:li:activity:123456/?tracking=other', 'linkedin_posts'), 'https://www.linkedin.com/feed/update/urn:li:activity:123456');
});

test('supplier marketing, jobs, non-development requests and stale/future alert entries are skipped', () => {
  const rows = [
    { snippet: 'We offer website development services. Contact our agency.' },
    { snippet: '[For Hire] Web developer available for your website.' },
    { snippet: '[Hiring] Full-time website developer, salary 80000. Join our team.' },
    { snippet: 'Are you looking for a web developer? Contact our agency.' },
    { title: 'Logo illustration request', snippet: 'We need a logo illustration agency.' },
    { snippet: 'Website redesign request for proposals. This project is closed.' },
    { updated: '2026-09-01T00:00:00Z' }, { updated: '2027-01-01T00:00:00Z' },
    { snippet: 'Our new website looks great. An agency made it.' },
  ];
  const result = parseGoogleAlertsFeed(xml(rows.map((row, index) => entry({ ...row, url: `https://buyer.org/request/${index}` })).join('')), 'google_alerts', { now });
  assert.equal(result.entries.length, 0); assert.equal(result.skippedCount, rows.length);
  assert.equal(result.rejections.supplier_marketing, 3); assert.equal(result.rejections.employment, 1);
});

test('unsafe or credential-bearing sources cannot be retained and source links are never fetched', () => {
  for (const url of ['javascript:alert(1)', 'http://127.0.0.1/private', 'http://10.0.0.1/', 'http://[::1]/', 'https://person:password@buyer.org/', 'https://buyer.local/', 'https://buyer.org:8080/', 'https://buyer.org/?api_key=private', 'https://buyer.org/?access_token=private']) {
    assert.equal(canonicalAlertSource(url, 'google_alerts'), null, url);
  }
  assert.equal(canonicalAlertSource('https://www.google.com/url?q=https%3A%2F%2Fbuyer.org%2Fproject%3Futm_source%3Dx%23fragment', 'google_alerts'), 'https://buyer.org/project');
});

test('malformed XML, DTD/entities, oversized responses and unrelated HTML are rejected safely', () => {
  for (const body of ['<feed><entry></feed>', '<html><body>Login required</body></html>', '<!DOCTYPE feed [<!ENTITY secret SYSTEM "file:///etc/passwd">]><feed>&secret;</feed>', '<feed xmlns="https://unrelated.org/"></feed>']) {
    assert.throws(() => parseGoogleAlertsFeed(body, 'google_alerts', { now }), error => error instanceof AlertImportError && error.code === 'FEED_PARSE');
  }
  assert.throws(() => parseGoogleAlertsFeed('x'.repeat(alertFeedLimits.bytes + 1), 'google_alerts', { now }), error => error instanceof AlertImportError && error.code === 'FEED_TOO_LARGE');
  const rows = Array.from({ length: 60 }, (_, index) => entry({ url: `https://buyer.org/request/${index}` })).join('');
  assert.equal(parseGoogleAlertsFeed(xml(rows), 'google_alerts', { now }).entries.length, 50);
});

test('fetch is bounded to one Google request without redirects, credentials or paid enrichment', async () => {
  let calls = 0;
  const result = await fetchGoogleAlertsFeed(feedUrl, { fetch: async (input, init) => {
    calls++; assert.equal(String(input), feedUrl); assert.equal(init?.redirect, 'manual'); assert.equal(init?.cache, 'no-store');
    assert.equal(init?.method, 'GET'); assert.equal(new Headers(init?.headers).get('authorization'), null);
    return new Response(xml(entry()), { status: 200, headers: { 'Content-Type': 'application/atom+xml' } });
  } });
  assert.equal(calls, 1); assert.equal(result, xml(entry()));
  await assert.rejects(fetchGoogleAlertsFeed('http://127.0.0.1/private', { fetch: async () => { throw new Error('Must not fetch'); } }), error => error instanceof AlertImportError && error.code === 'FEED_INVALID');
  await assert.rejects(fetchGoogleAlertsFeed(feedUrl, { fetch: async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } }) }), error => error instanceof AlertImportError && error.code === 'FEED_INVALID');
  await assert.rejects(fetchGoogleAlertsFeed(feedUrl, { fetch: async () => new Response('', { status: 429 }) }), error => error instanceof AlertImportError && error.code === 'FEED_RATE_LIMIT');
  await assert.rejects(fetchGoogleAlertsFeed(feedUrl, { fetch: async () => new Response('private detail', { status: 403 }) }), error => error instanceof AlertImportError && error.code === 'FEED_UNAVAILABLE');
  await assert.rejects(fetchGoogleAlertsFeed(feedUrl, { fetch: async () => new Response('x', { headers: { 'Content-Length': String(alertFeedLimits.bytes + 1) } }) }), error => error instanceof AlertImportError && error.code === 'FEED_TOO_LARGE');
  await assert.rejects(fetchGoogleAlertsFeed(feedUrl, { fetch: async () => new Response('x'.repeat(alertFeedLimits.bytes + 1)) }), error => error instanceof AlertImportError && error.code === 'FEED_TOO_LARGE');
  await assert.rejects(fetchGoogleAlertsFeed(feedUrl, { fetch: async () => { throw new Error(`Private feed ${feedUrl}`); } }), error => error instanceof AlertImportError && error.code === 'FEED_UNAVAILABLE' && !error.message.includes(feedUrl));
});
