import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isSupabaseConfigured } from '@/lib/config';
import { hasSameOrigin } from '@/lib/request';
import { CsvImportError, csvImportLimits, importCsvLeads } from '@/lib/csv';
import { supabaseServer } from '@/lib/supabase/server';

const input = z.object({
  csv: z.string().min(1).max(csvImportLimits.characters),
  lawfulBasis: z.string().trim().max(2000).optional().default(''),
}).strict();
const maximumBodyBytes = 1_000_000;

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Submit the import from your workspace.' }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Connect Supabase before importing leads.' }, { status: 503 });
  if (Number(request.headers.get('content-length') ?? 0) > maximumBodyBytes) return NextResponse.json({ error: 'This file is too large. Import at most 25 rows and 200,000 characters.' }, { status: 413 });
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maximumBodyBytes) return NextResponse.json({ error: 'This file is too large.' }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return NextResponse.json({ error: 'The import could not be read. Choose a CSV file and try again.' }, { status: 400 }); }
  const parsed = input.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Choose a CSV file with at most 200,000 characters and a contact permission note of at most 2,000 characters.' }, { status: 400 });
  try {
    const db = await supabaseServer();
    const { data: { user }, error } = await db.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Your session has expired. Sign in and try again.' }, { status: 401 });
    const result = await importCsvLeads(parsed.data.csv, parsed.data.lawfulBasis, async lead => {
      const { error: createError } = await db.rpc('create_workspace_lead', { payload: lead }).single();
      return { error: createError };
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CsvImportError) return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: 'The database is unavailable. Try again shortly.' }, { status: 503 });
  }
}
