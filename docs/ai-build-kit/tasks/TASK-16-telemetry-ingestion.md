# TASK 16 — Telemetry Ingestion and Historical Sync

**Phase 4 · Backend and Tesla.**

## Goal
Persist genuine normalised telemetry and rollups, and move the dashboard from demo mode to live data safely.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, Tesla adapter and mock (Task 15), Worker API (Task 14), schema (Task 03), telemetry model (Task 08), `docs/TELEMETRY_MODEL.md`, `docs/handoffs/TASK-15.md`.

## Stop conditions
- Provider cannot supply a resolution you planned for: store what is available; never fabricate.
- Any path where `DEMO` data could reach live tables: stop and fix first.

## Plan step
Describe scheduling hooks, the sync state machine, dedup/late-data strategy and the rollup approach.

## Requirements
- Separate **live status retrieval** from **historical synchronisation**; both are independent of rule evaluation and token maintenance.
- Discover and validate the selected site; respect configured polling cadence and rate limits.
- Normalise units and signs; timestamps in UTC; store source and quality metadata.
- Idempotent upserts keyed by site and timestamp; handle late and out-of-order samples; partial responses accepted with quality flags.
- Bounded backfills with resumable cursors in `telemetry_sync_state`; per-site failure isolation; recorded sync outcomes (success, partial, failed, reason).
- Stale detection with a configurable freshness threshold, surfaced to the API and UI.
- Compute and refresh hourly/daily rollups (including late-data recomputation) using the accounting units; rollups record resolution and completeness.
- Indexed, range-bounded queries only.
- Retention job per the design (purge or aggregate old raw samples, if specified), dry-run first.
- Dashboard mode transition: configuration/DB flag per site with clear UI state: `DEMO` → `CONNECTING` → `LIVE` / `STALE` / `ERROR`. Demo data is never merged into live views. Document the exact procedure.
- Sanitised logging; no payload dumps.

## Out of scope
Commands, automation.

## Deliverables
Ingestion modules, rollup logic, new migration files if needed, tests with fake clock and mock adapter, `docs/TELEMETRY_OPERATIONS.md`.

## Required tests
Duplicate samples; late/out-of-order; missing fields; partial responses; stale detection; failed sync and recovery after outage; rate-limit backoff; backfill resume; per-site isolation; rollup correctness and late-data recomputation; demo rejection in live tables; DST day rollups.

## Verification
Type check, lint, tests, build, migration apply (report real results). Run an ingestion pass against the mock adapter into a local database if available.

## Acceptance criteria
- With authorised credentials configured, real provider responses can be normalised and persisted without sample data contamination (proven with mocks; live marked `UNVERIFIED` until run).
- Re-running the same sync produces no duplicates.
- The UI shows true freshness and resolution.

## Repo locations
Branch: `task-16-telemetry-ingestion`. Commit prefix: `task-16:`. Write to: `apps/worker/src/services/ingestion`, `supabase/migrations/`, `docs/TELEMETRY_OPERATIONS.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-16.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-16.md`.
