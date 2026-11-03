import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isSupabaseConfigured } from '@/lib/config';
import { countryNames } from '@/lib/prospecting/types';
import { requestedServiceSchema } from '@/lib/intent/types';
import { supabaseServer } from '@/lib/supabase/server';
import { indiaDayWindow, inquiryPeriod } from '@/lib/intent/day-window';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 50;
const inquiryColumns = 'id,title,request_text,service,source_url,platform,published_at,deadline_at,country_code,buyer_name,discovery_query,discovered_at';
const contactColumns = `${inquiryColumns},contact_name,contact_email,contact_source_url`;
const timestamp = z.string().max(50).refine(value => Number.isFinite(Date.parse(value)));
const publicSource = z.string().max(2000).refine(value => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
      (!url.port || ['80', '443'].includes(url.port)) &&
      !Array.from(url.searchParams.keys()).some(name => /(?:api[-_]?key|access[-_]?token|authorization|password|secret|signature|(?:^|[-_])token$)/i.test(name)) &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|invalid|test|example|home|lan|onion)$/i.test(url.hostname);
  } catch { return false; }
});
const inquirySchema = z.object({
  id: z.uuid(), title: z.string().min(1).max(500), request_text: z.string().min(1).max(3000),
  service: requestedServiceSchema, source_url: publicSource, platform: z.string().min(1).max(253),
  published_at: timestamp, deadline_at: timestamp.nullable(), country_code: z.string().length(2),
  buyer_name: z.string().max(300).nullable(), discovery_query: z.string().max(500), discovered_at: timestamp,
  contact_name: z.string().max(200).nullable().optional(),
  contact_email: z.email().max(254).nullable().optional(),
  contact_source_url: publicSource.nullable().optional(),
}).strip();

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Connect Supabase using the setup guide first.' }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const q = (params.get('q') ?? '').trim().slice(0, 100);
  const country = (params.get('country') ?? '').trim().toUpperCase();
  const service = (params.get('service') ?? '').trim();
  const period = inquiryPeriod(params.get('period'));
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.get('p') ?? '1', 10) || 1));
  if (!period) return NextResponse.json({ error: 'Choose New today or Saved requests.' }, { status: 400 });
  if ((country && !Object.hasOwn(countryNames, country)) || (service && !requestedServiceSchema.safeParse(service).success)) {
    return NextResponse.json({ error: 'Choose a supported country and service filter.' }, { status: 400 });
  }
  try {
    const db = await supabaseServer();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Sign in to view your project requests.' }, { status: 401 });
    const ownerId = user.id;
    const settings = await db.from('prospecting_settings').select('data').eq('owner_id', user.id).maybeSingle();
    if (settings.error) {
      if (['PGRST205', '42P01'].includes(settings.error.code ?? '')) {
        return NextResponse.json({ migrationReady: false, inquiries: [], pagination: null,
          message: 'Install migration 006_project_requests.sql after the earlier database migrations.' },
        { headers: { 'Cache-Control': 'private, no-store' } });
      }
      return NextResponse.json({ error: 'Discovery settings could not be read. Check your database connection and access.' }, { status: 503 });
    }
    const maxAgeDays = settings.data?.data?.maxAgeDays ?? 30;
    if (!Number.isSafeInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 90) {
      return NextResponse.json({ error: 'Check the maximum request age in your saved discovery settings.' }, { status: 503 });
    }
    const now = new Date();
    const dayWindow = period === 'today' ? indiaDayWindow(now) : null;
    const cutoff = new Date(now.getTime() - maxAgeDays * 86_400_000).toISOString();
    function requestQuery(columns: string) {
    let query = db.from('project_requests').select(columns, { count: 'exact' }).eq('owner_id', ownerId);
    // New discoveries must still be recent and open. Saved history remains
    // accessible after the source deadline, so follow-up records do not vanish.
    if (period === 'today') query = query.gte('published_at', cutoff).or(`deadline_at.is.null,deadline_at.gte.${now.toISOString()}`);
    query = query.order('discovered_at', { ascending: false }).order('id', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (q) query = query.ilike('title', `%${q.replace(/[\\%_]/g, '\\$&')}%`);
    if (dayWindow) query = query.gte('discovered_at', dayWindow.start).lt('discovered_at', dayWindow.end);
    if (country) query = query.eq('country_code', country);
    if (service) query = service === 'website_and_application'
      ? query.eq('service', service) : query.in('service', [service, 'website_and_application']);
    return query;
    }
    let result = await requestQuery(contactColumns);
    let contactStorageReady = true;
    if (result.error && ['42703', 'PGRST204'].includes(result.error.code ?? '') && /contact_(?:name|email|source_url)/i.test(result.error.message ?? '')) {
      // Migration 007 is additive: keep existing request lists usable before it
      // is installed, without hiding contact columns once they are available.
      contactStorageReady = false;
      result = await requestQuery(inquiryColumns);
    }
    const { data, error, count } = result;
    if (error) {
      if (['PGRST205', '42P01'].includes(error.code ?? '')) {
        return NextResponse.json({ migrationReady: false, inquiries: [], pagination: null,
          message: 'Install migration 006_project_requests.sql from the Lead discovery setup guide.' },
        { headers: { 'Cache-Control': 'private, no-store' } });
      }
      return NextResponse.json({ error: 'Project requests could not be read. Check your database connection and access.' }, { status: 503 });
    }
    const parsed = z.array(inquirySchema).safeParse(data ?? []);
    if (!parsed.success || !Number.isSafeInteger(count) || count === null || count < 0) {
      return NextResponse.json({ error: 'Project request evidence could not be read. Check migration 006 and your stored records.' }, { status: 503 });
    }
    return NextResponse.json({ migrationReady: true, contactStorageReady, inquiries: parsed.data, period, dayWindow,
      pagination: { page, pageSize: PAGE_SIZE, total: count }, maxAgeDays },
    { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'The database connection is unavailable. Please try again.' }, { status: 503 });
  }
}
