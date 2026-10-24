# Setup for Non-Coders

**XHTMLChop Growth Agent — Phase 1**

A private workspace for growing white-label agency partnerships outside India. Phase 1 includes the dashboard, 20 fictional leads, business settings, light/dark mode, Supabase sign-in, a private database design, and a storage foundation. The complete sales automation system is built over eight phases.

## 1. What you can try today

- Dashboard with sample KPIs, funnel, markets, and opportunity values.
- Browse 20 fictional leads, search, filter by country, and open their details.
- Edit services, business address, pricing, turnaround, notification email, and FAQ text in Settings.
- Save demo preferences in your browser; refresh to confirm they remain saved.
- Toggle dark mode and try the layout on a narrow screen.
- Export the workspace as JSON.

**Demo Mode sends nothing and calls no AI services.** Dashboard counts, score values, charts, and attention reminders are illustrative. The revenue panel shows won opportunity value, not banked revenue. The decorative revenue bar chart is illustrative. Demo reporting dates are anchored to October 2026. Daily limits, mode switches, and automation controls are saved preferences only in Phase 1. Live automation is locked off. Later navigation sections clearly show their future phase.

## 2. Install two free tools

1. Open https://nodejs.org and install **Node.js 22 LTS or newer** using the default installer options.
2. Open https://code.visualstudio.com and install **Visual Studio Code**.
3. Unzip the supplied project. In VS Code, choose **File → Open Folder** and select the folder containing `package.json`.
4. Choose **Terminal → New Terminal**. A text panel opens along the bottom of the window. Type each command below there, pressing Enter after each.

## 3. Start the demo — no accounts needed

1. Type `npm ci` and wait until installation finishes. If no lockfile is present, use `npm install` instead.
2. In the VS Code file list, find `.env.example`. Copy it to a new file called `.env.local`. The beginning should look like this:

   ```text
   NEXT_PUBLIC_DEMO_MODE=true
   ```

3. Type `npm run dev`.
4. Open **http://localhost:3000** in your browser. You should see “A little more momentum.” and a “Demo workspace” badge.
5. Keep the terminal open while using the app. Press **Ctrl+C** in that terminal to stop it.

## 4. Test Phase 1 in five minutes

1. **Dashboard:** confirm there are 20 leads with all filters reset. Change “This month” to “Last 7 days”; totals should change. Reset it afterward.
2. **Leads:** select Leads in the sidebar, search “Studio”, filter the country, then click a company to open its details. Use reserved `.example` emails only as sample data.
3. **Settings → Business profile:** enter your real services and confirmed prices. The initial list is a suggestion, not a claim about your business. Click **Save changes**, refresh, and check that your edits remain.
4. **Controls:** try the automation switch and modes. A notice explicitly says no messages are sent. These controls only simulate state in Demo Mode.
5. **Appearance & export:** click the moon icon, shrink the browser window, and export your data from Settings. Demo preferences are stored only on this browser/device, not synced to Supabase.

## 5. Create Supabase for real sign-in and storage

You can do this later. Never paste secret keys into chat or browser settings.

1. Visit https://supabase.com/dashboard, create an account, and choose **New project**. Pick a project name, save your database password privately, and choose an appropriate hosting region.
2. Wait until the project is ready. Open **SQL Editor → New query**.
3. In VS Code, open `supabase/migrations/001_foundation.sql`. Copy the entire file into the Supabase query window and click **Run**. Run it **once in a new project**, not in an existing production database. It creates 20 tables, indexes, account-level access rules, an audit log, and a private file bucket.
4. Open **Authentication → Sign In / Providers → Email**. Enable email/password sign-in and turn **Allow new users to sign up** off. This workspace uses owner-created accounts.
5. Open **Authentication → Users → Add user → Create new user**. Enter your email and a strong password; use the confirmed-email option for this owner-created account. Never send the password to anyone.
6. Under **Authentication → URL Configuration**, use `http://localhost:3000` as Site URL and add `http://localhost:3000/auth/callback` to allowed redirect URLs. Password sign-in is the Phase 1 path; a code-exchange route is prepared for later magic-link flows.
7. Open **Project Settings → API / API Keys**. Copy the **Project URL** and **publishable key** into the corresponding lines in `.env.local`.
8. Change `NEXT_PUBLIC_DEMO_MODE=false` in `.env.local`. Stop and restart `npm run dev` after any environment-file change. For production mode, run `npm run build` again after changing any `NEXT_PUBLIC_` variable.
9. Open http://localhost:3000. You should be redirected to sign-in. Enter the account you created. The live dashboard starts empty; settings now save to Supabase.
10. Test privacy by creating a second user and signing in as that user in a private browser window. It must not see the first account’s leads or saved settings. Phase 1 treats each account as a separate workspace; shared team roles arrive later.

### Optional: install the 20 fictional leads in Supabase

1. In Supabase **Authentication → Users**, copy your owner user’s UUID into `SEED_OWNER_ID` in `.env.local`.
2. Copy the server-only legacy `service_role` key from the project’s API settings into `SUPABASE_SERVICE_ROLE_KEY`. Do not use a publishable key here. Treat this key like a master password.
3. In the terminal, run:

   ```sh
   node --env-file=.env.local --import tsx scripts/seed.ts
   ```

4. Refresh the live dashboard. Existing settings and matching lead records are preserved if the seed is run again.
5. Remove the service-role key from your local file when you finish seeding. The Phase 1 app itself does not need it.

## 6. Accounts for later phases

| Account | Simple first step | Needed for |
| --- | --- | --- |
| Anthropic | https://console.anthropic.com → API Keys → Create key | Phase 3 AI writing, later classification |
| Resend | https://resend.com/signup → Domains → add and verify a sending domain, then create an API key | Phase 3 emails |
| Inngest | https://www.inngest.com → create account and app | Phase 3 scheduled workers |
| Stripe or PayPal Business | https://dashboard.stripe.com/register or https://www.paypal.com/business | Phase 6 payments |
| Vercel | https://vercel.com/signup → create an account | Phase 8 deployment |
| Apollo, Hunter, Google Places | Optional accounts; use official APIs only | Phase 2 optional lead connectors |

No later-phase API keys are used or required now. `.env.example` explains the reserved environment variables. SMTP/IMAP alternatives and optional Telegram/WhatsApp settings are reserved, not implemented.

## 7. Build and check the project

```sh
npm test
npm run typecheck
npm run build
npm run smoke
npm start
```

`npm run smoke` briefly starts and stops a local server to check the built pages and API guards.

`npm start` opens the production build at http://localhost:3000. Stop any development server first if the port is already in use. Automated tests cover safe defaults, settings validation, fake-data integrity, opportunity totals, and the migration in an embedded PostgreSQL engine (PGlite), including account isolation, foreign-key ownership, immutable audit records, settings rate limiting, and automation guards. These database tests emulate the Supabase auth/storage schemas; they are not a live hosted Supabase test. Scheduling, unsubscribe, scoring, payment webhook and live Supabase integration tests are added with those implementations. The database migration must also be run and verified on your own Supabase project; do not treat a successful JavaScript build as proof of a live database setup.

## 8. What is built, and what comes next

1. **Foundation (this release):** Next.js App Router, strict TypeScript, Tailwind v4, shadcn-style reusable button, responsive dashboard, auth, settings, safe demo, SQL schema/RLS, private storage foundation, seed and setup guide.
2. **Leads:** CSV import, manual entry, enrichment, scoring, suppression and optional API connectors.
3. **Outreach:** background agents, AI writing, approval queue, scheduling, limits, sending, unsubscribe and deliverability checklist.
4. **Inbox & CRM:** reply capture/classification and pipeline editing.
5. **Inbound:** embed form/chat and acknowledgments.
6. **Sales & delivery:** quotes, signed payment webhooks, delivery board, client portal and files UI.
7. **Growth loop:** after-sales workflows, analytics and weekly reports.
8. **Go live:** beginner Vercel/Supabase deployment guide, security review and launch checklist.

Prompts, shared team management, full audit-log browsing, active connectors, actual revenue reconciliation, and all named background workers belong to the later feature phases. Their database foundation is present, but they do not run yet. Demo settings do not migrate automatically into live mode. Live deployment is deferred to Phase 8 as requested.

## Technical notes for your developer

- `app/page.tsx` verifies the current Supabase user before loading live workspace records. `proxy.ts` refreshes auth cookies; it does not replace server authorization.
- `app/api/workspace` validates settings with Zod, checks the request origin and size, and uses an authenticated RPC. Settings saves are limited to 20 per minute per account in the database, using a transaction lock, and generate immutable audit entries. No API keys are returned to the browser.
- Every tenant-owned table has RLS, ownership indexes, and composite ownership foreign keys for related records. Users cannot edit their role; financial records and audit logs are server-write only. “Global suppression” in later phases means across all sequences in one owner workspace.
- The private file bucket accepts objects up to 20 MB under `<owner-uuid>/...`; client portal sharing is not implemented.
- Phase 1 settings explicitly forbid enabling live automation at both API and database levels. Phase 3 must deliberately replace this guard only after implementing sending safeguards.
- No service-role key is used by runtime web requests. The seed script is trusted administrative code; run it only for the intended existing user.
- The reusable button follows the shadcn/ui source-owned CVA pattern. No external UI kit server or remote fonts are required.
- No external destinations are fetched by the application in Demo Mode.
