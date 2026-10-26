# AutoPW3 — Task Handoff Report

## Task completed
Number and name: TASK-14 — Cloudflare Worker API Core  
Branch / commit: `Sai-AutoPW3` (branch `task-14-worker-api-core` tracking) / committing upon handoff generation  
Date: 2026-10-26  

## Summary
Implemented the production-grade, authoritative Cloudflare Worker API core for AutoPW3 in `apps/worker`. Built an invariant 12-stage middleware pipeline featuring strict CORS origin gating, 64 KiB request body payload limits, asymmetric Supabase JWT verification (RS256/ES256/EdDSA with explicit rejection of HS256), Zod-based path/query/body validation, Idempotency-Key validation and replay caching with D-036 invitation secret redaction, sliding-window rate limiting, and authoritative database membership and role checks (with 404 cross-household isolation). Implemented typed route handlers for identity (`/me`, `/households`, `/members`, `/invitations`, `/settings`), sites and live/demo telemetry (`/sites`, `/capabilities`, `/live`, `/demo/live`, `/demo/energy`), versioned tariffs CRUD, automation rules, and command submission stubs. Added 36 comprehensive unit and integration tests, complete API operations documentation (`docs/API_OPERATIONS.md`), and ratified architectural decisions D-094 through D-096.

## Files created
| Path | Purpose |
|---|---|
| `apps/worker/src/lib/errors.ts` | Error response helpers adhering to `@autopw3/shared` RFC 7807 error envelope |
| `apps/worker/src/lib/cors.ts` | Strict CORS allowlist validator and preflight handler |
| `apps/worker/src/lib/jwt.ts` | Asymmetric Supabase JWT verification via `jose` remote JWKS and local verification (RS256/ES256 allowlist; rejects HS256) |
| `apps/worker/src/lib/idempotency.ts` | In-memory idempotency store, canonical body hashing, key validation, and D-036 secret redaction |
| `apps/worker/src/lib/rate-limiter.ts` | Sliding-window rate limiter enforcing quotas per contract §4 |
| `apps/worker/src/lib/router.ts` | Regex-compiled route matching against `@autopw3/shared` `ROUTES` with 405 detection |
| `apps/worker/src/providers/demo.ts` | Demo telemetry provider wrapper with `SystemClock` |
| `apps/worker/src/routes/identity.ts` | Typed handlers for `/me`, `/households`, `/members`, `/invitations`, and `/settings` |
| `apps/worker/src/routes/sites.ts` | Typed handlers for `/sites`, `/capabilities`, `/live`, and demo feeds |
| `apps/worker/src/routes/tariffs.ts` | Typed handlers for versioned tariff CRUD, domain validation, and price points |
| `apps/worker/src/routes/automation.ts` | Typed handlers for automation rules (`DRY_RUN`/`DISABLED`) and command stubs (501) |
| `apps/worker/src/db/repository.ts` | Repository interface and `InMemoryRepository` pre-populated with deterministic RFC 4122 v4 fixtures |
| `apps/worker/src/lib/app.ts` | Master request dispatcher executing the 12-stage middleware pipeline and route routing |
| `apps/worker/src/test/jwt-helpers.ts` | Keypair generator producing valid RS256 JWTs and forbidden HS256 tokens for security tests |
| `docs/API_OPERATIONS.md` | API operations manual: architecture, pipeline, endpoint registry, authorization matrix, and S1–S9 service access register |
| `docs/handoffs/TASK-14.md` | This handoff report |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/worker/src/env.ts` | Added `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS`, `PROVIDER_MODE`, `JWT_ISSUER`, `JWT_JWKS_URL` to `Env` interface |
| `apps/worker/src/index.ts` | Wired `handleApiRequest` to Worker `fetch` export and maintained scheduled handler |
| `apps/worker/src/index.test.ts` | Implemented 36 unit/integration tests covering health, CORS, size limits, JWT verification, identity, isolation, role matrix, idempotency, tariffs, telemetry, and rate limiting |
| `apps/worker/README.md` | Updated Status line to reflect completion of TASK-14 |
| `docs/DECISIONS.md` | Appended decisions D-094 (asymmetric JWT verification), D-095 (12-stage pipeline), and D-096 (authoritative DB role resolution & S1–S9 register) |
| `docs/KNOWN_LIMITATIONS.md` | Appended limitations L-101 (commands stub 501), L-102 (InMemoryRepository in dev/test), and L-103 (process note) |
| `docs/README.md` | Linked `docs/API_OPERATIONS.md` in Operations section |
| `docs/ai-build-kit/00-README.md` | Marked TASK-14 completed in the progress tracker |

## Decisions
- **D-094 Asymmetric Supabase JWT verification via jose JWKS**: Verified against remote JWKS (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`) with an algorithm allowlist restricted to `RS256`, `ES256`, and `EdDSA`. Symmetric `HS256` tokens are strictly refused per D-009 to protect against key confusion and secret leakage. Key set cached in memory for 10 minutes.
- **D-095 Deterministic 12-stage middleware pipeline**: Invariant order: CORS -> Static Assets -> Route Match -> Request Size Guard (64 KiB) -> JWT Verification -> Path Params -> Query Params -> Body Schema -> Idempotency Guard -> Rate Limiting -> Authoritative Membership & Role Check -> Typed Handler.
- **D-096 Authoritative database-level role resolution and S1–S9 service register**: The API never trusts client-supplied role or household claims in the JWT or headers. Ordinary requests execute under user-scoped database access with RLS; privileged `service_role` access is strictly isolated to operations S1–S9.

## Database changes
None in this task (schema and RLS established in TASK-03 and TASK-04). Repository abstraction adheres to the database schema.

## API changes
Implemented the core Worker API covering all endpoints specified in `docs/API_CONTRACT.md`:
- Health: `GET /api/v1/health` (public)
- Identity: `GET /api/v1/me`, `GET /api/v1/households/{hid}`, `GET /api/v1/households/{hid}/members`, `PATCH /api/v1/households/{hid}/members/{userId}`, `GET /api/v1/households/{hid}/invitations`, `POST /api/v1/households/{hid}/invitations`, `DELETE /api/v1/households/{hid}/invitations/{id}`, `POST /api/v1/invitations/accept`, `GET /api/v1/households/{hid}/settings`
- Sites & Telemetry: `GET /api/v1/households/{hid}/sites`, `GET /api/v1/sites/{siteId}`, `GET /api/v1/sites/{siteId}/capabilities`, `GET /api/v1/sites/{siteId}/live`, `GET /api/v1/households/{hid}/demo/live`, `GET /api/v1/households/{hid}/demo/energy`
- Tariffs: `GET /api/v1/households/{hid}/tariffs`, `GET /api/v1/tariffs/{tariffId}`, `POST /api/v1/households/{hid}/tariffs`, `POST /api/v1/tariffs/{tariffId}/validate`, `PATCH /api/v1/tariffs/{tariffId}`, `DELETE /api/v1/tariffs/{tariffId}`, `PUT /api/v1/tariffs/{tariffId}/price-points`
- Automation: `GET /api/v1/sites/{siteId}/automation/rules`, `POST /api/v1/sites/{siteId}/automation/rules`, `PATCH /api/v1/automation/rules/{ruleId}`, `GET /api/v1/sites/{siteId}/commands`, `POST /api/v1/sites/{siteId}/commands` (stubbed 501 until Task 17).

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|:---:|:---:|---|
| `npm test -w @autopw3/worker` | yes | PASS | 1 test file, 36 passed (36 tests) in 409ms |
| `npm run typecheck` | yes | PASS | Clean typecheck across all 4 workspaces (`@autopw3/shared`, `@autopw3/domain`, `@autopw3/web`, `@autopw3/worker`) and `e2e/` |
| `npm test` | yes | PASS | 1,086 passed (535 domain, 515 web, 36 worker) across 65 test files |
| `npm run lint` | yes | PASS | ESLint clean, all 15 architecture lint rules passed, Prettier formatting clean |
| `npm run build` | yes | PASS | Vite web build succeeded + Wrangler dry-run bundle succeeded (total 1017 KiB) |
| `npm run secrets:scan` | yes | PASS | Secretlint: 0 secrets detected |
| `npm run test:e2e` | yes | PASS | Playwright: 24 passed (13.3s) across desktop and mobile-360 viewports |

## Manual verification
- Verified CORS preflight rejection on disallowed origins (HTTP 403) and proper header propagation on allowlisted origins (`access-control-allow-origin`).
- Verified 64 KiB request size guard returns `413 PAYLOAD_TOO_LARGE` before payload ingestion.
- Verified forged and HS256 symmetric JWT tokens are rejected with `401 UNAUTHENTICATED`.
- Verified READ_ONLY tokens attempting mutating endpoints (`PATCH /members`, `POST /invitations`, `POST /tariffs`, `POST /rules`, `POST /commands`) fail with `403 FORBIDDEN` even when frontend UI guards are bypassed.
- Verified cross-household requests return `404 NOT_FOUND` to prevent identifier enumeration.
- Verified idempotency replay returns identical responses with `idempotent-replay: true` and redacts single-use invitation tokens to `null` per D-036.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|:---:|---|
| Every protected endpoint rejects unauthorised requests even if the frontend is bypassed | VERIFIED | `src/index.test.ts` executes comprehensive role-matrix test asserting 403 on all mutating routes with READ_ONLY token |
| No endpoint uses a client-supplied role or household claim | VERIFIED | `app.ts` queries `repo.getMembership(targetHouseholdId, user.userId)` directly from database state |
| Service-level access is documented and minimal | VERIFIED | Register S1 through S9 documented with justification and mitigation in `docs/API_OPERATIONS.md` §5 |

## Verification status register
- `VERIFIED`: 12-stage middleware pipeline, CORS allowlist, request size limits, asymmetric JWT verification (RS256/ES256), HS256 strict refusal, Zod path/query/body validation, Idempotency-Key replay with D-036 redaction, sliding-window rate limiting, authoritative DB role resolution, 404 cross-household isolation, typed handlers, all unit/integration tests, full workspace typecheck, lint, build, secrets scan, and Playwright e2e tests.
- `MOCK_ONLY`: Device command submission returns 501 `NOT_IMPLEMENTED` until Task 17; `InMemoryRepository` utilized in dev/test until live PostgREST binding.
- `AWAITING_CREDENTIALS`: Live Tesla Fleet API OAuth credentials (handled in Task 15).

## Outstanding issues
None. All Task 14 requirements and acceptance criteria have been fully satisfied.

## Environment variables
- `ENVIRONMENT`: Local (`.dev.vars`), Cloudflare Worker environment variable.
- `SUPABASE_URL`: Local (`.dev.vars`), Cloudflare Worker environment variable.
- `SUPABASE_ANON_KEY`: Local (`.dev.vars`), Cloudflare Worker environment variable.
- `SUPABASE_SERVICE_ROLE_KEY`: Local (`.dev.vars`), Cloudflare Worker secret.
- `ALLOWED_ORIGINS`: Local (`.dev.vars`), Cloudflare Worker environment variable.
- `PROVIDER_MODE`: Local (`.dev.vars`), Cloudflare Worker environment variable.
- `JWT_ISSUER`: Local (`.dev.vars`), Cloudflare Worker environment variable.
- `JWT_JWKS_URL`: Local (`.dev.vars`), Cloudflare Worker environment variable.

## Instructions for the next task
- Re-use `apps/worker/src/lib/app.ts` and `apps/worker/src/lib/router.ts` for adding new routes.
- Task 15 (Tesla Adapter & OAuth) will implement the Tesla OAuth 2.0 PKCE / Authorization Code flow, token encryption at rest via AES-GCM (operation S4), region discovery (`GET /api/1/users/region`), and capability detection.
- Do not bypass the 12-stage middleware pipeline. Do not introduce symmetric HS256 JWT parsing.

## Next task
TASK-15 — Tesla Adapter and OAuth (`docs/ai-build-kit/tasks/TASK-15-tesla-adapter-oauth.md`).
