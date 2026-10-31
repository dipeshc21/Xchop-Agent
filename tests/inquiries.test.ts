import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/inquiries/route';
import RequestDetail, { type InquiryRecord } from '../components/intent/request-detail';
import LeadResearch from '../components/prospecting/lead-research';
import { publicEvidenceLink, sourcePlatform } from '../components/intent/evidence-fields';

const inquiry: InquiryRecord = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'Website and customer application project',
  request_text: 'We are seeking an agency to develop a website and a customer booking application.',
  service: 'website_and_application', source_url: 'https://procurement.example.org/notices/booking-project',
  platform: 'An untrusted stored platform label', published_at: '2026-10-30T00:00:00Z', deadline_at: null,
  country_code: 'US', buyer_name: null,
  discovery_query: 'APP-ONLY-QUERY for public application requests', discovered_at: '2026-10-31T00:00:00Z',
};
const labels = ['What they searched', 'What service they required', 'On which platform they searched', 'From where they appeared'];

test('project popup presents literal evidence in the four requested fields without inventing private searches', () => {
  const html = renderToStaticMarkup(createElement(RequestDetail, { inquiry, onClose() {} }));
  for (const label of labels) assert.ok(html.includes(label), `Missing requested field ${label}`);
  assert.ok(html.includes(inquiry.request_text));
  assert.ok(html.includes('Website and application development'));
  assert.ok(html.includes('Public request on procurement.example.org'));
  assert.ok(!html.includes(inquiry.platform), 'Platform comes from the source URL, not an untrusted label.');
  assert.ok(html.includes('Private search history is unavailable.'));
  assert.ok(html.includes('not which search engine the buyer used'));
  assert.ok(html.indexOf(inquiry.discovery_query) > html.indexOf('How this request was discovered'), 'The app query must be identified separately.');
  assert.ok(html.includes('30 Oct 2026'));
  assert.ok(html.includes('review availability'));
  assert.ok(!html.includes('Contact name') && !html.includes('Email'), 'A project request does not require a fabricated contact.');
});

test('legacy company contacts immediately show unknown requirements instead of repurposing fit or email data', () => {
  const html = renderToStaticMarkup(createElement(LeadResearch, {
    leadId: inquiry.id,
    source: 'Hunter official APIs: company discovery, enrichment, contact search and email verification',
  }));
  for (const label of labels) assert.ok(html.includes(label));
  assert.ok(html.includes('No published request recorded'));
  assert.ok(html.includes('Unconfirmed contact'));
  assert.ok(html.includes('Hunter contact discovery'));
  assert.equal((html.match(/>Unknown</g) ?? []).length, 2, 'Both service need and buyer search platform remain unknown.');
  assert.ok(!html.includes('Website development') && !html.includes('Application development'));
});

test('source links reject unsafe or credential-bearing destinations and retain exact public request links', () => {
  const url = 'https://procurement.example.org/notices/project?id=123';
  assert.equal(publicEvidenceLink(url), url);
  assert.equal(sourcePlatform('https://www.procurement.example.org/notices/project'), 'procurement.example.org');
  for (const value of [
    'javascript:alert(1)', 'file:///private/secret', 'https://name:password@buyer.org/request',
    'http://127.0.0.1/request', 'http://[::1]/request', 'http://localhost/request', 'https://private.internal/request',
    'https://buyer.org:8443/request', 'https://buyer.org/request?api_key=private', 'https://buyer.org/request?access_token=private',
  ]) assert.equal(publicEvidenceLink(value), null, value);
  const escaped = renderToStaticMarkup(createElement(RequestDetail, { inquiry: { ...inquiry, request_text: '<script>unsafe</script>' }, onClose() {} }));
  assert.ok(!escaped.includes('<script>unsafe</script>'));
  assert.ok(escaped.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
});

async function withConfiguration(values: Record<string, string | undefined>, task: () => Promise<void>) {
  const before = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('No provider access is expected for this boundary check.'); };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { await task(); assert.equal(fetches, 0); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test('inquiry reads fail closed without configuration and reject unsupported filters before any connection', async () => {
  await withConfiguration({ NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }, async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/inquiries'));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Connect Supabase/);
  });
  await withConfiguration({ NEXT_PUBLIC_SUPABASE_URL: 'https://configured.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_boundary_check', NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }, async () => {
    for (const query of ['service=unknown', 'country=IN']) {
      const response = await GET(new NextRequest(`http://localhost:3000/api/inquiries?${query}`));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /supported country and service/);
    }
  });
});
