# TASK 03 — PostgreSQL Schema and Migrations

**Phase 1 · Foundation.** Schema only. RLS policies and security tests are Task 04.

## Goal
Implement the versioned Supabase PostgreSQL schema that matches `docs/DATABASE_DESIGN.md`.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, `docs/DATABASE_DESIGN.md`, `docs/SECURITY_MODEL.md`, `docs/ENERGY_ACCOUNTING.md`, `docs/handoffs/TASK-02.md`, the repo.

## Stop conditions
- The design document is ambiguous or inconsistent with Task 01 decisions: stop and list the conflicts.

## Plan step
List every table with columns, keys, constraints and indexes, plus anything you propose adding. Wait for no approval, but flag deviations from the design doc.

## Required tables
`user_profiles`, `households`, `household_members` (holds the role), `household_invitations`, `energy_sites`, `utility_tariffs` (versioned, effective-dated), `tariff_slots`, `tariff_overrides` (if the design calls for it), `automation_rules`, `automation_executions`, `powerwall_metrics_log`, `telemetry_rollups_hourly`, `telemetry_rollups_daily`, `telemetry_sync_state`, `tesla_credentials`, `device_command_log` (with idempotency key), `job_locks` (or whatever Task 01 chose), `audit_log`.

Add any other supporting tables the design needs.

## Requirements
- UUID primary keys; foreign keys with sensible `ON DELETE` behaviour.
- `numeric` for rates and money; explicit scale. Currency columns on tariffs.
- Timestamps `timestamptz` (UTC). Store IANA timezone on sites and tariffs, validated by a check or reference table.
- Telemetry columns named with units (`solar_power_w`, `battery_power_w`, `grid_power_w`, `load_power_w`, `battery_soc_percent`), with the sign convention documented in column comments. Include `source` (`TESLA`, `DEMO` rejected for live table via check constraint), `quality` and `recorded_at`.
- Unique constraints preventing duplicate samples per site and timestamp; indexes for time-range queries; partitioning only if the design chose it.
- Enum or check constraints for roles, command states, rule modes (`DISABLED`, `DRY_RUN`, `ACTIVE`) and tariff directions.
- Tariff windows: check constraints for valid times; overlap prevention where practical in the database (exclusion constraints) and otherwise documented as validated in the engine.
- Safe, idempotent migrations in order, with comments and rollback notes.
- Local-only seed data, clearly labelled, never containing real credentials.
- Do **not** write RLS policies or grants beyond a safe default of enabling RLS and revoking public access. Detailed policies are Task 04.

## Out of scope
Policies, functions for admin bootstrap, auth triggers (Task 04), application code.

## Deliverables
`supabase/migrations/*.sql`, `supabase/seed.sql`, `docs/DATABASE_SETUP.md`, an ER diagram (Mermaid) in `docs/DATABASE_ER.md`, and a data dictionary listing units and signs.

## Verification
Apply migrations to a clean local Supabase (or Postgres) and report the real result. Confirm they apply twice cleanly from scratch (reset and re-apply). If no local instance is available, state `NOT_EXECUTED` and provide the exact commands.

## Acceptance criteria
- Migrations apply from a clean database without errors.
- Every table in the design exists; every telemetry column has a unit.
- Constraints reject invalid roles, percentages outside 0–100, duplicate samples and `DEMO` data in the live table.

## Repo locations
Branch: `task-03-database-schema`. Commit prefix: `task-03:`. Write to: `supabase/migrations/`, `supabase/seed.sql`, `docs/DATABASE_SETUP.md`, `docs/DATABASE_ER.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-03.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-03.md`. Task 04 needs the migrations, table list and data dictionary.
