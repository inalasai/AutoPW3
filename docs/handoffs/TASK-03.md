# AutoPW3 — Task Handoff Report

## Task completed
Number and name: TASK-03 PostgreSQL schema and migrations
Branch / commit: `Raj-AutoPW3` (owner chose to work on this branch instead of `task-03-database-schema`); commits prefixed `task-03:`. Not pushed. No PR opened.
Date: 2026-10-23

## Summary
The versioned Supabase PostgreSQL schema from `docs/DATABASE_DESIGN.md` now exists as 7 ordered, idempotent migrations that create 29 tables. Every table has row-level security enabled and all access revoked from `PUBLIC`, `anon` and `authenticated`; there are no policies yet (TASK-04). A local-only seed, an ER diagram, a setup guide and a generated data dictionary (units and signs) were added. The migrations were applied, re-applied and reset on a real PostgreSQL 17.10 through `npm run db:verify`. They were **not** run on a real Supabase stack (see Outstanding issues).

## Files created
| Path | Purpose |
|---|---|
| `supabase/migrations/20261023120000_create_extensions_and_helpers.sql` | Extensions (`citext`, `btree_gist`), `role_enum`, `private` schema, helper functions (`validate_timezone`, `touch_updated_at`, append-only triggers, `lock_down_public_tables`) |
| `supabase/migrations/20261023120100_create_identity_tenancy_tables.sql` | `user_profiles`, `households`, `household_members`, `household_invitations`, `household_settings`, `system_bootstrap` |
| `supabase/migrations/20261023120200_create_sites_and_credentials_tables.sql` | `energy_sites`, `tesla_credentials`, `oauth_states` |
| `supabase/migrations/20261023120300_create_telemetry_tables.sql` | `powerwall_metrics_log`, `energy_intervals`, hourly and daily rollups, `telemetry_sync_state`, `provider_usage_daily` |
| `supabase/migrations/20261023120400_create_tariff_tables.sql` | `utility_tariffs`, `tariff_seasons`, `tariff_overrides`, `tariff_slots`, `tariff_levies`, `tariff_price_points`, `cost_rollups_daily` |
| `supabase/migrations/20261023120500_create_command_and_automation_tables.sql` | `automation_rules`, `automation_executions`, `device_command_log`, `device_command_events` |
| `supabase/migrations/20261023120600_create_jobs_and_audit_tables.sql` | `scheduled_jobs`, `job_locks`, `audit_log` |
| `supabase/seed.sql` | Local-only seed: one labelled household and two `ILLUSTRATIVE EXAMPLE` tariffs; no users, credentials or telemetry; refuses to run if `system_bootstrap` has a row |
| `supabase/config.toml` | Hand-written local config, `UNVERIFIED` (never loaded by the Supabase CLI) |
| `scripts/db-verify.mjs` | Verification harness on embedded PostgreSQL 17 (apply, re-apply, reset, snapshot compare, privilege checks, unit/sign comment checks, constraint checks); `--dictionary` regenerates the dictionary |
| `scripts/db/local-shim.sql` | Test-only stand-in for `auth.users`, Supabase roles and default grants. Never used by real migrations |
| `docs/DATABASE_SETUP.md` | How to apply, reset and verify |
| `docs/DATABASE_ER.md` | Mermaid ER diagram |
| `docs/DATABASE_DICTIONARY.md` | Generated data dictionary: 29 tables, columns, types, units, signs, comments |
| `docs/handoffs/TASK-03.md` | This report |

## Files modified
| Path | What changed and why |
|---|---|
| `package.json`, `package-lock.json` | Scripts `db:verify`, `db:dictionary`, `db:reset`; exact-pinned devDependencies `embedded-postgres`, `pg`, `@types/pg` (D-029) |
| `.github/workflows/ci.yml` | Added the `npm run db:verify` step (not yet run on GitHub) |
| `supabase/README.md`, `docs/README.md`, `docs/DEVELOPMENT_SETUP.md`, `AGENTS.md` | Status lines, commands and folder contents brought up to date |
| `docs/DECISIONS.md` | Appended D-029, D-030 and a formatting-repair note (see below) |
| `docs/KNOWN_LIMITATIONS.md` | Appended L-026 to L-030 |
| `docs/ai-build-kit/00-README.md` | TASK-03 ticked in the progress tracker |

**Defect repair (documented, not a rewrite of history):** while checking my own earlier appends I found that a PowerShell escaping fault had stripped inline backticks and turned `` `t `` and `` `n `` into tabs and newlines in the TASK-01 approval record, D-025 to D-028 and L-021 to L-025, all written by this agent in TASK-02 (for example "typescript" displayed as a tab plus "ypescript"). I restored the original wording and recorded this in `docs/DECISIONS.md`. D-001 to D-024 and L-001 to L-020 were not touched. A scan of all changed text files for control characters and tabs in Markdown now returns zero.

## Decisions
- **D-029** Database verification without Docker through embedded PostgreSQL 17.
- **D-030** Ten schema choices and deviations from `DATABASE_DESIGN.md`, all made to enforce existing rules in the database: composite foreign keys keep child rows in one household, site or tariff; equal-priority override overlap constraint; `household_settings` table-level checks; `scheduled_jobs.household_id`; no redundant descending index; six `DOCUMENTED` command kinds only; dry-run executions can never be `ACTED` or link a command; extra integrity checks; append-only trigger rules that still allow foreign-key cascades; timezone validation against `pg_timezone_names`. **Owner review of these deviations is requested.**

## Database changes
- 7 migrations, 29 tables in `public`, helper functions in schema `private`, extensions in schema `extensions`.
- Role type `public.role_enum` (`READ_ONLY`, `READ_WRITE`, `ADMIN`); `household_members.role` has **no default** (the default role is chosen by invitation/bootstrap logic in TASK-04).
- `private.lock_down_public_tables()` runs at the end of every migration: enables RLS on every `public` table and revokes `PUBLIC`, `anon` and `authenticated` privileges on tables and sequences. Supabase default privileges are also revoked. **No policies, no grants, no auth triggers, no bootstrap functions** (TASK-04).
- Sign and unit rules: telemetry columns end in `_w`, `_wh`, `_percent` or `_count`; power column comments state the sign (solar ≥ 0, battery > 0 discharging, grid > 0 importing). Checked by `db:verify`.
- Live-table safety: `source = 'TESLA'` check on `powerwall_metrics_log` and `energy_intervals`, and `energy_sites.provider`; `DEMO` is rejected.
- Money and rates are `numeric` with explicit scale; currency columns on tariffs. Times are `timestamptz` with IANA timezone validation on sites and tariffs.
- Exclusion constraints (`btree_gist`): tariff effective-date overlap, slot overlap, equal-priority override overlap, price-point overlap. What cannot be expressed is listed in L-028 and left to the tariff engine.
- `tesla_credentials`: encrypted columns only, 12-byte nonce check, `https` base URL check, not readable by `anon` or `authenticated`.

## API changes
None.

## Checks executed
| Exact command | Executed? | Result | Relevant output/failure |
|---|---|---|---|
| `npm run check` (typecheck, lint with Prettier and lint-rule proofs, tests, build, `secrets:scan`) | yes | exit 0 | Tests passed in all workspaces (4, 3, 5 and 4 tests in the four test runs); wrangler dry-run build succeeded; secretlint clean |
| `npm run db:verify` | yes | exit 0 | "All database checks passed" on PostgreSQL 17.10 (the previous full run listed 106 `ok` checks). Covers: apply, apply again, reset and re-apply with schema snapshot comparison; seed applied twice and bootstrap guard; 29 required tables; RLS on; no `anon`/`authenticated`/`PUBLIC` privileges; units and sign comments; about 90 constraint checks including invalid role, percent outside 0–100, duplicate sample, `DEMO` in live table, tariff overlaps, cross-household references, dry-run safety, append-only audit and cascade behaviour |
| `npm run db:dictionary` | yes | exit 0 | Regenerated `docs/DATABASE_DICTIONARY.md` (29 tables) |
| `npm run db:reset` (`supabase db reset`) | **NOT_EXECUTED** | n/a | No Docker or Supabase CLI. Command: `npm run db:reset` on a machine with Docker running |
| Load `supabase/config.toml` in the Supabase CLI | **NOT_EXECUTED** | n/a | `npx --yes supabase@2.122.0 start` |
| CI workflow on GitHub (Linux, Node 22) | **NOT_EXECUTED** | n/a | Needs a push |

## Manual verification
Read the generated dictionary against `DATABASE_DESIGN.md` table by table; confirmed the 29 tables and that every task-required table is present. Checked every changed Markdown file for control characters.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Migrations apply from a clean database without errors | VERIFIED on PostgreSQL 17.10 with a test shim; `NOT_EXECUTED` on a real Supabase stack | `db:verify` apply, re-apply, reset |
| Every design table exists; every telemetry column has a unit | VERIFIED | `db:verify` table list and unit-name check; dictionary |
| Constraints reject invalid roles, percentages outside 0–100, duplicate samples and `DEMO` in the live table | VERIFIED | named `db:verify` checks |
| Migrations apply twice cleanly (reset and re-apply) | VERIFIED (embedded PostgreSQL) | snapshot comparison in `db:verify` |
| RLS enabled and public access revoked; no policies | VERIFIED | `db:verify` privilege checks |
| Seed is local-only, labelled, no credentials | VERIFIED | `seed.sql` review, secretlint, bootstrap guard check |
| Deliverables: migrations, seed, `DATABASE_SETUP.md`, `DATABASE_ER.md`, data dictionary | VERIFIED (files exist) | see Files created |

**TASK NOT COMPLETE** is not claimed, but the criterion "clean local Supabase" is only met on plain PostgreSQL 17 plus a shim. The real-stack run must be done before TASK-04 relies on Supabase-specific behaviour.

## Verification status register
- Schema constraints and idempotency: VERIFIED (PostgreSQL 17.10 only).
- `supabase db reset`, `supabase/config.toml`, CI on GitHub: UNVERIFIED / NOT_EXECUTED (L-026, L-027).
- Tesla command payloads in `device_command_log`: UNVERIFIED, mock-only (L-029).
- Supabase signing and API key style: UNVERIFIED (Q-13).

## Outstanding issues
- Real Supabase stack run needed (owner machine with Docker): `npm run db:reset`, then `npm run db:verify`.
- No branch `task-03-database-schema` and no PR (the owner chose to stay on `Raj-AutoPW3`).
- `docs/HowToBuild.docx` is untracked and was deliberately not committed.
- Owner review requested for D-030 deviations.
- L-028: constraints left to the tariff engine.

## Environment variables
None added. `SUPABASE_SECRET_KEY` and `SUPABASE_ANON_KEY` remain as in `docs/CREDENTIALS.md`.

## Instructions for the next task
TASK-04 must reuse: the 29 tables listed in `docs/DATABASE_DICTIONARY.md`; the `private` schema and its helpers (`lock_down_public_tables`, `validate_timezone`, `touch_updated_at`, append-only triggers); `role_enum`. Add policies and grants only in **new** migrations (never edit these 7) and call `private.lock_down_public_tables()` semantics in mind: it revokes everything, so each grant must be explicit. `household_members.role` has no default and `system_bootstrap` exists for the first-admin flow. `tesla_credentials` must stay unreadable by `anon` and `authenticated`. Reuse `scripts/db-verify.mjs` and `scripts/db/local-shim.sql` for quick checks, but TASK-04 pgTAP tests should run against a real Supabase stack.

## Next task
TASK-04 RLS, grants, admin bootstrap and SQL security tests. Prerequisite: this report accepted; ideally one real `supabase db reset` run.
