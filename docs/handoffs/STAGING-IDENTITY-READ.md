# AutoPW3 — Task Handoff Report

## Task completed
Number and name: Staging durable identity read vertical slice
Branch / commit: `Raj-AutoPW3` / base `9a6ca9c937940407bf31de91a1417aba4fdd939b`; changes uncommitted for review
Date: 2026-10-31

## Summary
Added one disabled-by-default staging exception for exact `GET /api/v1/me` and its GET-only CORS preflight. The actual Worker fetch path builds authenticated identity reads and durable rate limiting without selecting any legacy dependency or idempotency cache. The slice requires a stored profile, validates response identity/shape, and returns sanitized failures. Production, every other staging API route and scheduled handlers retain their existing deployment guards. Local implementation and checks are complete; hosted verification has not been performed.

## Files created
| Path | Purpose |
|---|---|
| `apps/worker/src/lib/staging-identity.ts` | Staging gate, strict configuration, narrow preflight, real JWT verification, isolated limiter and authenticated repository construction, sanitized errors. |
| `apps/worker/src/lib/staging-identity.test.ts` | Actual Worker entrypoint tests with signed JWTs and mocked JWKS/PostgREST HTTP; concurrent actor isolation, route containment, configuration and failure coverage. |
| `apps/worker/src/lib/jwt.test.ts` | Missing-expiration regression and valid/expired-token checks for the shared verifier. |
| `supabase/tests/database/141_staging_identity_read.test.sql` | Twelve local RLS assertions for profile reads and the membership/household join, including cross-household denials and users with no memberships. |
| `docs/handoffs/STAGING-IDENTITY-READ.md` | This handoff and verification boundary. |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/worker/src/lib/app.ts` | Return through the staging slice before the existing deployment guard and legacy dependency selection. No broad injected dependency reaches the new path. |
| `apps/worker/src/lib/jwt.ts` | Add `requiredClaims: ['exp']`; signed authenticated JWTs without expiration now fail the documented verification contract. |
| `apps/worker/src/routes/identity.ts` | Narrow the read dependency to two methods; optional strict persisted-profile/response validation used only by the staging slice. Existing local behavior is preserved. |
| `apps/worker/src/env.ts` | Declare the staging-only opt-in flag and correct the environment-label comment. |
| `.env.example` | Document the flag with value `false`. No deployed binding or credential was changed. |
| `apps/worker/README.md`, `apps/worker/src/lib/README.md`, `apps/worker/src/db/README.md` | Describe the narrow staging exception and remaining deployment restrictions. |
| `supabase/tests/database/README.md` | Describe the new RLS regression scope. |
| `docs/DECISIONS.md` | Append D-117, the approved narrow exception to D-115/D-116. |
| `docs/KNOWN_LIMITATIONS.md` | Append L-132 for hosted verification and privileged credential limitations. |
| `docs/handoffs/README.md` | Link this handoff. |

## Decisions
D-117: Only staging with `STAGING_IDENTITY_READ_ENABLED=true` can reach this exact GET and its narrowly scoped preflight. The remaining application repository and mutation idempotency are not dependencies of this read. Missing configuration fails closed; `LOCAL_MOCKS=true` is rejected. Query parameters cannot select an actor, household or rate-limit bucket. An `Idempotency-Key` header never causes response replay or storage for this GET.

Before implementation, inspection confirmed that `worker_check_rate_limit` is SECURITY DEFINER and granted only to `service_role`; anon and authenticated users cannot execute it. It does not depend on `auth.uid()`. The limiter alone receives the service credential; identity reads receive the public key and exact verified user JWT. The existing privileged transport sends its key as a bearer JWT, so this slice requires a legacy `service_role` JWT and rejects opaque `sb_secret_` keys. Public reads accept a legacy anon JWT or publishable key. Key classification is configuration validation only; Supabase authenticates the keys. See [official API key guidance](https://supabase.com/docs/guides/getting-started/api-keys).

The shared JWT verifier had one runtime caller (`app.ts`); all existing test-token helpers already supply expiration. The added staging path calls the same verifier with issuer/JWKS derived from the configured Supabase project, and cannot use injected JWT test keys. Requiring expiration intentionally tightens shared authentication; the existing API and admin regression tests passed.

## Database changes
No migration, schema, grant or RPC changes. Reuse the hardened profile policy, household/membership RLS, existing identity repository methods, and `public.worker_check_rate_limit`. The new SQL file operates inside a rolled-back fixture transaction on the local harness. No hosted database was contacted.

## API changes
Exact `GET /api/v1/me` may return persisted identity in explicitly enabled staging. A missing profile returns `404 NOT_FOUND`; an empty membership list remains valid. Database authentication/permission failures return sanitized 401/403; configuration, limiter and other database failures return 502 `PROVIDER_UNAVAILABLE`; denied rate limits return 429 with `Retry-After`. Responses use `Cache-Control: no-store` and generated request IDs. GET does no business mutation. Preflight is unauthenticated, requires an allowed HTTPS Origin and requested method GET, permits only the listed request headers, and performs no outbound request. All other deployment API paths and cron remain blocked.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run test --workspace @autopw3/worker -- src/lib/staging-identity.test.ts src/lib/jwt.test.ts src/index.test.ts src/db/postgrest.test.ts src/db/identity-repository.test.ts src/lib/rate-limiter.test.ts src/routes/identity.test.ts src/routes/admin.test.ts` | yes | STARTUP BLOCKED | Default Vite config loader hit Windows sandbox `spawn EPERM` in `optimizeSafeRealPathSync` while invoking `net use`; no tests ran with this invocation. |
| `npm run test --workspace @autopw3/worker -- --configLoader native --pool threads src/lib/staging-identity.test.ts src/lib/jwt.test.ts src/index.test.ts src/db/postgrest.test.ts src/db/identity-repository.test.ts src/lib/rate-limiter.test.ts src/routes/identity.test.ts src/routes/admin.test.ts` | yes | PASS | Final run: 126 tests in eight files. Native Node config loading and thread workers ran the existing and new assertions without altering tests or dependency files. |
| `npm run typecheck` | yes | PASS | All workspaces and e2e TypeScript checks. |
| `npm run lint` | yes | PASS | ESLint, architecture rule checks and Prettier. |
| `npm run db:test` | yes | PASS | Throwaway PostgreSQL 17.10; 16 migrations applied; 494 SQL assertions across 19 files; zero failed assertions; two concurrency checks passed; 52-policy matrix matched. |
| `npm run secrets:scan` | yes | PASS | No secret findings. |
| `git diff --check` | yes | PASS | No whitespace errors. |

The full application test suite, `npm run build` and `npm run db:verify` were not run for this limited slice. No schema or production deployment configuration changed.

## Manual verification
Traced `index.ts.fetch` through `app.ts` to the staging branch, JWT verification, rate limiting, authenticated transport and the two identity reads. Confirmed the branch returns before generic dependency selection, injected repositories, idempotency handling and provider construction. The shared JWT cache contains public verification material only. Confirmed `index.ts`, Wrangler configuration and deployment workflow were not modified.

## Acceptance criteria
| Criterion | Status (VERIFIED / MOCK_ONLY / NOT_EXECUTED / FAILED) | Evidence |
|---|---|---|
| Exact staging opt-in, GET route, narrow preflight and deployment containment | VERIFIED | Entrypoint route/method matrix, flag tests, production and cron denial tests. |
| Request-local user JWT and actor filtering | MOCK_ONLY | Interleaved actual Worker fetch calls use signed JWTs and mocked HTTP; headers, filters and responses remain isolated. |
| Privileged rate limiting separated from user reads | MOCK_ONLY | Outbound HTTP assertions restrict service credentials to the limiter RPC; local SQL verifies grants. |
| Local RLS household/profile/join isolation | VERIFIED | New twelve-assertion regression plus the existing SQL security suite passed. |
| Missing configuration/profile and backend failures fail closed | VERIFIED | Positive and negative entrypoint tests; missing profile is 404; no fallback or cached replay. |
| Required JWT expiration with existing API regressions | VERIFIED | New verifier/entrypoint tests and existing API/admin tests passed. |
| Real hosted Supabase/Cloudflare integration | NOT_EXECUTED | No hosted migration, deployment or external credential use authorized for this implementation task. |

## Verification status register
Local TypeScript/lint/secrets: VERIFIED. Worker assertions: VERIFIED with mocked HTTP. Local PostgreSQL security: VERIFIED. Real Supabase JWT gateway, PostgREST embedding and Cloudflare: NOT_EXECUTED. This is not production readiness.

## Outstanding issues
- Hosted staging must verify actual credentials, asymmetric JWT signing/JWKS, PostgREST relationship embedding, effective RLS and binding configuration before enabling the feature in a deployed environment.
- The existing privileged RPC transport supports bearer JWT service-role credentials; opaque secret-key headers need a separately reviewed transport change.
- Settings, mutations, providers, other repository domains and durable scheduled handlers remain outside this slice. Production and all other staging APIs remain unavailable.
- The default Vitest config loader remains blocked in this sandbox; use the recorded native-loader/thread command here. No dependency or global tooling workaround was installed.

## Environment variables
`STAGING_IDENTITY_READ_ENABLED`: non-secret Worker binding, absent by default; example file sets false. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`, `ALLOWED_ORIGINS`: required for this staging slice. `LOCAL_MOCKS=true` is rejected. Optional JWT issuer/JWKS overrides must match the configured project exactly. `APP_BASE_URL`, Tesla credentials and encryption keys are not dependencies of this endpoint. No deployed values were set or read.

## Instructions for the next task
Review this uncommitted change on `Raj-AutoPW3`. Preserve the staging gate, fixed actor-derived limiter scope, separate user/service credentials and existing deployment guard. Hosted changes need explicit authorization. Do not enable the general identity route set, mutate data, activate cron or dispatch live Tesla operations to test this endpoint.

## Next task
After review, prepare an authorized isolated staging verification of this endpoint using two real test users and the existing reviewed migrations. Maintain NO-GO for broader API/production readiness until the remaining durable domains and transactional mutations are complete.
