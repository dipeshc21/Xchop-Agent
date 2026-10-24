import Link from 'next/link';
import { CheckCircle2, Circle, Database, ShieldCheck } from 'lucide-react';
import { inspectSupabaseSetup } from '@/lib/supabase/health';

export const dynamic = 'force-dynamic';

export default async function Setup() {
  const health = await inspectSupabaseSetup();
  const checks = [
    { label: 'Project URL and public key configured', ok: health.configured },
    { label: 'Owner account signed in', ok: health.authenticated },
    { label: 'Database and dashboard reads verified', ok: health.database === 'ready' },
  ];

  return <main style={{ maxWidth: 1000, paddingTop: 42, paddingBottom: 60 }}>
    <div className="brand" style={{ marginBottom: 35, padding: 0 }}>
      <span className="brand-mark">x.</span>
      <span>XHTMLChop<small>GROWTH AGENT</small></span>
    </div>
    <div className="page-heading">
      <div>
        <div className="eyebrow">LIVE WORKSPACE SETUP</div>
        <h1>Connect your business workspace.</h1>
        <p>Create a free Supabase project, connect it privately, and sign in. Your workspace starts empty.</p>
      </div>
      <Database size={32} style={{ color: 'var(--green)', flexShrink: 0 }} />
    </div>
    <section className="panel settings-panel" style={{ maxWidth: '100%', marginBottom: 24 }}>
      <h2>Connection status</h2>
      <p role="status">{health.message}</p>
      <div style={{ display: 'grid', gap: 14, marginBottom: 22 }}>
        {checks.map(check => <div key={check.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          {check.ok ? <CheckCircle2 size={18} style={{ color: 'var(--green)' }} /> : <Circle size={18} style={{ color: 'var(--muted)' }} />}
          {check.label}<span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11 }}>{check.ok ? 'Ready' : 'Pending'}</span>
        </div>)}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link href="/setup" className="button outline">Refresh status</Link>
        {health.configured && <Link href={health.database === 'ready' ? '/' : '/login'} className="button primary">{health.database === 'ready' ? 'Open workspace →' : 'Sign in →'}</Link>}
      </div>
    </section>
    <section className="panel settings-panel" style={{ maxWidth: '100%' }}>
      <h2>Set up Supabase in six steps</h2>
      <p>Your project URL and publishable key go in a local file. This page does not ask you to submit any keys.</p>
      <ol className="setup-steps">
        <li><strong>Create your project.</strong>
          <p>Open <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="text-link" style={{ display: 'inline' }}>Supabase Dashboard</a>, create an account, then choose <b>New project</b>. Pick your organization, give the project a name, save the database password privately, and wait for setup to finish.</p>
        </li>
        <li><strong>Install the database tables and access rules.</strong>
          <p>Open your project’s <b>SQL Editor → New query</b>. In the app’s project folder, open <code>supabase/migrations</code>. Run each SQL file in numeric order: <b>001, then 002, then 003</b>. Copy one file’s complete text into the SQL Editor and click <b>Run</b>, then repeat with the next file. Run each migration once. If you already ran 001 successfully, run only 002 and 003. The files are <code>001_foundation.sql</code>, <code>002_live_workspace.sql</code>, and <code>003_dashboard_summary.sql</code>.</p>
          <p>For an existing database, follow the README migration instructions before running SQL. Old sample rows are not removed automatically. If adding a lead reports a missing setup step, verify that migration 002 ran successfully.</p>
        </li>
        <li><strong>Create your owner account.</strong>
          <p>Under <b>Authentication → Sign In / Providers → Email</b>, enable email/password sign-in and disable public sign-ups. Then choose <b>Authentication → Users → Add user → Create new user</b>. Enter your email and a strong password. Mark this owner-created account as confirmed.</p>
        </li>
        <li><strong>Set the local app address.</strong>
          <p>In <b>Authentication → URL Configuration</b>, set the Site URL to <code>http://localhost:3000</code> and add <code>http://localhost:3000/auth/callback</code> to Redirect URLs. For hosting later, use your actual app address.</p>
        </li>
        <li><strong>Add your connection values privately.</strong>
          <p>Open <b>Project Settings → API / API Keys</b> and copy the Project URL and publishable key. In VS Code, copy <code>.env.example</code> to <code>.env.local</code> in the same folder as <code>package.json</code>. Fill these two lines with your own values:</p>
          <pre style={{ background: 'var(--soft)', padding: 16, borderRadius: 6, overflowX: 'auto', margin: '12px 0', fontSize: 12, lineHeight: 1.8 }}>{`NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key`}</pre>
          <p>The older Supabase anon key is also accepted through <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. The app never needs a secret or service-role key for sign-in or saving your workspace. Keep <code>.env.local</code> off GitHub.</p>
        </li>
        <li><strong>Restart, sign in, and add real records.</strong>
          <p>Stop the development terminal with <b>Ctrl+C</b>, run <code>npm run dev</code> again, then open <code>http://localhost:3000</code>. Sign in using the owner account you created. Save your real business details in Settings and add your first real lead. Refresh to confirm your records stay saved.</p>
          <p>If running a production build, run <code>npm run build</code> again after changing any <code>NEXT_PUBLIC_</code> value, then start the app.</p>
        </li>
      </ol>
      <div className="info-box"><ShieldCheck size={20} /><p>Sign-in, database records, settings, and lead entry use your own Supabase project. Email sending, AI prospecting, and payment collection are not implemented yet. The setup status checks database reads only; save a setting and add a lead after signing in to verify writes.</p></div>
    </section>
  </main>;
}
