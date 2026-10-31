'use client';

import { useEffect, useState } from 'react';
import EvidenceFields, { publicEvidenceLink } from '@/components/intent/evidence-fields';

type Research = {
  summary: string | null;
  industry: string;
  employeeCount: number | null;
  timeZone: string | null;
  sources: { uri: string; lastSeenOn: string | null }[];
  aiDraft: string | null;
};

export default function LeadResearch({ leadId, source = '' }: { leadId: string; source?: string }) {
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
        if (!response.ok) throw new Error(result.error || 'Contact sources could not be loaded.');
        setResearch(result.research);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Contact sources could not be loaded.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [leadId]);
  const contactSources = research?.sources.map(item => ({ ...item, url: publicEvidenceLink(item.uri) })).filter(item => item.url) ?? [];
  // Company descriptions, role matches, verified emails and AI notes do not establish
  // a buyer request. Legacy contacts therefore retain unknown requirement fields.
  const origin = /^Hunter official APIs:/i.test(source) ? 'Hunter contact discovery' : source || 'Contact source not recorded';
  return <section className="lead-research legacy-request-evidence">
    <p className="inquiry-unconfirmed">Unconfirmed contact · no project requirement recorded</p>
    <EvidenceFields request="No published request recorded"
      requestHelp="Private search history is unavailable. Company information does not show what this person requested."
      service="Unknown"
      platform="Unknown"
      platformHelp="A contact-source page does not establish where the person searched for development services."
      origin={<>{origin}{loading && <small>Loading recorded contact sources…</small>}{error && <small role="alert">{error}</small>}{!loading && !error && !contactSources.length && <small>No published project-source URL is recorded.</small>}{contactSources.length > 0 && <ul className="inquiry-contact-sources">{contactSources.map((item, index) => <li key={`${item.url}-${index}`}><a href={item.url!} target="_blank" rel="noopener noreferrer">{item.url}</a><small>Published contact source; not a project request.</small></li>)}</ul>}</>}
    />
    {research?.summary && <details className="inquiry-trace"><summary>Recorded company description</summary><p>{research.summary}</p><p>This description is background information. It does not confirm a website or application project.</p></details>}
  </section>;
}
