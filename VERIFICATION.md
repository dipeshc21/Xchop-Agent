# Project-request discovery verification

The app now qualifies published buyer requests for website/application work. It does not qualify a company solely because its profile matches an agency segment or its email verifies successfully. Existing contacts are retained separately as unconfirmed contacts.

## Scope

- Tavily searches public pages using a private server key; provider results are treated as untrusted source data.
- Qualification requires a literal external-development request, an explicitly stated publication date, supported service, and selected-country evidence in the source text. Search-engine estimated dates and country boosts do not establish those facts.
- Public request text, required service, source platform, original URL, source dates, and the app's own separate discovery query are stored with the request.
- The popup does not claim access to private search history or browsing activity. Existing company contacts show unknown/unrecorded project requirements.
- Requests can be saved without email addresses; none are invented. Review the source platform's posting before responding.
- Saved contact names and email addresses stay visible above the four inquiry fields. New project contacts are extracted only from explicit project-contact or submission instructions, with the original source recorded; a published address is not represented as delivery-verified.
- The durable worker uses owner binding, pause/version/lease checks, database-backed request reservations, daily limits, and duplicate source checks. It does not send messages or submit proposals.
- Migration 006 preserves earlier contacts, pauses old company-discovery configuration, and adds separate owner-scoped project-request records. The downloadable SQL must match its reviewed migration exactly.
- Optional additive migration 007 stores published project contacts and can fill missing contact fields on a same-source request without counting another lead. The existing list and worker continue to work before 007 is installed; it is not necessary to restore earlier contacts in the popup.
- Additive migration 008 repairs source-format checks in both JavaScript and PostgreSQL: adjacent-line fields, Markdown tables, no-colon posting labels, ordinals, and explicitly zoned deadlines. Exact source evidence is retained. Unknown clocks/countries/dates remain unqualified. It preserves discovery's enabled/paused state and makes only transient `UNAVAILABLE`/`RATE_LIMIT` failures due again after one hour.
- A run now covers up to four country/keyword partitions, sharing its configured total-results budget and existing daily API caps. Each query has an independent exact-query paid-request checkpoint. Query wording rotates between procurement and direct buyer requests. Provider-side engine-date filtering and forced live-page cache refresh no longer discard pages before source validation.
- Owner-scoped execution health distinguishes paused/configuration/never-run/queued/stalled/overdue/failed/zero-new-results states from verified execution. Optional repair readiness cannot block existing migration-006 reads.
- A missing/short search source can be retrieved in one separately reserved Tavily Extract batch per query, within the existing daily attempt and per-run result caps. Only the same canonical source URL's complete text can replace missing text; original titles and source dates are not invented. Partial provider failures, unsafe text, unrelated responses, and source-size bounds remain enforced. Cached search/extract responses are independently reused on recovery.
- A recorded failed request retains its whitelisted provider error instead of becoming a generic uncertain-request warning. Real database completion receipts are checked; content rejection or unconfirmed storage returns a safe terminal step outcome rather than retrying the already-paid callback. Unfinished reservations remain unrepeated. The UI calls reservation counts API attempts.
- The request list defaults to New today, using inclusive/exclusive first-discovery bounds at India midnight, with a separate complete saved history (including passed deadlines). It refreshes across midnight/return from a hidden tab. Existing discovery dates are immutable. Successful canonical sources are checked against both owner records and the immutable save audit before qualification or paid text retrieval, so previously saved/deleted requests do not return as new.

## Test evidence

The complete project-request release passed these checks in the cloud workspace:

- `npm test` — all 28 test files, including real embedded PostgreSQL execution through migration 008, cross-day duplicate prevention without discovery-date or daily-count refresh, deleted-record audit protection, India midnight/month/year/leap boundaries, owner-scoped known-source projections, JS/SQL date-layout parity, transient retry timing, unchanged targeting/pause state, request/source/contact binding, tenant isolation, multi-query and extraction caps/checkpoints/recovery, response-storage acknowledgments, safe recorded-failure propagation, frozen-time execution health, source qualification, visible contact identity above popup evidence, and byte-for-byte SQL downloads.
- `npm run typecheck` and `npm run build` — TypeScript and the Next.js production build.
- `npm run smoke` and `npm run smoke:settings` — setup/authentication boundaries and authenticated settings access/save/reload even when dashboard setup is incomplete.
- `npm run smoke:prospecting` — actual production HTTP routes with localhost fixtures: today-only versus saved history with India boundaries, unchanged owner isolation, and freshness/deadline checks on the daily view, published contact reads and compatibility before migration 007, optional repair readiness and execution health, old lead links opening the new request list, request-only counters, exact migration 006/008 downloads, missing-schema handling, keyless pause, guarded enabling/queueing, safe research projection, suppression, and unsigned-job rejection. External provider requests are blocked and asserted absent.

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
   Contact names and email addresses should be immediately visible above the inquiry evidence. To collect future published project contacts, run migration 007 once after 006; do not rerun 006 as part of that update. The optional SQL is available on `/prospecting/setup`.
   For discovery reliability, run additive migration 008 after 006 and optional 007. It is safe to repeat and never switches discovery on or off. If 007 is added later, rerun 008. Refresh and check the repair notice, connection checks, and execution-health message before queuing a run.
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

## Investigation of the reported two-day discovery gap

The code reproduction identified three release-induced ways to get no new requests: migration 006 paused existing company discovery and introduced a different server provider key; one default daily query spread four country/service combinations over four days; and both source validators rejected valid next-line/table dates and explicitly timed deadlines. Tavily's early date filter and forced cache freshness further reduced coverage. Regression tests now exercise those failures rather than only perfectly formatted source fixtures.

The cloud workspace has no hosted Supabase, Tavily, or Inngest runtime credentials. GitHub reported the previous Vercel deployment successful; that is not proof that a worker ran. The hosted public endpoint could not be inspected from this environment. The owner's last-two-day run history, provider credits, actual server configuration, migration application, and first new production execution still need the live acceptance check. The repair must not be described as a verified hosted recovery until that execution is observed.

The owner's subsequent screenshot confirms prior executions completed but saved zero requests, mostly because retrieved links lacked source text. It also shows newer `REQUEST_UNCERTAIN` failures. This proves execution occurred for those rows and supersedes a paused-schedule explanation for them. A local PostgreSQL reproduction confirms that SQL's uncertain state covers both unfinished reservations and recorded failed operations; the earlier runner ignored the latter's stored error reason. The screenshot does not identify which underlying provider/database/interruption caused each historical failure. That still requires its ledger status/error or Inngest step error; no hosted cause is claimed from the generic warning alone.

The supplied ledger narrows these specific historical attempts to `reserved`, null error and no response; in two runs the first two operations completed before the third remained unfinished. This is not an ordinary recorded provider rejection. A real PostgreSQL reproduction shows SQL content-check rejection can create that same shape, but it does not prove the historic cause. The latest shown attempt (3 November 16:17 India time) predates commit 470f180 (16:38 India time), which filters credential-shaped source content and checks response-storage acknowledgments. A fresh execution after deployment is still required to establish live recovery.

Duplicate protection is per owner/canonical source URL and is not universal semantic matching across reposted projects on different platforms. Different genuine projects from the same buyer remain allowed. New today filters first-save timestamps and does not claim a result was published that same day or guarantee a minimum daily lead count.
