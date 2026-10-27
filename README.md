# Setup for Non-Coders

**XHTMLChop Growth Agent — live workspace**

This version uses your own Supabase account. It contains no sample leads, simulated emails, pretend revenue, or browser-only business settings. Sign-in, business settings, manual lead entry and stage/value updates, leads-and-settings export, and dashboard totals use your real database records. Your workspace starts empty.

Email sending, automated prospecting/enrichment, CSV import, reply handling, payments, delivery tools, and shared teams are not implemented yet. Their navigation entries are marked as planned and cannot be opened. No background jobs run or messages are sent. Approval Mode and the automation-off guard remain in place until those features are implemented.

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

Run `001_foundation.sql` only once in a **new project**. If you already installed the earlier foundation, run only the missing migrations `002_live_workspace.sql` and `003_dashboard_summary.sql`, in that order, then run `004_restore_workspace_access.sql`. Migration 004 stops and names missing prerequisites if any earlier migration is incomplete. Do not rerun the foundation against an existing database. Stop and copy the error message if a migration fails.

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
6. Do **not** enter a database password, `service_role` key, or Supabase secret key in a `NEXT_PUBLIC_` variable. The live app does not need administrative keys. `.env.local` is ignored by Git; never upload it or paste its contents into chat.
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
6. Open **Leads → Add lead**. Enter a real company/contact, country, source, and the reason you may lawfully store/contact that person. Save the lead and refresh to confirm it remains in your account. Open a lead to update its pipeline stage or opportunity value, save, and refresh again.
7. India is excluded from targeting by default. A matching email in your workspace's suppression list cannot be added as a new lead. Duplicate email addresses are rejected.
8. Check the dashboard. Counts reflect your saved records and selected reporting period; email/revenue cards remain zero until actual matching records exist. Created leads, sends, quotes, and received payments use the selected UTC reporting period. Current pipeline stages, countries, won leads, and open opportunity values use all-time saved records. Received payments are grouped by currency; no exchange-rate conversion is applied. Opportunity value is separate from received payments.
9. Use **Settings → Export workspace** to download all your leads and saved business settings as JSON (up to 20,000 leads per download). It does not export files, payments, or other future modules. Light/dark appearance can be remembered locally; business settings are saved in Supabase.

Restart the development server after editing `.env.local`. For a production build, run `npm run build` again after changing any `NEXT_PUBLIC_` variable. Deployment and a full launch review remain separate later work; this guide runs the app locally.

## 6. Confirm your account is private

1. Create a second test user in Supabase Authentication.
2. Open the app in a private/incognito browser window and sign in as that user.
3. It must not show the first user's leads or business settings. Add a record with the second user and confirm that the first account cannot see it.
4. Remove the temporary test account from Supabase when you finish, if you no longer need it.

Database row-level security enforces ownership. A working screen alone is not proof that the live Supabase setup is correct; complete this check with your own project.

## 7. If you previously installed sample records

This release does not insert or automatically delete records. If you used the old optional seed script, its fictional rows may still exist in your Supabase database. Review them in **Table Editor → leads**, filtering `source` to `Fictional demo data` and checking that their email addresses end in `.example`. Delete only records you have confirmed are old samples. Keep all real records. You do not need this cleanup for a newly created Supabase project.

The removed browser-only settings are not migrated into your live account. Enter and save your confirmed business details after signing in.

## 8. Developer checks and troubleshooting

Run these checks from the project folder:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
npm run smoke:settings
```

`npm run smoke` briefly starts a local production server and checks its unconfigured setup boundary, stylesheet, and guarded endpoints. Run it after building with no Supabase configuration in this test environment. It does not create accounts or connect to a hosted database. If you have already configured your local app, use your real-account checks in sections 5 and 6 instead.

`npm run smoke:settings` uses a local test-only Supabase substitute and temporary Next server to verify that an authenticated account can open and save Settings even when the dashboard function is missing. It also checks that signed-out users are redirected and that diagnostic responses do not expose stored business data. Run it only against an unconfigured test build; it does not verify your hosted Supabase project.

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

Automated tests cover configuration-safe behavior, validation, metrics, and the SQL migrations in embedded PostgreSQL (PGlite). They emulate Supabase auth/storage schemas; they do not replace testing your hosted Supabase project. No hosted credentials are included in this repository.

## When sign-in returns to Setup

A successful login and database access are separate checks. The setup page lists each tested table/function and a safe error code, so a dashboard problem does not hide settings access.

1. Visit `/setup` while signed in and read the individual blocked checks.
2. If **Business settings** is ready, click **Open business settings** or visit `/settings` directly. This loads only your own settings and does not depend on the dashboard function or leads tables.
3. Follow the named migration/action on the blocked check. Permission failures can be repaired by migration 004 once all earlier migrations are present. Missing tables/functions need their named earlier migration first.
4. Refresh connection status. If it still fails, share only the check label and safe code, such as `Dashboard totals — PGRST202`; no keys, session tokens, or passwords are needed.

The browser URL may use a different port if 3000 was already occupied; use the same port for `/setup` and `/settings`.

## 9. Later connections

The current live foundation requires only Supabase. Keep these optional accounts for their future feature phases:

| Account | Purpose when implemented |
| --- | --- |
| [Anthropic](https://console.anthropic.com/) | AI scoring, writing, and classification |
| [Resend](https://resend.com/signup) or your SMTP provider | Email sending and reply capture |
| [Inngest](https://www.inngest.com/) | Background workers and scheduled automations |
| [Stripe](https://dashboard.stripe.com/register) or [PayPal Business](https://www.paypal.com/business) | Payments |
| [Vercel](https://vercel.com/signup) | Hosting |
| Apollo, Hunter, Google Places | Optional official API lead connectors |

Adding these keys now does not enable an unimplemented feature. Every future sending workflow must retain approval, suppression, unsubscribe, business-hours, lawful-basis, audit, and rate-limit safeguards.
