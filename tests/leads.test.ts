import test from 'node:test';
import assert from 'node:assert/strict';
import { leadSchema, leadUpdateSchema } from '../lib/lead-schema';

const valid = {
  company: 'Agency Name',
  contact_name: 'Client Contact',
  email: 'Client@Agency.test ',
  country: 'United Kingdom',
  source: 'Website enquiry received by our business',
  lawful_basis: 'The contact requested a quote for their project.',
};

test('manual lead validation normalizes email and leaves real scores to later processing', () => {
  const lead = leadSchema.parse(valid);
  assert.equal(lead.email, 'client@agency.test');
  assert.equal(lead.value, 0);
  assert.equal(lead.website, '');
  assert.ok(!('score' in lead));
});

test('manual lead requires source, contact permission note, email and company', () => {
  for (const invalid of [{ source: ' ' }, { lawful_basis: '' }, { company: '' }, { email: 'invalid' }, { country: '' }]) {
    assert.equal(leadSchema.safeParse({ ...valid, ...invalid }).success, false);
  }
});

test('manual lead rejects executable website URLs and owner or score overrides', () => {
  for (const invalid of [{ website: 'not a website' }, { website: 'javascript:alert(1)' }, { website: 'ftp://agency.test' }, { owner_id: 'another-user' }, { score: 99 }, { stage: 'Won' }]) {
    assert.equal(leadSchema.safeParse({ ...valid, ...invalid }).success, false);
  }
  assert.equal(leadSchema.safeParse({ ...valid, website: 'https://agency.test' }).success, true);
});

test('manual lead value must be a finite non-negative number within database bounds', () => {
  for (const value of [-1, Infinity, NaN, 10000000000, '500', null, true]) {
    assert.equal(leadSchema.safeParse({ ...valid, value }).success, false);
  }
  assert.equal(leadSchema.safeParse({ ...valid, value: 500.25 }).success, true);
});

test('lead updates accept only known stages, real UUIDs and safe amounts', () => {
  const validUpdate = { id: '00000000-0000-4000-8000-000000000001', stage: 'Qualified', value: 1200 };
  assert.equal(leadUpdateSchema.safeParse(validUpdate).success, true);
  for (const invalid of [{ id: 'bad' }, { stage: 'Paid' }, { value: -1 }, { value: Infinity }, { owner_id: 'another-user' }, { email: 'new@agency.test' }]) {
    assert.equal(leadUpdateSchema.safeParse({ ...validUpdate, ...invalid }).success, false);
  }
});
