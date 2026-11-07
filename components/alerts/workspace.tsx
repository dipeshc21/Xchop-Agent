'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Clock3, Database, Download, ExternalLink, Globe, LoaderCircle, RefreshCw, Rss, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ResourceType = 'google_alerts' | 'linkedin_posts';
type CheckResult = { id: string; label: string; ready: boolean; message: string };
type FeedSource = {
  id: string; resource_type: ResourceType; title: string; feed_url: string; enabled: boolean;
  last_checked_at: string | null; last_success_at: string | null; next_check_at: string | null;
  error_code?: string | null;
};
type FeedRun = {
  id: string; resource_type: ResourceType; status: string; created_at: string; finished_at: string | null;
  entries_seen: number; leads_saved: number; skipped_count: number; message: string | null; error_code: string | null;
};
type AlertStatus = {
  migrationReady: boolean;
  readiness: { ready: boolean; ownerBound: boolean; checks: CheckResult[] };
  sources: FeedSource[]; runs: FeedRun[];
};
const sourceNames: Record<ResourceType, string> = {
  google_alerts: 'Google Alerts',
  linkedin_posts: 'LinkedIn posts via Google Alerts',
};
const timestamp = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value))
  : 'Not recorded';

export default function AlertsWorkspace({ userEmail }: { userEmail: string }) {
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dirtySources, setDirtySources] = useState<ResourceType[]>([]);
  const sequence = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++sequence.current;
    try {
      const response = await fetch('/api/alerts', { cache: 'no-store', signal });
      if (response.status === 401) { window.location.assign('/login'); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Alert sources could not be loaded.');
      if (!result.readiness || !Array.isArray(result.sources) || !Array.isArray(result.runs)) throw new Error('Alert source status could not be read. Refresh and try again.');
      if (current !== sequence.current) return;
      setStatus(result); setError('');
    } catch (failure) {
      if (!signal?.aborted && current === sequence.current) setError(failure instanceof Error ? failure.message : 'Alert sources could not be loaded.');
    } finally { if (!signal?.aborted && current === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(controller.signal); }, 20_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);

  function markDirty(type: ResourceType, dirty: boolean) {
    setDirtySources(previous => dirty ? previous.includes(type) ? previous : [...previous, type] : previous.filter(value => value !== type));
  }
  async function checkNow() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/alerts/run', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The feed check could not be queued.');
      setMessage(result.message || 'Feed check queued. Review the run history below for actual results.');
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The feed check could not be queued.'); }
    finally { setBusy(false); }
  }
  const enabledCount = status?.sources.filter(source => source.enabled).length ?? 0;
  const inProgress = status?.runs.some(run => run.status === 'running' && Date.now() - Date.parse(run.created_at) < 15 * 60_000);

  return <main className="setup-shell alerts-shell">
    <div className="alerts-back-links"><Link href="/?view=leads"><ArrowLeft size={15} /> Back to leads</Link><Link href="/prospecting">Hunter discovery</Link></div>
    <div className="page-heading alerts-page-heading"><div><div className="eyebrow">FREE PROJECT ALERTS</div><h1>Let public requests come to you.</h1><p>Connect Google Alerts and indexed public LinkedIn posts. These feeds use no Hunter credits.</p></div><div className="heading-actions"><Link href="/alerts/setup" className="button outline">Setup guide <ArrowRight size={15} /></Link><Button onClick={checkNow} disabled={busy || loading || !status?.migrationReady || !status?.readiness.ready || !enabledCount || Boolean(inProgress) || dirtySources.length > 0}>{busy ? <LoaderCircle size={16} /> : <RefreshCw size={16} />} Check feeds now</Button></div></div>
    <div className="info-box"><Rss size={21} /><div><strong>Two sources, one review list.</strong><p>New matching alerts appear in Leads → Today. Their Resource title and original link show where they came from. Older discoveries stay in Past.</p><small>Signed in as {userEmail}</small></div></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="discovery-success" role="status"><Check size={17} />{message}</div>}
    {loading && <section className="panel empty-inline"><LoaderCircle size={20} /><p>Checking your free alert sources…</p></section>}
    {!loading && !status && <section className="panel empty-records"><Database size={28} /><h3>Alert setup could not load.</h3><p>Check the setup guide and your database connection.</p><Button onClick={() => load()}>Try again</Button></section>}
    {status && <>
      {!status.migrationReady && <section className="panel alert-install-note"><Database size={22} /><div><h2>Install the free-alert database update.</h2><p>Open the setup guide, copy migration 010 and run it in your existing Supabase project. Existing contacts and Hunter settings are retained.</p><Link href="/alerts/setup" className="text-link">Open free-alert setup <ArrowRight size={14} /></Link></div></section>}
      <section className="panel alert-readiness"><div className="section-heading"><div><h2>Connection checks</h2><p>These check configuration. Run history confirms whether a feed was actually read.</p></div><button className="icon-button" aria-label="Refresh free alert status" onClick={() => load()}><RefreshCw size={17} /></button></div><div className="discovery-check-grid">{status.readiness.checks.map(check => <div className="discovery-check" key={check.id}><span className={check.ready ? 'check-ready' : 'check-pending'}>{check.ready ? <Check size={15} /> : <Clock3 size={15} />}</span><div><strong>{check.label}</strong><p>{check.message}</p></div></div>)}</div></section>
      <div className="alert-source-grid">{(['google_alerts', 'linkedin_posts'] as const).map(type => <SourceCard key={type} type={type} source={status.sources.find(source => source.resource_type === type)} migrationReady={status.migrationReady} ready={status.readiness.ready} onDirty={markDirty} onSaved={async text => { setMessage(text); await load(); }} />)}</div>
      <p className="alert-schedule-note">Enabled sources are checked hourly through your hosted Inngest schedule. A manual check may wait for an active check or a short cooldown. Save edits before checking feeds.</p>
      <section className="panel leads-panel alert-run-history"><div className="section-heading"><div><h2>Feed check history</h2><p>Times use India time. A completed check can save zero alerts when entries are irrelevant, already saved or missing enough detail.</p></div></div><div className="table-scroll"><table><thead><tr><th>STARTED</th><th>RESOURCE</th><th>STATUS</th><th>ENTRIES</th><th>SAVED</th><th>SKIPPED</th><th>RESULT</th></tr></thead><tbody>{status.runs.map(run => <tr key={run.id}><td>{timestamp(run.created_at)}</td><td>{sourceNames[run.resource_type] || run.resource_type}</td><td><span className={`run-state run-${run.status}`}>{run.status}</span></td><td>{run.entries_seen ?? 0}</td><td>{run.leads_saved ?? 0}</td><td>{run.skipped_count ?? 0}</td><td className="run-result">{run.message || run.error_code || (run.status === 'running' ? 'Checking the feed…' : 'Check finished.')}</td></tr>)}</tbody></table></div>{!status.runs.length && <div className="empty-records"><Clock3 size={27} /><h3>No feed checks recorded yet.</h3><p>Create your RSS feeds, save and enable a source, then choose Check feeds now.</p></div>}</section>
    </>}
    <section className="panel alert-resource-download"><div><Download size={24} /><h2>Keep the full free-resource list.</h2><p>Download the PDF with other sources to connect later, their free-access limits and useful searches.</p></div><a href="/resources/free-lead-generation-resources.pdf" download className="button primary"><Download size={16} /> Download resource list PDF</a></section>
    <div className="info-box alert-source-explanation"><ShieldCheck size={21} /><div><p>LinkedIn results are public posts indexed by Google, with partial coverage and possible delays. This is not a direct LinkedIn connection. Alerts contain snippets, so contact names, emails and full requirements may not be published.</p><p>Hunter has separate controls. If its credits are exhausted, <Link href="/prospecting">pause Hunter discovery</Link> while using these feeds. No emails or proposals are sent by this importer.</p></div></div>
  </main>;
}

function SourceCard({ type, source, migrationReady, ready, onDirty, onSaved }: {
  type: ResourceType; source?: FeedSource; migrationReady: boolean; ready: boolean;
  onDirty: (type: ResourceType, dirty: boolean) => void; onSaved: (message: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(source?.title || sourceNames[type]);
  const [feedUrl, setFeedUrl] = useState(source?.feed_url || '');
  const [enabled, setEnabled] = useState(source?.enabled || false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  dirtyRef.current = dirty;
  useEffect(() => {
    if (dirtyRef.current) return;
    setTitle(source?.title || sourceNames[type]); setFeedUrl(source?.feed_url || ''); setEnabled(source?.enabled || false);
  }, [source?.title, source?.feed_url, source?.enabled, type]);
  function edit(task: () => void) { dirtyRef.current = true; setDirty(true); onDirty(type, true); task(); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_type: type, title: title.trim(), feed_url: feedUrl.trim(), enabled }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'This source could not be saved.');
      dirtyRef.current = false; setDirty(false); onDirty(type, false);
      await onSaved(`${sourceNames[type]} saved${enabled ? ' and enabled for scheduled checks' : ' with scheduled checks paused'}.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'This source could not be saved.'); }
    finally { setBusy(false); }
  }
  return <form className="panel alert-source-card" onSubmit={submit}>
    <div className="alert-source-card-title"><span className="alert-source-icon">{type === 'google_alerts' ? <Rss size={22} /> : <Globe size={22} />}</span><div><h2>{type === 'google_alerts' ? 'Google Alerts' : 'LinkedIn public posts'}</h2><p>{type === 'google_alerts' ? 'Website and application project requests across public pages.' : 'Public LinkedIn posts found through your Google alert.'}</p></div></div>
    <label>Resource title<small>This name appears beside imported leads.</small><input required maxLength={120} value={title} onChange={event => edit(() => setTitle(event.target.value))} disabled={busy || !migrationReady} /></label>
    <label>Google Alerts RSS feed URL<small>Copy your own alert’s RSS link. No Google or LinkedIn password is needed.</small><input type="url" required maxLength={2000} value={feedUrl} onChange={event => edit(() => setFeedUrl(event.target.value))} placeholder="https://www.google.com/alerts/feeds/…/…" autoComplete="off" spellCheck={false} disabled={busy || !migrationReady} /></label>
    <label className="checkbox-label"><input type="checkbox" checked={enabled} onChange={event => edit(() => setEnabled(event.target.checked))} disabled={busy || !migrationReady} />Enable this source</label>
    {enabled && !ready && <p className="alert-card-help">Complete the connection checks before saving an enabled source. You can leave this source paused while setting it up.</p>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="alert-card-submit"><Button type="submit" disabled={busy || !migrationReady || (enabled && !ready)}>{busy ? <LoaderCircle size={15} /> : <Check size={15} />}{busy ? 'Saving…' : 'Save source'}</Button><span>{dirty ? 'Unsaved changes' : source ? source.enabled ? 'Scheduled checks enabled' : 'Scheduled checks paused' : 'Not connected yet'}</span></div>
    <div className="alert-source-times"><span>Last checked: {timestamp(source?.last_checked_at || null)}</span><span>Last successful check: {timestamp(source?.last_success_at || null)}</span>{source?.enabled && <span>Next due: {timestamp(source.next_check_at)}</span>}</div>
    <Link href={`/alerts/setup#${type === 'google_alerts' ? 'google-alerts' : 'linkedin-alerts'}`} className="text-link">How to create this feed <ExternalLink size={13} /></Link>
  </form>;
}
