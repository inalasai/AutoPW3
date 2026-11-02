# Database migrations

Forward-only PostgreSQL migrations are applied in timestamp order. Never edit an applied historical
migration; create a new migration and verify it against throwaway PostgreSQL with `npm run db:verify` and
`npm run db:test`. Local verification does not apply migrations to hosted Supabase.

**Status:** Phase 2 adds `20261031160000_authorize_tesla_oauth_persistence.sql`: service-only current-ADMIN validation and an atomic, role-locked credential save with actor audit. No tables or RLS policies change. Hosted application remains NOT_EXECUTED.

**OAuth fencing status:** `20261101160000_fence_staging_tesla_oauth.sql` adds service-only begin,
session-validation and fenced-save RPCs over existing locks, credentials and Supabase `auth.sessions`.
It changes no tables, RLS policies, existing credentials or Auth configuration. Only the test shim
creates a minimal `auth.sessions` table. Apply this migration through the approved process before a
coordinated staging Worker/frontend rollout; it has not been applied hosted by this task.

**Site onboarding status:** `20261101170000_link_discovered_tesla_sites.sql` depends on the preceding
session-hardening migration. It adds one private RLS-enabled verification/idempotency table, one
service-only verification RPC and two authenticated ADMIN/session RPCs. It creates no public tables
or new public RLS policies and preserves existing grants. Provider checks run before the transaction;
the site, user-attributed audit and replayable result commit together. No hosted application occurred.


**Status: discovery refresh migration implemented locally; not applied hosted.**
`20261102120000_refresh_staging_tesla_discovery_credentials.sql` depends on the existing OAuth session
and site-link migrations. It adds a private RLS ledger, authenticated preflight/begin/finish and
service-only encrypted staging. No public table grant, linking freshness predicate or feature flag
is changed. SENT attempts deliberately survive logout and lease expiry to prevent blind reexchange.

**Status: expired READY forward fix implemented locally; not applied hosted.**
`20261102140000_resolve_expired_tesla_refresh_attempts.sql` terminalizes expired staged TOKEN results
as authenticated REAUTH, clears pending ciphertext and retains the barrier. It preserves newer
credential revisions, ADMIN/session and lease checks. Both this file and the unshipped 20261102120000
base migration install definitions and grants inside one DO statement, including autocommit execution.
No merged migration or hosted migration history was changed. There are now 21 local migrations.

Status: 22 local migrations. `20261102160000_fence_staging_tesla_link_commit.sql` rechecks link
authority/freshness after contention and installs its definition/grants in one DO statement. Existing
Worker RPC signatures and OAuth/login remain compatible. No hosted migration was applied.

Hosted staging checkpoint: three approved forward migrations installed and validated; Worker REDACTED_RUNTIME_ID deployed with preserved bindings and safety gates. Real ADMIN discovery and separately confirmed linking remain pending.
# Independent developer setup

Status: [DEVELOPER_SETUP.md](../../docs/DEVELOPER_SETUP.md) documents local and developer-owned hosted
migration verification. `../config.toml` has local-only callback/reset URLs and explicit email
confirmation/password policy; it does not reconfigure any hosted Auth project.
