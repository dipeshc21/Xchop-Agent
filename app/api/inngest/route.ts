import { NextResponse, type NextRequest } from 'next/server';
import { serve } from 'inngest/next';
import { inngest, inngestEndpointStatus } from '@/lib/inngest/client';
import { prospectingFunctions } from '@/lib/inngest/functions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const handlers = serve({ client: inngest, functions: prospectingFunctions });

function unavailable() {
  const status = inngestEndpointStatus();
  return status.enabled ? null : NextResponse.json({ error: status.message }, { status: 503 });
}

// The official SDK verifies Inngest signatures in cloud mode. These routes do not accept
// browser-origin authorization or a public cron secret as a substitute for its signature.
export async function GET(request: NextRequest, context: unknown) {
  return unavailable() ?? handlers.GET(request, context);
}
export async function POST(request: NextRequest, context: unknown) {
  return unavailable() ?? handlers.POST(request, context);
}
export async function PUT(request: NextRequest, context: unknown) {
  return unavailable() ?? handlers.PUT(request, context);
}
