import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Cloud, Database, KeyRound, ShieldCheck } from 'lucide-react';
import ProspectingSetupActions from '@/components/prospecting/setup-actions';

export const dynamic = 'force-dynamic';

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

export default async function ProspectingSetupPage() {
  return <main className="setup-shell">
    <Link href="/prospecting" style={{ display: 'inline-flex', gap: 7, alignItems: 'center', fontSize: 12 }}><ArrowLeft size={15} /> Back to discovery</Link>
    <div className="eyebrow" style={{ marginTop: 30 }}>PUBLIC PROJECT REQUESTS · SETUP</div>
    <h1>Find published website and application requests.</h1>
    <p>Connect Tavily to search public project requests. The app saves a result only when its source text contains an explicit buyer request, a dated publication, and evidence of a selected country. A company profile or an email address alone does not qualify.</p>
    <div className="info-box"><ShieldCheck size={20} /><p>The app cannot see anyone&apos;s private Google searches or browsing history. Its popup shows the publicly posted request and where it appeared. Review the original posting and its response rules before replying.</p></div>
    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Database size={19} /> 1. Install the project-request database update</h2>
      <p>If you already used Hunter discovery, keep your existing Supabase project. Migration 006 pauses the old discovery settings and preserves the previous contacts as unconfirmed contacts. It does not turn them into project inquiries.</p>
      <ol>
        <li>Update your project files from GitHub. In the project terminal run <code>git pull origin main</code>, then <code>npm ci</code>. Stop the development server first with <b>Ctrl+C</b>.</li>
        <li>Open <External href="https://supabase.com/dashboard">your Supabase project</External> and choose <b>SQL Editor → New query</b>.</li>
        <li>Click <b>Copy project-request SQL</b> below, paste that SQL into the query, and click <b>Run</b>. This is <code>006_project_requests.sql</code>. Complete migrations 001–005 first if this is a new installation.</li>
        <li>Wait for the success message. If a prerequisite is missing, use the <Link href="/setup">workspace setup guide</Link> and run only the missing migrations in order. Do not rerun the foundation over an existing database.</li>
      </ol>
      <ProspectingSetupActions />
      <p style={{ marginTop: 18 }}>The copy button contains SQL only. Commands such as <code>npm ci</code> belong in your project terminal, not in the Supabase SQL Editor.</p>
      <p>For a new installation, migration 005 is still available as an <a href="/migrations/005_automatic_prospecting.sql" target="_blank" rel="noreferrer">earlier prerequisite SQL file</a>. Existing installations that already ran it should continue with 006.</p>
    </section>
    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><KeyRound size={19} /> 2. Create Tavily and add the private key</h2>
      <ol>
        <li>Open <External href="https://app.tavily.com/">Tavily&apos;s dashboard</External>, create an account, and finish any account confirmation. Open the API keys area and create or copy your actual API key privately.</li>
        <li>Review your available credits and the <External href="https://docs.tavily.com/documentation/api-reference/endpoint/search">Search API documentation</External>. Search credits and account limits apply even when no result qualifies.</li>
        <li>In <b>Vercel → your Xchop-Agent project → Settings → Environment Variables</b>, add <code>TAVILY_API_KEY</code> with your private key. Select <b>Production</b> for your hosted app and save.</li>
        <li>Keep your existing Supabase connection, <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>AUTOMATION_OWNER_ID</code>, <code>APP_URL</code>, and Inngest keys. If Worker account is pending, copy your app sign-in account&apos;s User UID from <b>Supabase → Authentication → Users</b> into <code>AUTOMATION_OWNER_ID</code>.</li>
        <li>Open <b>Vercel → Deployments → latest Production deployment → ⋯ → Redeploy</b>. Wait for <b>Ready</b>, then refresh your app. New environment values apply to a new deployment.</li>
      </ol>
      <pre>{`TAVILY_API_KEY=your-private-tavily-api-key`}</pre>
      <p>For local development, add that line to your existing <code>.env.local</code>, save, and restart <code>npm run dev</code>. Never put it in a <code>NEXT_PUBLIC_</code> variable or paste a key into chat.</p>
      <p>Hunter and Anthropic keys are not required for project-request discovery. The new worker does not generate a company list or guess a project requirement from company facts.</p>
    </section>
    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Cloud size={19} /> 3. Keep scheduled discovery connected</h2>
      <p>If your Vercel and Inngest setup already works, keep those accounts and settings. Check the endpoint after deploying the updated code.</p>
      <ol>
        <li>For a new hosted setup, create <External href="https://vercel.com/signup">Vercel</External> and <External href="https://www.inngest.com/">Inngest</External> accounts. Import the <code>dipeshc21/Xchop-Agent</code> GitHub repository into Vercel as a Next.js project.</li>
        <li>Add the public Supabase URL/publishable key and private server values from <code>.env.example</code> to Vercel&apos;s <b>Production</b> environment. Use your real hosted address for <code>APP_URL</code>.</li>
        <li>In Inngest&apos;s <b>Production</b> environment, copy an <b>Event key</b> and its separate <b>Signing key</b>. Save them in Vercel as <code>INNGEST_EVENT_KEY</code> and <code>INNGEST_SIGNING_KEY</code>, then redeploy. Leave <code>INNGEST_DEV</code> unset in production.</li>
        <li>In Supabase <b>Authentication → URL Configuration</b>, allow your hosted app address and its <code>/auth/callback</code> URL.</li>
        <li>In Inngest, sync <code>https://your-app.vercel.app/api/inngest</code>. Confirm the app&apos;s functions and hourly schedule appear in the same environment as your keys.</li>
      </ol>
      <p>If deployment protection blocks Inngest, open <b>Vercel → your project → Settings → Deployment Protection → Protection Bypass for Automation</b>. Create a secret and paste it into the Inngest integration&apos;s <b>Deployment protection key</b>, save, then redeploy/resync. This secret differs from the Event key and Signing key. See the <External href="https://www.inngest.com/docs/durable-execution/deploying-functions/platforms/vercel">Inngest Vercel guide</External>.</p>
      <p>Hosted scheduling continues while your computer is off, provided the services and quotas remain available. Inngest checks due runs hourly, so the interval is not an exact-to-the-minute promise.</p>
    </section>
    <section className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><CheckCircle2 size={19} /> 4. Save targeting and inspect the first run</h2>
      <ol>
        <li>Open <Link href="/prospecting">Lead discovery</Link> and sign in as your configured owner. Confirm the project-request database, Tavily, owner, and scheduler checks are ready.</li>
        <li>Choose <b>Website development</b>, <b>Application development</b>, or both. Choose target countries, project-related keywords, a maximum request age, and conservative daily search/request limits.</li>
        <li>Record your actual basis and review process for collecting relevant public requests. Click <b>Save targeting</b>, then <b>Start automatic discovery</b>, then <b>Run discovery now</b>.</li>
        <li>Open <b>Run history</b> to inspect progress. A queued run has not necessarily executed. A completed run may correctly save no requests when the evidence is incomplete or the work is expired.</li>
        <li>Open <Link href="/inquiries">Project requests</Link>. Click a result to inspect the exact public request, required service, source platform, original URL, and dates before responding through the original platform.</li>
        <li>Use <b>Pause discovery</b> to stop future requests and saves. An already-started provider request may finish, but the worker checks again before saving.</li>
      </ol>
      <p>The app rejects company marketing pages, supplier offers, employment listings, expired/closed work, missing source text, unclear country, and insufficient publication evidence. It uses the date stated in the page&apos;s request text; a search engine&apos;s estimated publication/update date alone is not enough. Strict filtering can produce zero results and does not guarantee any number of opportunities.</p>
      <p>Each saved request has its own source URL. A useful request can be saved without an email address: the original platform is the response route, and no contact address is invented. The popup labels describe the public request and publication platform; private search terms and private search activity remain unavailable.</p>
      <p>The new flow does not need AI summaries and does not send email or submit proposals automatically. Use it for relevant published buyer requests, review the posting&apos;s availability and response terms, and follow the <External href="https://www.tavily.com/terms">provider&apos;s terms</External>.</p>
      <p>The integration uses basic search. Review <External href="https://docs.tavily.com/documentation/api-credits">Tavily&apos;s current credit rules</External> and your account usage. The app&apos;s request cap counts API calls, not money or guaranteed saved opportunities.</p>
    </section>
    <section className="panel">
      <h2>Local testing with two terminals</h2>
      <p>Add <code>INNGEST_DEV=1</code> to <code>.env.local</code> with <code>APP_URL=http://localhost:3000</code>. Run these in separate terminals:</p>
      <pre>{`# Terminal 1\nnpm run dev\n\n# Terminal 2\nnpm run dev:jobs`}</pre>
      <p>Keep both terminals open. Local scheduling stops when either service or your computer is off. Keep <code>INNGEST_DEV</code> out of production. If Next.js chooses another port, update <code>APP_URL</code> and use <code>npx inngest-cli@latest dev -u http://localhost:YOUR-PORT/api/inngest</code> in terminal 2.</p>
      <div className="setup-actions"><Link href="/prospecting" className="button primary">Open discovery →</Link><Link href="/inquiries" className="button outline">View project requests</Link><Link href="/setup" className="button outline">Check Supabase</Link></div>
    </section>
  </main>;
}
