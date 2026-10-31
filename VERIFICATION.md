# Project-request discovery verification

The app now qualifies published buyer requests for website/application work. It does not qualify a company solely because its profile matches an agency segment or its email verifies successfully. Existing contacts are retained separately as unconfirmed contacts.

## Scope

- Tavily searches public pages using a private server key; provider results are treated as untrusted source data.
- Qualification requires a literal external-development request, an explicitly stated publication date, supported service, and selected-country evidence in the source text. Search-engine estimated dates and country boosts do not establish those facts.
- Public request text, required service, source platform, original URL, source dates, and the app's own separate discovery query are stored with the request.
- The popup does not claim access to private search history or browsing activity. Existing company contacts show unknown/unrecorded project requirements.
- Requests can be saved without email addresses; none are invented. Review the source platform's posting before responding.
- The durable worker uses owner binding, pause/version/lease checks, database-backed request reservations, daily limits, and duplicate source checks. It does not send messages or submit proposals.
- Migration 006 preserves earlier contacts, pauses old company-discovery configuration, and adds separate owner-scoped project-request records. The downloadable SQL must match its reviewed migration exactly.

## Test evidence

The complete project-request release passed these checks in the cloud workspace:

- `npm test` — all 21 test files, including real embedded PostgreSQL execution through migration 006, request/source binding, tenant isolation, caps, pause/retry handling, source qualification, popup evidence, and byte-for-byte SQL downloads.
- `npm run typecheck` and `npm run build` — TypeScript and the Next.js production build.
- `npm run smoke` and `npm run smoke:settings` — setup/authentication boundaries and authenticated settings access/save/reload even when dashboard setup is incomplete.
- `npm run smoke:prospecting` — actual production HTTP routes with localhost fixtures: recent/unexpired owner requests, old lead links opening the new request list, request-only counters, exact migration 006 download, missing-schema handling, keyless pause, guarded enabling/queueing, safe research projection, suppression, and unsigned-job rejection. External provider requests are blocked and asserted absent.

Run release checks after changes:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
npm run smoke:settings
npm run smoke:prospecting
```

Provider/worker tests inject fixtures. Database tests execute embedded PostgreSQL (PGlite) with emulated Supabase auth/storage schemas and separate roles. HTTP smoke checks use temporary localhost servers and fixture sessions. These checks do not validate the owner's live Tavily account, hosted Supabase project, billing, or computer-off scheduling.

## Owner's live acceptance check

1. Update the code, run only missing migrations in order through 006, and add the actual `TAVILY_API_KEY` to the server. Keep the existing Supabase owner/admin and Inngest settings. Follow [README.md](README.md) or `/prospecting/setup`.
2. Confirm old contacts remain unconfirmed and the new project-request list does not invent requirements for them. Review the new targeting and conservative limits, save, and enable discovery.
3. Queue one run. Inspect the Inngest execution and app run history until it finishes. A queued row alone is not proof that provider work happened. The search can consume credits even if zero pages qualify.
4. For any saved result, open the original URL and verify the literal request, matching service, publication evidence, selected country, and deadline. Verify that the popup does not confuse the app's search query with the buyer's private search history.
5. Check that a supplier page, job advertisement, undated request, closed/expired project, and missing-country result do not appear as qualified requests. A run saving zero requests can be correct.
6. Refresh to confirm persistence. Pause discovery and confirm future requests and saves stop; an already-started provider request can complete.
7. Sign in as a separate test account in an incognito window. It must not read another owner's requests, contacts, settings, or run history, and cannot spend the configured owner's provider credits.
8. Close local services and confirm the hosted hourly Inngest tick queues the next due run. Local testing is not proof of unattended hosting.

## Limits

- No live provider credentials are included in the repository or used by fixture tests. Actual account access, charges, migrations, and scheduling need the owner's live acceptance check.
- Search coverage is bounded. Missing raw page text, explicit publication evidence, or country evidence can cause legitimate-looking pages to be rejected. No minimum result count, buyer response, or contract is promised.
- A public posting can become filled or withdrawn after publication. A stored request is evidence of a published request, not a guarantee of its present availability or permission for unrelated marketing.
- Configuration checks validate presence/format, not actual remote permissions, account credits, project matching, or deployment connectivity.
- Request caps count API calls rather than money. Check the provider's account usage and current credit rules.
- Hunter contact verification and AI summaries do not establish buyer intent and are not required by the new worker.
- Email outreach, replies, payments, and delivery remain later phases. Existing records are preserved; this update does not delete them automatically.
