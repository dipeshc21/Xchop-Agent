import Link from 'next/link';
import { AlertCircle, CheckCircle2, Circle, Database, ShieldCheck } from 'lucide-react';
import { inspectSupabaseSetup } from '@/lib/supabase/health';
import { setupReasonMessage, setupTargets, type SetupCheck } from '@/lib/setup-diagnostics';

export const dynamic = 'force-dynamic';

function CheckResult({ check }: { check: SetupCheck }) {
  const ready = check.status === 'ready';
  const blocked = check.status === 'blocked';
  return <div style={{ padding: '17px 0', borderBottom: '1px solid var(--line)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
      {ready ? <CheckCircle2 size={18} style={{ color: 'var(--green)', flexShrink: 0 }} />
        : blocked ? <AlertCircle size={18} style={{ color: '#b37e35', flexShrink: 0 }} />
          : <Circle size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />}
      <strong style={{ fontWeight: 500 }}>{check.label}</strong>
      <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11 }}>{ready ? 'Ready' : blocked ? 'Blocked' : 'Not checked'}</span>
    </div>
    <p style={{ margin: '9px 0 0 28px', fontSize: 12 }}>{check.message}</p>
    {(check.code || check.migration) && <p style={{ margin: '8px 0 0 28px', fontSize: 11 }}>
      {check.code && <>Error code: <code>{check.code}</code>{check.migration && ' · '}</>}
      {check.migration && <>SQL file: <code>{check.migration}</code></>}
    </p>}
  </div>;
}

type Query = { reason?: string | string[] };
export default async function Setup({ searchParams }: { searchParams: Promise<Query> }) {
  const [health, params] = await Promise.all([inspectSupabaseSetup(), searchParams]);
  const reason = setupReasonMessage(typeof params.reason === 'string' ? params.reason : undefined);
  const requiredChecks = health.checks.filter(check => setupTargets[check.id].required);
  const optionalChecks = health.checks.filter(check => !setupTargets[check.id].required);
  const settingsReady = health.authenticated && health.checks.some(check => check.id === 'settings' && check.status === 'ready');

  return <main style={{ maxWidth: 1000, paddingTop: 42, paddingBottom: 60 }}>
    <div className="brand" style={{ marginBottom: 35, padding: 0 }}>
      <span className="brand-mark">x.</span>
      <span>XHTMLChop<small>GROWTH AGENT</small></span>
    </div>
    <div className="page-heading">
      <div>
        <div className="eyebrow">LIVE WORKSPACE SETUP</div>
        <h1>{health.authenticated ? 'Check your workspace connection.' : 'Connect your business workspace.'}</h1>
        <p>{health.authenticated ? 'Your account is signed in. Review each database check and open Settings when it is available.' : 'Connect your own Supabase project, then sign in to verify database access.'}</p>
      </div>
      <Database size={32} style={{ color: 'var(--green)', flexShrink: 0 }} />
    </div>
    <section className="panel settings-panel" style={{ maxWidth: '100%', marginBottom: 24 }}>
      <h2>Connection status</h2>
      <p role="status">{health.message}</p>
      {reason && <div className="info-box" style={{ marginBottom: 14 }}><AlertCircle size={18} /><p>{reason}</p></div>}
      <div style={{ marginBottom: 22 }}>{requiredChecks.map(check => <CheckResult key={check.id} check={check} />)}</div>
      <details style={{ marginBottom: 24 }} open={optionalChecks.some(check => check.status === 'blocked')}>
        <summary style={{ cursor: 'pointer', fontSize: 12 }}>Supporting database checks</summary>
        {optionalChecks.map(check => <CheckResult key={check.id} check={check} />)}
      </details>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a href="/setup" className="button outline">Refresh status</a>
        {settingsReady && <Link href="/settings" className="button primary">Open Settings →</Link>}
        {health.authenticated && health.database === 'ready' && <Link href="/" className="button outline">Open workspace →</Link>}
        {!health.authenticated && health.configured && <Link href="/login" className="button primary">Sign in →</Link>}
      </div>
      {health.authenticated && <p style={{ marginBottom: 0, marginTop: 16, fontSize: 12 }}>A blocked database check does not require another sign-in. Apply the specific fix shown above, then refresh this page.</p>}
    </section>
    <section className="panel settings-panel" style={{ maxWidth: '100%' }}>
      <h2>{health.authenticated ? 'Database repair and setup instructions' : 'Set up Supabase in six steps'}</h2>
      <p>Your project URL and publishable key go in a local file. This page does not ask you to submit keys.</p>
      <div className="info-box" style={{ marginBottom: 25 }}><ShieldCheck size={20} /><p>If your project already has the app’s tables, do not rerun <code>001_foundation.sql</code>. Use the specific migration named in a blocked check. For permission errors after 001–003 are installed, <code>004_restore_workspace_access.sql</code> restores required grants and refreshes the API schema cache without replacing records.</p></div>
      <ol className="setup-steps">
        <li><strong>Create your project if you do not have one yet.</strong>
          <p>Open <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="text-link" style={{ display: 'inline' }}>Supabase Dashboard</a>, create an account, then choose <b>New project</b>. Pick your organization, name the project, save its database password privately, and wait for setup to finish.</p>
        </li>
        <li><strong>Install only the migrations your project needs.</strong>
          <p>In Supabase, open <b>SQL Editor → New query</b>. Find <code>supabase/migrations</code> in your local app folder. For a <b>new empty project</b>, run <code>001_foundation.sql</code>, then <code>002_live_workspace.sql</code>, <code>003_dashboard_summary.sql</code>, and <code>004_restore_workspace_access.sql</code> in order. Copy each file’s complete text into the SQL Editor and click <b>Run</b>.</p>
          <p>For an <b>existing app database</b>, keep completed migrations. A missing dashboard function points to 003; a permission error can be repaired with 004 after 001–003 exist. Migration 004 stops if prerequisite objects or access protection are missing. If only one table is missing from an existing project, review that object rather than rerunning the entire foundation file.</p>
        </li>
        <li><strong>Create your owner account if needed.</strong>
          <p>Under <b>Authentication → Sign In / Providers → Email</b>, enable email/password sign-in and disable public sign-ups. Choose <b>Authentication → Users → Add user → Create new user</b>, enter your email and a strong password, and mark this owner-created account as confirmed. If the account check above is Ready, this step is already complete.</p>
        </li>
        <li><strong>Set the local app address.</strong>
          <p>Under <b>Authentication → URL Configuration</b>, set Site URL to <code>http://localhost:3000</code> and add <code>http://localhost:3000/auth/callback</code> to Redirect URLs. Use your actual app address when hosting later.</p>
        </li>
        <li><strong>Find the project URL and publishable key.</strong>
          <p>Click the green <b>Connect</b> button near the top of your Supabase project. Choose the <b>Next.js</b> framework to see the Project URL and publishable key. Copy <code>.env.example</code> to <code>.env.local</code> beside <code>package.json</code> in your local app, then fill these two lines with your own values:</p>
          <pre style={{ background: 'var(--soft)', padding: 16, borderRadius: 6, overflowX: 'auto', margin: '12px 0', fontSize: 12, lineHeight: 1.8 }}>{`NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key`}</pre>
          <p>The older anon key is also accepted as <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. The app does not need a secret/service-role key for sign-in or workspace saves. Keep <code>.env.local</code> off GitHub.</p>
        </li>
        <li><strong>Restart after changing local configuration.</strong>
          <p>Stop the terminal with <b>Ctrl+C</b>, run <code>npm run dev</code>, and open <code>http://localhost:3000</code>. If signed in, you can open <code>http://localhost:3000/settings</code> directly when the settings table is readable. Save business details and add a lead to verify real writes.</p>
          <p>For a production build, rerun <code>npm run build</code> after changing any <code>NEXT_PUBLIC_</code> value, then start the app.</p>
        </li>
      </ol>
      <div className="info-box"><ShieldCheck size={20} /><p>These checks are read-only. They verify your account, table reads and dashboard response separately; they do not verify writes, email delivery, AI prospecting, payments, or file uploads.</p></div>
    </section>
  </main>;
}
