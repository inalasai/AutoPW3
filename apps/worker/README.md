# apps/worker — Cloudflare Worker

**Status:** Production API and staging/production cron remain fail-closed. Staging has independent disabled-by-default identity, OAuth and manual live-status exceptions. The identity gate: `STAGING_IDENTITY_READ_ENABLED=true` permits only durable `GET /api/v1/me` and its GET-only preflight. It uses authenticated PostgREST and the durable rate limiter, requires stored identity data, and has no legacy fallback. A separate `STAGING_TESLA_OAUTH_ENABLED=true` gate permits only ADMIN-authorized read-only OAuth connect, POST-only preflight and the state-authenticated callback. It uses the existing encrypted Supabase stores, explicit NA/EU audience and atomic state consumption. Other staging API routes remain blocked until their durable dependencies and transaction-safe mutation idempotency are implemented. In-memory API and cron mocks require `ENVIRONMENT=local` with `LOCAL_MOCKS=true` (tests use `ENVIRONMENT=test`). Live deployment is blocked; hosted behavior remains unverified. See `docs/handoffs/STAGING-IDENTITY-READ.md` for this slice's verification results.

## Purpose
The trusted backend: authenticated API, Tesla adapter, token handling, telemetry ingestion, device commands and scheduled automation. Enforces authorisation independently of the front end.

## Where code goes
| Path | Content | Task |
|---|---|---|
| `src/index.ts` | `fetch` and `scheduled` entry points | 02 |
| `src/routes/` | One file per resource; admin routes in `routes/admin` | 14, 19 |
| `src/middleware/` | CORS, size limits, auth, role, validation, rate limit, request ID | 14 |
| `src/db/` | User-scoped and (justified) service clients | 14 |
| `src/lib/` | Errors, redacting logger, config | 14 |
| `src/providers/demo/` | Demo telemetry provider | 14 |
| `src/providers/tesla/` | OAuth, adapter, capability registry, mock. `raw-types.ts` (TASK-05) holds the loose, `UNVERIFIED` raw Tesla shapes and the `NormaliseLiveStatus` boundary type | 05, 15 |
| `src/services/tokens/` | Encryption and refresh | 15 |
| `src/services/tokens/supabase-store.ts` | Encrypted PostgREST-backed Tesla credential and durable OAuth state stores; available for wiring after repository adapters | Durable Job Processing |
| `src/services/ingestion/` | Live and historical sync, rollups | 16 |
| `src/services/jobs/` | Supabase durable job queue adapter and bounded executor; production handlers await durable domain adapters | Durable Job Processing |
| `src/services/commands/` | Command lifecycle | 17 |
| `src/services/automation/` | Scheduler, rules, locks | 18 |

## Rules
- Production, staging and preview must never use process-local repository, token, OAuth state, idempotency or rate-limit state. API and cron remain fail-closed until the complete durable stack is wired.
- Authenticate every protected route; load role and household from the database; never trust client claims.
- Prefer user-scoped database access so RLS applies. Every service-role use is documented in `docs/API_OPERATIONS.md`.
- Tesla-specific types never leave `providers/tesla`; normalise at that boundary.
- Never log tokens, JWTs or telemetry payloads. Never return secrets.
- Commands only for capabilities marked supported; idempotency key required; never report success without confirmation.
- Automation defaults to dry-run; dry-run never calls control endpoints.
- Job claims and lifecycle changes use service-role-only `public.worker_*` RPCs. Production cron stays disabled until durable repository and encrypted token handlers are wired.
- Process-local stores require the explicit local-only binding `LOCAL_MOCKS=true`; staging and production set it to `false`.

## Configuration and secrets
Local: `apps/worker/.dev.vars` (git-ignored). Production: Cloudflare secrets. Variable list in [`../../.env.example`](../../.env.example); handling rules in [`../../docs/CREDENTIALS.md`](../../docs/CREDENTIALS.md).

## Tests
Unit and API tests as `*.test.ts` beside code, using a fake clock and the mock Tesla adapter. Never run live control tests automatically. See [`../../docs/TESTING.md`](../../docs/TESTING.md).

## Phase 3 manual live-status slice
**Status:** `STAGING_TESLA_LIVE_STATUS_ENABLED=true` separately permits only staging GET/GET-only OPTIONS at `/api/v1/households/{householdId}/sites/{siteId}/provider/tesla/live-status`. All three household roles may read an authorized persisted site. It uses RLS site reads, existing encrypted credentials and durable per-actor rate limiting; no telemetry writes, demo fallback, refresh or command execution. Native Tesla signs are explicitly labelled and absent measurements/timestamps remain null. The flag is false in the example and absent from Wrangler. See [Phase 3 handoff](../../docs/handoffs/PHASE-3-TESLA-LIVE-STATUS.md).
# Portable local configuration

Status: `.dev.vars.example` needs no credentials for local mocks. `wrangler.developer.example.jsonc`
is a complete portable example to copy to an ignored private override and rename for your own account.
The committed staging Worker name is a developer placeholder; do not target the existing team Worker.
Mock provider/live-status-off are preserved. See [developer setup](../../docs/DEVELOPER_SETUP.md).
