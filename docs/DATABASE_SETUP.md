# Database Setup

Status: **created in TASK-03.** Schema only; row level security policies, grants and database functions are TASK-04. Design: [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md). Tables and columns: [`DATABASE_ER.md`](DATABASE_ER.md) and [`DATABASE_DICTIONARY.md`](DATABASE_DICTIONARY.md) (generated).

## What exists
Seven migrations in `supabase/migrations/`, applied in file-name order:

| # | File | Contents |
|---|---|---|
| 1 | `20261023120000_create_extensions_and_helpers.sql` | `citext` and `btree_gist` (schema `extensions`), schema `private`, type `role_enum`, helper functions (timezone validation, append-only guards, `updated_at`, table lock-down) |
| 2 | `20261023120100_create_identity_tenancy_tables.sql` | `user_profiles`, `households`, `household_members`, `household_invitations`, `household_settings`, `system_bootstrap` |
| 3 | `20261023120200_create_sites_and_credentials_tables.sql` | `energy_sites`, `tesla_credentials`, `oauth_states` |
| 4 | `20261023120300_create_telemetry_tables.sql` | `powerwall_metrics_log`, `energy_intervals`, `telemetry_rollups_hourly`, `telemetry_rollups_daily`, `telemetry_sync_state`, `provider_usage_daily` |
| 5 | `20261023120400_create_tariff_tables.sql` | `utility_tariffs`, `tariff_seasons`, `tariff_overrides`, `tariff_slots`, `tariff_levies`, `tariff_price_points`, `cost_rollups_daily` |
| 6 | `20261023120500_create_command_and_automation_tables.sql` | `automation_rules`, `automation_executions`, `device_command_log`, `device_command_events` |
| 7 | `20261023120600_create_jobs_and_audit_tables.sql` | `scheduled_jobs`, `job_locks`, `audit_log` |

29 tables in schema `public`. Every migration is idempotent (`if not exists`, guarded `do` blocks) and starts with a comment naming how to roll it back for development. Never edit a migration after it is merged; add a new one.

`supabase/seed.sql` is local only: one household named `LOCAL SEED HOUSEHOLD (development only)` and two tariffs labelled `ILLUSTRATIVE EXAMPLE`. It has no users, credentials, Tesla data or telemetry, and it refuses to run on a database that has been bootstrapped.

## Default security posture
- Row level security is **enabled on every public table with no policies**, and `PUBLIC`, `anon` and `authenticated` have **no privileges** on any table or sequence (`private.lock_down_public_tables()`, called at the end of every migration). Default privileges that Supabase would otherwise grant to `anon`/`authenticated` on new tables are revoked.
- The `service_role` is untouched; only the Worker's server-side secret key uses it, and only in the documented cases (`SECURITY_MODEL.md` section 6).
- `tesla_credentials` holds encrypted ciphertext only (AES-256-GCM, 96-bit nonce, key id). Keys are never in the database.
- The `private` schema is not exposed to the API roles.
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

### Not verified here: the real Supabase stack
Docker, `psql` and the Supabase CLI were not available on the machine that wrote these migrations, so `supabase db reset` is `NOT_EXECUTED`. On a machine with Docker:
```bash
npm run db:reset       # npx supabase@2.122.0 db reset: applies migrations, then seed.sql
```
`supabase/config.toml` was written by hand and has not been loaded by the CLI (`UNVERIFIED`); fix any key the CLI rejects and record it. Things the real stack may expose that plain PostgreSQL cannot: the real `auth.users` definition, extension placement, and Supabase's own default privileges.

## Design notes and deviations from `DATABASE_DESIGN.md`
These are flagged in the TASK-03 handoff. In short: composite foreign keys keep child rows in the same household as their site; equal-priority overlapping tariff overrides are rejected in the database; `household_settings` has table-level checks for spend cap, on-demand interval and staleness; `scheduled_jobs.household_id` was added; the extra descending index on `powerwall_metrics_log` was dropped because the unique key already serves range scans in both directions.

## Left to later tasks
- TASK-04: policies, grants, `private.is_member` and role functions, bootstrap, invitations, auth trigger, last-admin and no-self-role-change triggers, pgTAP tests (`npm run db:test`).
- TASK-05: generated database types (`npm run db:types`).
- TASK-10/11: tariff engine checks that cannot be constraints (full-day coverage, season validation, `ALL` versus `WEEKDAY`/`WEEKEND` slot overlap).
- TASK-16: `claim_jobs`, `acquire_lock`, `release_lock`, `record_provider_call` and the retention deletes.
