'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowUpRight, Database, FileSearch, LayoutDashboard, LoaderCircle, Menu, RefreshCw, Search, Settings, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { countryNames } from '@/lib/prospecting/types';
import RequestDetail, { type InquiryRecord } from './request-detail';
import { evidenceDate, requiredServiceName, sourcePlatform } from './evidence-fields';

type Filters = { q: string; country: string; service: string; p: number };
type Result = { migrationReady: boolean; inquiries: InquiryRecord[]; pagination: { page: number; pageSize: number; total: number } | null; message?: string; maxAgeDays?: number };

export default function InquiryWorkspace({ userEmail, filters }: { userEmail: string; filters: Filters }) {
  const router = useRouter();
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState(filters.q);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<InquiryRecord | null>(null);
  const search = new URLSearchParams({ ...(filters.q ? { q: filters.q } : {}), ...(filters.country ? { country: filters.country } : {}), ...(filters.service ? { service: filters.service } : {}), p: String(filters.p) }).toString();
  useEffect(() => { setQuery(filters.q); }, [filters.q]);
  const fetchRequests = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError(''); setResult(null); setSelected(null);
    try {
      const response = await fetch(`/api/inquiries?${search}`, { cache: 'no-store', signal });
      if (response.status === 401) { window.location.assign('/login'); return; }
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Project requests could not be loaded.');
      if (!signal.aborted) setResult(json);
    } catch (failure) {
      if (!signal.aborted) setError(failure instanceof Error ? failure.message : 'Project requests could not be loaded.');
    } finally { if (!signal.aborted) setLoading(false); }
  }, [search]);
  useEffect(() => { const controller = new AbortController(); void fetchRequests(controller.signal); return () => controller.abort(); }, [fetchRequests, refresh]);
  function changeFilters(changes: Partial<Filters>) {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams({ ...(next.q ? { q: next.q } : {}), ...(next.country ? { country: next.country } : {}), ...(next.service ? { service: next.service } : {}), ...(next.p > 1 ? { p: String(next.p) } : {}) });
    router.push(`/inquiries${params.size ? `?${params}` : ''}`);
  }
  function submit(event: FormEvent) { event.preventDefault(); changeFilters({ q: query.trim(), p: 1 }); }
  const pagination = result?.pagination;
  return <div className="app-shell inquiry-shell">
    <aside className={`sidebar ${mobile ? 'open' : ''}`}>
      <Link href="/" className="brand"><span className="brand-mark">x.</span><span>XHTMLChop<small>GROWTH AGENT</small></span></Link>
      <div className="workspace-picker"><span className="workspace-avatar">XC</span><span>Your growth workspace<small>Published project requests</small></span></div>
      <div className="nav-label">WORKSPACE</div><nav aria-label="Workspace navigation"><Link href="/" className="nav-item"><LayoutDashboard size={19} />Dashboard</Link><Link href="/inquiries" className="nav-item active"><FileSearch size={19} />Project requests</Link><Link href="/prospecting" className="nav-item"><Search size={19} />Lead discovery</Link><Link href="/settings" className="nav-item"><Settings size={19} />Settings</Link></nav>
      <div className="sidebar-bottom"><div className="phase-card"><span className="tiny-overline">SOURCE EVIDENCE</span><strong>Read what the buyer requested.</strong><p>Each result includes the published requirement and its original page.</p><Link href="/?view=contacts">Unconfirmed contacts <ArrowRight size={14} /></Link></div><div className="profile"><span className="person-avatar">XC</span><span>Workspace owner<small>{userEmail}</small></span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={() => setMobile(!mobile)}><Menu size={20} /></button><span>Workspace</span><span>/</span><strong>Project requests</strong></div><button className="icon-button" aria-label="Refresh project requests" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={18} /></button></header>
      <main><div className="page-heading"><div><div className="eyebrow">WEBSITE & APPLICATION REQUIREMENTS</div><h1>See the request behind the lead.</h1><p>Published project requirements with a source, service match, and date.</p></div><div className="heading-actions"><Link href="/prospecting" className="button primary"><Search size={16} />Manage discovery</Link></div></div>
        <div className="info-box inquiry-evidence-note"><FileSearch size={22} /><p>These records contain publicly posted requirements. Review the original page for availability, eligibility, and how the buyer accepts responses. Unconfirmed company contacts are kept separately.</p></div>
        {loading && <section className="panel empty-inline"><LoaderCircle size={20} /><p>Loading your recorded project requests…</p></section>}
        {error && <section className="panel empty-records"><p role="alert" className="form-error">{error}</p><Button onClick={() => setRefresh(value => value + 1)}>Try again</Button></section>}
        {!loading && result && !result.migrationReady && <section className="panel empty-records"><Database size={28} /><h3>Install the project-request database update.</h3><p>{result.message}</p><Link href="/prospecting/setup" className="button primary">Open setup guide <ArrowRight size={15} /></Link></section>}
        {!loading && result?.migrationReady && <section className="panel leads-panel inquiry-list"><div className="section-heading"><div><h2>{pagination?.total ?? result.inquiries.length} published {pagination?.total === 1 ? 'request' : 'requests'}{filters.q || filters.country || filters.service ? ' matching your filters' : ''}</h2><p>Showing requests from the last {result.maxAgeDays ?? 30} days without a passed deadline. Open one to review its evidence.</p></div><Link href="/?view=contacts" className="text-link"><Users size={15} />Unconfirmed contacts</Link></div>
          <form className="table-filters inquiry-filters" onSubmit={submit}><label className="search-field"><Search size={17} /><input aria-label="Search project request title" placeholder="Search request title…" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filter required service" value={filters.service} onChange={event => changeFilters({ service: event.target.value, p: 1 })}><option value="">All services</option><option value="website">Website development</option><option value="application">Application development</option><option value="website_and_application">Website and application</option></select><select aria-label="Filter buyer country" value={filters.country} onChange={event => changeFilters({ country: event.target.value, p: 1 })}><option value="">All countries</option>{Object.entries(countryNames).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select><Button type="submit" variant="outline">Search</Button>{(filters.q || filters.country || filters.service) && <Button type="button" variant="ghost" onClick={() => changeFilters({ q: '', country: '', service: '', p: 1 })}>Clear filters</Button>}</form>
          <div className="table-scroll"><table><thead><tr><th>PROJECT REQUEST</th><th>SERVICE REQUIRED</th><th>PLATFORM</th><th>COUNTRY</th><th>PUBLISHED</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{result.inquiries.map(inquiry => <tr key={inquiry.id}><td><button className="company-button inquiry-title" onClick={() => setSelected(inquiry)}><span><strong>{inquiry.title}</strong><small>{inquiry.buyer_name || 'Published request · review availability'}</small></span></button></td><td>{requiredServiceName(inquiry.service)}</td><td>{sourcePlatform(inquiry.source_url) || 'Unknown'}</td><td>{countryNames[inquiry.country_code] || inquiry.country_code}</td><td>{evidenceDate(inquiry.published_at)}</td><td><button className="icon-button" aria-label={`View ${inquiry.title}`} onClick={() => setSelected(inquiry)}><ArrowUpRight size={16} /></button></td></tr>)}</tbody></table></div>
          {!result.inquiries.length && <div className="empty-records"><FileSearch size={28} /><h3>{filters.q || filters.country || filters.service ? 'No requests match these filters.' : 'No evidenced project requests saved yet.'}</h3><p>{filters.q || filters.country || filters.service ? 'Try another filter or review your discovery results.' : 'Connect public request search and run discovery. General company matches will not appear here.'}</p><Link href="/prospecting" className="button outline">Open lead discovery <ArrowRight size={15} /></Link></div>}
          {pagination && <div className="pagination"><span>{pagination.total ? `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.total)} of ${pagination.total}` : 'No records'}</span><Button variant="outline" disabled={pagination.page <= 1} onClick={() => changeFilters({ p: pagination.page - 1 })}>Previous</Button><Button variant="outline" disabled={pagination.page * pagination.pageSize >= pagination.total} onClick={() => changeFilters({ p: pagination.page + 1 })}>Next</Button></div>}
        </section>}
      </main>
    </div>{selected && <RequestDetail inquiry={selected} onClose={() => setSelected(null)} />}
  </div>;
}
