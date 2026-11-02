# AutoPW3 — Task Handoff Report

## Task completed

Number and name: Unnumbered staging Tesla discovery token-refresh follow-up.
Branch / commit: Raj-AutoPW3 / 606b7d4, uncommitted working tree preserved at owner's request.
Date: 2026-11-02.

## Summary

Expired ACTIVE Tesla credentials can be refreshed only during an authenticated staging discovery
request. A private durable attempt ledger prevents blind reexchange after uncertain outcomes;
encrypted provider output is staged by the server and activated only by the actual user's JWT.
Atomic session/ADMIN, lease owner, deadline and credential-revision checks fence concurrent and late
commits. Existing linking freshness, read-only scopes, allowed regions, feature flags and API/cron
guards remain in force. No hosted migration, deployment, OAuth reconnect, commit or live Tesla call.

## Files created

| Path | Purpose |
| --- | --- |
| `docs/TESLA_DISCOVERY_REFRESH.md` | Security/recovery contract written before implementation, then updated with verification. |
| `docs/handoffs/TESLA-DISCOVERY-REFRESH.md` | This handoff. |
| `apps/worker/src/lib/request-budget.ts` | One 25-second staging-site request budget; bounded phases and composed fetch abort signals. |
| `apps/worker/src/lib/request-budget.test.ts` | Deadline, ignored-abort transport, subsequent-phase denial and receiver tests. |
| `apps/worker/src/services/tokens/discovery-refresh.ts` | Authenticated discovery preflight, durable attempt, bounded renewal, staged-result recovery and JWT activation. |
| `apps/worker/src/providers/tesla/oauth-refresh.test.ts` | Strict response/scp validation, sanitized errors, redirect/body/timeout/no-retry tests. |
| `supabase/migrations/20261102120000_refresh_staging_tesla_discovery_credentials.sql` | Private RLS ledger, scoped RPCs and two empty-metadata audit actions. |
| `supabase/tests/database/146_tesla_discovery_refresh.test.sql` | 51 SQL authorization, privilege, expiry, recovery, audit and fencing assertions. |
| `scripts/db/tesla-discovery-refresh-concurrency.mjs` | Eight real two-connection PostgreSQL races. |

## Files modified

These changes build on the pre-existing uncommitted onboarding/OAuth work; unrelated changes were
preserved. Some files below were already untracked before this follow-up.

| Path | What changed and why |
| --- | --- |
| `apps/worker/src/lib/staging-tesla-sites.ts` | Discovery-only refresh orchestration and resulting revision baseline; bounded staging-site handler; existing link path still uses strict context. |
| `apps/worker/src/db/site-link-repository.ts` | Actual-user JWT preflight/begin/finish adapters with validated opaque outputs. |
| `apps/worker/src/db/system-client.ts` | Allowlist adds only encrypted refresh-result staging. |
| `apps/worker/src/services/tokens/supabase-store.ts` | Reuses AES-GCM envelope for pending rotated credentials and owner-matched lease release. |
| `apps/worker/src/providers/tesla/oauth.ts` | Shared token/scp normalization; bounded refresh transport; fixed sanitized failure classification. |
| `apps/worker/src/providers/tesla/http.ts` | Ten-second fetch/body bounds, nonblocking cancellation, bounded login_required classification without provider text. |
| `apps/worker/src/lib/staging-tesla-sites.test.ts` | Worker entrypoint refresh/valid/revoked/concurrent/uncertain-write/recovery/isolation tests using encrypted transport fixtures. |
| `apps/worker/src/providers/tesla/workerd.test.ts` | Exercises RequestBudget's composed fetch signal and disposal in native workerd. |
| `packages/shared/src/constants/enums.ts` | Adds tesla.token_refreshed and tesla.reauth_required. |
| `packages/shared/src/contract/db-contract.test.ts` | Audit drift guard follows the latest forward definition rather than only the original migration. Exact catalog equality remains enforced. |
| `packages/shared/src/db/database.types.ts` | Regenerated from all 20 migrations; no hand edits. |
| `packages/shared/src/db/database.types.test.ts` | Exact authenticated RPC type union, including the previously ungenerated linking RPCs and three new refresh RPCs. |
| `supabase/tests/database/100_hardening_and_grants.test.sql` | Exact authenticated EXECUTE allowlist adds precisely three RPCs. |
| `scripts/db-test.mjs` | Runs refresh races independently of existing OAuth/linking concurrency checks. |
| `apps/worker/src/{db,lib,providers/tesla,services/tokens}/README.md` | Current runtime, authority split, scope and local verification status. |
| `packages/shared/README.md` | Audit/type status. |
| `scripts/README.md` | Concurrency harness scope. |
| `supabase/migrations/README.md`, `supabase/tests/database/README.md` | Migration/test status and no hosted application. |
| `docs/README.md`, `docs/handoffs/README.md` | Contract and handoff links. |
| `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | Append D-125 and L-140; history unchanged. |

## Decisions

D-125 and the pre-code contract resolve three required invariants:

1. Rotation is not an atomic Tesla/PostgreSQL transaction. Authenticated begin records SENT before
   the exchange; lease expiry/logout never erase it. An unknown exchange or unstaged result blocks
   further exchange for that revision. Encrypted READY results can be resumed by the same live
   actor/session; exact authenticated finish replay reconciles ambiguous database responses.
2. Service staging cannot select an arbitrary actor/session or activate credentials. Begin/finish
   require the actual user's JWT. PostgreSQL derives auth.uid(), session and expiry and rechecks live
   Auth session/current ADMIN after locks, then activates and audits atomically.
3. A 25-second request budget, ten-second provider fetch/body limit, database-capped deadline and
   owner-matched token lease bound the operation. Session, membership, lease, credentials and attempt
   lock order fences logout/demotion/replacement/takeover and delayed commits. No transaction spans
   a provider call; no waiting loop, background renewal or token-exchange retry exists.

The owner explicitly prohibited commits. No task number was assigned; the existing dirty branch
and the established non-numbered handoff convention were preserved. Runtime changes to earlier
transport code fix boundedness and token-response validation defects required for safe refresh.

## Database changes

One forward migration, depending on the existing OAuth session and linking migrations:

- Private RLS table `tesla_discovery_refresh_attempts`, no direct grants to public/user/service roles.
  Unique household/revision prevents duplicate exchange. No Auth-session/user cascade removes the
  barrier. Committed attempts erase staged ciphertext. Household deletion still cascades.
- Authenticated-only `tesla_discovery_refresh_context(uuid)` admits expired ACTIVE credentials but
  retains current-session ADMIN, exact read-only scope, approved region and envelope-metadata rules.
- Authenticated-only `begin_tesla_discovery_refresh(uuid,text,uuid,timestamptz)` captures the actual
  actor/session and records SENT; only an existing READY result may be resumed under a new owner.
- Service-only `worker_stage_tesla_discovery_refresh(uuid,uuid,jsonb)` stages bounded encrypted output
  or a fixed REAUTH outcome. It accepts no actor/session identifiers and cannot activate credentials.
- Authenticated-only `finish_tesla_discovery_refresh(uuid,uuid,uuid)` takes no credentials or actor
  identifiers. It atomically checks authority/owner/deadline/revision and activates or marks NEEDS_REAUTH,
  updates last_refresh_at on success, records audit, erases staged payload and returns opaque metadata.
- Existing `private.touch_audit` is replaced forward with all prior allowlists unchanged plus exactly
  two empty-metadata actions. Linking context/proof/mutation functions are unchanged.

All SECURITY DEFINER functions use empty search_path. No public table grants or existing RLS policies
change. Prior trusted service/manual credential writers remain outside the new discovery workflow's
authority split; no claim is made to constrain a compromised service role or database administrator.

## API changes

No new HTTP path or environment flag. The existing staging discovery GET may renew expired tokens
before one products GET. Linking POST does not refresh. Missing refresh configuration fails closed.
No token, encrypted payload, attempt identifier, proof or provider error text is returned by HTTP.
Terminal Tesla login_required does not expire the user's Supabase session. All original public
success/error schemas, scope/region restrictions, manual nature and safety gates remain in place.

## Checks executed

| Exact command | Executed? | Result | Relevant output/failure |
| --- | --- | --- | --- |
| `npm run test --workspace @autopw3/worker -- --configLoader native --pool threads --maxWorkers 1` | yes | PASS | 694 tests / 39 files. |
| `npm run test --workspace @autopw3/shared -- --configLoader native --pool threads --maxWorkers 1` | yes | PASS | 236 tests / 16 files. |
| `npm run test --workspace @autopw3/worker -- src/providers/tesla/workerd.test.ts --configLoader native --pool threads --maxWorkers 1` | yes | PASS | Final native workerd run after adding RequestBudget signal/disposal checks. |
| `npm run typecheck` | yes | PASS | All four workspaces and e2e; final run after contract/type test updates. |
| `npm run db:test` | yes | PASS | Final clean run: PG 17.10, 20 migrations, 24 files, 690 checks: 674 SQL assertions and 16 concurrency checks. |
| `npm run db:verify` | yes | PASS | Final migration: empty install, idempotent reapply, reset/reapply, constraints, 30 public design tables, grants/RLS and flows. |
| `npm run db:types` | yes | PASS | Generated 1569-line catalog from 20 migrations. |
| `npm run db:types -- --check` | yes | PASS | Generated types exactly match current migrations. |
| `npm run lint:rules` | yes | PASS | Architecture rules. |
| `npm run secrets:scan` | yes | PASS | Final scan after source/docs changes. |
| `npm run lint` | yes | FAILED | 349 ESLint errors in pre-existing untracked generated `apps/worker/.wrangler-tesla-check/index.js`; untouched. Targeted source lint/format passed. |
| `git diff --check` | yes | PASS | Only existing CRLF warnings. |
| `npm run build` | no | NOT_EXECUTED | Preserve the owner's verified staging frontend assets. Native workerd tests bundle fixtures locally. |
| `npm run test:e2e` | no | NOT_EXECUTED | No frontend behavior change. |

Exact argument lists used for source ESLint/Prettier checks are the following files:

```powershell
$refreshSources = @(
  'apps/worker/src/lib/request-budget.ts',
  'apps/worker/src/lib/request-budget.test.ts',
  'apps/worker/src/lib/staging-tesla-sites.ts',
  'apps/worker/src/lib/staging-tesla-sites.test.ts',
  'apps/worker/src/db/site-link-repository.ts',
  'apps/worker/src/db/system-client.ts',
  'apps/worker/src/services/tokens/supabase-store.ts',
  'apps/worker/src/services/tokens/discovery-refresh.ts',
  'apps/worker/src/providers/tesla/oauth.ts',
  'apps/worker/src/providers/tesla/http.ts',
  'apps/worker/src/providers/tesla/oauth-refresh.test.ts',
  'apps/worker/src/providers/tesla/workerd.test.ts',
  'packages/shared/src/constants/enums.ts',
  'packages/shared/src/db/database.types.test.ts',
  'packages/shared/src/contract/db-contract.test.ts',
  'scripts/db-test.mjs',
  'scripts/db/tesla-discovery-refresh-concurrency.mjs'
)
node node_modules/eslint/bin/eslint.js @refreshSources
node node_modules/prettier/bin/prettier.cjs --check @refreshSources
```

Earlier failed runs were not counted as passes: sandbox initially prevented PostgreSQL startup;
test fixtures then needed the reset-helper grant, transaction-relative expired lease timestamp and
the runner's correct database name. Generated-type checks revealed the previously stale linking RPC
union; shared audit drift identified the need to extend the forward audit allowlist and follow its
latest definition. The final clean SQL, type and shared runs include these corrections.

## Manual verification

Reviewed SQL lock ordering, role grants, actual-JWT activation, durable SENT behavior, READY recovery,
credential fingerprint parity with strict linking and encrypted-store reuse. Inspected all provider
call sites: the new orchestration can invoke only token exchange and products, and no flags/config
were changed. Compared the existing index-D5B_VCiF.js SHA-256 with the earlier verified value: unchanged.
All provider traffic in tests is mocked or local workerd fixture traffic. No real credentials used.

## Acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Expired ACTIVE discovery can renew and use persisted rotation | VERIFIED | Worker encrypted transport tests and SQL activation/freshness assertions. |
| Valid credentials avoid refresh writes; revoked credentials remain closed | VERIFIED | Worker and SQL regressions. |
| No blind exchange retry after ambiguous exchange/save | VERIFIED | Durable SENT tests, network/staging failure tests, later-request and lost-response recovery tests. |
| Commit authority derives from actual JWT, not service-supplied identifiers | VERIFIED | Exact grants, service/user staging separation, actual-actor audit and logout/demotion checks. |
| Concurrency, lease, deadline and revision fencing | VERIFIED | Eight real PostgreSQL races and bounded-phase/body tests. |
| Existing linking/OAuth/scopes/regions/safety gates | VERIFIED | Full Worker/SQL suites; no flags, frontend, cron or control activation changes. |
| Task source lint/format/types and generated database types | VERIFIED | Targeted checks and generator check. Repository-wide lint has unrelated artifact failures above. |
| Real hosted Tesla/PostgREST/Auth behavior | NOT_EXECUTED | Explicitly outside this local implementation scope. |

## Verification status register

VERIFIED locally: authorization/privileges, atomic encrypted activation/audit, stale-owner/revision
rejection, duplicate-commit replay, request/body budgets and ambiguity barriers. MOCK_ONLY: Tesla
response shapes and renewal success. UNVERIFIED: hosted migration/grants/Auth compatibility and real
Tesla token behavior. No production-readiness or external-provider/database atomicity claim.

## Outstanding issues

L-140: A crash before dispatch can conservatively quarantine a revision; an exchanged result not
durably staged is not recoverable by this workflow. SENT never resets automatically. READY recovery
requires the original actor/session; logout/session loss can require separately authorized recovery.
Pending encrypted READY records have no automatic retention cleanup. No automatic OAuth recovery is
implemented. A bounded request may fail before all phases complete; staged or committed state is
reconciled without another token exchange. Full repository lint is blocked by the untouched generated
artifact. Existing general durable-runtime and provider-budget limitations remain unchanged.

## Environment variables

No new variables or secrets. Reuses STAGING_TESLA_SITES_ENABLED, ENVIRONMENT, LOCAL_MOCKS,
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY, TOKEN_ENCRYPTION_KEY, TESLA_CLIENT_ID,
TESLA_CLIENT_SECRET, APP_BASE_URL and ALLOWED_ORIGINS. No values changed. Live-status and all unrelated
flags remain unchanged. Public frontend environment and built assets were not rebuilt or modified.

## Instructions for the next task

Review the contract/migration and local patch independently before any separately authorized hosted
action. Preserve the new private no-reexchange ledger: do not delete SENT on lease expiry or add token
POST retries to handle ambiguity. Use actual user JWT for preflight/begin/finish; service role stages
encrypted output only. Keep strict linking context/proofs and all existing gates intact. No reset of
an uncertain attempt or OAuth reconnection is authorized by this handoff. Do not alter prior migrations.

## Next task

Independent review and, only under separate explicit authorization, hosted staging migration/rollout
and one controlled discovery verification. No telemetry, polling, automation or controls activation.

## Follow-up: expired READY review blocker

The [recovery handoff](TESLA-DISCOVERY-REFRESH-RECOVERY.md) supersedes this report for expired staged
access tokens and atomic installation. Earlier test counts above remain the original implementation
record. No hosted changes were performed.
