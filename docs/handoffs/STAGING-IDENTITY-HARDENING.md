# AutoPW3 — Task Handoff Report

## Task completed
Number and name: Staging identity audience and credential redirect hardening
Branch / commit: `Raj-AutoPW3` / base `9a6ca9c937940407bf31de91a1417aba4fdd939b`; all changes uncommitted for final review
Date: 2026-10-31

## Summary
Closed the audience-validation gap identified in the focused staging identity review. Staging requires audience `authenticated` with strict string/array shape validation, and rejected tokens cannot reach privileged rate limiting or user PostgREST reads. Both database transports now reject redirects, with real local HTTP tests proving that redirected destinations receive no requests and errors/logs do not expose synthetic credentials. All existing uncommitted staging slice work was preserved; no deployment flag, credentials, route/cron guard or database permissions changed.

## Files created
| Path | Purpose |
|---|---|
| `apps/worker/src/db/redirects.test.ts` | Real HTTP 301/302/303/307/308 regression cases for authenticated PostgREST and privileged RPC, with destination counters and credential/error/log checks. |
| `docs/handoffs/STAGING-IDENTITY-HARDENING.md` | This follow-up handoff; the original staging slice report is preserved. |

## Files modified
These are changes in this follow-up, on top of the existing uncommitted slice.

| Path | What changed and why |
|---|---|
| `apps/worker/src/lib/jwt.ts` | Optional expected audience in verification configuration; JOSE recipient matching plus complete claim-shape validation. Callers without an audience constraint retain prior behavior. |
| `apps/worker/src/lib/staging-identity.ts` | Pass fixed expected audience `authenticated` before constructing or calling the privileged limiter and user repository. |
| `apps/worker/src/lib/jwt.test.ts` | Correctly typed matching audiences, missing/wrong/malformed claims, mixed arrays and legacy caller compatibility. |
| `apps/worker/src/lib/staging-identity.test.ts` | Positive fixtures include audience; invalid audiences fail before database access; redirect failures return sanitized errors without logs. |
| `apps/worker/src/db/postgrest.ts` | Set `redirect: 'error'` for authenticated GET/PATCH/RPC requests. |
| `apps/worker/src/db/supabase-rpc.ts` | Set `redirect: 'error'` for privileged RPC requests. |
| `apps/worker/src/db/postgrest.test.ts` | Assert redirect rejection policy while retaining credential-separation assertions. |
| `apps/worker/src/db/README.md` | Document redirect policy and local HTTP regressions. |
| `apps/worker/src/lib/README.md` | Document staging audience policy and opt-in shared behavior. |
| `docs/DECISIONS.md` | Append D-118 for the two approved hardening changes. |
| `docs/KNOWN_LIMITATIONS.md` | Append L-133 distinguishing local hardening tests from hosted verification. |
| `docs/handoffs/README.md` | Link this handoff. |

## Decisions
D-118: Staging supplies an expected audience to the shared verifier. Accept `authenticated` as a string or within a nonempty array containing only nonempty strings. Reject missing, null, numeric, empty, unrelated, nested and mixed-type audience claims. Explicit shape checking is necessary because JOSE audience matching alone can accept a mixed-type array containing the expected recipient. Existing callers without an audience requirement keep their prior behavior.

Both credential-bearing database transports reject all HTTP redirects through Fetch's `error` policy; existing timeout and sanitized error behavior remains intact. No modern `sb_secret_` support was introduced, and the staging limiter retains its existing legacy `service_role` JWT requirement.

## Database changes
None. No SQL tests, migrations, grants, RLS policies or RPC authorization rules changed in this follow-up. The requested SQL security harness ran only against temporary local PostgreSQL.

## API changes
Enabled staging `/me` requests with invalid/missing audiences now return 401 before any rate-limit or PostgREST operation. Redirect failures return the existing sanitized 502 availability error through the staging API; no destination URL, credentials or redirect response body is exposed. Production, cron, all other staging routes and the disabled-by-default flag retain their previous guards.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run test --workspace @autopw3/worker -- --configLoader native --pool threads --maxWorkers 4` | yes | PASS | All 295 Worker tests in 29 files passed. Includes audience denial before database calls, interleaved actor isolation, existing route/cron guards, all shared-adapter consumers, and ten real HTTP redirect cases. |
| `npm run typecheck` | yes | PASS | All workspaces plus e2e TypeScript checks passed. |
| `npm run lint` | yes | PASS | ESLint, architecture rules and Prettier passed. |
| `npm run db:test` | yes | PASS | Temporary PostgreSQL 17.10, 16 migrations, 494 assertions across 19 files, zero failures, both concurrency checks passed and the 52-policy manifest matched. |
| `npm run secrets:scan` | yes | PASS | No secret findings. |
| `git diff --check` | yes | PASS | No whitespace errors. |

No failures occurred in this follow-up's verification runs. The native config loader and thread pool use the successful invocation from the prior slice, avoiding the previously observed default-loader Windows `spawn EPERM`; tests and isolation were not weakened. The full web/domain/shared test suites, hosted verification, deployment and production build were not run for this scoped change.

## Manual verification
Confirmed the only runtime caller supplying an audience constraint is the staging handler, which uses a fixed value and derives issuer/JWKS from the configured project. Both transports retain their separate credential sources and reject redirects before a second HTTP request can be made. The real HTTP tests use two loopback servers and synthetic credentials; the initial server receives one request while the destination receives zero. Responses and console log/warn/error calls are checked for credential disclosure. No real credentials were inspected or used.

## Acceptance criteria
| Criterion | Status (VERIFIED / MOCK_ONLY / NOT_EXECUTED / FAILED) | Evidence |
|---|---|---|
| Staging requires the intended audience and rejects malformed arrays | VERIFIED | Signed raw-claim fixtures exercise missing/wrong/numeric/empty/nested/mixed audiences and valid string/array audiences. |
| Rejected tokens cannot reach privileged or user database operations | VERIFIED | Entrypoint assertions allow only JWKS requests before the 401 response. |
| Other shared-verifier callers remain compatible | VERIFIED | Explicit unconstrained-caller regression and full Worker suite pass. |
| Both database transports reject redirects without reaching the destination | VERIFIED | Real local HTTP tests for five redirect statuses per transport; destination counters remain zero. |
| Credentials stay out of errors, responses and logs | VERIFIED | Transport errors and staging responses inspected; no console log/warn/error calls in exercised failure paths. |
| Feature and production/cron/route guards preserved | VERIFIED | Existing guard matrix passes; no flag/configuration or scheduled-handler changes. |
| Actual hosted Supabase and Cloudflare behavior | NOT_EXECUTED | Tests are local Node HTTP, mocked gateway/Worker requests and temporary PostgreSQL only. |

## Verification status register
Local Worker tests, TypeScript, lint, secret scan and PostgreSQL security assertions: VERIFIED. HTTP redirect rejection: VERIFIED with real local Node Fetch. Hosted Supabase, real user JWTs and deployed Cloudflare runtime: NOT_EXECUTED. This does not establish production readiness.

## Outstanding issues
- Hosted staging verification remains required before enabling the flag in a deployed environment.
- Modern opaque secret-key support remains explicitly out of scope and unsupported by this staging configuration.
- The broader durable application repository, transaction-safe mutation idempotency and scheduled handlers remain incomplete as recorded in the original slice handoff.

## Environment variables
No bindings or credentials changed. `STAGING_IDENTITY_READ_ENABLED` remains absent from Wrangler deployment configuration and false in the existing example file. Audience `authenticated` is a fixed staging call-site requirement, not a caller-controlled request parameter or new environment variable.

## Instructions for the next task
Perform the final review of the accumulated uncommitted changes. Preserve the opt-in audience constraint, full audience type validation, redirect error policies, credential separation and existing route/cron guards. Do not enable flags, apply hosted migrations, deploy, commit or push without the user's next authorization.

## Next task
Final review of this hardening and the existing staging identity slice, then separately authorized isolated hosted verification. No hosted action is authorized by this handoff.
