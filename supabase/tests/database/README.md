# Database security tests

Ordered `*.test.sql` files run against throwaway PostgreSQL 17 through `npm run db:test`. Keep each TAP
plan exact and roll back fixtures. These tests validate local PostgreSQL behavior, not hosted Supabase
configuration or Cloudflare runtime bindings.

**Status:** `141_staging_identity_read.test.sql` exercises the profile and household join used by the
staging `/me` slice under authenticated roles, including unrelated households and users without memberships.

`142_authenticated_site_reads.test.sql` adds 24 local authenticated RLS assertions for site metadata,
household membership, cross-household denial, UUID cursor pagination, empty households and revocation.
The tests reuse existing tables and policies; no migration or permission change is required.

**Phase 2:** `143_durable_tesla_oauth.test.sql` adds 22 assertions for RPC grants, current ADMIN authority, cross-household denial, scopes, approved origins and audit identity. The runner also checks single-use OAuth consumption across two PostgreSQL connections.

**Session/fencing follow-up:** `144_tesla_oauth_session_fencing.test.sql` adds 36 assertions covering
live/revoked/expired sessions, exact owner fencing, restart/expiry recovery, multiple ADMINs,
cross-household denial, grants, scopes and audit identity. The two-connection runner models an old save
committing after a client-visible failure, blocks a newer reconnect until that commit, rejects stale
saves, and serializes logout against pending persistence. No assertion is skipped on runner failure.

**Site onboarding:** `145_tesla_site_linking.test.sql` adds 49 assertions for provenance, sessions,
roles, tenant/key isolation, duplicate/retry/expiry handling, credential fencing, actor attribution and
unchanged controls. The strict authenticated-RPC allowlist in `100` adds exactly the two new scoped
RPCs; no old assertions are removed or generalized. Three real two-connection races supplement SQL
assertions. These results do not establish hosted Supabase/PostgREST or live Tesla behavior.


**Status: discovery refresh security tests implemented locally.** `146_tesla_discovery_refresh.test.sql`
adds 51 assertions covering precise grants, private ledger isolation, expired-token eligibility,
unchanged strict linking, durable ambiguity barriers, actual-user activation, audit/idempotency,
revocation, scope/region restrictions, logout, owner takeover, deadline and revision fencing.
The exhaustive authenticated-function allowlist is expanded by exactly the three new authenticated RPCs.
Real two-connection races run separately through the root database test runner.

**Status: expired READY regression coverage implemented locally.** The refresh SQL file now has 70
assertions, including terminalization/replay, ciphertext erasure, fixed reauthorization state and newer
OAuth preservation. The database runner also tests atomic installation rollback and 16 refresh races.
