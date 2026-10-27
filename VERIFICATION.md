# Live workspace verification

This release removes the generated lead seed and mode fallback. The app requires your own Supabase project. Missing connection values lead to setup instructions; they never produce fabricated dashboard data.

Implemented scope:
- Supabase password sign-in, owner-scoped records, and saved business settings.
- Manual real lead entry and stage/value updates with server-side input validation and database safeguards.
- Dashboard totals from stored records, true empty states, and leads-and-business-settings JSON export (up to 20,000 leads).
- Local connection check and numbered Windows/Supabase setup instructions.

Passed for this source release:
- Next.js production build with strict TypeScript validation.
- Nine automated test files covering configuration, validation, real dashboard aggregation, tenant isolation, database-backed rate limits, suppression, immutable audit entries, and guarded lead updates.
- Embedded PostgreSQL tests execute the migrations against emulated Supabase auth/storage schemas.
- Temporary local HTTP server checks: missing configuration redirects to setup; setup instructions and stylesheet load; login remains available; readiness response contains no secrets; same-origin settings requests reach the missing-configuration guard.
- Request-origin regression tests verify local 127.0.0.1 requests when Next internally reconstructs localhost, with cross-site requests still rejected.
- Readiness diagnostics report only fixed resource names and bounded error codes, and distinguish session, permissions, missing tables/functions, and API schema exposure.
- Access-repair migration tests start with missing public-schema privileges, restore them idempotently, preserve data and policies, and maintain tenant isolation and write restrictions.
- Authenticated local HTTP regression: Settings opens, saves via its guarded API, and reloads stored changes independently of missing dashboard functions, while dashboard readiness stays blocked and signed-out users cannot read settings. The HTTP test uses a test-only local Supabase substitute and SSR cookies.
- Source diff whitespace checks and staged-file credential screening.

Limits:
- Hosted Supabase authentication, database, and storage cannot be verified without the owner's project. No hosted credentials are included.
- Embedded database tests emulate Supabase auth/storage tables; they do not prove a hosted project has been migrated correctly.
- Browser visual and interaction verification may be unavailable in the cloud session; check the live sign-in, settings save, lead save/refresh, and two-account privacy steps in README.md.
- Email sending, AI enrichment/prospecting, CSV import, payments, background jobs, and project delivery are not implemented or activated by this change.
- Existing database records are preserved. Any old fictional seed records require explicit review and removal by the owner.
