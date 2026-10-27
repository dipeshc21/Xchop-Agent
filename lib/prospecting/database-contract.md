# Automatic prospecting database contract

Apply `005_automatic_prospecting.sql` once after migrations 001–004. It adds tables, indexes, functions and lead metadata; it does not seed leads or replace existing records. Browser writes to the suppression table become RPC-only so suppression changes are audited.

All four prospecting tables have owner-scoped read policies. Authenticated users cannot mutate those tables or read a worker claim token. The service role alone can call worker functions. Server code additionally binds service credentials to `AUTOMATION_OWNER_ID` before every repository operation.

## Authenticated functions

| Function | Result |
| --- | --- |
| `save_prospecting_settings(payload)` | `{data, version, next_run_at}`. Validates the full config; changed settings increment the version and cancel active work. A paused config sets the next run to null. |
| `queue_prospecting_run()` | A UUID; reuses the account's active run. Requires saved enabled config. |
| `prospecting_usage()` | `{day_start, requests, leads_saved}`. Budgets reset at UTC midnight regardless of the database session timezone. |
| `suppress_workspace_email({email,reason})` | Suppression UUID; normalizes the email and upserts a supported reason with an immutable audit record. |

Config saves are limited to 20/minute, manual queues to 5/minute and suppression changes to 30/minute per owner. These share a transaction advisory lock with worker mutations.

## Service functions

Every function takes `p_owner`; run-specific functions also take `p_run`. Worker mutations require `p_claim_token` except for due-run queueing. The token must be the current live claim on the owner's enabled run and match its config version. A claim has a 15-minute lease refreshed by checks and reservations. A different worker can reclaim an expired lease; stale workers cannot reserve, save or finish the replacement's work.

| Function | Result |
| --- | --- |
| `queue_due_prospecting_run(p_owner)` | Active or newly due UUID, otherwise null. Returns active queued work so dispatch can recover. |
| `claim_prospecting_run(p_owner,p_run,p_claim_token)` | `{run,config,config_version,search_index,cursors,claim_token}` or null. |
| `check_prospecting_run(p_owner,p_run,p_claim_token)` | `{allowed,reason}`. |
| `reserve_prospecting_request(...,p_operation,p_provider,p_claim_token)` | `{state,status,result?,reason?}`. `status` is `reserved`, `cached`, `uncertain`, `budget_exhausted` or `paused`. Provider is `hunter` or `anthropic`. |
| `complete_prospecting_request(...,p_operation,p_claim_token,p_result,p_error_code)` | `{status}`. Stores normalized results only; duplicate completion cannot replace an earlier result. |
| `record_prospecting_candidate(...,p_claim_token,p_domain,p_status,p_reason)` | `{status,candidate_status?,run_id?}`. Status can be `created`, `existing`, `reclaimed` or `paused`. Decided domains are remembered across runs; unfinished processing candidates can be reclaimed only from a terminal prior run. |
| `persist_discovered_lead(...,p_payload,p_claim_token)` | `{status,lead_id?}`. Possible statuses: `saved`, `duplicate`, `suppressed`, `country_excluded`, `low_score`, `daily_limit`, `paused`, `verification_required`, `provenance_required`. |
| `finish_prospecting_run(...,p_claim_token,p_status,p_counts,p_message,p_error_code,p_next_search_index,p_cursors)` | Boolean. Status is `completed`, `failed` or `cancelled`; next index/cursors are non-null. |

The request ledger reserves the UTC daily request budget before a paid call. Each `(owner,run,operation)` is unique. Completed results are replayable; failed or uncertain requests are not repeated automatically. An already-paid response may be recorded after pause, but a subsequent request or lead save remains blocked. An API request count is not a provider billing-credit total.

An interrupted company remains `processing` until a decision is saved. A later active run may atomically transfer that candidate only when its previous run is completed, failed or cancelled and all of that run's paid requests have a recorded outcome. A prior run marked `REQUEST_UNCERTAIN`, or with any request still reserved, requires manual investigation and cannot be reclaimed automatically. A provider may have received such a request even when the app could not store its response; the app does not promise exactly-once provider execution. Saved, skipped and review-needed candidates remain excluded, and replaying a processing step cannot undo their decisions. Reclaiming an unfinished candidate does not change the prior run's stored historical totals. Each new run has its own request budget and ledger.

## Save payload and safeguards

`p_payload` is `{company,contact,verification,score,lawfulBasis,aiDraft}` as defined in `types.ts` / `repository.ts`. The saved lawful basis always comes from the current run configuration, rather than the payload.

A save requires an actual supported selected company country, found contact provenance, at least one published HTTP(S) source, an email on the company domain or its subdomain, a `valid` non-webmail/non-disposable/non-catch-all verification dated within the last 31 days (at most five minutes ahead), and the configured fit score. It checks suppression, email duplicates, the daily lead cap and an immutable audit of already discovered company domains inside the same owner lock. Existing manual contacts at a company do not block a different discovered email. Deleting a CRM row cannot reset a daily cap or allow a second automatic contact for the same company.

Saved leads start at `New`, value zero, and `contact_review_status='needs_review'`. Verification does not infer consent. Optional AI notes remain `pending_approval`; the model cannot set the deterministic score or send a message. Run totals and daily save limits use immutable audit rows so later CRM deletion does not change historical counts.

Database tests execute migrations 001–005 in PGlite's PostgreSQL engine with separate authenticated, anonymous and service roles. They cover role grants/RLS, atomic reservation replay and budgets, claims/replacement, pause/config races, suppressed/guessed/unrelated/unverified contacts, duplicate company controls, cached verification dates, UTC reset boundaries and immutable historical limits. No live Supabase project or paid provider is contacted by those tests.
