import { supabaseConfigurationStatus } from '../config';
import { hasTavilyKey } from '../intent/tavily';
import type { ConnectionCheck, ProspectingConfig } from './types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const placeholder = /(?:your[-_ ]|placeholder|example|replace[-_ ]|changeme|dummy|test[-_ ]key)/i;
function privateValue(name: string) { return process.env[name]?.trim() ?? ''; }
function configuredSecret(name: string, minimum = 20) {
  const value = privateValue(name);
  return value.length >= minimum && !placeholder.test(value);
}
export function serviceRoleConfiguration() {
  const key = privateValue('SUPABASE_SERVICE_ROLE_KEY');
  let serviceRole = key.startsWith('sb_secret_') && key.length >= 30 && !placeholder.test(key);
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      serviceRole = payload.role === 'service_role' && key.length >= 60 && !placeholder.test(key);
    } catch { serviceRole = false; }
  }
  return { ready: serviceRole, message: serviceRole
    ? 'The server-only database credential is configured.'
    : 'Add a Supabase service-role or secret key as SUPABASE_SERVICE_ROLE_KEY on the server. Never use a publishable key here.' };
}
export function getAutomationOwnerId(): string | null {
  const owner = privateValue('AUTOMATION_OWNER_ID');
  return uuid.test(owner) ? owner : null;
}
export function assertAutomationOwner(ownerId: string) {
  const owner = getAutomationOwnerId();
  if (!owner || ownerId !== owner) throw new Error('This account is not bound to the automatic discovery worker.');
}
export function isLocalInngestDevelopment() {
  if (process.env.NODE_ENV === 'production' || !['1', 'true'].includes(privateValue('INNGEST_DEV'))) return false;
  try {
    const address = new URL(privateValue('APP_URL') || 'http://localhost:3000');
    return ['http:', 'https:'].includes(address.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname);
  } catch { return false; }
}
export function getProspectingReadiness(ownerId: string, config?: ProspectingConfig): {
  ready: boolean; ownerBound: boolean; checks: ConnectionCheck[];
} {
  const publicStatus = supabaseConfigurationStatus();
  const adminStatus = serviceRoleConfiguration();
  const ownerBound = Boolean(getAutomationOwnerId() && ownerId === getAutomationOwnerId());
  const projectSearch = hasTavilyKey(privateValue('TAVILY_API_KEY'));
  const local = isLocalInngestDevelopment();
  const unsafeDevelopment = process.env.NODE_ENV === 'production' && Boolean(privateValue('INNGEST_DEV'));
  const background = !unsafeDevelopment && (local || (configuredSecret('INNGEST_EVENT_KEY') && configuredSecret('INNGEST_SIGNING_KEY')));
  const lawfulBasis = !config || config.lawfulBasis.trim().length >= 10;
  const checks: ConnectionCheck[] = [
    { id: 'supabase', label: 'Supabase connection', ready: publicStatus.ready, message: publicStatus.message },
    { id: 'server-key', label: 'Server database access', ready: adminStatus.ready, message: adminStatus.message },
    { id: 'owner', label: 'Worker account', ready: ownerBound, message: ownerBound ? 'Automatic discovery is bound to your signed-in account.' : 'Set AUTOMATION_OWNER_ID to this account’s Supabase Auth user UUID on the server.' },
    { id: 'project-search', label: 'Public project-request search', ready: projectSearch, message: projectSearch ? 'Tavily is configured. Search results still need a dated buyer request, a matching service and source evidence before saving.' : 'Add your real Tavily API key as TAVILY_API_KEY on the server. Company/contact data alone cannot establish a project requirement.' },
    { id: 'scheduler', label: 'Background scheduler', ready: background, message: unsafeDevelopment ? 'Remove INNGEST_DEV from production before enabling signed hosted jobs.' : local ? 'Local Inngest development is configured. Keep both the app and Inngest dev server running.' : background ? 'Inngest event and signing keys are configured. Register the app endpoint in Inngest and keep hosting active.' : 'Configure INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY for hosted scheduling. Local development requires INNGEST_DEV=1 and a running Inngest dev server.' },
    { id: 'lawful-basis', label: 'Collection basis', ready: lawfulBasis, message: lawfulBasis ? 'A collection basis is recorded, or setup is being checked before enabling.' : 'Record the lawful basis for collecting relevant business prospects before enabling discovery.' },
  ];
  return { ready: checks.every(check => check.ready), ownerBound, checks };
}
