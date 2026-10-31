# Setup for Non-Coders

**XHTMLChop Growth Agent — public project requests**

Automatic discovery now looks for published requests from buyers who need website or application development. It uses Tavily to find public pages, then requires literal request text, publication evidence, a selected country, and a matching service before saving a result. Company names, agency descriptions, and verified emails alone do not qualify.

The request popup shows the public request, required service, publication platform, and original source. The app cannot see private Google searches or browsing history. It does not invent what a person searched for or infer a project from an old website.

Existing Hunter contacts are preserved as **Unconfirmed contacts**. A previous fit score does not establish an active project. New project requests are stored separately and can be useful without an email address: respond through the original posting after reviewing it. This phase does not send email or submit proposals automatically.

## Upgrade your existing installation

Use this path if your app already signs in and you have saved contacts.

1. Stop the development server with **Ctrl+C**. In your existing project terminal, run:

   ```powershell
   git pull origin main
   npm ci
   ```

2. Open **Lead discovery → Setup guide**, or `/prospecting/setup`. Click **Copy project-request SQL**. In **Supabase → your existing project → SQL Editor → New query**, paste that SQL and click **Run**. This installs `006_project_requests.sql`; it requires migrations 001–005 already installed. Do not rerun the foundation over your existing database.
3. Create a [Tavily account](https://app.tavily.com/), finish account confirmation, and open its API keys area. Copy your actual API key privately.
4. In **Vercel → your Xchop-Agent project → Settings → Environment Variables**, add `TAVILY_API_KEY`, paste your private key as its value, select **Production**, and save. Keep your existing Supabase, owner, and Inngest settings.
5. In Vercel, open **Deployments → latest Production deployment → ⋯ → Redeploy**. Wait for **Ready**. Environment changes need a new deployment. For local development instead, put the same value in `.env.local` and restart `npm run dev`.
6. Open **Lead discovery**, choose the website/application services and countries you want, review the project keywords, request age, and daily limits, and enter your actual collection/review basis.
7. Click **Save targeting → Start automatic discovery → Run discovery now**. Migration 006 deliberately pauses the previous company-discovery configuration, so you must review and enable the new targeting.
8. Check **Run history**, then open `/inquiries` to inspect any saved project requests. A completed run can correctly save zero requests when no retrieved page meets the evidence rules.

The new worker requires **Tavily**, not Hunter or Anthropic. Neither AI summaries nor an email-verification account is needed to discover public requests. Keep all API keys out of chat, screenshots, browser forms, and GitHub.

## 1. Get the project on Windows

1. Keep your working Node.js/NVM installation. In **VS Code → File → Open Folder**, select your existing `Xchop-Agent` project folder.
2. Open **Terminal → New Terminal** and run:

   ```powershell
   git pull origin main
   npm ci
   ```

   If you use a downloaded ZIP, get the latest ZIP from [your repository](https://github.com/dipeshc21/Xchop-Agent), extract it into a new folder, and keep your private `.env.local` file separate from downloaded archives. A ZIP folder does not contain Git history, so `git pull` will not work there.
3. The folder should contain `package.json`, `README.md`, `app`, and `supabase`.
4. If Windows reports `EPERM` while replacing a file in `node_modules`, stop the app and job-server terminals first. If a lock remains, restart Windows and run `npm ci` before starting the app.

## 2. Create a new Supabase project

Skip project creation if you already have the app's Supabase project.

1. Open [Supabase Dashboard](https://supabase.com/dashboard), create an account, and choose **New project**.
2. Enter a project name, choose an appropriate region, and save a strong database password privately. The app does not need that password in its settings.
3. Wait for the project to be ready, then open **SQL Editor → New query**.
4. Copy and run each complete migration file in order, using a new query for each file:

   | File | Purpose |
   | --- | --- |
   | `001_foundation.sql` | Tables, owner access rules, and private file bucket |
   | `002_live_workspace.sql` | Guarded real-contact creation and updates |
   | `003_dashboard_summary.sql` | Workspace dashboard totals |
   | `004_restore_workspace_access.sql` | Explicit API access grants and schema-cache refresh |
   | `005_automatic_prospecting.sql` | Durable runs, request budgets, and suppression foundation |
   | `006_project_requests.sql` | Public buyer-request discovery, evidence rules, and separate request records |

5. The in-app guide at `/prospecting/setup` provides **Copy project-request SQL** for migration 006. Earlier migration files are in `supabase/migrations`; the guide also links to the downloadable 005 prerequisite.

Run migration 001 only once in a **new project**. For an existing installation, run only missing migrations in the listed order. Migration 004 is additive and safe to rerun. Migrations 005 and 006 are one-time upgrades. Stop and inspect any SQL error before continuing. Terminal commands such as `Get-Content` and `npm ci` belong in PowerShell, not in the SQL Editor.

## 3. Create the sign-in account

1. In Supabase, open **Authentication → Sign In / Providers → Email** and enable email/password sign-in.
2. Turn **Allow new users to sign up** off. This app uses owner-created accounts.
3. Open **Authentication → Users → Add user → Create new user**. Enter your email and a strong password, using the confirmed-email/auto-confirm option for this owner account.
4. In **Authentication → URL Configuration**, allow your local site `http://localhost:3000` and redirect URL `http://localhost:3000/auth/callback`.
5. When hosting, also allow the actual hosted site address and its `/auth/callback` URL.

Each account has a separate workspace. Shared team permissions are a future feature.

## 4. Connect Supabase and Tavily privately

1. In Supabase, click **Connect → application/framework → Next.js** and copy the **Project URL** and browser-safe **publishable key**. API keys are listed separately under **Settings → API Keys**; the API Keys screen does not contain the Project URL. A legacy anon key can be used instead of a publishable key.
2. Create a local configuration file only if it does not already exist:

   ```powershell
   if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
   ```

3. Fill the existing `.env.local` with your own values:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY
   TAVILY_API_KEY=your-private-tavily-api-key
   SUPABASE_SERVICE_ROLE_KEY=your-private-supabase-server-key
   AUTOMATION_OWNER_ID=your-own-supabase-user-uuid
   APP_URL=http://localhost:3000
   ```

4. To get `TAVILY_API_KEY`, create an account at [Tavily](https://app.tavily.com/), complete account confirmation, and create/copy a key in the API keys area. Review its [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search), [credit rules](https://docs.tavily.com/documentation/api-credits), and your available account credits. The app uses basic search and can consume credits even when it rejects every retrieved result.
5. To get `SUPABASE_SERVICE_ROLE_KEY`, open **Supabase → Settings → API Keys** and copy a server secret key or legacy `service_role` key privately. It must belong to the same Supabase project as the public URL. Never put it in a `NEXT_PUBLIC_` variable.
6. To get `AUTOMATION_OWNER_ID`, open **Supabase → Authentication → Users**, select the account you sign into this app with, and copy its **User UID**. This is a user UUID, not the project reference.
7. Keep `APP_URL` set to the full origin you actually use. `.env.local` is ignored by Git; never upload it or paste its contents into chat.
8. Check the public Supabase configuration format without exposing its key:

   ```powershell
   npm run setup:check
   ```

This command does not test live login, database migrations, Tavily access, or Inngest. The app's configuration indicators are presence/format checks; an actual run verifies provider access.

## 5. Start locally

1. Run `npm run dev` and open **http://localhost:3000**. Use the printed port if 3000 is already occupied.
2. Sign in with the owner account created in Supabase. If configuration is missing, follow `/setup`.
3. Open `/settings`, save your real business name, address, services, prices, turnaround, and owner email, then refresh to confirm persistence.
4. Open `/prospecting/setup` for the numbered project-request setup guide. It is public so you can prepare accounts before sign-in; discovery actions require your account.
5. Restart the server after editing `.env.local`. Rebuild production after changing any `NEXT_PUBLIC_` value.

Local scheduling needs two running services. Add this to `.env.local` for local use only:

```text
INNGEST_DEV=1
```

Run these in separate project terminals:

```powershell
# Terminal 1
npm run dev

# Terminal 2
npm run dev:jobs
```

Open the local Inngest address printed by the second command and confirm the app functions are registered. The job script targets port 3000. If Next chooses another port, update `APP_URL` and run `npx inngest-cli@latest dev -u http://localhost:YOUR-PORT/api/inngest` instead. Local scheduling stops when the services or your computer are off.

## 6. Host automatic public-request discovery

1. Create [Vercel](https://vercel.com/signup) and [Inngest](https://www.inngest.com/) accounts if needed. Select plans suitable for your business use and expected usage.
2. In Vercel, choose **Add New → Project**, connect GitHub, and import `dipeshc21/Xchop-Agent` using the detected Next.js framework.
3. In the project's **Settings → Environment Variables**, add your public Supabase URL/publishable key and private Tavily/server-key/owner values. Select **Production**. Use `.env.example` for the exact names; do not overwrite existing working values unnecessarily.
4. In Inngest, select **Production**. Create/copy an **Event key** and its separate **Signing key**, then add them in Vercel as:

   ```text
   INNGEST_EVENT_KEY=your-private-production-event-key
   INNGEST_SIGNING_KEY=your-private-production-signing-key
   ```

5. Leave `INNGEST_DEV` unset in Vercel. It is for localhost development only.
6. Deploy. Set `APP_URL` to the actual production address, such as `https://your-app.vercel.app`, then **redeploy** so the environment value takes effect.
7. In Supabase **Authentication → URL Configuration**, allow the hosted app URL and `https://your-app.vercel.app/auth/callback`. Keep local URLs if you still use them.
8. In Inngest, sync `https://your-app.vercel.app/api/inngest` in the same environment as your keys. Confirm the function list and scheduled tick appear.
9. If deployment protection blocks the endpoint, open **Vercel → your project → Settings → Deployment Protection → Protection Bypass for Automation**. Generate a secret, copy it into the Inngest integration's **Deployment protection key**, save, and redeploy/resync. This is separate from the Event and Signing keys. See the [Inngest Vercel guide](https://www.inngest.com/docs/durable-execution/deploying-functions/platforms/vercel).
10. Open the hosted app, sign in as the configured owner, and review the checks under **Lead discovery**. Hosting does not turn discovery on by itself.

Inngest checks the owner's saved schedule hourly and queues a run at the first hourly check after it becomes due. This is not an exact-to-the-minute interval promise. Hosting can keep discovery working when your computer is off, subject to account access, service availability, and quotas.

## 7. Choose targets and inspect the results

1. Open **Lead discovery** and confirm the project-request database, Tavily, owner, and scheduler checks are ready.
2. Select **Website development**, **Application development**, or both. Choose supported target countries and project-related keywords. The defaults use website/application development rather than agency-directory phrases.
3. Set the maximum request age (30 days by default), interval, results checked per run, daily saved-request cap, and daily API-request cap. The request cap counts API calls; it is not a money or provider-credit estimate.
4. Record your actual collection basis and review process. A source being public does not by itself establish permission for unrelated marketing.
5. Click **Save targeting → Start automatic discovery → Run discovery now**. Open **Run history** to see the actual result. Queued means stored in the queue, not already processed.
6. Open `/inquiries` and click a saved request. Check the original source, publication date, explicit requirement, service, and any deadline before responding through the source platform.
7. Click **Pause discovery** to stop future work. A provider request already in flight may finish; workers recheck before another request or save.

The popup's four requested fields have these meanings:

| Popup field | What is actually recorded |
| --- | --- |
| What they searched | The exact public project request when available; private search history is unavailable |
| What service they required | Website and/or application development explicitly supported by that request |
| On which platform they searched | The platform where the public request appeared, identified from its source URL; private search activity is unavailable |
| From where they appeared | The original request URL and source dates |

The app's own discovery query is separate from the buyer's request. It must never be presented as something that person typed into Google.

Qualification requires a literal buyer request for outside development help, a supported service, explicit publication evidence in the retrieved page text, and source-text evidence of a selected country. Search-engine country boosts and estimated publication/update dates do not meet those requirements. Marketing pages, supplier offers, employment ads, tutorials, expired/closed work, and ambiguous or undated results are rejected. A recent public request can later be filled or withdrawn, so check its current availability before responding.

A run can correctly save zero requests. Strict evidence requirements, provider coverage, duplicates, budgets, or plan access can limit results. No minimum lead count, buyer response, contract, or unlimited search coverage is promised.

## 8. Existing contacts, settings, and account privacy

- Existing Hunter/manual/CSV contacts are retained as **Unconfirmed contacts**. Their company fit and verified email do not establish a project requirement. Migration 006 does not delete them or upgrade them into inquiries.
- Manual entry and CSV import remain available for existing contacts. CSV requires `company,email,country`; optional headers are `website,contact_name,role,source,lawful_basis`. Import at most 25 rows and 200,000 characters. Import does not establish project demand or verify an email.
- The old contact/settings JSON export includes up to 20,000 contact records; do not assume it exports the separate project-request table or every workspace module.
- Business settings stay in Supabase. Appearance preferences may be stored locally. A separate `/settings` route works even if dashboard reads fail.
- No sample records are inserted. If old optional sample data exists, review it explicitly before deleting anything. This update preserves records.

To check privacy, create a temporary second Supabase Auth user and sign in with it in an incognito window. It must not see the owner's project requests, contacts, settings, or run history and cannot operate the configured paid worker. Remove the temporary account when finished if no longer needed. The automated tests do not replace this check on your hosted project.

## 9. Troubleshooting and developer checks

| What you see | What to do |
| --- | --- |
| Worker account pending | Set `AUTOMATION_OWNER_ID` to the UID of the account you use to sign into the app; restart locally or redeploy Vercel. |
| Public-request provider pending | Add your real `TAVILY_API_KEY` on the server, save, and restart/redeploy. Hunter and Anthropic keys do not replace it. |
| Project-request database pending | Run migration 006 using the in-app Copy SQL action after migrations 001–005. |
| Discovery is paused after upgrading | This is intentional. Review the new targeting, save it, and enable discovery. |
| Run remains queued | Check Inngest endpoint sync, matching environment/keys, deployment protection, hosting, and the running local job server if testing locally. |
| Completed run saved zero requests | Read its result. Missing/uncertain country, source text, buyer request, publication evidence, an expired deadline, duplicates, or limits can reject every page. |
| A company contact shows Unknown requirements | It remains an unconfirmed contact. A verified email or agency description does not prove a project request. |
| Tavily rejects the key or credits are exhausted | Check your actual Tavily key, current account credits and endpoint access. Provider errors are shown without exposing the key. |
| Login returns to Setup | Read the blocked check; use `/settings` if business settings are ready. Database access and sign-in are separate checks. |
| Database permission error `42501` | Use the named migration/access guidance. Migration 004 restores the original workspace API grants after prerequisites are installed. |
| Data API schema error `PGRST106` | Ensure `public` is an exposed schema in Supabase Data API settings; keep row-level security enabled. |
| `EPERM` replacing a Node dependency on Windows | Stop running project terminals. If needed restart Windows, then run `npm ci` before starting the app. |
| Missing table/function | Run only the missing migrations in order. Do not rerun migration 001 against an existing database. |

Run checks from the project folder:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
npm run smoke:settings
npm run smoke:prospecting
```

Smoke commands use isolated localhost fixtures and require a production build made without configured Supabase values. They never verify the owner's real provider account. For a configured installation, complete the actual-account checks above. See [VERIFICATION.md](VERIFICATION.md) for the distinction between fixture tests and live acceptance.

For production-style local use, stop the development server first, then run `npm run build` and `npm start`.

## Later connections

Email sending and reply capture, payments, delivery tools, and shared teams remain later work. Adding Resend/SMTP, payment, or notification keys does not enable those features. Project-request discovery neither sends an email nor submits a bid or proposal. Follow the original platform's response rules and [Tavily's terms](https://www.tavily.com/terms); this source is for reviewing relevant published buyer requests, not generating an unsolicited marketing list.
