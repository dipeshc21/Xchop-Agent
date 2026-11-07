import { z } from 'zod';

export const alertResourceTypes = ['google_alerts', 'linkedin_posts'] as const;
export type AlertResourceType = typeof alertResourceTypes[number];
export const alertResourceNames: Record<AlertResourceType, string> = {
  google_alerts: 'Google Alerts',
  linkedin_posts: 'LinkedIn posts via Google Alerts',
};

/** Feed links are private configuration, never arbitrary server fetch targets. */
export function validateFeedUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500 || value !== value.trim()) return false;
  return /^https:\/\/www\.google\.com\/alerts\/feeds\/[0-9]+\/[0-9]+$/.test(value);
}

export const alertFeedInputSchema = z.object({
  resource_type: z.enum(alertResourceTypes),
  title: z.string().trim().min(1).max(120),
  feed_url: z.string().refine(validateFeedUrl, 'Copy the Google Alerts RSS link, beginning https://www.google.com/alerts/feeds/.'),
  enabled: z.boolean(),
}).strict();
export type AlertFeedInput = z.infer<typeof alertFeedInputSchema>;
export type AlertFeedSource = AlertFeedInput & {
  id: string; owner_id: string; version: number;
  next_check_at?: string | null; last_checked_at?: string | null;
  last_success_at?: string | null; error_code?: string | null;
};
export type AlertService = 'website' | 'application' | 'website_and_application';
export type AlertEntry = {
  title: string; snippet: string; service: AlertService;
  source_url: string; source_platform: string; feed_published_at: string;
  contact_name: string | null; email: string | null;
};
export type AlertErrorCode = 'FEED_INVALID' | 'FEED_UNAVAILABLE' | 'FEED_RATE_LIMIT' | 'FEED_TOO_LARGE' | 'FEED_PARSE' | 'DATABASE_UNAVAILABLE';
export const alertErrorMessages: Record<AlertErrorCode, string> = {
  FEED_INVALID: 'The saved feed link is not a supported Google Alerts RSS feed. Copy the RSS link again.',
  FEED_UNAVAILABLE: 'The feed could not be retrieved. Check the alert still exists; the next scheduled check will retry.',
  FEED_RATE_LIMIT: 'Google temporarily limited feed requests. The next scheduled check will retry.',
  FEED_TOO_LARGE: 'The feed exceeded the safe import size. Narrow the alert query before trying again.',
  FEED_PARSE: 'The response was not a valid Google Alerts Atom feed. Check the RSS link.',
  DATABASE_UNAVAILABLE: 'The app could not confirm that alert results were saved. Check database access and migration 010.',
};
export class AlertImportError extends Error {
  constructor(readonly code: AlertErrorCode) {
    super(alertErrorMessages[code]);
    this.name = 'AlertImportError';
  }
}
