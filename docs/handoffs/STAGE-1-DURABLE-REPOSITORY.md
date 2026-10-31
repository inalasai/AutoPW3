# TASK NOT COMPLETE — Stage 1 Durable Application Repository and Runtime Integration

## Task completed
Number and name: Stage 1 — Durable Application Repository and Runtime Integration (incomplete)
Branch / commit: `cloudflare-deployment` / `5661d2be1f694eaee600c0ae78e2f2f1da0f8725`
Date: 2026-10-31

## Summary
The current Worker dependency map and blockers are documented in `docs/DURABLE_RUNTIME_STAGE1_AUDIT.md`. Process-local API/cron mocks now require explicit test or local configuration, and staging/production continue to fail closed. The durable application repository and transaction-safe idempotency were not implemented because the existing service-role RPC set cannot preserve actor authorization or atomically couple idempotency with every business mutation. This task is not complete.

## Files created
| Path | Purpose |
|---|---|
| `docs/DURABLE_RUNTIME_STAGE1_AUDIT.md` | Runtime dependency map, current in-memory boundaries, and exact repository/idempotency blockers. |
| `docs/handoffs/STAGE-1-DURABLE-REPOSITORY.md` | Incomplete task handoff and next steps. |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/worker/src/env.ts` | Added the explicit `LOCAL_MOCKS` binding. |
| `apps/worker/src/lib/app.ts` | Reject API requests from non-local environments that would otherwise fall through to process-local defaults; keep staging/production blocked. |
| `apps/worker/src/index.ts` | Restrict process-local scheduled execution to local/test, with explicit `LOCAL_MOCKS=true`. |
| `apps/worker/src/index.test.ts` | Cover explicit local mock opt-in and non-local fail-closed behavior. |
| `apps/worker/wrangler.jsonc` | Enable local mocks only in the top-level local environment; explicitly disable them in staging/production. |
| `.env.example` | Document the local-only mock flag. |
| `apps/worker/README.md`, `apps/worker/src/db/README.md` | Correct storage and fail-closed status. |
| `docs/README.md`, `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | Index the audit, record the fail-closed decision, and append the repository/idempotency limitation. |

## Decisions
D-115 records why the API and cron remain disabled until tenant-safe repository operations and transaction-safe idempotency exist. It also limits process-local mocks to explicit local/test operation.

## Database changes
None. No hosted or local migration was applied or added in this stage.

## API changes
No endpoint contract changed. API paths in staging/production remain unavailable. Other non-local environments without complete explicitly injected dependencies fail closed instead of using process-local defaults.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run typecheck` | yes | Passed | All workspaces and e2e typecheck. |
| `npm run lint` | yes | Passed | Architecture rules and Prettier passed. |
| `npm run test --workspace @autopw3/worker -- --pool=threads --maxWorkers=1 --configLoader native` | yes | Passed | 23 files, 180 tests. |
| `npm test` | yes | Failed in sandbox | Vite startup `spawn EPERM` while resolving workspace configs. |
| `npm run db:verify` | yes | Passed | PostgreSQL 17.10, 15 migrations, 30 design tables, all database checks passed on a throwaway local instance. |
| `npm run db:test` | yes | Passed | 463 assertions across 17 files; concurrent claims, overlapping scheduler calls, and 52-policy manifest passed. |
| `npm run secrets:scan` | yes | Passed | Secretlint exited successfully. |
| `npm run build` | yes | Passed | Web build and Wrangler `--dry-run`; warnings for unspecified deploy target and large client chunk. No deployment. |

## Manual verification
Confirmed current branch and commit, reviewed the runtime constructors and `Repository` interface, and read the stash list without modifying it. No hosted Supabase or Cloudflare access was used.

## Acceptance criteria
| Criterion | Status (VERIFIED / MOCK_ONLY / NOT_EXECUTED / FAILED) | Evidence |
|---|---|---|
| Durable application repository exists | NOT_EXECUTED | `InMemoryRepository` remains the only implementation. |
| Durable idempotency exists | NOT_EXECUTED | Current get/dispatch/set process-local implementation remains. |
| Staging/production runtime selects durable adapters | NOT_EXECUTED | No complete durable application dependency set exists; deploy paths remain blocked. |
| No in-memory production fallback remains | VERIFIED | Staging/production remain hard blocked; other non-local API calls without injected dependencies return unavailable; cron rejects non-local environments. |
| Tenant isolation is tested for the durable repository | NOT_EXECUTED | No durable repository exists to test. |
| Missing configuration fails closed | MOCK_ONLY | Runtime guard tests cover local/preview and existing staging/production fail-closed behavior. |
| Existing tests continue to pass | MOCK_ONLY | Worker suite passes; root suite is blocked by sandbox `spawn EPERM`. |

## Verification status register
Worker unit tests and local static checks are `VERIFIED`. Database and build outcomes are recorded in the final report. Hosted Supabase and Cloudflare behavior remain `NOT_EXECUTED`.

## Outstanding issues
- Implement all `Repository` operations against existing tables with explicit tenant scoping and transaction-safe multi-row behavior.
- Add narrow server-only actor-aware RPCs where existing authenticated functions rely on `auth.uid()`; validate roles and household membership inside each wrapper.
- Couple idempotency with each mutation transaction or use an already-idempotent business operation. A generic lease alone cannot safely recover from a crash between mutation commit and result persistence.
- Wire durable repository, token, OAuth, idempotency, rate-limit and job adapters only after the above are complete; add runtime-level tenant and concurrency tests.

## Environment variables
`LOCAL_MOCKS` is a non-secret local-only binding. `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `TOKEN_ENCRYPTION_KEY` remain Worker configuration/secrets as documented; they were not read or exposed in the report.

## Instructions for the next task
Continue on `cloudflare-deployment` without disturbing the pre-existing dirty workspace. Reuse the interfaces in `apps/worker/src/db/repository.ts`, `apps/worker/src/lib/idempotency.ts`, and the existing `public.worker_*` service-only wrappers. Preserve the staging/production fail-closed guard until the full durable runtime and operation-level idempotency are covered by database and Worker tests.

## Next task
Implement the Supabase repository in bounded vertical slices, starting with identity/membership and household/site reads, then mutation-specific actor-aware RPCs and idempotency in the same SQL transactions. Do not enable API/cron until the entire route dependency set has a durable implementation and tenant isolation tests pass.
