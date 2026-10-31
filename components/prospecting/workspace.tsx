'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronRight, Clock3, Database, FileText, Globe, LayoutDashboard, LoaderCircle, Menu, Pause, Play, RefreshCw, Search, Settings, ShieldCheck, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { serviceNames } from '@/lib/intent/types';
import { countryNames, defaultProspectingConfig, prospectingConfigSchema, type ConnectionCheck, type ProspectingConfig, type ProspectingRun } from '@/lib/prospecting/types';

type Status = {
  config: ProspectingConfig;
  readiness: { ready: boolean; checks: ConnectionCheck[]; ownerBound: boolean };
  runs: ProspectingRun[];
  nextRunAt: string | null;
  usage: { requestsToday: number; leadsToday: number; dayStart?: string };
  enabled: boolean;
  migrationReady: boolean;
};
type Suppression = { id: string; email: string; reason: string; created_at: string };
const timestamp = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value))
  : 'Not scheduled';

export default function ProspectingWorkspace({ userEmail }: { userEmail: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<ProspectingConfig>(defaultProspectingConfig);
  const [keywords, setKeywords] = useState(defaultProspectingConfig.keywords.join('\n'));
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const loadSequence = useRef(0);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'targeting' | 'runs' | 'suppression'>('targeting');
  const [mobile, setMobile] = useState(false);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [suppressionEmail, setSuppressionEmail] = useState('');
  const [suppressionReason, setSuppressionReason] = useState('do-not-contact');
  const [suppressionLoading, setSuppressionLoading] = useState(false);
  dirtyRef.current = dirty;

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++loadSequence.current;
    try {
      const response = await fetch('/api/prospecting', { cache: 'no-store', signal });
      if (response.status === 401) { window.location.assign('/login'); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Discovery status could not be loaded.');
      if (sequence !== loadSequence.current) return;
      setStatus(result);
      if (!dirtyRef.current) { setDraft(result.config); setKeywords(result.config.keywords.join('\n')); }
      setLoadError('');
    } catch (failure) {
      if (signal?.aborted || sequence !== loadSequence.current) return;
      setLoadError(failure instanceof Error ? failure.message : 'Discovery status could not be loaded.');
    } finally { if (!signal?.aborted && sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(controller.signal); }, 12000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);

  function edit(changes: Partial<ProspectingConfig>) { dirtyRef.current = true; setDraft(value => ({ ...value, ...changes })); setDirty(true); }
  function formConfig(enabled = draft.enabled) {
    return { ...draft, enabled, discoveryMode: 'project_requests' as const, aiEnabled: false, paginationEnabled: false, keywords: keywords.split('\n').map(value => value.trim()).filter(Boolean) };
  }
  async function save(config: ProspectingConfig, success: string) {
    const parsed = prospectingConfigSchema.safeParse(config);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Please check the targeting fields.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/prospecting', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Discovery settings could not be saved.');
      dirtyRef.current = false; setDirty(false); setDraft(parsed.data); setKeywords(parsed.data.keywords.join('\n'));
      await load(); setMessage(success);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Discovery settings could not be saved.'); }
    finally { setBusy(false); }
  }
  async function runNow() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/prospecting/run', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The discovery run could not be queued.');
      setMessage(result.message ?? 'Discovery run queued. Its actual progress appears in Run history.');
      setTab('runs'); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The discovery run could not be queued.'); }
    finally { setBusy(false); }
  }
  const loadSuppressions = useCallback(async () => {
    setSuppressionLoading(true);
    try {
      const response = await fetch('/api/suppression', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Suppressed contacts could not be loaded.');
      setSuppressions(result.entries ?? []);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Suppressed contacts could not be loaded.'); }
    finally { setSuppressionLoading(false); }
  }, []);
  useEffect(() => { if (tab === 'suppression') void loadSuppressions(); }, [tab, loadSuppressions]);
  async function suppress(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/suppression', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: suppressionEmail, reason: suppressionReason }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The address could not be suppressed.');
      setSuppressionEmail(''); setMessage('This address is suppressed across your workspace.'); await loadSuppressions();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The address could not be suppressed.'); }
    finally { setBusy(false); }
  }
  const inProgress = status?.runs.some(run => ['queued', 'running'].includes(run.status));
  const state = !status ? 'Checking setup' : !status.enabled ? 'Paused' : !status.readiness.ready ? 'Configuration needed' : inProgress ? 'Run in progress' : 'Scheduled';

  return <div className="app-shell discovery-shell">
    <aside className={`sidebar ${mobile ? 'open' : ''}`}>
      <Link href="/" className="brand"><span className="brand-mark">x.</span><span>XHTMLChop<small>GROWTH AGENT</small></span></Link>
      <div className="workspace-picker"><span className="workspace-avatar">XC</span><span>Your growth workspace<small>Public project requests</small></span></div>
      <div className="nav-label">WORKSPACE</div><nav aria-label="Workspace navigation"><Link href="/" className="nav-item"><LayoutDashboard size={19} />Dashboard</Link><Link href="/inquiries" className="nav-item"><Users size={19} />Leads</Link><Link href="/prospecting" className="nav-item active"><Search size={19} />Lead discovery</Link><Link href="/settings" className="nav-item"><Settings size={19} />Settings</Link></nav>
      <div className="sidebar-bottom"><div className="phase-card"><span className="tiny-overline">PUBLIC REQUEST EVIDENCE</span><strong>Find requests for your services.</strong><p>Tavily finds public project posts. Inngest runs the schedule. Only evidenced requests are saved.</p><Link href="/prospecting/setup">Connection & hosting guide <ArrowRight size={14} /></Link></div><div className="profile"><span className="person-avatar">XC</span><span>Workspace owner<small>{userEmail}</small></span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={() => setMobile(!mobile)}><Menu size={20} /></button><span>Workspace</span><span>/</span><strong>Lead discovery</strong></div><div className="top-actions"><span className="connection-tag"><span />{state}</span><button className="icon-button" aria-label="Refresh discovery status" onClick={() => load()}><RefreshCw size={18} /></button></div></header>
      <main><div className="page-heading"><div><div className="eyebrow">AUTOMATIC PROJECT DISCOVERY</div><h1>Find clients with a project request.</h1><p>Find dated public requests for website or application development, with the original wording and source link.</p></div><div className="heading-actions"><Link className="button outline" href="/prospecting/setup">Setup guide <ArrowRight size={15} /></Link><Button disabled={busy || loading || !status?.enabled || !status?.readiness.ready || inProgress || dirty} onClick={runNow}>{busy ? <LoaderCircle size={15} /> : <Play size={15} />} Run discovery now</Button></div></div>
        {(error || loadError) && <div role="alert" className="form-error">{error || loadError}</div>}{message && <div role="status" className="discovery-success"><Check size={17} />{message}</div>}
        {loading && <section className="panel empty-inline"><LoaderCircle size={20} /><p>Checking your discovery configuration…</p></section>}
        {!loading && !status && <section className="panel empty-records"><Database size={28} /><h3>Discovery could not load.</h3><p>Check the setup guide and your database migration.</p><Button onClick={() => load()}>Try again</Button></section>}
        {status && <>
          {!status.migrationReady && <div className="info-box discovery-setup-note"><Database size={22} /><div><strong>Install the project-request database update.</strong><p>Apply migration 006 from the setup guide. Existing contacts are preserved separately; company matches no longer qualify as project requests.</p><Link href="/prospecting/setup" className="text-link">Open database setup <ArrowRight size={14} /></Link></div></div>}
          <section className="panel discovery-status"><div><span className="eyebrow">AUTOMATIC DISCOVERY</span><h2>{state}</h2><p>{status.enabled ? `Next due: ${timestamp(status.nextRunAt)} · India time. The scheduler checks hourly.` : 'Discovery is paused. Enable it after saving your targeting and connecting the services.'}</p></div><Button variant={status.enabled ? 'outline' : 'default'} disabled={busy || !status.migrationReady || (!status.enabled && !status.readiness.ready)} onClick={() => status.enabled ? save({ ...status.config, enabled: false }, 'Automatic discovery paused. Workers will stop before their next request or save.') : save(formConfig(true), 'Automatic discovery enabled. Use Run discovery now to check your first batch.')}>
            {status.enabled ? <><Pause size={16} /> Pause discovery</> : <><Play size={16} /> Start automatic discovery</>}
          </Button></section>
          {!status.readiness.ready && <div className="info-box discovery-blockers"><ShieldCheck size={20} /><div><strong>Complete these checks before starting</strong><ul>{status.readiness.checks.filter(check => !check.ready).map(check => <li key={check.id}><strong>{check.label}:</strong> {check.message}</li>)}</ul><p>Save targeting after editing the fields below to refresh these checks.</p></div></div>}<div className="discovery-flow" aria-label="Discovery process">{['Find public posts', 'Read request evidence', 'Match required service', 'Check dates and location', 'Save project requests'].map((label, index) => <span key={label}><i>{index + 1}</i>{label}{index < 4 && <ChevronRight size={13} />}</span>)}</div>
          {status.migrationReady && <div className="metrics-grid discovery-metrics">{[
            ['Project requests saved today', status.usage.leadsToday, `Maximum ${status.config.dailyLeadLimit} per day`],
            ['API requests today', status.usage.requestsToday, `Maximum ${status.config.dailyRequestLimit} per day`],
            ['Search results per run', status.config.companiesPerRun, 'Each result needs its own project evidence'],
            ['Discovery interval', `${status.config.intervalHours}h`, 'Runs continue on your hosted scheduler'],
          ].map(([label, value, detail]) => <section key={String(label)} className="panel metric"><div className="metric-top"><span>{label}</span></div><div className="metric-value">{value}</div><p>{detail}</p></section>)}</div>}
          <p className="discovery-help">Daily limits reset at 05:30 India time (00:00 UTC). Save targeting before starting automatic discovery.</p><section className="panel discovery-connections"><div className="section-heading"><div><h2>Configuration checks</h2><p>Presence checks only. Your first actual run checks provider access. Results qualify only with a recent, explicit buyer request and source evidence.</p></div><Link href="/prospecting/setup" className="text-link">Manage connections <ArrowRight size={14} /></Link></div><div className="discovery-check-grid">{status.readiness.checks.map(check => <div className="discovery-check" key={check.id}><span className={check.ready ? 'check-ready' : 'check-pending'}>{check.ready ? <Check size={15} /> : <Clock3 size={15} />}</span><div><strong>{check.label}</strong><p>{check.message}</p></div></div>)}</div></section>
          <div className="discovery-tabs" role="tablist" aria-label="Discovery sections">{([['targeting', 'Targeting & limits'], ['runs', 'Run history'], ['suppression', 'Suppression list']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
          {tab === 'targeting' && <form className="panel settings-panel discovery-form" onSubmit={event => { event.preventDefault(); void save(formConfig(), 'Discovery targeting and limits saved.'); }}>
            <h2>Requests that match your services</h2><p>The app saves public development requests with dated evidence. Company descriptions, email validity and AI guesses do not establish a project requirement.</p>
            <label>Services to match<small>A saved request must explicitly ask for a selected service.</small></label><div className="country-options">{Object.entries(serviceNames).map(([key, name]) => <label className="checkbox-label" key={key}><input type="checkbox" checked={draft.services.includes(key as 'website' | 'application')} onChange={event => edit({ services: event.target.checked ? [...draft.services, key as 'website' | 'application'] : draft.services.filter(value => value !== key) })} />{name}</label>)}</div><label>Target countries<small>The request text must state a selected buyer country. Missing location evidence and India are excluded.</small></label><div className="country-options">{Object.entries(countryNames).map(([code, name]) => <label className="checkbox-label" key={code}><input type="checkbox" checked={draft.countries.includes(code)} disabled={!draft.countries.includes(code) && draft.countries.length >= 8} onChange={event => edit({ countries: event.target.checked ? [...draft.countries, code] : draft.countries.filter(value => value !== code) })} />{name}</label>)}</div>
            <label>Project search terms<small>One service phrase per line, up to eight. For example, website development or booking application. The app searches for buyer requests using these terms.</small><textarea rows={4} required value={keywords} onChange={event => { dirtyRef.current = true; setKeywords(event.target.value); setDirty(true); }} /></label>
            <div className="form-grid"><label>Run every (hours)<input type="number" required min={6} max={168} value={draft.intervalHours} onChange={event => edit({ intervalHours: Number(event.target.value) })} /></label><label>Search results reviewed per run<input type="number" required min={1} max={20} value={draft.companiesPerRun} onChange={event => edit({ companiesPerRun: Number(event.target.value) })} /></label><label>Maximum saved project requests per day<input type="number" required min={1} max={100} value={draft.dailyLeadLimit} onChange={event => edit({ dailyLeadLimit: Number(event.target.value) })} /></label><label>Maximum API requests per day<input type="number" required min={5} max={500} value={draft.dailyRequestLimit} onChange={event => edit({ dailyRequestLimit: Number(event.target.value) })} /></label><label>Maximum request age (days)<input type="number" required min={1} max={90} value={draft.maxAgeDays} onChange={event => edit({ maxAgeDays: Number(event.target.value) })} /><small>Uses a posted/issued date recorded in the source text, not a search-engine update estimate.</small></label></div>
            <div className="info-box"><InfoLine /><p>Tavily searches can consume provider credits. Daily request caps bound API calls; they do not guarantee a number of qualified projects. A search can correctly produce zero saved results.</p></div>
            <label>Basis for reviewing and responding to these public requests<small>Record your actual review and response process. This note is yours; it is never presented as the buyer’s requirement or consent.</small><textarea rows={4} value={draft.lawfulBasis} maxLength={2000} onChange={event => edit({ lawfulBasis: event.target.value })} placeholder="Document your basis, source transparency, and contact-review process." /></label>
            <div className="settings-submit"><Button type="submit" disabled={busy || !status.migrationReady}><Check size={16} />{busy ? 'Saving…' : 'Save targeting'}</Button><span>{dirty ? 'You have unsaved changes.' : 'Saved targeting is used by scheduled discovery.'}</span></div>
          </form>}
          {tab === 'runs' && <section className="panel leads-panel"><div className="section-heading"><div><h2>Actual discovery runs</h2><p>Queued work continues through Inngest when your hosted app is closed. Times shown in India time.</p></div></div><div className="table-scroll"><table><thead><tr><th>STARTED / QUEUED</th><th>STATUS</th><th>PAGES REVIEWED</th><th>REQUESTS SAVED</th><th>SKIPPED</th><th>REQUESTS</th><th>RESULT</th></tr></thead><tbody>{status.runs.map(run => <tr key={run.id}><td>{timestamp(run.started_at ?? run.created_at)}</td><td><span className={`run-state run-${run.status}`}>{run.status}</span></td><td>{run.companies_found}</td><td>{run.leads_saved}</td><td>{run.skipped_count}</td><td>{run.request_count}</td><td className="run-result">{run.message || run.error_code || (run.status === 'queued' ? 'Waiting for the worker.' : run.status === 'running' ? 'Processing…' : 'Run finished.')}</td></tr>)}</tbody></table>{!status.runs.length && <div className="empty-records"><Clock3 size={26} /><h3>No discovery runs yet.</h3><p>Connect the services, save your targeting, and enable automatic discovery.</p></div>}</div></section>}
          {tab === 'suppression' && <section className="panel settings-panel discovery-form"><h2>Keep do-not-contact choices together.</h2><p>Suppression keeps contact choices across your workspace. Public project-request discovery does not generate contact emails or send messages.</p><form onSubmit={suppress}><div className="form-grid"><label>Email<input type="email" required value={suppressionEmail} onChange={event => setSuppressionEmail(event.target.value)} /></label><label>Reason<select value={suppressionReason} onChange={event => setSuppressionReason(event.target.value)}><option value="do-not-contact">Do not contact</option><option value="unsubscribed">Unsubscribed</option><option value="bounced">Bounced</option></select></label></div><Button type="submit" disabled={busy || !status.migrationReady}><ShieldCheck size={15} />Add to suppression</Button></form><div className="suppression-list">{suppressionLoading ? <p>Loading suppressed contacts…</p> : suppressions.length ? suppressions.map(entry => <div className="connection-row" key={entry.id}><div><strong>{entry.email}</strong><p>{entry.reason} · {timestamp(entry.created_at)}</p></div><ShieldCheck size={17} /></div>) : <p>No suppression entries recorded.</p>}</div><p className="discovery-help">Up to 100 most recent entries are shown. Existing unsubscribe choices are retained.</p></section>}
          <div className="info-box discovery-footer-note"><ShieldCheck size={20} /><p>Saved records contain published project requests, not private search history. Review the original post and availability before responding through its platform. Nothing is sent automatically.</p><Link href="/inquiries" className="text-link">View project requests <ArrowRight size={14} /></Link></div>
        </>}
      </main>
    </div>
  </div>;
}
function InfoLine() { return <FileText size={20} />; }
