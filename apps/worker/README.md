# apps/worker — Cloudflare Worker

**Status:** Staging/production API and cron remain fail-closed because a complete PostgreSQL application repository, transaction-safe durable idempotency and production job handlers are not implemented or wired. In-memory API and cron mocks require `ENVIRONMENT=local` with `LOCAL_MOCKS=true` (tests use `ENVIRONMENT=test`). Durable job, token, OAuth and rate-limit adapters exist but are not selected by the Worker entry point. Live deployment is blocked. Test results are recorded in the current task handoff.

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
