'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, Columns3, Send, Inbox, FileText, FolderKanban,
  ChartNoAxesCombined, Settings as SettingsIcon, ArrowUpRight, ArrowRight,
  ChevronDown, Search, ShieldCheck, Plus, Sun, Moon, Power, Check,
  Globe, Download, Menu, X, Info, RefreshCw, LogOut, Clock3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import CsvImport from '@/components/prospecting/csv-import';
import LeadResearch from '@/components/prospecting/lead-research';
import type { Lead } from '@/lib/models';
import type { DashboardPeriod, DashboardSummary } from '@/lib/dashboard';
import { type Settings, settingsSchema, stages } from '@/lib/schema';

type WorkspacePage = 'Dashboard' | 'Leads' | 'Settings';
type CommonProps = {
  initialSettings: Settings;
  userEmail: string;
};
type Props = CommonProps & ({
  settingsOnly: true;
} | {
  settingsOnly?: false;
  initialPage?: WorkspacePage;
  initialLeads: Lead[];
  summary: DashboardSummary;
  period: DashboardPeriod;
  search: string;
  country: string;
  pageNumber: number;
  pageSize: number;
  totalLeads: number;
});
const navigation = [['Dashboard', LayoutDashboard], ['Leads', Users], ['Settings', SettingsIcon]] as const;
const planned = [['Pipeline', Columns3], ['Outreach', Send], ['Inbox', Inbox], ['Quotes', FileText], ['Projects', FolderKanban], ['Analytics', ChartNoAxesCombined]] as const;
const money = (n: number, currency = 'USD') => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n); }
  catch { return `${currency} ${n.toFixed(2)}`; }
};
const date = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(value));

export default function Workspace(props: Props) {
  const { initialSettings, userEmail } = props;
  const workspaceData = props.settingsOnly ? null : props;
  const initialPage: WorkspacePage = props.settingsOnly ? 'Settings' : props.initialPage ?? 'Dashboard';
  const router = useRouter();
  const [activePage, setPage] = useState<WorkspacePage>(initialPage);
  const page: WorkspacePage = props.settingsOnly ? 'Settings' : activePage;
  const [settings, setSettings] = useState(initialSettings);
  const [draft, setDraft] = useState(initialSettings);
  const [dark, setDark] = useState(false);
  const [query, setQuery] = useState(workspaceData?.search ?? '');
  const [toast, setToast] = useState('');
  const [mobile, setMobile] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [adding, setAdding] = useState(false);
  const [settingTab, setSettingTab] = useState('Business profile');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [settingsConflict, setSettingsConflict] = useState(false);
  const receivedSettings = useRef(JSON.stringify(initialSettings));
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const [signingOut, setSigningOut] = useState(false);
  const [exporting, setExporting] = useState(false);
  const notify = (text: string) => setToast(text);

  useEffect(() => { try { setDark(localStorage.getItem('xchop-theme') === 'dark'); } catch { /* Theme persistence is optional. */ } }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => { setQuery(workspaceData?.search ?? ''); }, [workspaceData?.search]);
  useEffect(() => { setPage(initialPage); }, [initialPage]);
  useEffect(() => {
    const next = JSON.stringify(initialSettings);
    const previous = receivedSettings.current;
    if (next === previous) return;
    receivedSettings.current = next;
    setSettings(initialSettings);
    const edited = JSON.stringify(currentDraft.current);
    if (edited === previous || edited === next) { setDraft(initialSettings); setSettingsConflict(false); }
    else setSettingsConflict(true);
  }, [initialSettings]);
  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(''), 5500); return () => clearTimeout(id); } }, [toast]);

  function go(name: WorkspacePage) {
    setMobile(false);
    if (name === 'Leads') { router.push('/inquiries'); return; }
    if (props.settingsOnly && name !== 'Settings') {
      router.push('/');
      return;
    }
    setPage(name);
  }
  function filters(changes: { period?: string; q?: string; country?: string; p?: string }) {
    if (!workspaceData) return;
    const { period, search, country, pageNumber } = workspaceData;
    const params = new URLSearchParams({ view: page === 'Leads' ? 'contacts' : page.toLowerCase(), period, ...(search ? { q: search } : {}), ...(country ? { country } : {}), p: String(pageNumber), ...changes });
    for (const key of [...params.keys()]) if (!params.get(key)) params.delete(key);
    router.push(`/?${params}`);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (settingsConflict) { setSaveError('Saved settings have changed. Load the latest saved values before editing again.'); return; }
    const valid = settingsSchema.safeParse(draft);
    if (!valid.success) { setSaveError(valid.error.issues[0]?.message ?? 'Check the settings fields.'); return; }
    setSaving(true); setSaveError('');
    try {
      const response = await fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid.data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Settings could not be saved.');
      setSettings(valid.data); setDraft(valid.data); notify('Business settings saved to your database.'); router.refresh();
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Settings could not be saved.'); }
    finally { setSaving(false); }
  }
  async function exportData() {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch('/api/export');
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? 'Export could not be downloaded.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = 'xhtmlchop-leads-and-settings.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Your leads and business settings were exported.');
    } catch (error) { notify(error instanceof Error ? error.message : 'The export could not be downloaded.'); }
    finally { setExporting(false); }
  }
  async function signOut() {
    setSigningOut(true);
    try {
      const { supabaseBrowser } = await import('@/lib/supabase/browser');
      const { error } = await supabaseBrowser().auth.signOut();
      if (error) throw error;
      window.location.assign('/login');
    } catch { notify('Could not sign out. Please try again.'); setSigningOut(false); }
  }
  const chartMetrics = workspaceData ? {
    marketTotal: workspaceData.summary.markets.reduce((total, market) => total + market.count, 0),
    maxStage: Math.max(1, ...workspaceData.summary.funnel.map(item => item.count)),
  } : null;

  return <div className="app-shell">
    <aside className={`sidebar ${mobile ? 'open' : ''}`}>
      <button className="brand" onClick={() => go('Dashboard')}><span className="brand-mark">x.</span><span>XHTMLChop<small>GROWTH AGENT</small></span></button>
      <button className="workspace-picker" onClick={() => go('Settings')}><span className="workspace-avatar">XC</span><span>{settings.businessName} workspace<small>Your private workspace</small></span><ChevronDown size={14} /></button>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Workspace navigation">{navigation.map(([name, Icon]) => <button key={name} className={`nav-item ${page === name ? 'active' : ''}`} onClick={() => go(name)}><Icon size={19} /><span>{name}</span></button>)}<a href="/prospecting" className="nav-item"><Search size={19} /><span>Lead discovery</span></a></nav>
      <div className="nav-label planned-label">PLANNED FEATURES</div>
      <div className="planned-nav">{planned.map(([name, Icon]) => <div key={name} className="nav-item unavailable" title={`${name} has not been implemented yet`}><Icon size={17} /><span>{name}</span><Clock3 size={12} /></div>)}</div>
      <div className="sidebar-bottom"><div className="phase-card"><span className="tiny-overline">LIVE DATA ONLY</span><strong>Your business. Your records.</strong><p>{props.settingsOnly ? 'Business settings connected' : 'Sign-in and database connected'}</p><a href="/setup">Connection & setup guide <ArrowUpRight size={14} /></a></div><button className="profile" onClick={() => go('Settings')}><span className="person-avatar">XC</span><span>Workspace owner<small>{userEmail}</small></span><SettingsIcon size={16} /></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Toggle navigation" onClick={() => setMobile(!mobile)}><Menu size={20} /></button><span>Workspace</span><span className="slash">/</span><strong>{page}</strong></div><div className="top-actions"><span className="connection-tag"><span />{props.settingsOnly ? 'Settings connected' : 'Database connected'}</span><button className="icon-button" aria-label="Refresh records" onClick={() => router.refresh()}><RefreshCw size={17} /></button><button className="icon-button" aria-label="Toggle light or dark mode" onClick={() => { const next = !dark; setDark(next); try { localStorage.setItem('xchop-theme', next ? 'dark' : 'light'); } catch { /* Optional appearance preference. */ } }}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button><button className="icon-button" disabled={signingOut} aria-label="Sign out" onClick={signOut}><LogOut size={18} /></button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">{page === 'Dashboard' ? 'YOUR GROWTH, AT A GLANCE' : 'XHTMLCHOP WORKSPACE'}</div><h1>{page === 'Dashboard' ? 'Your business, in view.' : page === 'Leads' ? 'Unconfirmed contacts' : page}</h1><p>{page === 'Dashboard' ? 'Real records from your private workspace.' : page === 'Settings' ? 'Save the details your team and future automations will use.' : 'Existing contacts without evidenced project requirements. These are kept separately from project requests.'}</p></div><div className="heading-actions">{workspaceData && page === 'Dashboard' ? <><select aria-label="Reporting period" value={workspaceData.period} onChange={e => filters({ period: e.target.value })}><option value="month">This month</option><option value="week">Last 7 days</option><option value="all">All time</option></select><a href="/inquiries" className="button primary"><Search size={16} /> View project requests</a></> : workspaceData && page === 'Leads' ? <><Button variant="outline" disabled={exporting} onClick={exportData}><Download size={16} /> Export workspace</Button><Button onClick={() => setAdding(true)}><Plus size={16} /> Add lead</Button></> : <Button variant="outline" disabled={exporting} onClick={exportData}><Download size={16} /> Export workspace</Button>}</div></div>

        <div className="automation-bar"><div className="automation-copy"><span className="status-icon"><Power size={17} /></span><div><strong>Outreach has not been connected</strong><span>{props.settingsOnly ? 'Business settings are connected. Dashboard and lead access are checked separately.' : 'Lead discovery now requires public website or application project requests. Previous contacts remain unconfirmed.'}</span></div></div><span className="approval-badge"><ShieldCheck size={15} /> Approval required</span></div>

        {workspaceData && chartMetrics && page === 'Dashboard' && <>
          <div className="metrics-grid">{[
            { label: 'Contacts added', value: workspaceData.summary.leadCount, icon: Users, detail: 'Created in selected period' },
            { label: 'Emails sent', value: workspaceData.summary.sentCount, icon: Send, detail: 'Recorded sends in selected period' },
            { label: 'Reply rate', value: `${workspaceData.summary.replyRate}%`, icon: Inbox, detail: 'Sent contacts who replied in period' },
            { label: 'Won opportunities', value: workspaceData.summary.wonCount, icon: FolderKanban, detail: 'Currently won or in delivery · all time' },
          ].map(({ label, value, icon: Icon, detail }) => <section className="panel metric" key={label}><div className="metric-top"><span>{label}</span><Icon size={18} /></div><div className="metric-value">{value}</div><p>{detail}</p></section>)}</div>
          <div className="dashboard-columns">
            <section className="panel funnel-panel"><div className="section-heading"><div><h2>Your pipeline stages</h2><p>Current stage of every lead · all time.</p></div><span className="badge">Actual records</span></div><div className="stage-chart">{workspaceData.summary.funnel.map(item => <div className="stage-chart-row" key={item.stage}><span>{item.stage}</span><div><i style={{ width: `${item.count / chartMetrics.maxStage * 100}%` }} /></div><strong>{item.count}</strong></div>)}</div><div className="funnel-footer"><span><span className="legend-dot" /> Each lead appears in its current stage</span><button onClick={() => go('Leads')}>Manage leads <ArrowRight size={14} /></button></div></section>
            <section className="panel revenue-panel"><div className="section-heading"><div><h2>Recorded revenue</h2><p>Confirmed payment records in selected period.</p></div><span className="round-icon"><ChartNoAxesCombined size={20} /></span></div><div className="actual-revenue">{workspaceData.summary.revenue.length ? workspaceData.summary.revenue.map(item => <div key={item.currency}><small>{item.currency}</small><strong>{money(item.amount, item.currency)}</strong></div>) : <><strong>{money(0)}</strong><p>No confirmed payments recorded.</p></>}</div><div className="revenue-bottom"><div><span>Open pipeline · all time</span><strong>{money(workspaceData.summary.pipelineValue)}</strong></div><div><span>Quotes in selected period</span><strong>{workspaceData.summary.quoteCount}</strong></div></div><small>Pipeline estimates use USD. Payment currencies are reported separately. Payment collection will be added later.</small></section>
          </div>
          <div className="dashboard-columns bottom-columns"><section className="panel attention-panel"><div className="section-heading"><div className="inline-title"><h2>Upcoming work</h2><span className="count-badge">{workspaceData.summary.attention.length}</span></div><span className="muted-small">Due within 7 days or overdue</span></div>{workspaceData.summary.attention.length ? workspaceData.summary.attention.map(item => <div className="attention-row" key={`${item.kind}-${item.id}`}><span className="attention-icon green">{item.kind === 'project' ? <FolderKanban size={18} /> : <Check size={18} />}</span><div><strong>{item.title}</strong><p>{item.detail} · Due {date(item.due_at)}</p></div></div>) : <div className="empty-inline"><ShieldCheck size={26} /><p>No upcoming tasks or project deadlines recorded.</p></div>}<div className="subtle-note"><Info size={13} /> Task and delivery management will be added later.</div></section><section className="panel market-panel"><div className="section-heading"><div><h2>Contact markets</h2><p>Countries from your actual leads · all time.</p></div><Globe size={19} /></div>{workspaceData.summary.markets.length ? workspaceData.summary.markets.slice(0, 6).map(item => <div className="country-row" key={item.country}><span>{item.country}</span><div className="country-track"><span style={{ width: `${item.count / Math.max(1, chartMetrics.marketTotal) * 100}%` }} /></div><strong>{item.count}</strong></div>) : <div className="empty-inline"><p>Add your first lead to see its market here.</p></div>}<div className="market-note"><ShieldCheck size={14} />{settings.excludeIndia ? 'New outbound leads from India are excluded' : 'All markets enabled'}<button onClick={() => { go('Settings'); setSettingTab('Safety & preferences'); }}>Manage</button></div></section></div>
          <section className="panel discovery-leads-banner"><div><strong>Find clients with published development requests.</strong><p>Only dated website or application requests with source evidence appear in your project list.</p></div><a href="/inquiries" className="button primary">View project requests <ArrowRight size={15} /></a></section><section className="panel leads-panel"><div className="section-heading"><div><h2>Recent unconfirmed contacts</h2><p>{workspaceData.search || workspaceData.country ? 'Showing your current lead filters.' : 'Previous contacts; no project request is established.'}</p></div><button className="text-link" onClick={() => go('Leads')}>Manage leads <ArrowRight size={15} /></button></div><LeadTable leads={workspaceData.initialLeads.slice(0, 5)} onSelect={setSelected} emptyAction={() => setAdding(true)} /></section><div className="workspace-footer"><span><span className="legend-dot" /> Signed in · records protected by account access rules</span><span>Reports use UTC · due dates use India time.</span></div>
        </>}

        {workspaceData && page === 'Leads' && <><div className="discovery-leads-banner panel"><div><strong>Find requests for your development services.</strong><p>Search for dated website and application project requests with source evidence.</p></div><a href="/prospecting" className="button primary"><Search size={15} /> Open lead discovery</a></div><section className="panel leads-panel"><div className="section-heading"><div><h2>{workspaceData.totalLeads} {workspaceData.totalLeads === 1 ? 'lead' : 'leads'}{workspaceData.search || workspaceData.country ? ' matching your filters' : ''}</h2><p>Unconfirmed contacts. A company match or verified email does not establish a development requirement.</p></div></div><form className="table-filters" onSubmit={e => { e.preventDefault(); filters({ q: query.trim(), p: '1' }); }}><label className="search-field"><Search size={17} /><input aria-label="Search company name" placeholder="Search company name…" maxLength={100} value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="Filter country" value={workspaceData.country} onChange={e => filters({ country: e.target.value, p: '1' })}><option value="">All countries</option>{workspaceData.summary.markets.map(item => <option key={item.country}>{item.country}</option>)}</select><Button type="submit" variant="outline">Search</Button>{(workspaceData.search || workspaceData.country) && <Button type="button" variant="ghost" onClick={() => { setQuery(''); filters({ q: '', country: '', p: '1' }); }}>Clear filters</Button>}</form><LeadTable leads={workspaceData.initialLeads} onSelect={setSelected} emptyAction={() => setAdding(true)} /><div className="pagination"><span>{workspaceData.totalLeads ? `${(workspaceData.pageNumber - 1) * workspaceData.pageSize + 1}–${Math.min(workspaceData.pageNumber * workspaceData.pageSize, workspaceData.totalLeads)} of ${workspaceData.totalLeads}` : 'No records'}</span><Button variant="outline" disabled={workspaceData.pageNumber <= 1} onClick={() => filters({ p: String(workspaceData.pageNumber - 1) })}>Previous</Button><Button variant="outline" disabled={workspaceData.pageNumber * workspaceData.pageSize >= workspaceData.totalLeads} onClick={() => filters({ p: String(workspaceData.pageNumber + 1) })}>Next</Button></div></section><CsvImport onImported={() => router.refresh()} /></>}

        {page === 'Settings' && <div className="settings-layout"><nav className="settings-nav" aria-label="Settings sections">{['Business profile', 'Safety & preferences', 'Knowledge base', 'Connections'].map(tab => <button key={tab} className={settingTab === tab ? 'selected' : ''} onClick={() => setSettingTab(tab)}>{tab}</button>)}<a href="/setup">Connection & setup guide <ArrowUpRight size={14} /></a></nav><form className="panel settings-panel" onSubmit={save}>
          {settingsConflict && <div className="info-box" role="status"><div><p>Your saved settings changed while you were editing. Load the latest values before making more changes.</p><Button type="button" variant="outline" onClick={() => { setDraft(settings); setSettingsConflict(false); setSaveError(''); }}>Load latest saved values</Button></div></div>}
          {settingTab === 'Business profile' && <><h2>Your business, in your words.</h2><p>Confirm your services, prices, and postal address before outreach is connected.</p><div className="form-grid">{([['businessName', 'Business name'], ['website', 'Website'], ['ownerEmail', 'Owner notification email'], ['turnaround', 'Typical turnaround']] as const).map(([key, label]) => <label key={key}>{label}<input type={key === 'ownerEmail' ? 'email' : key === 'website' ? 'url' : 'text'} required={key === 'businessName' || key === 'website'} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}</div><label>Business postal address<textarea value={draft.address} placeholder="Your full business mailing address" onChange={e => setDraft({ ...draft, address: e.target.value })} /></label><label>Services<small>Edit this list to match the services you actually provide.</small><textarea rows={7} value={draft.services} onChange={e => setDraft({ ...draft, services: e.target.value })} /></label><label>Pricing<input value={draft.pricing} onChange={e => setDraft({ ...draft, pricing: e.target.value })} /></label></>}
          {settingTab === 'Safety & preferences' && <><h2>You set the boundaries.</h2><p>These settings are saved to your account.</p><label className="checkbox-label"><input type="checkbox" checked={draft.excludeIndia} onChange={e => setDraft({ ...draft, excludeIndia: e.target.checked })} /> Exclude India when adding new leads</label><label>Daily sending limit per domain<small>A saved limit for the future outreach engine. Sending is not active.</small><input type="number" min={1} max={30} required value={draft.dailyLimit} onChange={e => setDraft({ ...draft, dailyLimit: Number(e.target.value) })} /></label><div className="info-box"><ShieldCheck size={20} /><p>Approval Mode is enforced for outreach. Automatic discovery has its own controls in Lead discovery; email sending is not active.</p></div></>}
          {settingTab === 'Knowledge base' && <><h2>Your source of truth.</h2><p>Save confirmed FAQs and policies here. The AI assistant will be connected in a later build.</p><label>FAQs, pricing, process & revisions<textarea rows={15} value={draft.knowledgeBase} onChange={e => setDraft({ ...draft, knowledgeBase: e.target.value })} /></label></>}
          {settingTab === 'Connections' && <><h2>Your connections</h2><p>Secrets are configured in your environment file and are never displayed here.</p><div className="connection-row"><div><strong>Supabase</strong><p>{props.settingsOnly ? 'Your account and business settings were checked when this page loaded. Dashboard checks are separate.' : 'Authenticated database connection checked when this page loads.'}</p></div><span className="badge">Connected</span></div><div className="connection-row"><div><strong>Automatic discovery</strong><p>Public project-request search with Tavily and Inngest scheduling. Check readiness on the discovery page.</p></div><a href="/prospecting" className="text-link">Open discovery <ArrowRight size={14} /></a></div>{[['AI outreach writing', 'Planned for follow-up emails'], ['Outreach', 'Email sending'], ['Payments', 'Stripe or PayPal']].map(([name, detail]) => <div className="connection-row" key={name}><div><strong>{name}</strong><p>{detail}</p></div><span className="badge">Not implemented</span></div>)}<p className="connection-help">The full setup guide includes your environment file instructions.</p><a className="text-link" href="/setup">Open connection checks <ArrowRight size={14} /></a></>}
          {saveError && <p role="alert" className="form-error">{saveError}</p>}<div className="settings-submit"><Button type="submit" disabled={saving || settingsConflict}><Check size={16} />{saving ? 'Saving…' : 'Save changes'}</Button><span>Saved settings are available after signing in on another device.</span></div>
        </form></div>}
      </main>
    </div>
    {toast && <div role="status" className="toast"><Check size={17} />{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16} /></button></div>}
    {workspaceData && adding && <LeadForm excludeIndia={settings.excludeIndia} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); go('Leads'); router.push('/?view=contacts'); router.refresh(); notify('Contact saved to your database.'); }} />}
    {workspaceData && selected && <LeadDetail lead={selected} onClose={() => setSelected(null)} onSaved={lead => { setSelected(lead); router.refresh(); notify('Lead stage and value saved.'); }} />}
  </div>;
}

function LeadTable({ leads, onSelect, emptyAction }: { leads: Lead[]; onSelect: (lead: Lead) => void; emptyAction: () => void }) {
  return <div className="table-scroll"><table><thead><tr><th>COMPANY / CONTACT</th><th>COUNTRY</th><th>FIT SCORE</th><th>STAGE</th><th>VALUE (USD)</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{leads.map((lead, index) => <tr key={lead.id}><td><button className="company-button" onClick={() => onSelect(lead)}><span className={`company-avatar tone-${index % 4}`}>{lead.company.split(' ').slice(0, 2).map(word => word[0]).join('')}</span><span><strong>{lead.company}</strong><small>{lead.contact_name || 'No contact name'}{lead.segment ? ` · ${lead.segment}` : ''}</small></span></button></td><td>{lead.country}</td><td>{lead.score_reason && lead.score_reason !== 'Not scored' ? <span className="score" title={lead.score_reason}>{lead.score} / 100</span> : <span className="not-scored">Not scored</span>}</td><td><span className={`stage stage-${lead.stage.toLowerCase().replaceAll(' ', '-')}`}>{lead.stage}</span></td><td className="value-cell">{money(lead.value)}</td><td><button className="icon-button" aria-label={`View ${lead.company}`} onClick={() => onSelect(lead)}><ArrowUpRight size={16} /></button></td></tr>)}</tbody></table>{!leads.length && <div className="empty-records"><Users size={28} /><h3>No leads to show yet.</h3><p>Add a real business contact, or clear your search filters.</p><Button onClick={emptyAction}><Plus size={15} /> Add a lead</Button></div>}</div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? []);
      const first = elements[0], last = elements[elements.length - 1];
      if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.body.style.overflow = savedOverflow; document.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={onClose}><section ref={ref} role="dialog" aria-modal="true" aria-label={title} className="panel lead-modal" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button><h2>{title}</h2>{children}</section></div>;
}

function LeadForm({ excludeIndia, onClose, onSaved }: { excludeIndia: boolean; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState({ company: '', contact_name: '', email: '', website: '', country: '', role: '', segment: '', source: '', lawful_basis: '', value: '' });
  const field = (name: keyof typeof values) => ({ value: values[name], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues({ ...values, [name]: event.target.value }) });
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, value: Number(values.value || 0) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Lead could not be saved.');
      onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Lead could not be saved.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Add a real lead" onClose={() => { if (!busy) onClose(); }}><p className="modal-description">Save a business contact and its source. Adding a lead does not contact them.</p><form onSubmit={submit}>
    <label>Company name<input required maxLength={200} {...field('company')} /></label><div className="form-grid"><label>Contact name<input maxLength={200} {...field('contact_name')} /></label><label>Email<input type="email" required maxLength={254} {...field('email')} /></label></div><label>Company website<input type="url" placeholder="https://" maxLength={500} {...field('website')} /></label><div className="form-grid"><label>Country<small>Use the full country name.</small><input required maxLength={100} placeholder="United States" {...field('country')} /></label><label>Contact role<input maxLength={100} {...field('role')} /></label></div><div className="form-grid"><label>Segment<select {...field('segment')}><option value="">Choose a segment</option><option>Design agency</option><option>Freelance designer</option><option>Digital agency</option><option>Startup</option><option>E-commerce</option><option>SaaS</option><option>Other</option></select></label><label>Estimated opportunity value (USD)<input type="number" min={0} max={9999999999.99} step="0.01" placeholder="0.00" {...field('value')} /></label></div><label>Lead source<small>For example, the contact form, a referral, or a public business directory URL.</small><input required maxLength={500} {...field('source')} /></label><label>Lawful basis / permission note<small>Record why you may store and contact this person. A note alone does not establish consent.</small><textarea required rows={3} maxLength={2000} {...field('lawful_basis')} /></label>{excludeIndia && <p className="subtle-note"><ShieldCheck size={14} /> India is excluded in your account settings.</p>}{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save lead'}</Button></div>
  </form></Modal>;
}

function LeadDetail({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: (lead: Lead) => void }) {
  const [stage, setStage] = useState(lead.stage);
  const [value, setValue] = useState(String(lead.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/leads', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lead.id, stage, value: Number(value) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Changes could not be saved.');
      onSaved({ ...result.lead, value: Number(result.lead.value) });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Changes could not be saved.'); }
    finally { setBusy(false); }
  }
  return <Modal title={lead.company} onClose={() => { if (!busy) onClose(); }}><p className="modal-description">{lead.segment || 'Business contact'} · {lead.country}</p><LeadResearch leadId={lead.id} source={lead.source} /><details className="legacy-contact-details"><summary>Contact details and previous assessment</summary><dl>{[
    ['Contact', lead.contact_name || 'Not provided'], ['Email', lead.email], ['Website', lead.website || 'Not provided'], ['Source', lead.source], ['Lawful basis', lead.lawful_basis], ['Added', date(lead.created_at)], ['Fit assessment', lead.score_reason || 'Not scored'], ['Email verification', lead.email_verification_status || 'unverified'], ['Last verified', lead.email_verified_at ? date(lead.email_verified_at) : 'Not verified'], ['Contact review', lead.contact_review_status === 'needs_review' ? 'Required before outreach' : lead.contact_review_status || 'Not reviewed'],
  ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details><form onSubmit={submit}><div className="form-grid"><label>Pipeline stage<select value={stage} onChange={event => setStage(event.target.value)}>{stages.map(name => <option key={name}>{name}</option>)}</select></label><label>Opportunity value (USD)<input type="number" required min={0} max={9999999999.99} step="0.01" value={value} onChange={event => setValue(event.target.value)} /></label></div><p className="subtle-note">Changing a stage updates your CRM records. It does not record a payment or send an email.</p>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button></div></form></Modal>;
}
