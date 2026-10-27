import { leadSchema, type ValidatedLead } from './lead-schema';

export const csvImportLimits = { characters: 200_000, rows: 25 } as const;
const allowedHeaders = ['company', 'website', 'contact_name', 'email', 'country', 'role', 'source', 'lawful_basis'] as const;
type CsvHeader = typeof allowedHeaders[number];
export type CsvIssue = { row: number; message: string };
export class CsvImportError extends Error {
  constructor(message: string, public readonly issues: CsvIssue[] = []) { super(message); this.name = 'CsvImportError'; }
}

/** RFC 4180 fields, including escaped quotes, quoted line breaks and UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  if (text.length > csvImportLimits.characters) throw new CsvImportError('Choose a CSV file containing at most 200,000 characters.');
  const input = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let record: string[] = [], field = '', quoted = false, closed = false;
  const finishField = () => { record.push(field); field = ''; closed = false; };
  const finishRecord = () => { finishField(); records.push(record); record = []; };
  for (let i = 0; i < input.length; i += 1) {
    const character = input[i];
    if (quoted) {
      if (character === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; }
        else { quoted = false; closed = true; }
      } else field += character;
      continue;
    }
    if (character === ',') { finishField(); continue; }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && input[i + 1] === '\n') i += 1;
      finishRecord(); continue;
    }
    if (closed) throw new CsvImportError('A quoted field has unexpected text after its closing quote. Export the file as CSV again.');
    if (character === '"') {
      if (field.length) throw new CsvImportError('A quote appears inside an unquoted field. Export the file as CSV again.');
      quoted = true;
    } else field += character;
  }
  if (quoted) throw new CsvImportError('A quoted field is not closed. Export the file as CSV again.');
  if (field.length || record.length || closed) finishRecord();
  return records;
}

export type PreparedCsvRow = { row: number; lead: ValidatedLead };
export function prepareCsvImport(csv: string, lawfulBasis = ''): PreparedCsvRow[] {
  const records = parseCsv(csv);
  if (!records.length) throw new CsvImportError('Choose a CSV file with a header and at least one lead.');
  const headers = records[0].map(value => value.trim().toLowerCase());
  if (headers.some(header => !allowedHeaders.includes(header as CsvHeader)) || new Set(headers).size !== headers.length) {
    throw new CsvImportError(`Use these column names once each: ${allowedHeaders.join(', ')}. Remove other columns.`);
  }
  if (!['company', 'email', 'country'].every(header => headers.includes(header))) {
    throw new CsvImportError('The CSV header must include company, email, and country.');
  }
  const data = records.slice(1).map((values, index) => ({ values, row: index + 2 }))
    .filter(({ values }) => values.some(value => value.trim().length));
  if (!data.length) throw new CsvImportError('The CSV contains no lead rows.');
  if (data.length > csvImportLimits.rows) throw new CsvImportError('Import at most 25 leads at a time. Split the file into smaller files.');
  const issues: CsvIssue[] = [], result: PreparedCsvRow[] = [];
  for (const { values, row } of data) {
    if (values.length !== headers.length) { issues.push({ row, message: 'The number of fields does not match the header.' }); continue; }
    const fields = Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]));
    const basis = fields.lawful_basis || lawfulBasis.trim();
    if (basis.length < 10) { issues.push({ row, message: 'Add a contact permission note of at least 10 characters in lawful_basis or in the import form.' }); continue; }
    const validated = leadSchema.safeParse({
      company: fields.company, email: fields.email, country: fields.country,
      website: fields.website || '', contact_name: fields.contact_name || '', role: fields.role || '',
      source: fields.source || 'CSV import', lawful_basis: basis, value: 0,
    });
    if (!validated.success) {
      const invalid = [...new Set(validated.error.issues.map(issue => String(issue.path[0] || 'fields')))];
      issues.push({ row, message: `Check these fields: ${invalid.join(', ')}.` });
    } else result.push({ row, lead: validated.data });
  }
  if (issues.length) throw new CsvImportError('Fix the listed rows and import the file again. No leads were added.', issues);
  return result;
}

type CreateError = { code?: string; message?: string };
export type CsvRowResult = { row: number; status: 'imported' | 'skipped' | 'not_processed'; message: string };
export type CsvImportResult = { imported: number; skipped: number; results: CsvRowResult[] };

/** Validation completes before the first database mutation. Existing guarded RPC owns policy checks. */
export async function importCsvLeads(
  csv: string, lawfulBasis: string,
  create: (lead: ValidatedLead) => Promise<{ error: CreateError | null }>,
): Promise<CsvImportResult> {
  const rows = prepareCsvImport(csv, lawfulBasis);
  const results: CsvRowResult[] = [];
  let stopMessage: string | null = null;
  for (const { row, lead } of rows) {
    if (stopMessage) { results.push({ row, status: 'not_processed', message: stopMessage }); continue; }
    let error: CreateError | null;
    try { ({ error } = await create(lead)); }
    catch { error = { message: 'DATABASE_UNAVAILABLE' }; }
    if (!error) { results.push({ row, status: 'imported', message: 'Lead saved.' }); continue; }
    let message = 'The database could not save this row. Remaining rows were not processed; retry the file after checking your connection.';
    if (error.code === '23505') message = 'This email already exists in your workspace.';
    else if (error.message === 'LEAD_SUPPRESSED') message = 'This email is on your do-not-contact, unsubscribe, or bounce list.';
    else if (error.message === 'LEAD_INDIA_EXCLUDED') message = 'India is excluded in your workspace Settings.';
    else if (error.message === 'LEAD_INVALID') message = 'The database rejected this row. Check its fields.';
    else if (error.message === 'LEAD_RATE_LIMIT') {
      message = 'The limit of 30 lead additions per minute was reached. Wait one minute before retrying this file.';
      stopMessage = 'Not processed because the rate limit was reached. Retry this file after one minute; existing emails will be skipped.';
    } else if (error.code === 'PGRST202' || error.code === '42883') {
      message = 'Run database migration 002_live_workspace.sql in Supabase before importing leads.';
      stopMessage = message;
    } else stopMessage = 'Not processed after a database error. Retry this file after checking your connection; existing emails will be skipped.';
    results.push({ row, status: 'skipped', message });
  }
  const imported = results.filter(result => result.status === 'imported').length;
  return { imported, skipped: results.length - imported, results };
}
