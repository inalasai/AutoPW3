# scripts — helper scripts

**Status:** `check-lint-rules.mjs` (TASK-02) proves the architecture lint rules fire; run by `npm run lint`.

Small, documented scripts for development and operations (for example key generation, local setup, secrets scan). Each script must:
- start with a comment explaining purpose and usage,
- never print or store secrets,
- be safe to re-run, and say so if it is not.

Prefer npm scripts in the root `package.json` for common commands.

**Phase 2 status:** `db-test.mjs` adds a two-connection OAuth consume check alongside the existing job-claim and cron-scheduling checks. It still runs only against its temporary local PostgreSQL.

**OAuth fencing status:** The runner also checks delayed-commit ordering and session logout under real
row-lock contention. `db/local-shim.sql` now supplies only the `auth.sessions` columns referenced by
the new migration. This shim is test-only; migrations do not create or alter Supabase Auth tables.

**Site onboarding status:** `db/tesla-site-link-concurrency.mjs` is called only by the temporary local
database runner. It checks same-key replay, two ADMINs linking one site, and cross-household uniqueness
with real row/index contention. Fixtures are isolated and connections have bounded statement timeouts.


**Status: discovery refresh concurrency verification implemented locally.** `db-test.mjs` runs
`db/tesla-discovery-refresh-concurrency.mjs` against its throwaway `security_tests` database. Eight real
races cover exclusive claims, duplicate commits, replacement, logout, demotion, revocation, deadline
expiry during row-lock waits and successor ownership. No hosted connection or provider call is made.

**Status: expired READY and atomic migration verification implemented locally.** Refresh concurrency
now covers 16 real races, including expired-result terminalization and independent next-generation
claims. `db/tesla-refresh-migration-atomicity.mjs` injects installation failures for both unshipped
refresh migrations and proves definitions/grants roll back in autocommit and outer transactions.

Status: `verify-staging-build.mjs` checks staging auth/public configuration from the developer's
environment, gates, CSP and asset hashes. Owner-specific hosted-preflight and Auth-redirect helpers
are private/ignored and excluded from publication; ordinary development never needs operator access.

Hosted staging checkpoint: three approved forward migrations installed and validated; Worker REDACTED_RUNTIME_ID deployed with preserved bindings and safety gates. Real ADMIN discovery and separately confirmed linking remain pending.

Status: see [independent developer setup](../docs/TEAM_DEVELOPMENT.md) and the
[publication handoff](../docs/handoffs/SECURE-GITHUB-PUBLICATION.md). No hosted-operation command is
authorized by this repository's local setup instructions.
