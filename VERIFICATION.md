# Hunter restoration verification

This release restores Hunter company/contact discovery and saved-contact navigation while preserving the upgraded workspace and project-request archive. It uses the Hunter implementation identified at `8bc4dea` and keeps later response-recording, access, and audit protections.

Hunter records are prospects with unconfirmed project requirements. A company match, fit score, source link, or valid email does not establish active website/app demand or permission to send marketing. Contact identity remains visible above the four source/requirement fields. Unknown needs remain unknown.

## Restoration scope

- The scheduled worker routes to Hunter discovery, enrichment, sourced contact search, email verification, scoring, and guarded contact persistence.
- Hunter configuration is accepted in its legacy and modern company-contact forms. Old project-mode snapshots cannot accidentally be executed as Hunter work.
- Additive `009_restore_hunter_discovery.sql` restores the database functions that later project-request migrations replaced or disabled. It supports fresh databases through 005 and databases already upgraded through 008.
- Applying 009 does not delete tables, remove contacts/project requests, reset suppression choices, switch every owner's settings, or start provider work. The public download must match the reviewed SQL exactly.
- The authenticated owner restoration action recovers available earlier Hunter targeting and bounded scan progress, sets the restoration interval to six hours, preserves current daily caps and collection notes, and queues its first run. Configuration version changes cancel incompatible active work for that owner.
- Existing owner/domain/email checks, candidate history, immutable audit deduplication, suppression, pause/version/lease checks, atomic budgets, and audit-based totals remain enforced.
- Paid operations have separate durable request records. Cached responses are reused; unfinished reservations are not automatically repeated. Known recorded provider failures and response-storage acknowledgment failures retain safe specific outcomes without exposing raw errors or credentials.
- The larger historical Tavily checkpoint handling, source trimming, recorded project requests, and newer audit-based finishing logic remain in place. The restored scheduled workflow does not call Tavily.
- Leads again opens saved contacts. Name, email, role, website, source details and honest requirement fields remain accessible. Earlier public requests remain a separate saved archive when installed.
- Optional AI output is a draft for review. Restoration leaves it off; this phase sends no messages and submits no proposals.

## Release checks

Validated in the cloud workspace on **4 November 2026**: `npm test` passed all **29 test files**; `npm run typecheck`, the production build, and all three HTTP smoke checks passed. The restoration HTTP check exercised the authenticated preview, restore, queue and intercepted scheduler dispatch with fixture credentials; no live provider was called.

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
npm run smoke:settings
npm run smoke:prospecting
```

The subsequent Today/Past update passed `npm run typecheck`, `tests/intent-day-window.test.ts`, a fresh production build and the expanded `npm run smoke:prospecting`. That HTTP check exercised both date tabs, their date columns and filtered pagination.

Run TypeScript checks and production builds sequentially because Next.js regenerates files under `.next/types`.

Verified coverage includes:

- Hunter provider normalization, plan/quota/error mapping, public contact provenance, email verification freshness, scoring, owner binding, duplicates, suppression, caps, pauses, and durable retries.
- Real embedded PostgreSQL execution of 001–005 then 009, and 001–008 then 009, with emulated Supabase auth/storage schemas and separate roles.
- Preservation of existing contacts, settings, suppression, project requests, run/request history, and other owners' configurations during installation/restoration.
- Owner-scoped restoration, recovered targeting/progress, six-hour interval, unchanged current budgets, cancellation of incompatible old work, migration rerun safety, and the first Hunter queue/reserve/save path.
- Duplicate/deleted-record protection, source-backed verified contact persistence, tenant isolation, read/write permissions, and unchanged request audit totals.
- Production HTTP routes using localhost fixture sessions: readiness before/after 009, restoration access guards, queued-first-run behavior, company-mode usage/history, saved-contact navigation, settings persistence, and unsigned job rejection.
- Today/Past company-contact tabs use inclusive/exclusive India-day boundaries on original creation dates before pagination. HTTP fixtures cover exact midnight, older records updated today, future-day exclusion, 52-record past pagination, search/country filtering, out-of-range redirects and unchanged dashboard recent records.
- Existing source/date/contact tests for the retained public-request archive and exact downloadable migration copies.

Provider and worker tests inject fixtures. Database tests use PGlite. HTTP smoke checks use temporary local servers and fixture credentials; outbound provider calls are blocked. These checks do not use or verify the owner's live Hunter key, Supabase project, Inngest account, billing, or computer-off scheduling.

## Required live acceptance

The current cloud workspace has no configured live Supabase, Hunter, Vercel or Inngest runtime credentials. GitHub deployment success establishes that code built/deployed, not that a hosted Hunter run or migration succeeded. Live recovery remains unverified until the following steps are observed in the owner's accounts.

1. Deploy the latest code. In the existing Supabase project, run only **009** from `/prospecting/setup` → **Copy Hunter restoration SQL**. Keep already installed 006–008. Do not rerun 005/006 or delete data. A fresh installation completes 001–005 first.
2. Refresh Lead discovery while signed in as the configured owner. Confirm Hunter database, server database access, worker account, Hunter key, scheduler and collection-basis checks are ready. Reuse existing values; never paste keys into chat.
3. Review the preview's earlier Hunter targeting and current daily limits. Click **Restore Hunter discovery**. Verify this switches only that owner's settings, enables the six-hour schedule, and queues one first run.
4. Inspect the Inngest execution and app Run history until the run completes or reports a specific safe error. A queued row or a configured-key check is not evidence that the provider work happened.
5. Review any new saved contact in Leads. Confirm company/country, actual business contact, source links, verification status/date, fit assessment, and original creation date. The popup must not invent a required service, private search history, buyer budget or consent.
6. Re-run or wait for the next due run. Already saved companies/emails must not be reintroduced as fresh prospects or inflate the saved count. Suppress a test address and confirm it cannot be saved by discovery.
7. Pause discovery and confirm the worker stops before another request/save. An already-started provider request may complete. Review real provider usage alongside the app's reserved-attempt counter.
8. Resync the hosted `/api/inngest` endpoint in Inngest Production. Confirm both functions and the hourly schedule appear with the matching Event/Signing environment. Close local services and verify a hosted due run; local tests do not establish unattended execution.
9. Sign in as a separate temporary account in an incognito window. It must not read another owner's contacts, settings, archive, suppression or runs, and cannot spend the configured owner's provider credits.

## Operational limits

- Restoration returns the company/contact workflow, not confirmed buyer inquiries. Public business data, email verification and optional AI summaries do not establish project intent.
- Hunter account permissions, credits and pagination eligibility are external facts verified by a live run. Some endpoints/features may be unavailable under the current plan.
- Basic first-page discovery can become exhausted after those companies have been processed. Eligible pagination or revised targeting can extend coverage. No minimum daily contact count, buyer reply, signed contract, or repeated batch of 14 is promised.
- Daily caps count reserved API attempts and immutable saved-lead audits. They are not a currency or provider-credit estimate. Budget resets occur at 00:00 UTC (05:30 India time).
- A six-hour schedule is checked by an hourly hosted tick. Service outages, deployment protection and provider limits can delay it.
- Existing historical failures remain in the audit; they are not rewritten as successful runs. Evaluate a new post-restoration execution.
- The earlier supplied ledger showed reserved attempts with no response/error, and some prior successful operations in the same run. It narrowed the failure window but did not establish the original interruption. Do not attribute those old failures to a specific live provider/database cause without the corresponding error.
- Email outreach, replies, proposals, payments and delivery remain later phases. Records and archives are retained; no automatic cleanup is performed.

## Free alerts integration — November 2026

Migration 010 adds independent owner-scoped feed settings, leased import runs, immutable URL save audits and a security-invoker combined Leads view. Existing Hunter tables, contact constraints, settings and provider functions are preserved. The Leads page falls back to its contact table before 010 is installed.

Google Alerts supplies both the general web feed and the LinkedIn public-post feed. Only exact Google feed URLs are fetched; redirects, arbitrary hosts, DTD/entities, oversized documents and unsafe original URLs are rejected. The importer never fetches a LinkedIn/source page or calls Hunter, Tavily or AI. Source snippets remain plain text and publication dates/contact identity are not invented. Two feeds share canonical-URL duplicate protection; first discovery timestamps never refresh on duplicates.

Validation on 7 November 2026: all **32 test files** passed, including real PostgreSQL migration/lease/tenant/duplicate checks; TypeScript, the production build, all three existing HTTP smoke checks and `ALERTS_BROWSER=1 npm run smoke:alerts` passed. Final SQL skip-diagnostic changes passed the focused database suite and exact-copy checks. Chromium checked desktop/mobile layouts, source review, tabs, filters, navigation and RSS setup fields. The alert smoke uses localhost Supabase fixtures and an intercepted Inngest dispatch, with all real provider requests blocked. It checks auth/origin guards, no-Hunter readiness, API field projection, setup/migration/PDF downloads, combined Today/Past records, resource titles, contact-table fallback, read-only alert details and browser navigation. The PDF is a validated four-page document with clickable source links.

Live activation still needs the owner to apply 010, create their own two RSS feeds, save/enable the feeds privately in the app and resync the hosted Inngest endpoint. Fixture validation does not prove the owner's feeds have results or that a live unattended import occurred.

### Empty-feed investigation

The owner reported completed Google and LinkedIn checks with zero entries, saved and skipped, then confirmed both original RSS sources contained no `<entry>` elements. The code counts direct Atom entries before filtering; normal Atom namespace fixtures and the database count path were checked. This supports an empty upstream feed for those checks, not rejection by lead filters. A separate wording gap for web designer(s)/web designing agency was fixed with positive and marketing/job-negative regressions. The connection UI now distinguishes empty checks and links to query/delivery guidance. No schema or credential change is required for this update.
