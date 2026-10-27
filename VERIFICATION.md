# Live workspace and discovery verification

The app uses the owner's Supabase project and official provider APIs. Missing configuration opens setup instructions. The production app has no sample-lead fallback, test provider mode, or invented contact addresses.

## Implemented scope

- Supabase password sign-in, owner-scoped leads, business settings, guarded stage/value changes, dashboard aggregation, and actual-record JSON export.
- Hunter-based company discovery, independent country enrichment, published business-contact search, email verification, deterministic fit scoring, and saved prospects marked for contact review.
- Persistent run history and request reservations, owner binding, configurable targeting, request/lead limits, pause controls, suppression, and Inngest scheduling.
- Optional CSV import for existing contacts, with file validation before saving and row-specific results; imported contacts are not automatically verified.
- Optional Anthropic research summaries stored as drafts. A separate explicit model setting is required; AI cannot approve contact or send messages.
- Public numbered discovery setup instructions, private server configuration examples, hosted Vercel/Inngest instructions, and a Copy SQL action with a plain-file/manual-copy fallback.

## Verification evidence

The following checks passed in the cloud workspace during this release:

- `npm test` — all 16 test files, including embedded PostgreSQL migrations 001–005, tenant isolation, role grants, request/lead limits, pause/version guards, suppression, provider response validation, scoring, CSV import, and SQL-copy equality.
- `npm run typecheck` and `npm run build` — TypeScript and the Next.js production build.
- `npm run smoke` — unconfigured setup, stylesheet, sign-in boundary, and guarded saves.
- `npm run smoke:settings` — authenticated Settings access/save/reload while the dashboard function is unavailable, with a local test-only Supabase substitute.
- `npm run smoke:prospecting` — actual production HTTP routes for owner-scoped status/usage, public setup and exact SQL copy, missing migration, pause without provider keys, blocked enabling/queueing, suppression, research projection, and unsigned background-handler rejection. External provider fetches are blocked and asserted absent.

Provider/runner tests inject documented response fixtures. Database tests execute embedded PostgreSQL (PGlite) with emulated Supabase auth/storage schemas and distinct roles. HTTP smoke checks use temporary localhost servers and fixture sessions. These checks do not validate the owner's hosted accounts, provider entitlement, or scheduled execution and do not make paid provider requests.

Run release checks from the project folder after changes:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
npm run smoke:settings
npm run smoke:prospecting
```

Smoke commands require an isolated production build made without configured Supabase values. For a configured owner installation, use the real-account acceptance steps below instead.

## Owner's live acceptance check

1. Apply the missing database migrations in order, configure the actual owner and server credentials, and sync the hosted app endpoint in Inngest. Follow [README.md](README.md), section 6, or open `/prospecting/setup`.
2. Sign in as the configured owner, save targeting and conservative limits, start discovery, and queue one run. This uses real provider credits.
3. Inspect the Inngest function execution and the app's Run history. Confirm a run progresses from queued to a finished status. A queued run alone does not prove that a worker ran.
4. Inspect any saved lead's company country, published source, actual email-verification date, fit reason, and contact-review status. A run can correctly save zero leads when no result qualifies.
5. Refresh the app to confirm persistence. Test Pause discovery and check that future work stops before its next request or save. A request already in flight can finish.
6. Check isolation using a second Supabase user in a private browser window. It must not read the owner's leads, settings, or run history and cannot operate the configured paid worker.
7. Leave the local app closed and confirm the hosted Inngest hourly tick dispatches the next due run. Local development servers do not prove computer-off scheduling.

## Limits

- No owner Supabase, Hunter, Inngest, Vercel, or Anthropic credentials are included in source. Hosted sign-in, migrations, provider access, charges, and unattended execution require the owner's real-account checks above. A passing fixture-based test is not a live provider verification.
- A syntactically configured key does not prove account access, endpoint entitlement, available credits, or correct project matching. Readiness labels describe configuration; actual failures appear in run history.
- Hunter can return cached verification dates. The app records the actual returned date and accepts eligible valid results no older than 31 days. Verification does not establish consent or guarantee delivery.
- API-request limits count requests, not Hunter billing credits. Basic Discover search has bounded coverage; Premium pagination requires suitable account access. No minimum number of leads is promised.
- Email sending, reply handling, payments, and project delivery remain later phases. Discovery never starts email follow-ups automatically.
- Existing database records are preserved. Review and remove any old fictional seed records explicitly; this update does not delete them.
