# Database Setup

Status: **created in TASK-03, security added in TASK-04.** Tables (TASK-03) plus row level security policies, grants, audited functions and triggers (TASK-04). Design: [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md). Tables and columns: [`DATABASE_ER.md`](DATABASE_ER.md) and [`DATABASE_DICTIONARY.md`](DATABASE_DICTIONARY.md) (generated).

## What exists
Eleven migrations in `supabase/migrations/`, applied in file-name order (1 to 7: TASK-03 tables; 8 to 11: TASK-04 security):

| # | File | Contents |
|---|---|---|
| 1 | `20261023120000_create_extensions_and_helpers.sql` | `citext` and `btree_gist` (schema `extensions`), schema `private`, type `role_enum`, helper functions (timezone validation, append-only guards, `updated_at`, table lock-down) |
| 2 | `20261023120100_create_identity_tenancy_tables.sql` | `user_profiles`, `households`, `household_members`, `household_invitations`, `household_settings`, `system_bootstrap` |
| 3 | `20261023120200_create_sites_and_credentials_tables.sql` | `energy_sites`, `tesla_credentials`, `oauth_states` |
| 4 | `20261023120300_create_telemetry_tables.sql` | `powerwall_metrics_log`, `energy_intervals`, `telemetry_rollups_hourly`, `telemetry_rollups_daily`, `telemetry_sync_state`, `provider_usage_daily` |
| 5 | `20261023120400_create_tariff_tables.sql` | `utility_tariffs`, `tariff_seasons`, `tariff_overrides`, `tariff_slots`, `tariff_levies`, `tariff_price_points`, `cost_rollups_daily` |
| 6 | `20261023120500_create_command_and_automation_tables.sql` | `automation_rules`, `automation_executions`, `device_command_log`, `device_command_events` |
| 7 | `20261023120600_create_jobs_and_audit_tables.sql` | `scheduled_jobs`, `job_locks`, `audit_log` |
| 8 | `20261023130000_security_helpers.sql` | `pgcrypto`, `private.is_member`, `private.has_role_at_least`, allowlisted `private.touch_audit`, actor stamping, TRUNCATE guard, policy-aware `private.lock_down_public_tables()` |
| 9 | `20261023130100_membership_integrity_and_audit_triggers.sql` | Last-admin and no-self-role-change guard, tariff version immutability, audit triggers, append-only TRUNCATE guards |
| 10 | `20261023130200_identity_and_membership_functions.sql` | Auth trigger (profile only), invitation, membership, pause and rule-mode functions, `private.bootstrap_first_admin` |
| 11 | `20261023130300_rls_policies_and_grants.sql` | 52 policies and the explicit grants (see `RLS_POLICY_MATRIX.md`) |

29 tables in schema `public`. Migrations 8 to 11 need the Supabase roles `anon`, `authenticated` and `service_role` (they exist on every Supabase stack and in the test shim). Every migration is idempotent (`if not exists`, guarded `do` blocks) and starts with a comment naming how to roll it back for development. Never edit a migration after it is merged; add a new one.

`supabase/seed.sql` is local only: one household named `LOCAL SEED HOUSEHOLD (development only)` and two tariffs labelled `ILLUSTRATIVE EXAMPLE`. It has no users, credentials, Tesla data or telemetry, and it refuses to run on a database that has been bootstrapped.

## Default security posture
- Row level security is **enabled on every public table**. `PUBLIC` and `anon` have **no privileges** on any table, sequence or function. `authenticated` has only the privileges and 52 policies listed in [`RLS_POLICY_MATRIX.md`](RLS_POLICY_MATRIX.md); a table without a policy stays closed (`private.lock_down_public_tables()`, called at the end of every table migration, keeps policy-backed grants and revokes the rest). Default privileges that Supabase would otherwise grant to `anon`/`authenticated` on new tables and functions are revoked.
- Privileged changes (roles, membership, invitations, rule activation, pause) happen only through audited `SECURITY DEFINER` functions; the last ADMIN cannot be demoted or removed; nobody can change their own role. First admin: [`ADMIN_BOOTSTRAP.md`](ADMIN_BOOTSTRAP.md).
- The `service_role` keeps its default privileges except `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log` and `device_command_events`; only the Worker's server-side secret key uses it, and only in the documented cases (`SECURITY_MODEL.md` section 6).
- `tesla_credentials` holds encrypted ciphertext only (AES-256-GCM, 96-bit nonce, key id). Keys are never in the database.
- The `private` schema is not exposed through the API. `authenticated` can use it only to evaluate the two policy helpers; `anon` cannot use it.
- `powerwall_metrics_log`, `energy_intervals` and `energy_sites.provider` accept only `TESLA`: `DEMO` data cannot reach live tables (D-017).
- `device_command_log.kind` allows only the six Tesla endpoints that TASK-00 marked `DOCUMENTED` (still `UNVERIFIED` payloads, mock only). Forced charge, forced export, solar bypass and islanding are not representable.
- `device_command_events` and `audit_log` are append-only (trigger). Direct `UPDATE`/`DELETE` fails; deletes caused by foreign-key cascades (deleting a household or site) are allowed, and deleting a user nulls `audit_log.actor_user_id` without removing the row.
- A dry-run automation execution cannot be `ACTED` and cannot link a command (check constraint).

## Running it
### Verified here: temporary PostgreSQL 17
```bash
npm run db:verify       # starts a throwaway PostgreSQL 17 (embedded-postgres), runs every check, deletes it
npm run db:dictionary   # same, and regenerates docs/DATABASE_DICTIONARY.md
```
`db:verify` applies the migrations from an empty database, applies them again on top of themselves, resets and re-applies, applies the seed twice, checks that all 29 tables exist with RLS on and no access for `anon`/`authenticated`/`PUBLIC`, checks units and sign comments, and runs the constraint checks (each must succeed, or fail with the expected SQLSTATE). 106 checks in total at TASK-03. It takes a few minutes (server start-up dominates). It uses a small test-only shim (`scripts/db/local-shim.sql`) that creates `auth.users`, the roles `anon`/`authenticated`/`service_role` and Supabase's default table grants. The shim is not a migration and is never applied by the Supabase CLI.

```bash
npm run db:test         # same server: applies the migrations, runs supabase/tests/database/*.test.sql, checks the policy manifest
```
`db:test` runs 336 assertions in 11 files with `scripts/db/pgtap-lite.sql` (a small pgTAP look-alike, test only) on top of the same shim, which also provides `auth.uid()`. See `supabase/tests/README.md`.

### Not verified here: the real Supabase stack
Docker, `psql` and the Supabase CLI were not available on the machine that wrote these migrations, so `supabase db reset` is `NOT_EXECUTED`. On a machine with Docker:
```bash
npm run db:reset       # npx supabase@2.122.0 db reset: applies migrations, then seed.sql
npx supabase@2.122.0 test db   # runs supabase/tests/database with real pgTAP (NOT_EXECUTED so far)
```
`supabase/config.toml` was written by hand and has not been loaded by the CLI (`UNVERIFIED`); fix any key the CLI rejects and record it. Things the real stack may expose that plain PostgreSQL cannot: the real `auth.users` definition, extension placement, and Supabase's own default privileges.

## Design notes and deviations from `DATABASE_DESIGN.md`
These are flagged in the TASK-03 handoff. In short: composite foreign keys keep child rows in the same household as their site; equal-priority overlapping tariff overrides are rejected in the database; `household_settings` has table-level checks for spend cap, on-demand interval and staleness; `scheduled_jobs.household_id` was added; the extra descending index on `powerwall_metrics_log` was dropped because the unique key already serves range scans in both directions.

## Left to later tasks
- Not done in TASK-04 (see KNOWN_LIMITATIONS L-031, L-032): immutability of tariff child rows, an audited household-deletion function.
- Done in TASK-05: generated database types (`npm run db:types`; see `docs/DOMAIN_TYPES.md` section 6 and L-038).
- TASK-10/11: tariff engine checks that cannot be constraints (full-day coverage, season validation, `ALL` versus `WEEKDAY`/`WEEKEND` slot overlap).
- TASK-16: `claim_jobs`, `acquire_lock`, `release_lock`, `record_provider_call` and the retention deletes.
