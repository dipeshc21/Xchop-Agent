import test from 'node:test';
import assert from 'node:assert/strict';
import { CsvImportError, importCsvLeads, parseCsv, prepareCsvImport } from '../lib/csv';

const basis = 'Existing business enquiry with contact permission.';
const header = 'company,email,country';
const valid = `${header}\nAgency,contact@agency.test,United States`;

test('CSV supports BOM, CRLF, commas, escaped quotes and quoted line breaks', () => {
  assert.deepEqual(parseCsv('\uFEFFcompany,email,country,source\r\n"A, ""B""",hello@agency.test,Canada,"Website\r\nenquiry"\r\n'), [
    ['company', 'email', 'country', 'source'], ['A, "B"', 'hello@agency.test', 'Canada', 'Website\r\nenquiry'],
  ]);
});
test('CSV rejects malformed quotes and unsafe headers', () => {
  for (const csv of ['a\n"unfinished', 'a\nun"quoted', 'a\n"done"suffix', 'company,email,email\na,a@a.test,b@b.test', 'company,email,country,owner_id\na,a@a.test,US,other']) {
    assert.throws(() => prepareCsvImport(csv, basis), CsvImportError);
  }
});
test('CSV validates and normalizes real records with explicit country and no synthetic score', () => {
  const result = prepareCsvImport('company,email,country,source,lawful_basis\nAgency,CONTACT@AGENCY.TEST,Canada,,', basis);
  assert.equal(result[0].row, 2);
  assert.equal(result[0].lead.email, 'contact@agency.test');
  assert.equal(result[0].lead.source, 'CSV import');
  assert.equal(result[0].lead.country, 'Canada');
  assert.equal(result[0].lead.lawful_basis, basis);
  assert.equal(result[0].lead.value, 0);
  assert.equal('score' in result[0].lead, false);
  assert.throws(() => prepareCsvImport('company,email,country\nAgency,a@agency.test,', basis), CsvImportError);
});
test('CSV enforces row, character, field count, website and collection-note boundaries', () => {
  for (const csv of [
    `${header}\nAgency,a@agency.test,US,extra`,
    `${header},website\nAgency,a@agency.test,US,javascript:alert(1)`,
    `${header}\n${Array.from({ length: 26 }, (_, i) => `A,a${i}@agency.test,Canada`).join('\n')}`,
    'a'.repeat(200_001),
  ]) assert.throws(() => prepareCsvImport(csv, basis), CsvImportError);
  assert.throws(() => prepareCsvImport(valid, 'short'), CsvImportError);
  assert.equal(prepareCsvImport(`${valid}\n\n`, basis).length, 1);
});
test('CSV validates every row before performing any writes', async () => {
  let writes = 0;
  await assert.rejects(importCsvLeads(`${valid}\nBroken,not-an-email,Canada`, basis, async () => { writes += 1; return { error: null }; }), CsvImportError);
  assert.equal(writes, 0);
});
test('CSV imports sequentially, reports policy skips and stops remaining writes on rate limit', async () => {
  const csv = `${header}\n${Array.from({ length: 6 }, (_, i) => `Agency,a${i}@agency.test,Canada`).join('\n')}`;
  const errors = [null, { code: '23505' }, { message: 'LEAD_SUPPRESSED' }, { message: 'LEAD_RATE_LIMIT' }];
  let calls = 0, active = 0;
  const result = await importCsvLeads(csv, basis, async () => {
    active += 1; assert.equal(active, 1);
    await Promise.resolve(); active -= 1;
    return { error: errors[calls++] };
  });
  assert.equal(calls, 4);
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 5);
  assert.deepEqual(result.results.map(row => row.status), ['imported', 'skipped', 'skipped', 'skipped', 'not_processed', 'not_processed']);
  assert.match(result.results[1].message, /already exists/);
  assert.match(result.results[2].message, /do-not-contact/);
});
test('CSV stops after unexpected database failures and never returns raw provider errors', async () => {
  let calls = 0;
  const result = await importCsvLeads(`${valid}\nOther,a@other.test,Canada`, basis, async () => { calls += 1; return { error: { message: 'sensitive provider details' } }; });
  assert.equal(calls, 1);
  assert.equal(result.results[1].status, 'not_processed');
  assert.doesNotMatch(JSON.stringify(result), /sensitive provider details/);
});
