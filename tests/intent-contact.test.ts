import test from 'node:test';
import assert from 'node:assert/strict';
import { extractProjectContact } from '../lib/intent/contact';

const source = 'https://procurement.buyer.org/requests/website-rebuild';
const none = { contactName: null, contactEmail: null, contactSourceUrl: null };

test('extracts an explicitly published project contact with a traceable source, without a verification claim', () => {
  const text = 'Published: 2026-11-02\nProject contact: Dr. Jane O’Neil\nEmail address: Jane.Oneil@Buyer.org\nDeadline: 2026-11-20';
  assert.deepEqual(extractProjectContact(text, source), { contactName: 'Dr. Jane O’Neil', contactEmail: 'jane.oneil@buyer.org', contactSourceUrl: source });
});

test('supports labelled procurement contact blocks and literal inline details', () => {
  assert.deepEqual(extractProjectContact('## Procurement contact\nName: Purchasing Team\nE-mail: bids@buyer.org', source),
    { contactName: 'Purchasing Team', contactEmail: 'bids@buyer.org', contactSourceUrl: source });
  assert.deepEqual(extractProjectContact('**Buyer contact:** Jane Smith, jane.smith@buyer.org', source),
    { contactName: 'Jane Smith', contactEmail: 'jane.smith@buyer.org', contactSourceUrl: source });
  assert.deepEqual(extractProjectContact('Project contact: Jane Smith — jane.smith@buyer.org', source),
    { contactName: 'Jane Smith', contactEmail: 'jane.smith@buyer.org', contactSourceUrl: source });
  assert.deepEqual(extractProjectContact('Project contact: Jane Smith, email: jane.smith@buyer.org', source),
    { contactName: 'Jane Smith', contactEmail: 'jane.smith@buyer.org', contactSourceUrl: source });
  assert.deepEqual(extractProjectContact('Procurement email: tenders@buyer.org', source),
    { contactName: null, contactEmail: 'tenders@buyer.org', contactSourceUrl: source });
});

test('keeps an expressly named contact when no email is published and never generates an address', () => {
  const text = 'Contact person: Alex Rivers\nCompany website: https://buyer.org\nWe are seeking a website developer.';
  assert.deepEqual(extractProjectContact(text, source), { contactName: 'Alex Rivers', contactEmail: null, contactSourceUrl: source });
  assert.deepEqual(extractProjectContact('Buyer: Alex Rivers\nCompany domain: buyer.org', source), none);
});

test('unlabelled emails, website footers, privacy contacts and support mailboxes do not become buyer contacts', () => {
  for (const text of [
    'We are seeking an agency. Any questions? jane@buyer.org',
    'Email: jane@buyer.org',
    'Contact email: hello@platform.org',
    'Contact us\nEmail: info@platform.org\nPrivacy policy',
    'Privacy contact: Data Protection Officer\nEmail: privacy@buyer.org',
    'Platform contact: Ann Administrator\nEmail: ann@platform.org',
    'Website contact: Jane Webmaster\nEmail: jane@buyer.org',
    'Contact information:\nEmail: support@platform.org',
    'Tender contact:\nEmail: jobs@buyer.org',
  ]) assert.deepEqual(extractProjectContact(text, source), none, text);
});

test('a contact block stops before footer contacts or an unrelated section', () => {
  assert.deepEqual(extractProjectContact('Project contact: Jane Smith\nEmail: jane@buyer.org\n\nPrivacy policy\nEmail: privacy@buyer.org', source),
    { contactName: 'Jane Smith', contactEmail: 'jane@buyer.org', contactSourceUrl: source });
  assert.deepEqual(extractProjectContact('Project contact: Jane Smith\n## Website support\nEmail: support@platform.org', source),
    { contactName: 'Jane Smith', contactEmail: null, contactSourceUrl: source });
  assert.deepEqual(extractProjectContact('Project contact: Jane Smith\n' + '\n'.repeat(9) + 'Email: another@buyer.org', source),
    { contactName: 'Jane Smith', contactEmail: null, contactSourceUrl: source });
});

test('conflicting names or mailboxes remain unknown instead of selecting an arbitrary contact', () => {
  for (const text of [
    'Project contact: Jane Smith\nEmail: jane@buyer.org\n\nProcurement contact: John Green\nEmail: john@buyer.org',
    'Project contact: Jane Smith\nEmail: jane@buyer.org and john@buyer.org',
    'Contact person: Jane Smith\nName: John Green\nEmail: jane@buyer.org',
  ]) assert.deepEqual(extractProjectContact(text, source), none, text);
});

test('a named person is not paired with a separate procurement mailbox without shared source context', () => {
  assert.deepEqual(extractProjectContact('Contact person: Jane Smith\n\nProcurement email: bids@buyer.org', source),
    { contactName: 'Jane Smith', contactEmail: null, contactSourceUrl: source });
});

test('only literal valid addresses and names are used; obfuscated addresses and placeholders stay missing', () => {
  assert.deepEqual(extractProjectContact('Project contact: Jane Smith\nEmail: jane [at] buyer [dot] org', source),
    { contactName: 'Jane Smith', contactEmail: null, contactSourceUrl: source });
  assert.deepEqual(extractProjectContact('Contact person: [Your name]\nEmail: user@localhost', source), none);
  assert.deepEqual(extractProjectContact('Project contact: Jane Smith\nEmail: invalid@@buyer.org', source),
    { contactName: 'Jane Smith', contactEmail: null, contactSourceUrl: source });
});

test('unsafe sources and oversized content cannot supply contact details', () => {
  const text = 'Project contact: Jane Smith\nEmail: jane@buyer.org';
  for (const url of ['http://127.0.0.1/request', 'https://buyer.internal/request', 'https://user:secret@buyer.org/request', 'https://buyer.org/request?api_key=private']) {
    assert.deepEqual(extractProjectContact(text, url), none);
  }
  assert.deepEqual(extractProjectContact(text + 'x'.repeat(60_000), source), none);
});

test('contact source uses the same safe canonical project URL and retains project identity', () => {
  assert.deepEqual(extractProjectContact('Procurement email: contracts@buyer.org', source + '?project=17&utm_source=alert#contact'),
    { contactName: null, contactEmail: 'contracts@buyer.org', contactSourceUrl: source + '?project=17' });
});

test('explicit proposal submission instructions can supply a public email without inventing a name', () => {
  for (const text of [
    'Submissions should be emailed to sarahr@westsiderc.org',
    'Please send your proposal to bids@buyer.org by the deadline.',
    'Email your tender submission to contracts@buyer.org.',
    'Project proposals must be submitted to Procurement@Buyer.org.',
  ]) {
    const email = text.match(/[A-Za-z]+@[A-Za-z.]+/)![0].toLowerCase().replace(/\.$/, '');
    assert.deepEqual(extractProjectContact(text, source), { contactName: null, contactEmail: email, contactSourceUrl: source });
  }
  for (const text of [
    'Questions? Email sarahr@westsiderc.org. We accept project proposals.',
    'We provide proposal writing support. Email help@platform.org.',
    'Privacy Policy\nSubmissions should be emailed to jane@privacy.org.',
    'Submit your job application to jobs@buyer.org.',
    'Please send your proposal to jane@buyer.org or john@buyer.org.',
  ]) assert.deepEqual(extractProjectContact(text, source), none, text);
  assert.deepEqual(extractProjectContact('A public project description.\n'.repeat(40) + 'Submissions should be emailed to bids@buyer.org', source),
    { contactName: null, contactEmail: 'bids@buyer.org', contactSourceUrl: source });
});

test('privacy and platform contact sections cannot supply otherwise valid-looking named contacts', () => {
  assert.deepEqual(extractProjectContact('## Privacy Policy\nContact person: Jane Smith\nEmail: jane@buyer.org', source), none);
  assert.deepEqual(extractProjectContact('Platform contact: Technical Helpdesk\nContact person: Jane Smith\nEmail: jane@platform.org', source), none);
  assert.deepEqual(extractProjectContact('Project contact\nPlease contact procurement\nEmail: procurement@buyer.org', source),
    { contactName: null, contactEmail: 'procurement@buyer.org', contactSourceUrl: source });
});
