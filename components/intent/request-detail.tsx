'use client';

import { useEffect, useRef } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { ProjectInquiry } from '@/lib/intent/types';
import EvidenceFields, { evidenceDate, publicEvidenceLink, requiredServiceName, sourcePlatform } from './evidence-fields';

export type InquiryRecord = Omit<ProjectInquiry, 'owner_id' | 'run_id' | 'evidence'>;

export default function RequestDetail({ inquiry, onClose }: { inquiry: InquiryRecord; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary') ?? []);
      const first = elements[0], last = elements.at(-1);
      if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  const url = publicEvidenceLink(inquiry.source_url);
  const platform = sourcePlatform(inquiry.source_url);
  const expired = inquiry.deadline_at && Date.parse(inquiry.deadline_at) < Date.now();
  return <div className="modal-backdrop" onClick={onClose}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="project-request-title" className="panel lead-modal inquiry-modal" onClick={event => event.stopPropagation()}>
      <button className="modal-close icon-button" aria-label="Close project request" onClick={onClose}><X size={20} /></button>
      <div className="eyebrow">PUBLISHED PROJECT REQUEST</div><h2 id="project-request-title">{inquiry.title}</h2>
      <p className="modal-description">{expired ? 'Recorded request · its deadline has passed' : 'Published request · review availability'}{inquiry.buyer_name ? ` · ${inquiry.buyer_name}` : ''}</p>
      <EvidenceFields request={<blockquote>{inquiry.request_text}</blockquote>}
        requestHelp="Exact wording from the public request. Private search history is unavailable."
        service={requiredServiceName(inquiry.service)}
        platform={platform ? `Public request on ${platform}` : 'Unknown'}
        platformHelp="This identifies where the request was published, not which search engine the buyer used."
        origin={<>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{url} <ExternalLink size={13} /></a> : 'Source link unavailable'}<small>Published: {evidenceDate(inquiry.published_at)}{inquiry.deadline_at ? ` · Deadline: ${evidenceDate(inquiry.deadline_at)}` : ''}</small></>}
      />
      <details className="inquiry-trace"><summary>How this request was discovered</summary><p>Your app found this public page using the query below. This is the app’s search, not the buyer’s search history.</p><p className="inquiry-query">{inquiry.discovery_query}</p><p>Saved in your workspace: {evidenceDate(inquiry.discovered_at)}.</p></details>
      {url && <div className="modal-actions"><a href={url} target="_blank" rel="noopener noreferrer" className="button primary">Read original request <ExternalLink size={15} /></a></div>}
    </section>
  </div>;
}
