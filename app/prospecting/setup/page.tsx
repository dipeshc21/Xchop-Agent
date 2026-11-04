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
    <div className="eyebrow" style={{ marginTop: 30 }}>HUNTER LEAD DISCOVERY · RESTORE</div>
    <h1>Restore your company and contact discovery.</h1>
    <p>This restores the Hunter discovery flow used for your earlier business contacts. Your saved contacts, business settings, suppression choices, run history, and public project-request records stay in place.</p>
    <div className="info-box"><ShieldCheck size={20} /><p>Hunter finds businesses and published work contacts. A verified email or company match does not establish a website/app project requirement or permission to send marketing. Contact names and emails remain visible alongside their source details; unknown project requirements stay unknown.</p></div>

    <section className="panel" id="hunter-restoration">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Database size={19} /> 1. Install the Hunter restoration update</h2>
      <p>Use your existing Supabase project. Migration <code>009_restore_hunter_discovery.sql</code> restores the database access needed by Hunter while preserving existing data. It is safe to repeat.</p>
      <ol>
        <li>Wait for the latest GitHub version to finish deploying in Vercel.</li>
        <li>Open <External href="https://supabase.com/dashboard">Supabase</External> → your existing project → <b>SQL Editor → New query</b>.</li>
        <li>Click <b>Copy Hunter restoration SQL</b> below. Paste the complete SQL into that new query, then click <b>Run</b>.</li>
        <li>After the success message, refresh <Link href="/prospecting">Lead discovery</Link>. The Hunter database check should be ready.</li>
      </ol>
      <ProspectingSetupActions />
      <p>Do not rerun migrations 005 or 006, drop tables, or create a new Supabase project for this restoration. Keep any already installed project-request updates 006–008. Paste SQL into Supabase; terminal commands such as <code>npm ci</code> belong in PowerShell.</p>
      <p>For a completely new installation, finish the <Link href="/setup">workspace setup</Link> and migrations 001–005 first. The <a href="/migrations/005_automatic_prospecting.sql" target="_blank" rel="noreferrer">005 prerequisite SQL</a> is provided for installations that have never run it.</p>
    </section>

    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><KeyRound size={19} /> 2. Reuse your existing Hunter connection</h2>
      <p>If Hunter was already connected when your earlier contacts were generated, keep the same account and key. Check <b>Vercel → Xchop-Agent → Settings → Environment Variables → Production</b> for <code>HUNTER_API_KEY</code>.</p>
      <ol>
        <li>If the Hunter check is pending, open your <External href="https://hunter.io/api-keys">Hunter API keys page</External> and add your actual private key as <code>HUNTER_API_KEY</code> in Vercel Production.</li>
        <li>Keep your existing Supabase URL and publishable key, <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>AUTOMATION_OWNER_ID</code>, <code>APP_URL</code>, and Inngest keys.</li>
        <li>Only if you changed environment values, open <b>Vercel → Deployments → latest Production deployment → Redeploy</b>. Wait for <b>Ready</b> and refresh the app.</li>
      </ol>
      <p>If you need a new Hunter account, <External href="https://hunter.io/users/sign_up">create one</External> and check access and credits for Discover, Company Enrichment, Domain Search, and Email Verifier in the <External href="https://hunter.io/api-documentation">official API documentation</External>. Actual runs verify account access; a configured key alone does not establish plan eligibility.</p>
      <p>Never put server keys in a <code>NEXT_PUBLIC_</code> variable, a browser form, chat, or GitHub. Tavily is not required for the restored Hunter worker. Its existing key can stay in your server settings, and saved <Link href="/inquiries?period=saved">public project requests remain available as an archive</Link>.</p>
    </section>

    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><CheckCircle2 size={19} /> 3. Restore targeting and run one batch</h2>
      <ol>
        <li>Open <Link href="/prospecting">Lead discovery</Link> while signed in as the configured workspace owner. Complete any pending connection checks.</li>
        <li>Review the proposed Hunter targeting and daily limits. Restoration uses the earlier Hunter targeting when it is available, keeps your current daily budgets and collection note, and proposes a <b>6-hour</b> interval.</li>
        <li>Click <b>Restore Hunter discovery</b>. This restores targeting for your signed-in workspace and queues its first Hunter run.</li>
        <li>Open <b>Run history</b>. Confirm the run starts and finishes, then open <Link href="/?view=leads">Leads</Link> to review any saved contacts and their sources.</li>
      </ol>
      <p>Keep Premium pagination off unless your Hunter plan supports it. Basic discovery rotates country/keyword targeting and skips companies already processed; it can save zero new contacts when those results are exhausted. Pagination can extend coverage when account access and credits permit it.</p>
      <p>The worker checks company details and country, finds published business contacts, verifies eligible email addresses, applies your fit threshold, and saves qualifying prospects. Existing leads and suppressed addresses are skipped. It does not manufacture project requirements, send messages, or submit proposals.</p>
      <p>Check Hunter usage alongside the app&apos;s daily limits. API attempts count reserved requests, including interrupted ones; they are not a billing-credit estimate. Restoring the flow does not promise the same 14 contacts again or a minimum number of new contacts each day.</p>
    </section>

    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Cloud size={19} /> 4. Confirm the hosted schedule</h2>
      <p>Keep your existing Vercel and Inngest accounts. After deployment, open <External href="https://app.inngest.com/">Inngest Production</External> and sync the app endpoint:</p>
      <pre>https://xchop-agent.vercel.app/api/inngest</pre>
      <p>For another deployment, replace that host with your own production address. Confirm both the discovery worker and its hourly schedule appear in the same Inngest environment as your Event key and Signing key.</p>
      <p>If Vercel deployment protection blocks the endpoint, keep the existing automation bypass configured in the Inngest integration. See the <External href="https://www.inngest.com/docs/durable-execution/deploying-functions/platforms/vercel">Inngest Vercel guide</External>. Keep <code>INNGEST_DEV</code> unset in production.</p>
      <p>Scheduled runs continue while your computer is off when the hosted services, account access, and credits are available. The schedule checks once an hour and starts due work on an hourly check. Use <b>Pause discovery</b> to stop future requests and saves.</p>
    </section>

    <section className="panel">
      <h2>Local development and optional drafts</h2>
      <p>For a local copy, stop the development server with <b>Ctrl+C</b>, run <code>git pull origin main</code> and <code>npm ci</code>, and keep your private <code>.env.local</code>. Use <code>APP_URL=http://localhost:3000</code> and <code>INNGEST_DEV=1</code> locally, then start these in separate terminals:</p>
      <pre>{`# Terminal 1\nnpm run dev\n\n# Terminal 2\nnpm run dev:jobs`}</pre>
      <p>Both terminals must remain running for local jobs. Local discovery stops when your computer is off. Optional Anthropic summary drafts need their own configured account and model; leave AI off until you choose to enable it. Drafts stay for review and do not establish a buyer&apos;s need or send outreach.</p>
      <div className="setup-actions"><Link href="/prospecting" className="button primary">Open lead discovery →</Link><Link href="/?view=leads" className="button outline">View saved leads</Link><Link href="/setup" className="button outline">Check Supabase</Link></div>
    </section>
  </main>;
}
