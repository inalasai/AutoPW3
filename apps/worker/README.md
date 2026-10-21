# apps/worker — Cloudflare Worker

**Status:** not started (skeleton in TASK-02, API in TASK-14).

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
| `src/providers/tesla/` | OAuth, adapter, capability registry, mock | 15 |
| `src/services/tokens/` | Encryption and refresh | 15 |
| `src/services/ingestion/` | Live and historical sync, rollups | 16 |
| `src/services/commands/` | Command lifecycle | 17 |
| `src/services/automation/` | Scheduler, rules, locks | 18 |

## Rules
- Authenticate every protected route; load role and household from the database; never trust client claims.
- Prefer user-scoped database access so RLS applies. Every service-role use is documented in `docs/API_OPERATIONS.md`.
- Tesla-specific types never leave `providers/tesla`; normalise at that boundary.
- Never log tokens, JWTs or telemetry payloads. Never return secrets.
- Commands only for capabilities marked supported; idempotency key required; never report success without confirmation.
- Automation defaults to dry-run; dry-run never calls control endpoints.

## Configuration and secrets
Local: `apps/worker/.dev.vars` (git-ignored). Production: Cloudflare secrets. Variable list in [`../../.env.example`](../../.env.example); handling rules in [`../../docs/CREDENTIALS.md`](../../docs/CREDENTIALS.md).

## Tests
Unit and API tests as `*.test.ts` beside code, using a fake clock and the mock Tesla adapter. Never run live control tests automatically. See [`../../docs/TESTING.md`](../../docs/TESTING.md).
