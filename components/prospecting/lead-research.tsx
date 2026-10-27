'use client';

import { useEffect, useState } from 'react';

type Research = {
  summary: string | null;
  industry: string;
  employeeCount: number | null;
  timeZone: string | null;
  sources: { uri: string; lastSeenOn: string | null }[];
  aiDraft: string | null;
};
function publicLink(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export default function LeadResearch({ leadId }: { leadId: string }) {
  const [research, setResearch] = useState<Research | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setResearch(null);
    async function load() {
      try {
        const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/research`, { signal: controller.signal, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Research could not be loaded.');
        setResearch(result.research);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Research could not be loaded.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [leadId]);
  return <section className="lead-research"><h3>Company research</h3>
    {loading ? <p>Loading recorded research…</p> : error ? <p role="alert">{error}</p> : !research ? <p>No company research recorded.</p> : <>
      <p>{research.summary || 'No company description provided.'}</p>
      <dl>{[['Industry', research.industry || 'Not provided'], ['Employee count', research.employeeCount === null ? 'Not provided' : String(research.employeeCount)], ['Time zone', research.timeZone || 'Not provided']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <h4>Published contact sources</h4><ul>{research.sources.map((source, index) => {
        const url = publicLink(source.uri);
        return url ? <li key={`${url}-${index}`}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a>{source.lastSeenOn && <small>Provider last saw this source: {source.lastSeenOn}</small>}</li> : null;
      })}</ul>
      {research.aiDraft && <div className="info-box"><div><strong>AI research draft · review required</strong><p>{research.aiDraft}</p></div></div>}
      <p className="discovery-help">Company facts and source links come from Hunter. Verification does not establish permission to contact this prospect.</p>
    </>}
  </section>;
}
