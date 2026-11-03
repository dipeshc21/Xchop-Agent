import test from 'node:test';
import assert from 'node:assert/strict';
import { IntentProviderError, TavilyClient, hasTavilyKey, tavilyResponseLimits } from '../lib/intent/tavily';

const key = 'tvly-fixture-credential-not-a-real-account';
const input = { query: 'Website development request for proposals', limit: 10, maxAgeDays: 30 };
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const mock = (handler: (url: URL, init: RequestInit) => Response | Promise<Response>): typeof fetch => async (url, init) => handler(new URL(String(url)), init ?? {});
const row = { title: 'Website project request', url: 'https://buyer.com/procurement/website', content: 'Provider snippet must not substitute for evidence', raw_content: 'Published: 2026-10-30\nWe require an external supplier to build our website.', published_date: 'Fri, 30 Oct 2026 12:00:00 GMT' };
async function expectCode(task: () => Promise<unknown>, code: string) {
  await assert.rejects(task, error => error instanceof IntentProviderError && error.code === code);
}

test('project search uses fixed HTTPS endpoint, header authentication and explicit evidence options', async () => {
  let count = 0;
  const client = new TavilyClient(key, { fetch: mock((url, init) => {
    count++;
    assert.equal(url.href, 'https://api.tavily.com/search');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${key}`);
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    const body = JSON.parse(String(init.body));
    assert.equal(body.query, input.query); assert.equal(body.max_results, 10);
    assert.equal(body.include_raw_content, 'text'); assert.equal(body.include_answer, false);
    assert.equal(body.include_published_date, true); assert.equal(body.filter_by_published_date, false);
    assert.equal(body.auto_parameters, false); assert.equal(body.search_depth, 'basic');
    assert.equal(body.safe_search, true); assert.equal(body.max_age_hours, undefined, 'Cache freshness must not force every source through live fetch.');
    assert.equal(body.country, undefined, 'Search country hints cannot become buyer-location facts.');
    assert.match(body.start_date, /^\d{4}-\d{2}-\d{2}$/); assert.match(body.end_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((Date.parse(body.end_date) - Date.parse(body.start_date)) / 86_400_000, 30);
    assert.equal(String(init.body).includes(key), false);
    return json({ answer: 'Untrusted generated answer', results: [row], request_id: 'not-retained', api_key: key });
  }) });
  const result = await client.search(input);
  assert.deepEqual(result, { results: [{ title: row.title, url: row.url, rawContent: row.raw_content, publishedDate: row.published_date }] });
  assert.equal(count, 1); assert.equal(JSON.stringify(result).includes(key), false);
});

test('missing extracted content stays empty instead of inventing evidence from generated text', async () => {
  const client = new TavilyClient(key, { fetch: mock(() => json({ results: [{ ...row, raw_content: null, published_date: undefined }] })) });
  const result = await client.search(input);
  assert.equal(result.results[0].rawContent, ''); assert.equal(result.results[0].publishedDate, null);
  const invalidDate = new TavilyClient(key, { fetch: mock(() => json({ results: [{ ...row, published_date: 'not-a-date' }] })) });
  assert.equal((await invalidDate.search(input)).results[0].publishedDate, null);
});

test('search preserves date hints without asserting those are actual project dates', async () => {
  const dateHint = '2026-10-31';
  const text = 'This request was originally posted in 2021; site footer updated in 2026.';
  const client = new TavilyClient(key, { fetch: mock(() => json({ results: [{ ...row, raw_content: text, published_date: dateHint }] })) });
  const result = (await client.search(input)).results[0];
  assert.equal(result.rawContent, text); assert.equal(result.publishedDate, dateHint);
  assert.equal(Object.hasOwn(result, 'publishedAt'), false);
});

test('unsafe URLs and duplicate source links are not retained', async () => {
  const urls = ['javascript:alert(1)', 'http://127.0.0.1/private', 'http://10.0.0.1/', 'http://[::1]/', 'https://person:secret@buyer.com/', 'https://buyer.local/', 'https://buyer.com:8080/', 'https://buyer.com/?api_key=private', 'https://buyer.com/?access_token=private', row.url, row.url];
  const client = new TavilyClient(key, { fetch: mock(() => json({ results: urls.map(url => ({ ...row, url })) })) });
  const result = await client.search({ ...input, limit: 20 });
  assert.equal(result.results.length, 1); assert.equal(result.results[0].url, row.url);
});

test('result text and aggregate content are bounded before a request is cached', async () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ ...row, url: `https://buyer.com/request/${index}`, title: 't'.repeat(1000), raw_content: 'x'.repeat(50_000) }));
  const client = new TavilyClient(key, { fetch: mock(() => json({ results: rows })) });
  const result = await client.search(input);
  assert.equal(result.results.length, 4);
  assert.ok(result.results.every(item => item.rawContent.length === 50_000 && item.title.length <= 300));
  assert.equal(result.results.reduce((total, item) => total + item.rawContent.length, 0), tavilyResponseLimits.totalContentCharacters);
});

test('oversized source content is omitted whole rather than hiding trailing project status', async () => {
  const client = new TavilyClient(key, { fetch: mock(() => json({ results: [
    { ...row, url: 'https://buyer.com/oversized', raw_content: row.raw_content + 'x'.repeat(60_000) + '\nThis project is closed and awarded.' },
    row,
  ] })) });
  const result = await client.search(input);
  assert.equal(result.results.length, 1); assert.equal(result.results[0].url, row.url);
  assert.equal(result.results[0].rawContent, row.raw_content);
});

test('invalid inputs and placeholder keys fail before network access', async () => {
  for (const value of ['', 'test-api-key', 'tvly-YOUR_API_KEY', 'tvly-placeholder-secret-123456789', 'tvly-test-api-key-123456789', 'tvly-too-short']) {
    assert.equal(hasTavilyKey(value), false); assert.throws(() => new TavilyClient(value), error => error instanceof IntentProviderError && error.code === 'configuration');
  }
  let calls = 0;
  const client = new TavilyClient(key, { fetch: mock(() => { calls++; return json({ results: [] }); }) });
  for (const changed of [{ query: '' }, { query: 'x'.repeat(501) }, { query: 'query\ncontrol' }, { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { maxAgeDays: 0 }, { maxAgeDays: 91 }, { maxAgeDays: 1.5 }]) {
    await expectCode(() => client.search({ ...input, ...changed }), 'invalid_input');
  }
  assert.equal(calls, 0);
});

test('provider failures are static and never retry paid searches or echo credentials', async () => {
  for (const [status, code] of [[400, 'invalid_input'], [401, 'authentication'], [403, 'authentication'], [422, 'invalid_input'], [429, 'rate_limit'], [432, 'quota'], [433, 'quota'], [434, 'unavailable'], [503, 'unavailable']] as const) {
    let calls = 0;
    const client = new TavilyClient(key, { fetch: mock(() => { calls++; return json({ detail: { error: `credential=${key}; https://provider.test/?api_key=${key}` } }, status); }) });
    await assert.rejects(() => client.search(input), error => {
      assert.ok(error instanceof IntentProviderError); assert.equal(error.code, code);
      assert.equal(error.message.includes(key), false); assert.equal(String(error.stack).includes('api_key='), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('transport errors, timeouts, malformed responses and excessive result counts fail closed', async () => {
  const timeout = new TavilyClient(key, { timeoutMs: 5, fetch: mock(() => new Promise<Response>(() => {})) });
  await expectCode(() => timeout.search(input), 'unavailable');
  const transport = new TavilyClient(key, { fetch: mock(() => { throw new Error(`Bearer ${key}`); }) });
  await expectCode(() => transport.search(input), 'unavailable');
  const malformed = new TavilyClient(key, { fetch: mock(() => new Response(`not-json-${key}`)) });
  await expectCode(() => malformed.search(input), 'invalid_response');
  const missing = new TavilyClient(key, { fetch: mock(() => json({ answer: 'A fabricated project requirement.' })) });
  await expectCode(() => missing.search(input), 'invalid_response');
  const excessive = new TavilyClient(key, { fetch: mock(() => json({ results: [row, row] })) });
  await expectCode(() => excessive.search({ ...input, limit: 1 }), 'invalid_response');
  const embeddedError = new TavilyClient(key, { fetch: mock(() => json({ detail: { error: key }, results: [] })) });
  await expectCode(() => embeddedError.search(input), 'invalid_response');
});

test('response limits inspect both Content-Length and actual streamed bytes', async () => {
  const declared = new TavilyClient(key, { fetch: mock(() => json({ results: [] }, 200, { 'Content-Length': String(tavilyResponseLimits.bytes + 1) })) });
  await expectCode(() => declared.search(input), 'invalid_response');
  const oversized = new TavilyClient(key, { fetch: mock(() => json({ results: [{ ...row, raw_content: 'x'.repeat(tavilyResponseLimits.bytes + 1) }] })) });
  await expectCode(() => oversized.search(input), 'invalid_response');
});

test('missing-source extraction uses one fixed endpoint and requests complete source rather than query chunks', async () => {
  let calls = 0;
  const client = new TavilyClient(key, { fetch: mock((url, init) => {
    calls++;
    assert.equal(url.href, 'https://api.tavily.com/extract');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${key}`);
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.urls, [row.url]);
    assert.equal(body.format, 'text'); assert.equal(body.extract_depth, 'basic');
    assert.equal(body.query, undefined); assert.equal(body.chunks_per_source, undefined);
    assert.equal(body.include_answer, undefined); assert.equal(body.timeout, 10);
    assert.equal(String(init.body).includes(key), false);
    return json({ results: [{ ...row, title: 'Not trusted for extraction identity', published_date: '2026-11-01' }], failed_results: [], answer: `Never retained ${key}` });
  }) });
  const result = await client.extract({ urls: [row.url, `${row.url}?utm_campaign=discovery#details`] });
  assert.deepEqual(result, { results: [{ title: '', url: row.url, rawContent: row.raw_content, publishedDate: null }] });
  assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes(key), false);
});

test('extraction binds full content to requested public URLs and rejects ambiguous or failed sources', async () => {
  const base = 'https://buyer.com/request/';
  const client = new TavilyClient(key, { fetch: mock(() => json({
    results: [
      { ...row, url: `${base}one?utm_source=test#summary` },
      { ...row, url: `${base}unrequested`, raw_content: 'Unrelated source that must not be attributed to a requested project.' },
      { ...row, url: `${base}two`, raw_content: null, content: 'Search snippets cannot replace a failed extraction.' },
      { ...row, url: `${base}three`, raw_content: 'Earlier content for a conflicting duplicate response.' },
      { ...row, url: `${base}three`, raw_content: 'This duplicate says that the request is closed.' },
      { ...row, url: `${base}four` },
    ],
    failed_results: [{ url: `${base}four`, error: `Private provider error ${key}` }],
  })) });
  const result = await client.extract({ urls: ['one', 'two', 'three', 'four'].map(id => base + id) });
  assert.deepEqual(result, { results: [{ title: '', url: base + 'one', rawContent: row.raw_content, publishedDate: null }] });
  assert.equal(JSON.stringify(result).includes('Unrelated'), false); assert.equal(JSON.stringify(result).includes(key), false);
});

test('extraction failures stay empty without falling back to snippets or generated answers', async () => {
  const client = new TavilyClient(key, { fetch: mock(() => json({
    results: [], failed_results: [{ url: row.url, error: 'Could not read this page' }],
    answer: 'A generated project need', content: 'A search snippet with a project need',
  })) });
  assert.deepEqual(await client.extract({ urls: [row.url] }), { results: [] });
});

test('extraction validates URL and batch bounds before making any paid request', async () => {
  let calls = 0;
  const client = new TavilyClient(key, { fetch: mock(() => { calls++; return json({ results: [], failed_results: [] }); }) });
  const invalid = [[], Array(21).fill(row.url), ['file:///private'], ['https://127.0.0.1/private'],
    ['https://buyer.internal/request'], ['https://person:password@buyer.com/request'],
    ['https://buyer.com/request?api_key=private'], ['https://buyer.com/api_key=private'],
    ['https://buyer.com/request?signature=private'], ['https://buyer.com:8443/request']];
  for (const urls of invalid) await expectCode(() => client.extract({ urls }), 'invalid_input');
  assert.equal(calls, 0);
});

test('credential-shaped page content is omitted whole without discarding other safe search/extraction sources', async () => {
  const sensitive = 'provider-fixture-value-must-not-be-retained';
  for (const marker of [`api_key=${sensitive}`, `apikey=${sensitive}`, `access_token=${sensitive}`, `authorization=${sensitive}`, `"api_key":"${sensitive}"`, `"password": "${sensitive}"`]) {
    const client = new TavilyClient(key, { fetch: mock(() => json({ results: [
      { ...row, url: `${row.url}/unsafe`, raw_content: `${row.raw_content}\n${marker}` },
      { ...row, url: `${row.url}/unsafe-title`, title: marker }, row,
    ], failed_results: [] })) });
    const searched = await client.search(input);
    assert.deepEqual(searched.results.map(result => result.url), [row.url]);
    assert.equal(JSON.stringify(searched).includes(sensitive), false);
    const extracted = await client.extract({ urls: [row.url, `${row.url}/unsafe`] });
    assert.deepEqual(extracted.results.map(result => result.url), [row.url]);
    assert.equal(JSON.stringify(extracted).includes(sensitive), false);
  }
});

test('extraction omits oversized pages whole and bounds aggregate content without hiding trailing status', async () => {
  const urls = Array.from({ length: 6 }, (_, index) => `https://buyer.com/request/${index}`);
  const client = new TavilyClient(key, { fetch: mock(() => json({ results: [
    { url: urls[0], raw_content: 'x'.repeat(60_001) + '\nThis request is closed.' },
    ...urls.slice(1).map(url => ({ url, raw_content: 'x'.repeat(50_000) })),
  ], failed_results: [] })) });
  const result = await client.extract({ urls });
  assert.equal(result.results.length, 4); assert.ok(!result.results.some(result => result.url === urls[0]));
  assert.equal(result.results.reduce((total, result) => total + result.rawContent.length, 0), tavilyResponseLimits.totalContentCharacters);
});

test('extraction failures are redacted single-call outcomes, including malformed partial responses and timeout', async () => {
  for (const [status, code] of [[401, 'authentication'], [429, 'rate_limit'], [432, 'quota'], [503, 'unavailable']] as const) {
    let calls = 0;
    const client = new TavilyClient(key, { fetch: mock(() => { calls++; return json({ detail: { error: `credential=${key}` } }, status); }) });
    await assert.rejects(() => client.extract({ urls: [row.url] }), error => {
      assert.ok(error instanceof IntentProviderError); assert.equal(error.code, code);
      assert.equal(error.message.includes(key), false); return true;
    });
    assert.equal(calls, 1);
  }
  for (const body of [{ failed_results: [] }, { results: [], failed_results: { error: key } }, { results: Array(21).fill(row), failed_results: [] }]) {
    const client = new TavilyClient(key, { fetch: mock(() => json(body)) });
    await expectCode(() => client.extract({ urls: [row.url] }), 'invalid_response');
  }
  const timeout = new TavilyClient(key, { timeoutMs: 5, fetch: mock(() => new Promise<Response>(() => {})) });
  await expectCode(() => timeout.extract({ urls: [row.url] }), 'unavailable');
});
