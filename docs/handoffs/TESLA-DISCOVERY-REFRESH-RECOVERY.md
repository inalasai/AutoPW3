# AutoPW3 — Task Handoff Report

## Task completed

Number and name: unnumbered follow-up — resolve expired READY Tesla discovery refresh blocker.
Branch / commit: existing `Raj-AutoPW3`, HEAD `606b7d4`; no commit. Preserve unrelated changes (D-125).
Date: 2026-11-02.

## Summary

An expired/expiring access token in encrypted READY staging now terminalizes as REAUTH under the
original authenticated actor/session, lease, deadline and credential revision fences. Pending rotated
tokens are never exchanged again. The matching credential becomes NEEDS_REAUTH, audit and ciphertext
erasure commit atomically, and repeated discovery returns a fixed HTTP 409 reauthorization state.
Successfully activated credential generations retain independent SENT barriers for later refreshes.

GO for the local fix and separately authorized controlled staging rollout, subject to hosted
prerequisite/grant/cache and deployment-configuration verification. No hosted action is authorized
or performed here. Actual Tesla renewal remains UNVERIFIED; no security invariant was waived.

## Files created

| Path | Purpose |
| --- | --- |
| `supabase/migrations/20261102140000_resolve_expired_tesla_refresh_attempts.sql` | Forward context/finish replacement and precise grants, installed as one atomic DO statement. |
| `scripts/db/tesla-refresh-migration-atomicity.mjs` | Injected installation failure and outer-transaction rollback tests on temporary PostgreSQL. |
| `scripts/db/README.md` | Local helper scope and prohibition on hosted fixture use. |
| `docs/handoffs/TESLA-DISCOVERY-REFRESH-RECOVERY.md` | Current outcome, exact checks and operational boundaries. |

## Files modified

| Path | What changed and why |
| --- | --- |
| `supabase/migrations/20261102120000_refresh_staging_tesla_discovery_credentials.sql` | Only an atomic DO wrapper added to the unmerged/unhosted base migration; function/table definitions and grants preserved. |
| `apps/worker/src/db/postgrest.ts`, `postgrest.test.ts` | Allowlist two fixed recovery tags; test that provider/database details remain discarded. |
| `apps/worker/src/services/tokens/discovery-refresh.ts` | Typed fixed reauthorization outcome; no new token exchange path. |
| `apps/worker/src/lib/staging-tesla-sites.ts`, `staging-tesla-sites.test.ts` | HTTP 409 recovery mapping and expired READY, repetition, later-generation ambiguity/revocation and authorization regression tests. |
| `supabase/tests/database/146_tesla_discovery_refresh.test.sql` | 70 SQL assertions, including terminalization/replay, audit, erasure and newer OAuth preservation. |
| `scripts/db/tesla-discovery-refresh-concurrency.mjs` | 16 real refresh races; expired-result terminalization and later-generation SENT fencing. |
| `scripts/db-test.mjs` | Run atomic-install verification before each affected migration on throwaway PostgreSQL. |
| `docs/TESLA_DISCOVERY_REFRESH.md` | Pre-code plan, rotation rationale, terminal lifecycle, HTTP states and verification. |
| `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | Append D-126 and L-141; preserve history. |
| Touched-folder READMEs | Update DB, lib, tokens, scripts, migrations, SQL tests, docs and handoff status/links. |
| `docs/handoffs/TESLA-DISCOVERY-REFRESH.md` | Append link to this superseding follow-up; original test record retained. |

## Decisions

D-126: treat pending rotated pairs as distinct generations without introducing an exchange from
pending ciphertext. Tesla documents single-use refresh tokens, saving each rotated refresh token and
a last-used-token grace period. That grace period does not prove whether an ambiguous exchange was
consumed. This fix chooses explicit reauthorization when staged access expires. Only an activated
pair can enter another normal refresh, with its own encrypted credential revision and SENT barrier.
Source: https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens#refresh-tokens.

Use one DO statement per unshipped refresh migration. Definitions and privilege restrictions are
atomic even in autocommit; an outer migration transaction remains controlled by the runner.
Source: https://www.postgresql.org/docs/17/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY.

## Database changes

21 local migrations. The new forward migration replaces only private refresh context and authenticated
finish, retaining signatures. NEEDS_REAUTH produces a fixed preflight error tag. Under unchanged
post-lock checks, expired READY TOKEN is converted to REAUTH; status/audit/barrier/payload clearing
commit together. No new public table, policy, scope, region, grant recipient or feature flag.

The base migration was untracked, unmerged and never applied hosted by this session. Only its atomic
wrapper changed; no merged historical migration is edited. Atomicity tests inject failure immediately
before the grant restriction block, compare function definitions/ACLs and ledger existence, and test
the same file inside an outer transaction followed by rollback. Final privilege tests pass.

## API changes

No new endpoint. Authenticated ADMIN discovery returns existing HTTP 409 CONFLICT JSON with detail
`{path: "provider.tesla", issue: "TESLA_REAUTHORIZATION_REQUIRED"}` for terminal REAUTH/NEEDS_REAUTH;
an ambiguous SENT barrier returns issue `TESLA_RECOVERY_REQUIRED`. Existing authentication and ADMIN
failures keep their status. Linking freshness, scopes, region and all unrelated safety gates remain.
No tokens, ciphertext, provider response text or arbitrary database messages are returned.

## Checks executed

| Exact command | Executed? | Result | Relevant output/failure |
| --- | --- | --- | --- |
| `npm run test --workspace @autopw3/worker -- --configLoader native --pool threads --maxWorkers 1` | yes | PASS | Final run 703 tests / 39 files, including native workerd. |
| `npm run test --workspace @autopw3/shared -- --configLoader native --pool threads --maxWorkers 1` | yes | PASS | 236 tests / 16 files. |
| `npm run db:test` | yes | PASS | PG 17.10, 21 migrations, 24 SQL files; 721 checks: 693 SQL, 24 concurrency (16 refresh), four atomic-install checks. |
| `npm run db:verify` | yes | PASS | Empty install, reapply, reset/reapply, constraints, 30 public tables, grants/RLS and flows. |
| `npm run db:types -- --check` | yes | PASS | Existing generated catalog remains up to date after 21 migrations; no manual/generated type change needed. |
| `npm run typecheck` | yes | PASS | All four workspaces and e2e. |
| Targeted ESLint command below | yes | PASS | Eight changed source/test/helper files. |
| `npm run lint:rules` | yes | PASS | All architecture checks. |
| `npm run secrets:scan` | yes | PASS | No findings. |
| Targeted Prettier check below | yes | PASS | Eight changed source/test/helper files match formatting. Decision/limitation Markdown checks also pass. |
| `git diff --check` | yes | PASS | Existing CRLF warnings only; no whitespace errors. |
| `npm run build` / `npm run test:e2e` | no | NOT_EXECUTED | No frontend or build/config changes; preserve verified staging bundle. |
| Hosted migration/deployment/Tesla request | no | NOT_EXECUTED | Not authorized; no OAuth reconnection. |

Targeted ESLint (PowerShell, repository root):

```powershell
$refreshRecoverySources = @(
  'apps/worker/src/db/postgrest.ts',
  'apps/worker/src/db/postgrest.test.ts',
  'apps/worker/src/lib/staging-tesla-sites.ts',
  'apps/worker/src/lib/staging-tesla-sites.test.ts',
  'apps/worker/src/services/tokens/discovery-refresh.ts',
  'scripts/db-test.mjs',
  'scripts/db/tesla-discovery-refresh-concurrency.mjs',
  'scripts/db/tesla-refresh-migration-atomicity.mjs'
)
& .\node_modules\.bin\eslint.cmd @refreshRecoverySources
& .\node_modules\.bin\prettier.cmd --check @refreshRecoverySources
```

Initial verification exposed two fixture issues: exact optional property deletion required `delete`,
and an audit scalar/count assertion included earlier test audits in the same transaction. Both were
corrected before final passing runs. A new test also initially expected 502 for a definite unstaged
finish conflict; the correct first status is 409, followed by explicit recovery state without retry.
One final local PostgreSQL launch was sandbox-blocked with spawn EPERM; rerunning under the already
approved local database-test permission passed all 721 checks. No hosted database was contacted.

## Manual verification

Reviewed original/new SQL authorization, locking and revision logic; the terminal branch runs only
after the same session/ADMIN/lease/deadline/revision checks as token activation. No newer OAuth record
can be overwritten or marked NEEDS_REAUTH by the old attempt. No pending-token decryption or exchange
API was added. Existing encrypted storage and committed credential access are unchanged.

The verified frontend `index-D5B_VCiF.js` SHA256 remains
`22b3944600622eb56134c855c13729c6f2932070e37052456ac413c91373c152`.
The pre-existing generated lint artifact SHA256 remains
`14740877e5fdd53e08f509992a916bb0eda1cb9280325e607f349b65be388f0a`.
Neither was changed. Root lint's previously verified failure in that artifact remains separate from
the passing targeted checks; root lint is not claimed to pass.

## Acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Expired READY never repeatedly resumes to expiry rejection | VERIFIED | SQL terminal/replay tests, Worker repeated HTTP 409 tests, real duplicate terminalization race. |
| No uncertain exchange replay | VERIFIED | SENT barrier tests, independently ambiguous next-generation Worker/DB tests. |
| ADMIN/session, encryption, lease and revision safety | VERIFIED | SQL privileges and 16 real refresh races including expired READY against logout, demotion, revocation, replacement and deadline expiry. |
| Newer OAuth credentials preserved | VERIFIED | Concurrent replacement and post-terminal OAuth replacement/replay assertions. |
| Migration definitions/grants atomic | VERIFIED | Autocommit injected failure and outer-transaction rollback on PG 17; final precise privilege assertions. |
| No telemetry, controls, polling, automation or reconnect | VERIFIED | No new provider path, flags, scheduler or frontend change. |
| Hosted/Tesla end-to-end operation | NOT_EXECUTED | Separately authorized deployment/verification required. |

## Verification status register

VERIFIED: local Worker, shared, real PostgreSQL, schema, generated types and source checks above.
MOCK_ONLY: Tesla token response/exchange scenarios; no real token/provider request was sent.
UNVERIFIED: hosted Supabase Auth/PostgREST schema visibility/grants, active Worker/bindings and real
Tesla renewal. The review's Cloudflare HTTP 401 was not bypassed by reconnecting credentials.

## Outstanding issues

L-141: explicit reauthorization sacrifices availability for expired pending generations. SENT barriers
are intentionally never reset, even after pre-dispatch crashes. Original actor/session binding can
prevent READY recovery after session loss. Abandoned READY ciphertext and ledger metadata have no
automatic cleanup. Logical deadlines fence authority; they do not erase data. Any future cleanup must
preserve a tombstone against consumed-token reuse. Existing privileged generic credential writers
remain trusted; this workflow does not remove their established authority.

Root lint remains blocked by the untouched generated `.wrangler-tesla-check/index.js` artifact.
No live flags were changed: the checked-in STAGING_TESLA_SITES_ENABLED default is false. A separately
authorized Worker rollout must preserve its intended deployed discovery setting and keep telemetry,
controls, polling, automation and cron disabled.

## Environment variables

No names or values changed. Reuses existing staging discovery/authentication/encryption/Tesla client
configuration; all secret values remain in the existing server-side configuration.

## Instructions for the next task

Independently review the local patch, then only under explicit authorization verify hosted migration
history/prerequisites, apply the atomic forward sequence, verify new function grants and PostgREST
visibility, preserve deployment flags, and perform one controlled discovery verification. Old Worker
OAuth/login/site-link interfaces remain unchanged by migration installation; old expired discovery
is not fixed until the new Worker is deployed. Never delete SENT to retry, exchange pending staged
tokens, reconnect OAuth or enable live hardware behavior as an implicit recovery step.

## Next task

Separately authorized controlled staging verification, preserving the current frontend bundle and all
hardware safety gates. No deployment, hosted migration or commit was performed by this task.
