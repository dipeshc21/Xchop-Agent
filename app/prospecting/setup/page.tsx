import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Cloud, Database, KeyRound, ShieldCheck } from 'lucide-react';
import ProspectingSetupActions from '@/components/prospecting/setup-actions';

export const dynamic = 'force-dynamic';

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

export default async function ProspectingSetupPage() {
  return <main className="setup-shell">
    <Link href="/prospecting" style={{ display: 'inline-flex', gap: 7, alignItems: 'center', fontSize: 12 }}><ArrowLeft size={15} /> Back to lead discovery</Link>
    <div className="eyebrow" style={{ marginTop: 30 }}>AUTOMATIC LEAD DISCOVERY · SETUP</div>
    <h1>Let your workspace find new opportunities.</h1>
    <p>Connect Hunter for real business contacts and Inngest for scheduled runs. Hosting the app keeps the schedule working while your computer is off.</p>
    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Database size={19} /> 1. Install the prospecting database update</h2>
      <p>Your existing leads and settings stay in place. Complete the workspace database setup first, then apply migration 005.</p>
      <ol>
        <li>Open <External href="https://supabase.com/dashboard">your Supabase project</External> and choose <b>SQL Editor → New query</b>.</li>
        <li>Click <b>Copy prospecting SQL</b> below. Paste that SQL into the new query and click <b>Run</b>.</li>
        <li>Wait for the success message. If Supabase reports a missing prerequisite, follow the <Link href="/setup">workspace setup instructions</Link> and run the missing migrations in order.</li>
      </ol>
      <ProspectingSetupActions />
      <p style={{ marginTop: 18 }}>The copy button contains SQL only. Terminal commands such as <code>npm ci</code> belong in PowerShell, not in the Supabase SQL Editor.</p>
    </section>
    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><KeyRound size={19} /> 2. Create Hunter and add private connection values</h2>
      <ol>
        <li>Create a <External href="https://hunter.io/users/sign_up">Hunter account</External> and confirm your email. Open its <External href="https://hunter.io/api-keys">API keys page</External> and copy your real API key privately. Check your plan and credits for Discover, Company Enrichment, Domain Search, and Email Verifier in the <External href="https://hunter.io/api-documentation">official API documentation</External>. Some access may require a paid plan.</li>
        <li>In Supabase, open <b>Authentication → Users</b>. Open your own sign-in account and copy its <b>User UID</b>. This identifies the workspace that unattended runs may write to.</li>
        <li>In Supabase, open <b>Settings → API Keys</b>. Copy a server-side secret key, or the legacy <code>service_role</code> key, privately. This key is only for the server; keep it out of browser settings and GitHub.</li>
        <li>In your local app folder, open <code>.env.local</code> beside <code>package.json</code>. Keep your existing Supabase project URL and publishable key. Add the lines below with your own values.</li>
      </ol>
      <pre>{`HUNTER_API_KEY=your-private-hunter-key
SUPABASE_SERVICE_ROLE_KEY=your-private-supabase-server-key
AUTOMATION_OWNER_ID=your-supabase-sign-in-user-uuid
APP_URL=http://localhost:3000`}</pre>
      <p>The server key must never have a <code>NEXT_PUBLIC_</code> prefix. It bypasses database access rules, so unattended workers restrict their writes to the configured owner. Never send these keys in chat.</p>
    </section>
    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Cloud size={19} /> 3. Host the app for runs while your computer is off</h2>
      <ol>
        <li>Create accounts at <External href="https://vercel.com/signup">Vercel</External> and <External href="https://www.inngest.com/">Inngest</External>. Choose plans suitable for your business use and expected usage.</li>
        <li>In Vercel, choose <b>Add New → Project</b>, connect GitHub, and import your <code>dipeshc21/Xchop-Agent</code> repository. Keep the detected Next.js framework.</li>
        <li>Add your existing Supabase URL/publishable key and the private Hunter/server-key/owner values from step 2 in Vercel <b>Project Settings → Environment Variables</b>. In your Inngest dashboard select <b>Production</b>, create/copy an <b>Event key</b>, and copy that environment&apos;s <b>Signing key</b>. Add these different keys in Vercel as <code>INNGEST_EVENT_KEY</code> and <code>INNGEST_SIGNING_KEY</code>.</li>
        <li>Deploy the project. Copy its production address, such as <code>https://your-app.vercel.app</code>, into <code>APP_URL</code> in Vercel, then redeploy so the app uses that address.</li>
        <li>In Supabase <b>Authentication → URL Configuration</b>, add your hosted app URL and its <code>/auth/callback</code> URL. Keep localhost if you still use the app locally.</li>
        <li>In Inngest, add/sync an app using your production endpoint: <code>https://your-app.vercel.app/api/inngest</code>. Confirm that the app&apos;s functions and schedule appear. Use the same production environment as the event and signing keys you added in Vercel.</li>
      </ol>
      <p>Inngest must be able to reach the endpoint. If Vercel deployment protection blocks it, follow the <External href="https://www.inngest.com/docs/deploy/vercel">Inngest Vercel deployment guide</External> to connect the integration and allow access to that project. Keep Supabase sign-in enabled for your workspace; provider keys stay on the server.</p>
      <div className="info-box"><ShieldCheck size={20} /><p>Hosting alone does not start prospecting. Enable it deliberately after choosing your targets and limits. Hunter, Vercel, and Inngest quotas or plan restrictions can limit runs; check each account&apos;s current usage and terms.</p></div>
    </section>
    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><CheckCircle2 size={19} /> 4. Choose targets, test, and enable the schedule</h2>
      <ol>
        <li>Open <Link href="/prospecting">Lead discovery</Link> while signed in as your configured owner.</li>
        <li>Choose target countries and business keywords, record your source/lawful-basis note, and set conservative daily API-request and saved-lead limits. India stays excluded by default.</li>
        <li>Use the basic Discover mode unless your Hunter plan includes Premium Discover pagination. Keep the Premium option off when you are unsure.</li>
        <li>Click <b>Save targeting</b>, then <b>Start automatic discovery</b>, then <b>Run discovery now</b>. This uses real Hunter API requests and can consume your provider credits. Open <b>Run history</b> to check actual progress and saved leads.</li>
        <li>Confirm the scheduled function is active in Inngest. It checks once an hour and queues work on the first hourly check after your chosen interval becomes due. Disable discovery from the app whenever you want future runs to stop.</li>
      </ol>
      <p>The worker searches for companies, checks company country using independent enrichment, finds published business contacts, checks email verification, and saves eligible leads with a visible fit score. Hunter may return a cached verification date; the actual date is recorded and must be no older than 31 days. Existing leads, suppressed addresses, unverified results, and excluded countries are skipped.</p>
      <p>A verified email address is not permission to send marketing email. Review each lead&apos;s source and lawful basis before any later outreach. No emails are sent in this phase.</p>
      <p>Hunter endpoints can consume different kinds or amounts of provider credits. The app&apos;s API-request limit counts requests; it is not a billing-credit estimate. Basic Discover rotates country/keyword searches with bounded coverage and does not promise unlimited new leads. Premium pagination can extend coverage when your plan supports it.</p>
    </section>
    <section className="panel">
      <h2>Local development and optional AI</h2>
      <p>For local testing, add <code>INNGEST_DEV=1</code> to <code>.env.local</code> with <code>APP_URL=http://localhost:3000</code>. Run the app in one terminal and the Inngest development server in a second terminal:</p>
      <pre>{`# Terminal 1\nnpm run dev\n\n# Terminal 2\nnpm run dev:jobs`}</pre>
      <p>Keep both terminals open. Local scheduling stops when they or your computer are off. Keep <code>INNGEST_DEV</code> out of production and use the real hosted keys there. The job script targets port 3000. If Next.js chooses another port, update <code>APP_URL</code> and use <code>npx inngest-cli@latest dev -u http://localhost:YOUR-PORT/api/inngest</code> in terminal 2.</p>
      <p>Optional AI summaries require a separate <External href="https://console.anthropic.com/">Anthropic account</External>, <code>ANTHROPIC_API_KEY</code>, and an available <code>ANTHROPIC_MODEL</code>. Keep AI off until those values are configured. AI output is stored for review; it does not send a message or replace the source and country checks.</p>
      <div className="setup-actions"><Link href="/prospecting" className="button primary">Open lead discovery →</Link><Link href="/setup" className="button outline">Check Supabase connection</Link></div>
    </section>
  </main>;
}
