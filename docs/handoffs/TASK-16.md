# AutoPW3 — Task Handoff Report

## Task completed
Number and name: TASK-16 Telemetry Ingestion and Historical Sync
Branch / commit: `Sai-AutoPW3`
Date: 2026-10-26

## Summary
Telemetry ingestion pipelines for live status polling and historical energy sync have been implemented and separated. All readings are normalised into strict SI/project units and sign conventions (D-006) with zero tolerance for DEMO data reaching live tables. The historical sync engine implements resumable cursor backfills (`lastCompletedIntervalEnd`), per-site failure isolation, and hourly and daily rollup computations that handle local calendar DST transitions (23h, 24h, 25h). The API routes for live status, power series, energy series, and financial costs are mounted, and the Cloudflare scheduled cron dispatcher coordinates token maintenance, polling, history sync, rollups, and 90-day/30-day retention with dry-run support.

## Files created
| Path | Purpose |
|---|---|
| `supabase/migrations/20261026120000_create_job_and_usage_functions.sql` | Postgres functions for job claiming (`SKIP LOCKED`), lease locking, and atomic provider usage accounting |
| `apps/worker/src/services/ingestion/types.ts` | Sync state, rollup, fetch, and retention type definitions |
| `apps/worker/src/services/ingestion/live-fetcher.ts` | Live telemetry fetcher with sign normalisation, freshness evaluation, and connection state transitions |
| `apps/worker/src/services/ingestion/live-fetcher.test.ts` | Unit & integration tests for live status ingestion and state transitions (6 tests) |
| `apps/worker/src/services/ingestion/historical-sync.ts` | Historical energy sync engine with resumable cursors, per-site failure isolation, and duplicate deduplication |
| `apps/worker/src/services/ingestion/historical-sync.test.ts` | Unit & integration tests for calendar history sync and cursors (5 tests) |
| `apps/worker/src/services/ingestion/rollups.ts` | Rollup engine for UTC hourly buckets and DST-aware site-local calendar days |
| `apps/worker/src/services/ingestion/rollups.test.ts` | Unit & integration tests for hourly rollups, completeness, DST (23h/25h), and late data recomputation (4 tests) |
| `apps/worker/src/services/ingestion/retention.ts` | Retention cleanup service for raw power samples (>90 days) and completed jobs (>30 days) with dryRun support |
| `apps/worker/src/services/ingestion/retention.test.ts` | Unit tests for retention purging and dry-run safety (2 tests) |
| `apps/worker/src/services/ingestion/dispatcher.ts` | Scheduled cron dispatcher coordinating all 5 background jobs |
| `apps/worker/src/routes/telemetry.ts` | Worker route handlers for `/live`, `/power`, `/energy`, and `/costs` |
| `apps/worker/src/routes/telemetry.test.ts` | Integration tests for telemetry endpoints and household isolation (5 tests) |
| `docs/TELEMETRY_OPERATIONS.md` | Comprehensive operational guide for telemetry ingestion, sync, rollups, and retention |
| `docs/handoffs/TASK-16.md` | This task handoff report |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/worker/src/db/repository.ts` | Added telemetry methods to `Repository` interface and `InMemoryRepository` (power samples, intervals, rollups, sync state, usage tracking, purging) |
| `apps/worker/src/lib/app.ts` | Wired telemetry routes (`/sites/:siteId/live`, `/power`, `/energy`, `/costs`) and scheduled dispatcher |
| `apps/worker/src/index.ts` | Connected `scheduled(controller, env, ctx)` handler to cron dispatcher |
| `apps/worker/src/providers/tesla/mock-adapter.ts` | Added optional `timestampProvider` to `MockTeslaClient` for deterministic testing |
| `docs/DECISIONS.md` | Appended decisions D-100, D-101, D-102 |
| `docs/KNOWN_LIMITATIONS.md` | Appended limitations L-107, L-108, L-109 |
| `docs/ai-build-kit/00-README.md` | Updated progress checklist to mark TASK-16 complete |

## Decisions
- **D-100 Resumable cursor-based telemetry ingestion with per-site failure isolation**: Decouples live status retrieval from calendar sync, tracks cursors per site, and isolates failures to prevent cross-household sync blockage.
- **D-101 DST-aware site-local calendar day rollup computation**: Enforces whole UTC hours for hourly rollups and computes daily rollups over local calendar days respecting 23h, 24h, and 25h DST days.
- **D-102 Scheduled cron dispatcher and batched retention with dry-run support**: Dispatches background tasks and executes 90-day/30-day retention with dry-run mode.

## Database changes
- Created migration `20261026120000_create_job_and_usage_functions.sql`:
  - `private.claim_jobs(p_worker_id, p_max_jobs, p_lease_seconds)`: Atomic claim using `FOR UPDATE SKIP LOCKED`.
  - `private.acquire_lock(p_lock_key, p_owner_id, p_lease_seconds)`: Concurrency lock acquisition with lease expiration.
  - `private.release_lock(p_lock_key, p_owner_id)`: Safe lock release by current owner.
  - `private.record_provider_call(p_household_id, p_category, p_is_success)`: Atomic upsert of daily provider call counters.
  - Revoked all execute privileges from `PUBLIC`, `anon`, `authenticated`; granted exclusively to `service_role`.

## API changes
- `GET /api/v1/sites/{siteId}/live`: Returns live reading or fetches fresh reading with connection status.
- `GET /api/v1/sites/{siteId}/power`: Returns bounded power sample series (`from`, `to`, `limit`).
- `GET /api/v1/sites/{siteId}/energy`: Returns energy series with `raw`, `hourly`, or `daily` rollups and completeness.
- `GET /api/v1/sites/{siteId}/costs`: Computes financial costs over daily or monthly granularity with exact decimal arithmetic.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run typecheck` | yes | PASSED | Strict TypeScript pass across all workspaces (`shared`, `domain`, `web`, `worker`) and `e2e` |
| `npm run lint` | yes | PASSED | ESLint, architecture rules, and Prettier formatting clean across entire repo |
| `npm test` | yes | PASSED | 1,378 unit and integration tests passing across all packages |
| `npm run build` | yes | PASSED | Web build (Vite client) + Worker deploy dry-run bundle clean |
| `npm run secrets:scan` | yes | PASSED | Secretlint 0 violations |
| `npm run db:verify` | yes | PASSED | Migrations and table constraints verified 100% on Postgres 17 |
| `npm run db:dictionary` | yes | PASSED | Regenerated `docs/DATABASE_DICTIONARY.md` |
| `npm run db:test` | yes | PASSED | 336 ok, 0 not ok across 11 pgTAP test files |
| `npm run test:e2e` | yes | PASSED | 24 Playwright tests passed across desktop and mobile-360 viewports |

## Manual verification
- Verified live status sign normalisation: Tesla -1200 W maps to +1200 W battery discharging.
- Verified DEMO source rejection in repository methods throws invariant error.
- Verified daily rollups across DST spring forward (23h) and fall back (25h) produce exact duration and completeness metrics.
- Verified retention `dryRun: true` returns candidate counts without mutating records.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Live status polling independent of history sync | VERIFIED | Implemented in separate services (`live-fetcher.ts`, `historical-sync.ts`) |
| Strict sign normalisation (D-006) | VERIFIED | `normaliseLiveStatus` and test suites verify signs |
| Zero tolerance for DEMO in live tables | VERIFIED | Database CHECK constraints + domain `acceptForLiveIngestion` |
| Resumable cursors on history sync | VERIFIED | `historical-sync.test.ts` proves resumption from last completed interval |
| Per-site failure isolation | VERIFIED | `historical-sync.test.ts` proves failing site does not block valid sites |
| Rollup computation handles DST | VERIFIED | `rollups.test.ts` tests 23h and 25h DST days |
| Bounded telemetry queries | VERIFIED | Query parameters enforce max limits and ISO time bounds |
| Retention purge with dryRun | VERIFIED | `retention.test.ts` verifies both dryRun and real purge |

## Verification status register
- `VERIFIED`: Ingestion logic, rollups, sign conversion, retention, DB functions, tests.
- `AWAITING_CREDENTIALS`: Live Tesla Fleet API credentials for end-to-end production testing against physical Powerwall 3.

## Outstanding issues
- None.

## Environment variables
- `TOKEN_ENCRYPTION_KEY`: Cloudflare Worker secret (AES-256-GCM key).
- `SUPABASE_SECRET_KEY`: Cloudflare Worker secret for service-role database operations.
- `TESLA_CLIENT_ID` / `TESLA_CLIENT_SECRET`: Cloudflare Worker secrets for Tesla Fleet API.

## Instructions for the next task
- Task 17 (Device Controls) must use:
  - `POST /api/v1/sites/{siteId}/commands` route.
  - `DeviceCommandLog` table and `device_command_events` append-only audit trail.
  - The 6 documented Tesla control endpoints: `SET_BACKUP_RESERVE`, `SET_OPERATION_MODE`, `SET_GRID_IMPORT_EXPORT`, `SET_STORM_MODE`, `SET_OFF_GRID_VEHICLE_CHARGING_RESERVE`, `SET_TIME_OF_USE_SETTINGS`.
  - Reconcile commands via read-back rather than trusting HTTP 200 alone (D-015).
  - Enforce READ_WRITE / ADMIN role checks; READ_ONLY is strictly blocked from issuing commands.

## Next task
TASK-17 — Device Controls (Phase 5: Controls and operations).
Prerequisites satisfied: Ingestion, telemetry models, and Tesla adapter are complete.
