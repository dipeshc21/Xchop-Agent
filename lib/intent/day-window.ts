export type InquiryPeriod = 'today' | 'saved';

export function inquiryPeriod(value: string | null | undefined): InquiryPeriod | null {
  if (!value || value === 'today') return 'today';
  return value === 'saved' ? 'saved' : null;
}

/** India has a fixed UTC offset. Calendar boundaries are independent of the
 * execution host/browser timezone and of the provider's UTC budget reset. */
export function indiaDayWindow(now = new Date()) {
  const instant = now.getTime();
  if (!Number.isFinite(instant)) throw new Error('A valid discovery date is required.');
  const offset = 330 * 60_000;
  const local = new Date(instant + offset);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset;
  return { start: new Date(start).toISOString(), end: new Date(start + 86_400_000).toISOString(),
    date: local.toISOString().slice(0, 10), timeZone: 'Asia/Kolkata' as const };
}
