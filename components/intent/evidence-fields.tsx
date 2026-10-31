import type { ReactNode } from 'react';
import type { RequestedService } from '@/lib/intent/types';

export function requiredServiceName(service: RequestedService) {
  return service === 'website' ? 'Website development'
    : service === 'application' ? 'Application development'
      : 'Website and application development';
}

/** Links are displayed only; this component never retrieves a source page. */
export function publicEvidenceLink(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (url.port && !['80', '443'].includes(url.port)) ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
        /(?:^|\.)(?:localhost|local|internal|invalid|test|example|home|lan|onion)$/.test(host)) return null;
    if (Array.from(url.searchParams.keys()).some(name => /(?:api[-_]?key|access[-_]?token|authorization|password|secret|signature|(?:^|[-_])token$)/i.test(name))) return null;
    return url.href;
  } catch { return null; }
}

export function sourcePlatform(url: string): string | null {
  const link = publicEvidenceLink(url);
  return link ? new URL(link).hostname.replace(/^www\./, '') : null;
}

export function evidenceDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  // Source dates express a publication day. Do not shift midnight to another day.
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}

type Props = {
  request: ReactNode;
  requestHelp?: string;
  service: ReactNode;
  platform: ReactNode;
  platformHelp?: string;
  origin: ReactNode;
};

/** The labels match the requested popup; helpers identify what the evidence proves. */
export default function EvidenceFields({ request, requestHelp, service, platform, platformHelp, origin }: Props) {
  return <dl className="intent-fields">
    <div className="intent-field"><dt>What they searched</dt><dd>{request}{requestHelp && <small>{requestHelp}</small>}</dd></div>
    <div className="intent-field"><dt>What service they required</dt><dd>{service}</dd></div>
    <div className="intent-field"><dt>On which platform they searched</dt><dd>{platform}{platformHelp && <small>{platformHelp}</small>}</dd></div>
    <div className="intent-field"><dt>From where they appeared</dt><dd>{origin}</dd></div>
  </dl>;
}
