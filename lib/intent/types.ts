import { z } from 'zod';

export const serviceNames = {
  website: 'Website development',
  application: 'Application development',
} as const;
export const requestedServiceSchema = z.enum(['website', 'application', 'website_and_application']);
export type RequestedService = z.infer<typeof requestedServiceSchema>;
export type ProjectSearchResult = {
  title: string;
  url: string;
  rawContent: string;
  // Search-engine dates are hints only; qualification requires a date in the source text.
  publishedDate: string | null;
};
export type ProjectSearchPage = { results: ProjectSearchResult[] };
export type ProjectEvidence = {
  version: 1;
  title: string;
  requestText: string;
  service: RequestedService;
  sourceUrl: string;
  platform: string;
  publishedAt: string;
  publishedDateText: string;
  deadlineAt: string | null;
  deadlineText: string | null;
  countryCode: string;
  countryEvidence: string;
  buyerName: string | null;
};
export type EvidenceRejection = 'unsafe_source' | 'missing_content' | 'not_buyer_request' | 'service_mismatch' | 'employment' | 'supplier_marketing' | 'closed' | 'missing_date' | 'stale' | 'expired' | 'country_unknown' | 'country_excluded';
export type ProjectQualification = { qualified: true; evidence: ProjectEvidence } | { qualified: false; reason: EvidenceRejection };
export type ProjectInquiry = {
  id: string;
  owner_id: string;
  run_id: string;
  title: string;
  request_text: string;
  service: RequestedService;
  source_url: string;
  platform: string;
  published_at: string;
  deadline_at: string | null;
  country_code: string;
  buyer_name: string | null;
  discovery_query: string;
  evidence: ProjectEvidence;
  discovered_at: string;
};
