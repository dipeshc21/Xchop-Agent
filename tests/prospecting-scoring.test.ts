import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreProspect, isVerifiedBusinessEmail } from '../lib/prospecting/scoring';
import type { CompanyFacts, EmailVerification, FoundContact } from '../lib/prospecting/types';

const facts: CompanyFacts = { domain: 'agency.com', name: 'Agency', description: 'A web design agency producing Figma website design.', industry: 'Design Services', countryCode: 'US', country: 'United States', timeZone: null, employeeCount: 12, tags: ['branding'] };
const contact: FoundContact = { email: 'owner@agency.com', firstName: 'A', lastName: 'Contact', role: 'Founder', confidence: 90, provenance: 'found', sources: [{ uri: 'https://agency.com/team', lastSeenOn: '2026-10-01' }] };
const verified: EmailVerification = { status: 'valid', checkedAt: '2026-10-01', acceptAll: false, disposable: false, webmail: false };

test('a sourced verified agency in a target country passes the default score threshold', () => {
  const result = scoreProspect(facts, contact, verified, ['US', 'GB']);
  assert.ok(result.score >= 65 && result.score <= 100);
  assert.equal(result.segment, 'Design agency');
  assert.match(result.reason, /Provider reports 12 employees/);
  assert.match(result.reason, /No conclusion about an in-house development team, budget, or permission/);
  assert.deepEqual(result, scoreProspect(facts, contact, verified, ['US', 'GB']));
});

test('scoring does not infer country from discovery filters or domain suffix', () => {
  for (const countryCode of ['', 'IN', 'CA']) assert.equal(scoreProspect({ ...facts, countryCode }, contact, verified, ['US']).score, 0);
});

test('accept-all, webmail, disposable, unknown, pending and claimed verifications cannot qualify', () => {
  for (const status of ['invalid', 'accept_all', 'webmail', 'disposable', 'unknown', 'pending', 'claimed'] as const) {
    assert.equal(scoreProspect(facts, contact, { ...verified, status }, ['US']).score, 0);
    assert.equal(isVerifiedBusinessEmail({ ...verified, status }), false);
  }
  for (const risk of [{ acceptAll: true }, { webmail: true }, { disposable: true }]) assert.equal(isVerifiedBusinessEmail({ ...verified, ...risk }), false);
});

test('inferred and unsourced contacts are excluded before they receive points', () => {
  assert.equal(scoreProspect(facts, { ...contact, provenance: 'inferred' }, verified, ['US']).score, 0);
  assert.equal(scoreProspect(facts, { ...contact, sources: [] }, verified, ['US']).score, 0);
});

test('an unrelated business remains below the default threshold without fabricated facts', () => {
  const result = scoreProspect({ ...facts, name: 'Farm', description: 'Supplies agricultural equipment.', industry: 'Agriculture', employeeCount: null, tags: [] }, { ...contact, role: '' }, verified, ['US']);
  assert.equal(result.score, 40);
  assert.equal(result.segment, 'Other business');
  assert.match(result.reason, /No priority customer segment established/);
});
