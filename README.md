# Setup for Non-Coders

**XHTMLChop Growth Agent — Hunter company/contact discovery**

Automatic discovery uses Hunter to find companies, enrich their business details, find published work contacts, verify eligible email addresses, and save matching prospects. Existing contacts, business settings, suppression choices, and run history remain in your Supabase project.

A saved contact is a prospect. Company fit and a verified email do not establish an active website/app project or permission to send marketing. Contact names, emails, roles, and websites stay visible above the four source/requirement fields. Unknown requirements stay unknown. This phase does not send messages, submit proposals, or process payments.

## Connect free Google Alerts and LinkedIn public-post alerts

Open **Free alert sources** from Leads or visit `/alerts`. This importer uses owner-created Google Alerts RSS feeds and your existing hosted scheduler. It makes no Hunter, Tavily or AI calls. LinkedIn results are public posts indexed by Google; this is not a direct LinkedIn login/API connection and coverage can be delayed or incomplete.

1. Open `/alerts/setup` and click **Copy free-alert setup SQL**. In your existing Supabase project, choose **SQL Editor → New query**, paste the complete **010_free_alert_sources.sql**, and click **Run**. Keep your earlier migrations and saved records. Do not rerun the foundation or Hunter restoration for this update.
2. Sign in at [Google Alerts](https://www.google.com/alerts). Create a buyer-request alert, for example `"looking for a web development agency" OR "website redesign RFP" OR "mobile app development RFP"`. Under **Show options → Deliver to**, select **RSS feed**, then create the alert. Copy the RSS icon's link. If RSS is unavailable, use **As-it-happens** and disable digest delivery settings.
3. Create a second alert for public LinkedIn posts, for example `site:linkedin.com/posts "looking for" ("web developer" OR "development agency" OR "app developer")`. Select RSS delivery and copy this second feed link.
4. On `/alerts`, paste the first link into **Google Alerts** and the second into **LinkedIn public posts**. Give each its Resource title, enable the source, and click **Save source**. Feed URLs are private settings; no Google or LinkedIn password is required. The app accepts only Google Alerts feed links.
5. Keep your existing Supabase, server database key, `AUTOMATION_OWNER_ID`, and Inngest keys. No new paid provider account or API key is needed. In Inngest Production, resync `https://xchop-agent.vercel.app/api/inngest` and confirm **Free alerts · hourly feed checks** and **Free alerts · Google and LinkedIn public requests** appear alongside the two Hunter functions. Use your own host if different.
6. Choose **Check feeds now**. Review import history for actual entries reviewed, saved and skipped. Scheduled checks run when due on an hourly tick; manual checks less than two minutes apart are skipped. Hunter controls are independent: pause Hunter discovery if its credits are exhausted.
7. Open **Leads → Today**. The combined list retains existing contacts and adds review-required alerts, with **Resource title**, original source link and discovery date. Earlier discoveries remain in **Past**. Cross-feed/cross-day duplicate URLs do not become fresh leads again.

If Feed check history shows **Entries 0, Saved 0, Skipped 0**, the check received an empty Google feed. Open the RSS link privately, view its source and search for `<entry`. If it has no entries, the app has nothing to review; changing Inngest keys does not populate the feed. Edit the Google Alert with a shorter buyer phrase such as `"need a website" OR "looking for a web designer"`, choose **All results** and RSS delivery, and review the region/source settings. Google preview results are not a complete RSS backlog. See `/alerts/setup#empty-feeds` for the troubleshooting steps.

The importer saves only snippets suggesting a website/app buyer request. It skips obvious job advertisements, seller promotions, unrelated pages, unsupported URLs and old alert timestamps. Open the original page to confirm the full requirement, availability and how to reply. Contact details are included only when explicitly published in the snippet; missing names/emails stay unknown. Alert-feed dates describe indexing/alert time, not necessarily the original post's publication date. Alerts use a read-only review popup, while existing contact editing remains available. The dashboard's contact totals remain CRM-contact totals.

Download the four-page [free lead-generation resource guide](public/resources/free-lead-generation-resources.pdf), or use `/resources/free-lead-generation-resources.pdf` on your deployed app. The PDF includes all twelve researched resources, free-access limits and search examples. An editable source is in `docs/free-lead-generation-resources.md`.

## Restore your existing installation

Use this path when you already have a working Supabase sign-in and saved records.

1. Wait for the latest GitHub version to deploy in Vercel. For a local copy, stop the app with **Ctrl+C**, then run `git pull origin main` and `npm ci` in the project folder. Keep your private `.env.local` file.
2. Open **Lead discovery → Setup guide**, or `/prospecting/setup`. Click **Copy Hunter restoration SQL**. In **Supabase → your existing project → SQL Editor → New query**, paste the entire SQL and click **Run**. This installs **`009_restore_hunter_discovery.sql`**.
3. Refresh **Lead discovery** and complete any pending connection checks. Reuse your existing `HUNTER_API_KEY`, Supabase connection, server database key, owner UUID, and Inngest keys. If an environment value must change, save it in **Vercel Production** and redeploy.
4. Review the proposed Hunter targeting and daily limits, then click **Restore Hunter discovery**. This switches only your signed-in workspace to Hunter and queues its first run. Inspect **Run history**, then open **Leads** to review any saved contacts.
5. In **Inngest Production**, resync `https://xchop-agent.vercel.app/api/inngest` after deployment. Confirm the discovery worker and hourly schedule are present in the environment matching your Event and Signing keys.

**For this restoration, run only migration 009. Do not rerun 005 or 006, drop tables, or create a replacement Supabase project.** Keep already installed project-request migrations 006–008 and their records. Migration 009 is additive and safe to repeat; installing it alone does not switch every owner's settings or start provider work.

The authenticated restore action recovers the latest available completed Hunter targeting and bounded scan progress. It preserves current daily budgets and the collection note, proposes a **6-hour** interval, and leaves optional AI off. Existing email/domain duplicate checks, candidate history, deleted-record audit protection, and suppression choices remain authoritative. Review the restored targets before later edits; saving changed targeting can restart its scan while existing duplicate protection remains in place.

The reference Hunter implementation in Git is `8bc4dea` (27 October 2026). The 2 November revision already used the later Tavily project-request flow. Migration 009 adapts the Hunter flow to databases that have received those later updates while retaining the newer response-recording and access protections.

## New installation: database and owner account

Skip this section if your existing workspace already signs in and has migrations 001–005.

1. Create a project in [Supabase Dashboard](https://supabase.com/dashboard). Save its database password privately and wait for provisioning to finish.
2. Open **SQL Editor → New query**. Run each complete file below, in order, using a fresh query for each:

   | File | Purpose |
   | --- | --- |
   | `001_foundation.sql` | Workspace tables, owner access rules, and private file bucket |
   | `002_live_workspace.sql` | Guarded contact creation and updates |
   | `003_dashboard_summary.sql` | Dashboard totals |
   | `004_restore_workspace_access.sql` | Explicit API grants and schema-cache refresh |
   | `005_automatic_prospecting.sql` | Durable runs, request budgets, and suppression foundation |
   | `009_restore_hunter_discovery.sql` | Restored Hunter operations and owner-scoped activation |

3. The in-app setup guide provides **Copy Hunter restoration SQL** for 009 and a link to the 005 prerequisite. Migrations 006–008 belong to the earlier public-request feature; they are not prerequisites for a fresh Hunter installation.
4. In **Authentication → Sign In / Providers → Email**, enable email/password sign-in. Turn **Allow new users to sign up** off if this is your private owner workspace.
5. In **Authentication → Users → Add user → Create new user**, create your owner account and use the confirmed-email/auto-confirm option.
6. In **Authentication → URL Configuration**, allow `http://localhost:3000` and `http://localhost:3000/auth/callback` for local testing. Add your hosted origin and its `/auth/callback` URL when hosting.

Run the foundation only once in a new project. For an existing project, run only missing prerequisites and the new restoration migration. A `relation already exists` error is not an instruction to delete that table. Stop and inspect the named file instead. Terminal commands such as `Get-Content` and `npm ci` belong in PowerShell, not in Supabase SQL Editor.

Each sign-in account has its own records. Only the configured automatic-discovery owner can use the unattended provider worker.

## Get or update the files on Windows

1. In VS Code, open your existing `Xchop-Agent` folder containing `package.json` and the Git checkout.
2. Stop running app/job terminals with **Ctrl+C**, then run:

   ```powershell
   git pull origin main
   npm ci
   ```

3. Keep your private `.env.local` when updating. Never replace it with blank example values.
4. A GitHub ZIP does not contain Git history. If your folder came from a ZIP and `git pull` says it is not a repository, use a proper clone in a new folder or download the latest ZIP from [your repository](https://github.com/dipeshc21/Xchop-Agent). Preserve the existing private configuration separately.
5. If Windows reports `EPERM` replacing a file in `node_modules`, stop the app and job terminals first. If the lock persists, restart Windows and run `npm ci` before starting the app again. Keep your working Node.js/NVM installation.

Hosted Vercel users do not need to edit application code locally for the restoration.

## Connect Supabase and Hunter privately

1. In Supabase, click **Connect → application/framework → Next.js** and copy the **Project URL** and browser-safe **publishable key**. The **API Keys** screen lists keys separately; it does not contain the Project URL. A legacy anon key can be used instead of the publishable key.
2. Create `.env.local` only if it does not already exist:

   ```powershell
   if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
   ```

3. Add your real values privately:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY
   HUNTER_API_KEY=your-private-hunter-key
   SUPABASE_SERVICE_ROLE_KEY=your-private-supabase-server-key
   AUTOMATION_OWNER_ID=your-own-supabase-sign-in-user-uuid
   APP_URL=http://localhost:3000
   ```

4. Reuse the Hunter key used for your earlier discovery. If you need a new account, [create one](https://hunter.io/users/sign_up), confirm it, and privately copy a key from the [API keys page](https://hunter.io/api-keys).
5. Check your Hunter plan and credits for **Discover, Company Enrichment, Domain Search, and Email Verifier** in the [official API documentation](https://hunter.io/api-documentation). An actual run checks account access. Presence checks alone do not establish permissions or remaining credits.
6. For `SUPABASE_SERVICE_ROLE_KEY`, use a server secret key or legacy `service_role` key from **Supabase → Settings → API Keys**, belonging to the same project as your public URL. Never give this variable a `NEXT_PUBLIC_` prefix.
7. For `AUTOMATION_OWNER_ID`, copy the **User UID** from **Supabase → Authentication → Users → your app sign-in account**. This is a user UUID, not the Supabase project reference.
8. Keep `APP_URL` set to the origin you actually use. Restart locally or redeploy Vercel after changing environment values. Changes to `NEXT_PUBLIC_` values require a new production build.

Keep keys out of chat, screenshots, browser client code, and GitHub. `.env.local` is ignored by Git. The optional Tavily connection can remain in your server settings; the restored Hunter worker does not require it. Existing [public project requests](https://xchop-agent.vercel.app/inquiries?period=saved) remain an archive if your project already installed that feature.

You can check the public Supabase configuration format without printing its key:

```powershell
npm run setup:check
```

This command does not verify live login, database migrations, Hunter access, or Inngest execution.

## Start locally

Run `npm run dev` and open **http://localhost:3000**. Use the terminal's printed port if 3000 is occupied. Sign in as the owner. Open `/settings`, save your real business details, and refresh to confirm persistence.

Local discovery needs two running services. Add `INNGEST_DEV=1` to `.env.local` for local use only, with `APP_URL=http://localhost:3000`, and run these in separate terminals:

```powershell
# Terminal 1
npm run dev

# Terminal 2
npm run dev:jobs
```

Open the Inngest local address printed by the second command and confirm the app functions are registered. The job script targets port 3000. If Next.js uses another port, update `APP_URL` and run `npx inngest-cli@latest dev -u http://localhost:YOUR-PORT/api/inngest` instead.

Local scheduling stops when either service or your computer is off. Keep `INNGEST_DEV` unset in production. For production-style local use, stop the development server, then run `npm run build` and `npm start`.

## Keep hosted discovery running

Reuse your existing hosted setup when it already works.

1. For a new hosted setup, create [Vercel](https://vercel.com/signup) and [Inngest](https://www.inngest.com/) accounts and select plans suitable for your business use and expected usage.
2. Import `dipeshc21/Xchop-Agent` into Vercel as a Next.js project.
3. In **Vercel → Project Settings → Environment Variables → Production**, add the public Supabase values and private Hunter/server-key/owner values. Use the exact names in `.env.example`; keep existing working values.
4. In **Inngest → Production**, create/copy an **Event key** and its separate **Signing key**. Save them in Vercel as `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
5. Leave `INNGEST_DEV` unset in Vercel. Use your actual hosted origin for `APP_URL` and redeploy after saving environment changes.
6. In Supabase URL Configuration, allow the hosted app origin and its `/auth/callback` URL.
7. In Inngest Production, sync your hosted endpoint, such as `https://xchop-agent.vercel.app/api/inngest`. Confirm both the discovery worker and hourly schedule appear in the same environment as your keys.
8. If deployment protection blocks Inngest, keep or configure **Vercel → Deployment Protection → Protection Bypass for Automation** in the Inngest integration. This value differs from its Event and Signing keys. See the [Inngest Vercel guide](https://www.inngest.com/docs/durable-execution/deploying-functions/platforms/vercel).
9. Open **Lead discovery**, verify the checks, and perform the authenticated restoration/first-run action.

Inngest checks due work hourly. A six-hour setting makes work due every six hours, with dispatch on an hourly check; it is not an exact-to-the-minute promise. Hosting can keep discovery running while your computer is off, subject to service availability, plan access and credits.

## Targeting, run history, and follow-ups

- **Restore Hunter discovery** recovers available earlier Hunter targets and progress, preserves current caps, enables your own workspace, and queues the first Hunter run. It does not alter other owners' settings.
- Set target countries and business/agency keywords that match your intended prospects. Review the fit threshold and collection/review basis. India is excluded from automatic discovery.
- Keep Premium pagination off unless your Hunter account supports it. First-page searches can become exhausted after the worker has seen those companies. Eligible pagination or adjusted targeting can extend coverage; the app cannot promise unlimited new contacts from unchanged first pages.
- **API attempts** counts budget reservations, including interrupted or failed ones. Hunter endpoints can consume different kinds or amounts of credits. The counter is not a bill or a number of confirmed responses.
- **Queued** means work is stored for the worker. Inspect the completed run's result, companies reviewed, saved count, skipped count, and any safe error message. Do not count a queued row as a successful discovery.
- Existing companies, emails and suppression choices are checked before new saves. Duplicate protection and scan progress continue across days. A repeat is not made fresh by changing its creation date.
- **Leads** has two tabs: **Today** for records first saved since midnight India time, and **Past** for earlier records. **Date discovered** shows the original saved date in India time. Older leads move into Past automatically; search and pagination stay within the selected tab.
- Use **Leads** for saved company/contact prospects, stage changes, source review, and follow-ups. Contact name, email, role, and website remain above the requirement/source fields in the popup.
- Use **Pause discovery** to stop future requests and saves. An already-started request may finish; the worker checks again before another request or save.

The four popup fields remain truthful:

| Field | What it shows |
| --- | --- |
| What they searched | A recorded published request when available; private search history is unavailable |
| What service they required | A source-backed request when recorded; otherwise Unknown |
| On which platform they searched | A recorded publication platform when known; otherwise Unknown |
| From where they appeared | Hunter discovery and recorded public contact-source links, or the original public request URL |

A fit score explains a possible business/agency match. It does not infer an in-house development gap, budget, consent, or a current project. Hunter's actual verification date is retained; eligible cached checks may be up to 31 days old. Optional Anthropic drafts summarize supplied facts for review and do not establish buyer intent or send outreach.

## Saved data and privacy

The restoration retains existing contacts, settings, suppression choices, files, run/request audit history, and previously saved project requests. It does not reinsert demonstration data or delete records automatically. Existing archive records do not become newly generated Hunter contacts.

Manual entry and CSV import remain available. CSV requires `company,email,country`; optional headers are `website,contact_name,role,source,lawful_basis`. Import at most 25 rows and 200,000 characters. Importing does not verify an email or establish a project requirement.

The workspace JSON export covers contacts/settings within its documented row limit; do not assume it exports every module or the separate public-request archive. The `/settings` route remains available even if dashboard reads fail.

For a live privacy check, sign in as a separate temporary test account in an incognito window. It must not see another owner's contacts, settings, project requests, suppression, or run history and cannot spend the configured owner's provider credits.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Hunter database restoration pending | Run only additive 009 from **Copy Hunter restoration SQL**, then refresh |
| Restore Hunter discovery button remains | Install 009, complete connection checks, then use that owner action to switch settings and queue a run |
| Hunter official API pending | Reuse/add the real `HUNTER_API_KEY` in server settings; restart locally or redeploy Production |
| Worker account pending | Set `AUTOMATION_OWNER_ID` to your app sign-in account's User UID |
| Hunter plan/pagination error | Review account access; turn Premium pagination off unless supported |
| Hunter quota/authentication error | Check the account's actual credits and server key; do not paste keys into chat |
| Run remains queued or schedule overdue | Check Inngest endpoint sync, matching environment/keys, deployment protection and hosting |
| Completed run saved zero contacts | Read its result: seen companies, unverified emails, missing public provenance, country/score filters, suppression, caps, or exhausted first pages can leave zero eligible contacts |
| Requirements show Unknown | The record is a contact prospect; no project requirement has been recorded |
| Old failed runs are still visible | Historical failures remain in run history. Verify the newly queued Hunter run after restoration |
| Login returns to Setup | Read the blocked check; use `/settings` when business settings are available |
| Database permission error `42501` | Follow the named setup/access guidance; do not disable row-level security |
| Data API schema error `PGRST106` | Ensure `public` is exposed in Supabase Data API settings, with owner access rules retained |
| `relation already exists` | Check the migration file. Existing installations should run 009, not the old one-time foundation/project upgrade |
| Windows `EPERM` replacing a dependency | Stop app/job terminals; if needed restart Windows and run `npm ci` before starting again |

## Developer checks and live verification

Run checks sequentially from the project folder:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
npm run smoke:settings
npm run smoke:prospecting
```

The smoke checks use isolated localhost fixtures and require a production build made without configured Supabase values. Fixture/provider tests do not validate the owner's live Hunter plan, credits, hosted database permissions or unattended schedule. See [VERIFICATION.md](VERIFICATION.md) for the required live acceptance steps.

Email sending, reply capture, proposals, payments, delivery integrations, and shared-team workflows remain later work. Adding connection values for them does not turn them on.
