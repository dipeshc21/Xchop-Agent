# Setup for Non-Coders

**XHTMLChop Growth Agent — live workspace**

This version uses your own Supabase account and official Hunter APIs to discover real prospective clients automatically. It checks company country, finds published business email contacts, verifies them, scores fit, and saves eligible leads to your account. Inngest schedules the work; hosted Vercel + Inngest runs keep working when your computer is off. There is no sample lead fallback. Sign-in, business settings, real lead records, stage/value updates, export, and dashboard totals use your own database.

**Phase 2 builds lead discovery, not outreach.** No emails are sent. Email sending/reply handling, payments, delivery tools, and shared teams remain later work. Discovery is disabled initially and only calls paid/credit-based APIs after you configure the provider, record your lawful basis, set limits, and enable it. The outreach automation guard remains off independently of the discovery schedule.

## 1. Get the latest project on Windows

1. Keep your working Node.js/NVM installation. Open **VS Code → File → Open Folder** and select your existing `Xchop-Agent` project folder.
2. Choose **Terminal → New Terminal**. Run:

   ```powershell
   git pull origin main
   npm ci
   ```

   If you downloaded a ZIP instead of using Git, download the latest ZIP from [your repository](https://github.com/dipeshc21/Xchop-Agent), extract it into a new folder, and open that folder. Keep your private `.env.local` file separate from downloaded archives.
3. The folder should contain `package.json`, `README.md`, `app`, and `supabase`.

## 2. Create your Supabase project

1. Open [Supabase Dashboard](https://supabase.com/dashboard) and create a free account.
2. Choose **New project**. Enter a project name such as `XHTMLChop Growth Agent`, choose your organization, and select an appropriate region.
3. Choose a strong database password and save it privately. The app does not need that password in its settings.
4. Wait until the new project is ready.
5. In the Supabase sidebar, open **SQL Editor → New query**.
6. In VS Code, open `supabase/migrations/001_foundation.sql`. Copy the entire file into the SQL Editor and click **Run**. This creates the database tables, account access rules, and private file bucket.
7. Open another **New query**, copy all of `supabase/migrations/002_live_workspace.sql`, and click **Run**. This enables the real lead-entry operation with validation, duplicate protection, targeting restrictions, and rate limiting.
8. Open one more **New query**, copy all of `supabase/migrations/003_dashboard_summary.sql`, and click **Run**. This enables dashboard totals from your own saved records.
9. Run `supabase/migrations/004_restore_workspace_access.sql`. This explicitly restores the authenticated API access used by the app and refreshes the API schema cache. It preserves records, row-level security, policies, and write restrictions, and is safe to run again.
10. Run `supabase/migrations/005_automatic_prospecting.sql` for automatic discovery. The app’s **Lead discovery → Setup guide** includes a **Copy prospecting SQL** button containing this exact migration. Paste SQL into **Supabase → SQL Editor → New query → Run**. Run PowerShell commands in your terminal, not in the SQL Editor.

Run `001_foundation.sql` only once in a **new project**. If you already installed the earlier foundation, run only the missing migrations `002_live_workspace.sql` and `003_dashboard_summary.sql`, in that order, then run `004_restore_workspace_access.sql`, followed by `005_automatic_prospecting.sql`. Migration 004 stops and names missing prerequisites if any earlier migration is incomplete. Do not rerun the foundation against an existing database. Stop and copy the error message if a migration fails.

## 3. Create your sign-in account

1. In Supabase, open **Authentication → Sign In / Providers → Email**. Enable email/password sign-in.
2. Turn **Allow new users to sign up** off. The app uses owner-created accounts rather than public registration.
3. Open **Authentication → Users → Add user → Create new user**.
4. Enter your own email and a strong password. Use the confirmed-email/auto-confirm option for this owner-created account. Save the password privately.
5. Under **Authentication → URL Configuration**, set **Site URL** to:

   ```text
   http://localhost:3000
   ```

6. Add this allowed redirect URL:

   ```text
   http://localhost:3000/auth/callback
   ```

Each sign-in account currently has its own separate workspace. Shared team permissions are a future feature.

## 4. Connect your app privately

1. Open your Supabase project and click the green **Connect** button at the top. Select the application/framework option and choose **Next.js**.
2. Copy the **Project URL** and **publishable key** shown for the app. Specific keys are listed separately under **Settings → API Keys**; the API Keys screen does not contain the Project URL. A legacy **anon** key can be used instead if your project uses legacy keys.
3. In the VS Code terminal, create your local configuration file **only if it does not already exist**:

   ```powershell
   if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
   ```

4. Open `.env.local` in VS Code and fill in these two lines with your own project values:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY
   ```

5. Leave `APP_URL=http://localhost:3000` while running on your computer. The app no longer uses a mode flag; older mode-variable lines can be removed from this file.
6. Do **not** enter a database password, `service_role` key, or Supabase secret key in a `NEXT_PUBLIC_` variable. Sign-in and ordinary workspace saves use the publishable key. Unattended discovery additionally needs a **server-only** administrative key under `SUPABASE_SERVICE_ROLE_KEY`, as explained below. `.env.local` is ignored by Git; never upload it or paste its contents into chat.
7. Check that the required local values are present:

   ```powershell
   npm run setup:check
   ```

   This command checks local configuration format and never prints the key. It does not test your Supabase login or database over the network.

## 5. Start the real app

1. Run:

   ```powershell
   npm run dev
   ```

2. Keep the terminal open. Visit **http://localhost:3000**.
3. If configuration is missing, the app shows the setup page. Complete the steps above, stop the server with **Ctrl+C**, then run `npm run dev` again.
4. When configured, sign in with the email and password you created in Supabase. The dashboard will initially show zero leads and zero activity.
5. Open **Settings → Business profile**, or visit **http://localhost:3000/settings** directly. Enter your real business address, services, pricing, turnaround, and notification email. Click **Save changes**, refresh, and confirm that the values remain saved.
6. Open **Lead discovery** and follow the setup in the next section to find clients automatically. The separate **Leads → Add lead** form is optional for a contact you already know. Open a saved lead to update its pipeline stage or opportunity value, save, and refresh again.
7. India is excluded from targeting by default. A matching email in your workspace's suppression list cannot be added as a new lead. Duplicate email addresses are rejected.
8. Check the dashboard. Counts reflect your saved records and selected reporting period; email/revenue cards remain zero until actual matching records exist. Created leads, sends, quotes, and received payments use the selected UTC reporting period. Current pipeline stages, countries, won leads, and open opportunity values use all-time saved records. Received payments are grouped by currency; no exchange-rate conversion is applied. Opportunity value is separate from received payments.
9. Use **Settings → Export workspace** to download all your leads and saved business settings as JSON (up to 20,000 leads per download). It does not export files, payments, or other future modules. Light/dark appearance can be remembered locally; business settings are saved in Supabase.

Restart the development server after editing `.env.local`. For a production build, run `npm run build` again after changing any `NEXT_PUBLIC_` variable. Unattended discovery needs the hosted setup below. A full outreach launch/security review remains later work; installing discovery does not enable email sending.

## 6. Set up automatic lead discovery

Open **http://localhost:3000/prospecting/setup** for the numbered in-app guide. This guide can be opened before sign-in so you can prepare accounts. Lead discovery settings, runs, and provider actions require your sign-in. You will need a Hunter account, an Inngest account, and hosting; there is no unlimited/free lead supply promised by the app.

### A. Add the prospecting database update

1. Update the code: run `git pull origin main` and `npm ci` in the project terminal.
2. In the app, open **Lead discovery → Setup guide → Copy prospecting SQL**.
3. Open your Supabase project **SQL Editor → New query**, paste, and click **Run**. This is migration `005_automatic_prospecting.sql`; complete migrations 001–004 first. The button has a plain-file fallback if your browser blocks clipboard access.
4. Keep using your existing Supabase project and account. Existing records are preserved.

### B. Create Hunter and connect the owner workspace

1. Create a [Hunter account](https://hunter.io/users/sign_up), confirm your email, and open its [API keys page](https://hunter.io/api-keys). Save your real API key privately. Review available credits and your access to **Discover, Company Enrichment, Domain Search, and Email Verifier** in the [official API documentation](https://hunter.io/api-documentation). Some access may require a paid plan. The app does not use Hunter's example `test-api-key` or manufacture contacts when access is unavailable.
2. In Supabase **Authentication → Users**, open your own app sign-in account and copy its **User UID**. Use this value for `AUTOMATION_OWNER_ID`. It is the existing user account that will own unattended discoveries, not a project ID.
3. In Supabase **Settings → API Keys**, copy a **server secret key** or legacy **service_role** key privately. Put it in `SUPABASE_SERVICE_ROLE_KEY`; never put it in a `NEXT_PUBLIC_` variable. The worker uses administrative access but restricts each operation to the configured owner.
4. Add these server values to `.env.local`, keeping your existing public Supabase connection values:

   ```text
   HUNTER_API_KEY=your-private-hunter-key
   SUPABASE_SERVICE_ROLE_KEY=your-private-supabase-server-key
   AUTOMATION_OWNER_ID=your-own-supabase-user-uuid
   APP_URL=http://localhost:3000
   ```

5. Save, stop the running app with **Ctrl+C**, and restart after completing the local or hosted scheduler setup. Keep private keys out of chat, screenshots, browser forms, and GitHub.

### C. Test locally with two terminals

Local testing runs only while your computer and both terminals stay on. It does not provide unattended hosting.

1. Add this local-only setting to `.env.local`:

   ```text
   INNGEST_DEV=1
   ```

2. In terminal 1, run:

   ```powershell
   npm run dev
   ```

3. Open a second terminal in the same project folder and run the official Inngest development server:

   ```powershell
   npm run dev:jobs
   ```

4. Open the local Inngest address printed by that command and confirm your app's functions are registered. The script targets port 3000. If Next chooses another port, update `APP_URL`, then start the job server with `npx inngest-cli@latest dev -u http://localhost:YOUR-PORT/api/inngest` instead. Use that same port in your browser.
5. Follow **E. Choose targets and run** below. Real Hunter requests can consume credits even during local testing.

### D. Host it so discovery continues when your computer is off

1. Create accounts at [Vercel](https://vercel.com/signup) and [Inngest](https://www.inngest.com/). Choose plans that support your business use and expected usage; check current pricing and quotas before enabling recurring work.
2. In Vercel, choose **Add New → Project**, connect GitHub, and import `dipeshc21/Xchop-Agent`. Keep the detected Next.js framework.
3. Add the Supabase URL/publishable key, Hunter API key, Supabase server key, and owner UUID to the project's **Environment Variables**. Use the exact names from `.env.example`.
4. In your Inngest dashboard, select the **Production** environment. Find/create an **Event key** under that environment's event keys, then copy its **Signing key** from the environment settings. These are different keys. Add them in Vercel as:

   ```text
   INNGEST_EVENT_KEY=your-private-production-event-key
   INNGEST_SIGNING_KEY=your-private-production-signing-key
   ```

5. Keep `INNGEST_DEV` **unset** in Vercel/production. It is accepted only for local development with a localhost app address.
6. Deploy. Copy the production URL, such as `https://your-app.vercel.app`, into Vercel's `APP_URL` variable and **redeploy** so that address is active.
7. In Supabase **Authentication → URL Configuration**, add the hosted app URL and `https://your-app.vercel.app/auth/callback` to allowed URLs. Keep localhost if you still use local development.
8. In Inngest, add/sync the app's endpoint: `https://your-app.vercel.app/api/inngest`. Use the same production environment as your keys. Confirm the functions and scheduled tick appear.
9. If deployment protection blocks Inngest, follow the [Inngest Vercel deployment guide](https://www.inngest.com/docs/deploy/vercel) to connect the integration and allow access to that project. The endpoint must be reachable by Inngest; the workspace itself still requires Supabase sign-in and webhook signatures remain checked.
10. Open the hosted app, sign in as the configured owner, and finish the controls below. Hosting does not turn discovery on by itself.

### E. Choose targets and run

1. Open **Lead discovery**. Check the provider/database/scheduler readiness indicators.
2. Choose your target countries and business keywords. India is excluded by default; country eligibility is checked against company enrichment, independently of the Discover search filter.
3. Record a specific **source/lawful-basis note** explaining why you may store and contact this type of lead. A verified email is **not consent**. Review sources and applicable rules before later outreach.
4. Set conservative daily **API-request** and saved-lead caps, the batch size, and the interval. API-request counts are not Hunter credit/billing estimates: endpoints and plans can have different credit costs.
5. Keep **Premium Discover pagination** off unless your Hunter account includes it. Basic mode rotates bounded country/keyword searches. It may revisit companies, skip duplicates, or find no eligible contacts; it does not promise unlimited fresh leads.
6. Click **Save targeting**, then **Start automatic discovery**, then **Run discovery now**. A persisted queued run means it has been queued, not that provider work has already completed. Open **Run history** to see started/completed/failed work and safe provider error messages.
7. The worker finds companies, independently checks country, searches for found business contacts, checks emails with Hunter's verifier, calculates a visible fit score, and saves only eligible leads. When Hunter reports verification is still processing, the worker waits and checks again at most twice, counting each check against the request cap. If it is still pending, a later run may retry the unfinished company. Hunter may return a cached verification date; the app records that actual date and accepts valid results no older than 31 days. Suppressed addresses, duplicates, India/excluded countries, and unverified contacts are skipped. A score is a fit estimate, not a sale or evidence of consent.
8. Confirm saved leads appear under **Leads** and remain after refresh. Investigate a run with zero saved leads using its log rather than repeatedly increasing limits.
9. Inngest checks the configured owner's schedule **once an hour**. A run is queued on the first hourly tick after the chosen interval is due; this is not an exact-to-the-minute promise. Manual **Run now** queues immediately when the scheduler connection is available.
10. Click **Pause discovery** to stop future automatic work. A provider request already in flight may finish, but workers check again before another request or lead save. Review the run status. No email is sent in this phase.

### F. Optional AI summaries

Create an [Anthropic account](https://console.anthropic.com/) only if you want AI-generated company summaries. Set **both** `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` on the server, using a model available to your account, then enable AI in discovery settings. There is no hard-coded model fallback. AI results are drafts for review and are logged; they do not send messages or replace independent country, suppression, duplicate, or email-verification checks. AI API calls can incur provider charges.

Hunter is the active automatic source in this phase. Apollo is not enabled. Google Places is not used as a durable CRM source; its storage/use restrictions need a separately compliant integration. Optional manual entry remains available for contacts you already have.

For an existing contact list, **Leads → Import an existing contact list** accepts CSV files with the required headers `company,email,country` and optional headers `website,contact_name,role,source,lawful_basis`. Import at most 25 rows and 200,000 characters at a time. Enter your actual collection/contact basis in the import form or each row. The app validates the file before saving, reports each row's outcome, and skips existing emails and suppressed contacts. CSV import does not verify email addresses or send messages.

## 7. Confirm your account is private

1. Create a second test user in Supabase Authentication.
2. Open the app in a private/incognito browser window and sign in as that user.
3. It must not show the first user's leads or business settings. Add a record with the second user and confirm that the first account cannot see it.
4. Remove the temporary test account from Supabase when you finish, if you no longer need it.

Database row-level security enforces ownership. A working screen alone is not proof that the live Supabase setup is correct; complete this check with your own project.

## 8. If you previously installed sample records

This release does not insert or automatically delete records. If you used the old optional seed script, its fictional rows may still exist in your Supabase database. Review them in **Table Editor → leads**, filtering `source` to `Fictional demo data` and checking that their email addresses end in `.example`. Delete only records you have confirmed are old samples. Keep all real records. You do not need this cleanup for a newly created Supabase project.

The removed browser-only settings are not migrated into your live account. Enter and save your confirmed business details after signing in.

## 9. Developer checks and troubleshooting

Run these checks from the project folder:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
npm run smoke:settings
npm run smoke:prospecting
```

`npm run smoke` briefly starts a local production server and checks its unconfigured setup boundary, stylesheet, and guarded endpoints. Run it after building with no Supabase configuration in this test environment. It does not create accounts or connect to a hosted database. If you have already configured your local app, use your real-account checks in sections 5–7 instead.

`npm run smoke:settings` uses a local test-only Supabase substitute and temporary Next server to verify that an authenticated account can open and save Settings even when the dashboard function is missing. It also checks that signed-out users are redirected and that diagnostic responses do not expose stored business data. Run it only against an unconfigured test build; it does not verify your hosted Supabase project.

`npm run smoke:prospecting` checks the actual discovery HTTP routes with local fixture data and blocks external provider requests. It verifies owner filters, setup SQL, pause and missing-key boundaries, suppression, and research responses. It requires the same unconfigured test build.

For a production-style local run:

```powershell
npm run build
npm start
```

Stop the development server first if port 3000 is in use.

| What you see | What to do |
| --- | --- |
| Setup page after entering keys | Save `.env.local` in the same folder as `package.json`, check the variable names, and restart the server. |
| Sign-in failed | Use the Supabase Authentication user and password, not the database password. Check that the user is confirmed. |
| Login returns to Setup | Check each individual Connection status result. If business settings are ready, use **Open business settings** or `/settings`; this route works independently of dashboard reads. |
| Missing table or function | Run the named missing migration, in order. Do not rerun migration 001 over existing tables. Migration 004 reports missing prerequisites without changing records. |
| Permission error `42501` | Run migration `004_restore_workspace_access.sql` after migrations 001–003 have completed, then refresh Setup. This restores intended API privileges and refreshes the schema cache. |
| API schema exposure error `PGRST106` | In Supabase **Integrations → Data API**, make sure `public` is an exposed schema. Keep row-level security enabled. |
| Lead already exists | Search your existing leads for the same email. Email comparisons are normalized. |
| India targeting restriction | Check **Settings → Safety & preferences**. India is excluded by default. |
| Suppressed address | Honor the suppression entry. Do not remove it just to add or contact that address. |
| Rate-limit message | Wait a minute, then retry. Settings and lead creation have per-account limits. |
| NVM blocks npm | Repair your Windows Node/NVM installation first. This is separate from the app and Supabase setup. |
| Discovery stays queued | Confirm the Inngest app endpoint is synced and reachable, its environment matches both keys, and hosting is running. Locally, keep both `npm run dev` and `npm run dev:jobs` open. |
| Hunter plan/access error | Check your Hunter plan for all four required endpoints and available credits. Leave Premium pagination off unless your plan supports it. |
| A completed run saved zero leads | Review the run result and targeting. Missing country, no published contact, invalid/uncertain verification, low fit, duplicates, suppression, or a reached limit can produce zero leads. No minimum lead count is promised. |
| Wrong account for automatic discovery | Set `AUTOMATION_OWNER_ID` to the User UID of the account you use to sign in. Restart locally or redeploy after changes. Never replace it with the Supabase project reference. |

Automated tests cover configuration-safe behavior, validation, metrics, and the SQL migrations in embedded PostgreSQL (PGlite). They emulate Supabase auth/storage schemas; they do not replace testing your hosted Supabase project. No hosted credentials are included in this repository.

## When sign-in returns to Setup

A successful login and database access are separate checks. The setup page lists each tested table/function and a safe error code, so a dashboard problem does not hide settings access.

1. Visit `/setup` while signed in and read the individual blocked checks.
2. If **Business settings** is ready, click **Open business settings** or visit `/settings` directly. This loads only your own settings and does not depend on the dashboard function or leads tables.
3. Follow the named migration/action on the blocked check. Permission failures can be repaired by migration 004 once all earlier migrations are present. Missing tables/functions need their named earlier migration first.
4. Refresh connection status. If it still fails, share only the check label and safe code, such as `Dashboard totals — PGRST202`; no keys, session tokens, or passwords are needed.

The browser URL may use a different port if 3000 was already occupied; use the same port for `/setup` and `/settings`.

## 10. Later connections

Supabase, Hunter, Vercel, and Inngest are the real automatic-discovery setup above. Anthropic is optional. These remaining connections belong to later feature phases:

| Account | Purpose when implemented |
| --- | --- |
| [Resend](https://resend.com/signup) or your SMTP provider | Email sending and reply capture |
| [Stripe](https://dashboard.stripe.com/register) or [PayPal Business](https://www.paypal.com/business) | Payments |
| Apollo / another approved source | Possible future connector; not enabled by adding a key |

Adding a later-feature key does not enable that feature. Every future sending workflow must retain approval, suppression, unsubscribe, business-hours, lawful-basis, audit, and rate-limit safeguards.
