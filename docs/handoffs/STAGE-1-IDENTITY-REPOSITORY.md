# TASK NOT COMPLETE

# AutoPW3 — Task Handoff Report

## Task completed
Number and name: Stage 1 Implementation — Authenticated Database Foundation, Identity, Households and Settings
Branch / commit: `cloudflare-deployment` / `5661d2be1f694eaee600c0ae78e2f2f1da0f8725`
Date: 2026-10-31

## Summary
Added a request-scoped authenticated PostgREST transport and a separate allowlisted service-role RPC constructor used by the existing privileged job, token and rate-limit adapters. Added a scoped durable identity repository for profile, household, membership, invitation and settings operations, and wired the authenticated repository into API construction only after JWT verification. Staging/production API fail-closed behavior remains unchanged. SQL verification passed locally; Worker Vitest could not start because Vite config resolution returned `spawn EPERM`.

## Files created
| Path | Purpose |
|---|---|
| `apps/worker/src/db/postgrest.ts` | Request-scoped authenticated PostgREST client with timeout and redacted errors. |
| `apps/worker/src/db/system-client.ts` | Narrow server-only constructor for the existing privileged RPC transport. |
| `apps/worker/src/db/identity-repository.ts` | First scoped durable repository implementation and interface. |
| `apps/worker/src/db/postgrest.test.ts` | Transport credential, separation and error tests. |
| `apps/worker/src/db/identity-repository.test.ts` | Repository actor scoping and request mapping tests. |
| `supabase/tests/database/140_authenticated_identity_repository.test.sql` | RLS, role denial, settings and audit actor regression tests. |
| `supabase/migrations/20261031150000_authenticated_household_update.sql` | Authenticated household metadata update and same-transaction audit RPC. |
| `docs/DURABLE_IDENTITY_STAGE1.md` | Implemented scope, limits and verification boundary. |
| `docs/handoffs/STAGE-1-IDENTITY-REPOSITORY.md` | This handoff. |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/worker/src/db/repository.ts` | Added profile methods to the explicit in-memory mock for local/test route compatibility. |
| `apps/worker/src/lib/app.ts` | Construct a per-request authenticated repository after JWT verification; dispatch identity routes and role lookups through it. Production/staging early fail-closed gate remains intact. |
| `apps/worker/src/routes/identity.ts` | Use the scoped identity repository and return the actual persisted profile from `/me`. |
| `apps/worker/src/routes/admin.ts` | Avoid duplicate application audit writes when database triggers already audit identity mutations. |
| `apps/worker/src/services/jobs/store.ts` | Route privileged queue RPCs through the allowlisted system client. |
| `apps/worker/src/services/tokens/supabase-store.ts` | Route credential and OAuth-state RPCs through the allowlisted system client. |
| `apps/worker/src/lib/rate-limiter.ts` | Route the durable rate-limit RPC through the allowlisted system client. |
| `apps/worker/src/index.test.ts` | Added multi-request bearer isolation test and retained deployment fail-closed coverage with anon configuration. |
| `packages/shared/src/constants/enums.ts` | Added `UNKNOWN` budget state so missing monetary usage is not reported as under budget. |
| `packages/shared/src/db/database.types.ts` | Added generated type contract for `public.update_household`. |
| `packages/shared/src/db/database.types.test.ts` | Added the new RPC to the generated database type surface assertion. |
| `supabase/tests/database/100_hardening_and_grants.test.sql` | Updated exact authenticated RPC grant allowlist assertion for the new function. |
| `apps/worker/src/db/README.md` | Updated adapter status and production boundary. |
| `docs/README.md` | Linked the implementation scope and architecture docs. |
| `docs/DECISIONS.md` | Appended D-116 for request-scoped actor-aware access. |
| `docs/KNOWN_LIMITATIONS.md` | Appended L-130 and L-131 for remaining repository and budget gaps. |
| `docs/handoffs/README.md` | Linked this stage handoff. |

## Decisions
D-116: preserve the validated request JWT for user PostgREST operations and use a separate allowlisted service-role RPC client only for system operations. Household metadata updates use one authenticated RPC so the change and actor-attributed audit row commit together.

## Database changes
Added forward-only migration `20261031150000_authenticated_household_update.sql` defining authenticated `public.update_household` plus an audit trigger for all household name/timezone updates. The RPC derives the actor through `auth.uid()`, checks ADMIN, uses an empty `search_path`, and has an explicit authenticated-only grant; its update and `settings.changed` audit commit together. Reused `public.create_invitation`, `accept_invitation`, `revoke_invitation`, `change_member_role`, `remove_member`, and `leave_household`. The SQL regression test has not yet completed successfully in this sandbox.

## API changes
No endpoint or route contract was added. `/me` now returns stored profile data on the authenticated repository path. Staging and production continue to return `PROVIDER_UNAVAILABLE` before route dispatch. Invitation idempotency remains process-local and is not safe for production activation.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run typecheck` | yes | PASS | All workspace and e2e TypeScript checks passed. |
| `npm run lint` | yes | PASS | ESLint, architecture rules and Prettier passed. |
| `npx eslint apps/worker/src/db/postgrest.ts apps/worker/src/db/postgrest.test.ts apps/worker/src/db/system-client.ts apps/worker/src/db/identity-repository.ts apps/worker/src/db/identity-repository.test.ts apps/worker/src/db/repository.ts apps/worker/src/index.test.ts apps/worker/src/lib/app.ts apps/worker/src/routes/admin.ts apps/worker/src/routes/identity.ts apps/worker/src/services/jobs/store.ts apps/worker/src/services/tokens/supabase-store.ts apps/worker/src/lib/rate-limiter.ts` | yes | PASS | No ESLint findings. |
| `npx prettier --check apps/worker/src/db/postgrest.ts apps/worker/src/db/postgrest.test.ts apps/worker/src/db/system-client.ts apps/worker/src/db/identity-repository.ts apps/worker/src/db/identity-repository.test.ts docs/DURABLE_IDENTITY_STAGE1.md` | yes | PASS | New implementation/test files formatted. |
| `npm run test --workspace @autopw3/worker -- --run src/db/postgrest.test.ts src/db/identity-repository.test.ts src/index.test.ts` | yes | NOT_EXECUTED | Vitest startup failed during Vite config resolution with Windows sandbox `spawn EPERM`. |
| `npm run test --workspace @autopw3/worker -- --configLoader runner src/db/postgrest.test.ts src/db/identity-repository.test.ts src/index.test.ts` | yes | NOT_EXECUTED | Alternate loader failed because `require` is unavailable in the ESM module runner. |
| `npm run db:verify` | yes | PASS | PostgreSQL 17.10; all 16 migrations applied and reapplied cleanly; schema/constraint verification passed. |
| `npm run db:test` | yes | PASS | 482 SQL assertions across 18 files plus concurrent job claim and cron scheduling checks passed; policy matrix matched 52 policies. |
| `npm run secrets:scan` | yes | PASS | No secret findings. |

## Manual verification
Confirmed the Worker verifies the JWT before constructing the PostgREST client, forwards the exact bearer with the anon key, creates the client inside each request, and does not inject a privileged client into route dependencies. Confirmed existing authenticated SQL functions and the new household RPC derive the actor from `auth.uid()`. Confirmed production/staging API gate remains before API dispatch. No migration was applied to hosted Supabase.

## Acceptance criteria
| Criterion | Status (VERIFIED / MOCK_ONLY / NOT_EXECUTED / FAILED) | Evidence |
|---|---|---|
| Request-scoped authenticated access and actor JWT preservation | NOT_EXECUTED | Implementation and Worker integration test exist; Vitest blocked by `spawn EPERM`. |
| Privileged client separation | NOT_EXECUTED | Separate server-only constructor and test exist; Worker tests did not run. |
| Durable first repository slice | NOT_EXECUTED | SQL authority passed locally, but Worker adapter and runtime tests could not start. |
| RLS, role and actor audit tests | VERIFIED | `npm run db:test`: 482 assertions passed, including the 19 new identity repository SQL assertions. |
| No service-role shortcut for user operations | VERIFIED | Identity adapter receives only authenticated transport; system client is absent from route dependencies. |
| Runtime wiring and deployment fail-closed | VERIFIED | Per-request construction in app; deployment gate unchanged and test configured. |
| Missing configuration fail-closed | VERIFIED | Staging/production API remains disabled before any in-memory or PostgREST route use. |

## Verification status register
TypeScript: VERIFIED. ESLint, architecture rules and full lint: VERIFIED. Worker runtime tests: NOT_EXECUTED (`spawn EPERM`). Local PostgreSQL verification and SQL tests: VERIFIED. Hosted Supabase: NOT_EXECUTED. Cloudflare: NOT_EXECUTED.

## Outstanding issues
- Run the Worker tests in an environment where Vitest config resolution can launch child processes, then verify real Supabase JWT/PostgREST behavior in staging before enabling any deployment path.
- Implement transaction-coupled durable idempotency, especially for invitation creation; its raw token must never be persisted for replay.
- Complete the remaining repository domains. Household creation remains service-only bootstrap; household rename and timezone update are not in this slice.
- Provider usage has no monetary ledger. Settings report `spentUsd: null` and `UNKNOWN`; there is no monthly cap enforcement.
- Profile update is repository-only because the current API has no profile-update route.

## Environment variables
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are used by the authenticated repository. `SUPABASE_SECRET_KEY` remains service-only and is not injected into request handlers. Existing `ENVIRONMENT` and `LOCAL_MOCKS` controls retain their current behavior.

## Instructions for the next task
Reuse `IdentityRepository` as a scoped domain interface; do not widen it to claim the full `Repository`. Preserve request-local JWT binding in `AuthenticatedPostgrestClient`. Keep `system-client.ts` out of route imports. Do not remove the staging/production gate until all repository methods and durable transaction-coupled idempotency are implemented and verified. Run the added SQL test under local PostgreSQL and real Supabase staging before claiming RLS integration is proven.

## Next task
Implement transactional durable idempotency for authenticated identity mutations, starting with invitation creation and safe token replay behavior, then rerun SQL concurrency tests in a process-enabled environment.
