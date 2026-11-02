# AutoPW3 — Task Handoff Report

## Task completed

Number and name: Three targeted staging Tesla OAuth security fixes (no numbered task assigned).
Branch / commit: Raj-AutoPW3 / 606b7d4; local changes only.
Date: 2026-11-01.

## Summary

Callbacks never delete the fixed-name browser cookie, so old or invalid responses cannot erase a
newer transaction. Completion now requires the initiating, still-live Supabase session using a staging
browser POST bridge. A forward-only migration fences encrypted credential persistence against the
current session, ADMIN membership, and actor/household lease owners through commit.

## Files created

| Path | Purpose |
| --- | --- |
| `apps/web/src/features/auth/pages/TeslaOAuthCallbackPage.tsx` | Staging callback bridge using the current auth adapter; removes the fragment and reports only fixed errors. |
| `apps/web/src/features/auth/pages/TeslaOAuthCallbackPage.test.tsx` | Current-session completion, logout, refresh without fragment, StrictMode and code/error non-disclosure. |
| `supabase/migrations/20261101160000_fence_staging_tesla_oauth.sql` | Service-only live-session validation, paired lease acquisition/restart and transactional fenced persistence. |
| `supabase/tests/database/144_tesla_oauth_session_fencing.test.sql` | 36 positive/negative session, lease, role, grant, tenant, scope and audit assertions. |
| `docs/handoffs/TESLA-OAUTH-SESSION-FENCING.md` | This handoff and exact task manifest. |

## Files modified

Paths are relative to the repository. Existing unrelated edits in these files are preserved.

| Path | What changed and why |
| --- | --- |
| `apps/worker/src/lib/staging-tesla-oauth.ts` | No cookie deletion or cookie-presence lockout; explicit authorized restart; GET bridge and authenticated POST completion; session validation before consume; fenced save. |
| `apps/worker/src/lib/staging-tesla-oauth.test.ts` | Actual Worker regression tests for response ordering, logout/switch/expiry, same-session refresh, restart and delayed persistence. Existing security cases retained. |
| `apps/worker/src/lib/staging-tesla-oauth-cookie.ts` | Version-2 signed binding includes session and household; removes unsafe deletion helper. HKDF/HMAC and 256-bit entropy remain. |
| `apps/worker/src/lib/staging-tesla-oauth-cookie.test.ts` | Session/household tampering and current version fixtures; unsafe clear-cookie test replaced by actual response-ordering coverage. |
| `apps/worker/src/lib/jwt.ts` | Opt-in required UUID session claim and verified expiry/session metadata; other callers' verification behaviour is unchanged. |
| `apps/worker/src/db/system-client.ts` | Three explicit new privileged RPC allowlist entries. |
| `apps/worker/src/services/tokens/supabase-store.ts` | Fenced OAuth save reuses encryption and never falls back to unfenced RPCs. |
| `apps/worker/src/services/tokens/supabase-store.test.ts` | Exact fenced RPC, encrypted envelope and failure/no-fallback checks. |
| `apps/worker/src/providers/tesla/workerd.test.ts` | Version-2 cookie fixture; native workerd crypto and credential redirect tests retained. |
| `apps/web/src/features/auth/types.ts` | Optional staging completion adapter contract without exposing session tokens. |
| `apps/web/src/features/auth/AuthProvider.tsx` | Completion facade; no token enters React state. |
| `apps/web/src/features/auth/create-client.ts` | Opt into session lifecycle policy only for a staging build. |
| `apps/web/src/features/auth/supabase-client.ts` | Authenticated same-origin callback POST; revoke session before staging logout/switch and fail if revocation is unavailable. |
| `apps/web/src/features/auth/supabase-client.test.ts` | Current session, no session, production denial, remote revocation ordering/failures and safe callback failure cases. |
| `apps/web/src/app/App.tsx` | Completion route is included only in a staging build. |
| `scripts/db-test.mjs` | Real two-connection delayed-commit fencing and logout lock tests; isolated fixture cleanup. |
| `scripts/db/local-shim.sql` | Minimal test-only `auth.sessions`; never applied hosted. |
| `apps/worker/src/lib/README.md` | Updated callback, cookie and migration status. |
| `apps/worker/src/services/tokens/README.md` | Documents fenced staging persistence without fallback. |
| `apps/web/README.md` | Staging bridge and remote revocation policy. |
| `scripts/README.md` | New concurrency tests and test-only Auth shim. |
| `supabase/migrations/README.md` | Migration prerequisites and hosted boundary. |
| `supabase/tests/database/README.md` | New SQL/security coverage. |
| `docs/DECISIONS.md` | Append D-123; preserves prior decision history. |
| `docs/KNOWN_LIMITATIONS.md` | Append L-138; preserves prior limitation history. |
| `docs/handoffs/TESLA-OAUTH-BROWSER-CORRELATION.md` | Marks superseded security assumptions without rewriting earlier results. |
| `docs/handoffs/README.md` | Links this follow-up. |

## Decisions

D-123 documents the three fixes. Cookie values expire naturally rather than being deleted on any
callback. A cookie alone never blocks reconnect; default live attempts conflict, and `restart: true`
is an explicit authenticated ADMIN cancellation. One actor and one household can own a current
attempt; different ADMINs for one household are fenced too. Late initiation responses can replace a
cookie with a superseded one, but that cookie cannot authorize persistence and explicit restart recovers.

GET cannot know the browser's current Supabase identity. It therefore performs no privileged I/O,
state consumption or Tesla requests, and redirects only to the fixed same-origin completion page.
The code/state are transferred with `tesla_code`/`tesla_state` (or `tesla_error`) fragment fields,
so Supabase's own code/error URL parser cannot consume the Tesla callback. They are removed from
history before completion, held in memory and POSTed with
the current session. No code, Tesla credential or correlation value is stored by the page or logged.
Supabase's own session persistence remains unchanged. The SDK's user-logout API confirms revocation
before staging local logout/new sign-in; no service-role key or privileged browser client is used.

## Database changes

The new migration uses existing `job_locks`, credentials, membership and Supabase `auth.sessions`.
It creates no tables or policies and makes no Auth schema changes. Only the test shim creates a
minimal Auth session ledger. RPCs are `worker_begin_tesla_oauth`,
`worker_validate_tesla_oauth_session`, and `worker_save_tesla_credentials_fenced_for_oauth`.
Each denies PUBLIC/anon/authenticated and grants execution to service_role only.

Lock order is live Auth session, ADMIN membership, household lease, actor lease. Fenced persistence
holds those rows through encrypted save/audit and commit. Restart waits for an old save already
holding those locks, then replaces the fence. Delayed old saves fail. Logout deletion must wait for
an already-authorized transaction; after logout acknowledges, the missing session rejects every save.
An HTTP timeout/failure never establishes whether a database transaction committed.

Apply the migration only through a separately approved hosted procedure, before a coordinated
Worker and `--mode staging` frontend rollout. Both Tesla flags must stay false during preparation.
Version-1 cookies fail closed; pending attempts must be restarted. No new secrets or key rotation.

## API changes

- Staging POST connect accepts optional `restart: true`, preserving `enableControls: false` only.
- GET `/api/v1/provider/tesla/callback` validates query/correlation and returns a 303 to
  `/auth/tesla/callback#...`; it never exchanges the code.
- Same-origin JSON POST at the same API callback requires the initiating actor/session and cookie.
  Success returns `{ "connected": true }`; failures remain sanitized and fail closed.
- Revoked session/current ADMIN/lease validation occurs before atomic state consumption and again
  at authorization and final persistence. No callback emits Set-Cookie. Production paths are unchanged.
- Scopes remain exactly `openid offline_access energy_device_data`. Commands, automation, cron and
  live-status activation remain outside this patch.

## Checks executed

| Exact command | Executed? | Result | Relevant output/failure |
| --- | --- | --- | --- |
| `npm run test --workspace @autopw3/worker -- src/lib/staging-tesla-oauth.test.ts src/lib/staging-tesla-oauth-cookie.test.ts src/services/tokens/supabase-store.test.ts --configLoader native --pool threads --maxWorkers 1` | yes | PASS | 100 tests, 3 files. |
| `npm run test --workspace @autopw3/worker -- --configLoader native --pool threads --maxWorkers 1` | yes | PASS | 572 tests, 36 files, including both real workerd regressions. |
| `npm run test --workspace @autopw3/web -- src/features/auth/supabase-client.test.ts src/features/auth/auth.test.tsx src/features/auth/pages/TeslaOAuthCallbackPage.test.tsx --configLoader native --pool threads --maxWorkers 1` | yes | PASS | 120 tests, 3 files. |
| `npm run typecheck` | yes | PASS | All workspaces and e2e. |
| `npm run db:test` | yes | PASS | Final clean run: PostgreSQL 17.10, 18 migrations, 22 files, 579 ok / 0 not ok, including five separate concurrency checks. |
| `npm run db:verify` | yes | PASS | Empty installation, idempotent reapplication, reset/reapply, 30 tables, RLS, grants and constraints. |
| `node node_modules/eslint/bin/eslint.js` followed by the changed TS/TSX files and `scripts/db-test.mjs` in the manifest above | yes | PASS | Targeted ESLint. |
| `node node_modules/prettier/bin/prettier.cjs --check` followed by those same source/test files | yes | PASS | Targeted formatting. |
| `npm run lint:rules` | yes | PASS | Architecture rules. |
| `npm run secrets:scan` | yes | PASS | No credential values printed. |
| `git diff --check` | yes | PASS | Pre-existing CRLF normalization warnings only. |

Earlier runs were not counted as success: initial focused assertions needed conversion to the new
GET/POST contract; a new test fixture collided with the previous test's committed fixture world;
an initial concurrency harness sequence was cancelled after causing a client-ordering lock wait;
one subsequent runner initialization hit `spawn EPERM`. All were followed by the final clean run
above without weakening or skipping SQL assertions. No hosted verification is implied.

## Manual verification

Inspected real state-consumption, encrypted save and owner-matched release RPCs before editing.
Checked the installed SDK's local sign-out path: it can clear local state on a network error, which
is why staging confirms remote revocation first. Reviewed purpose-separated native Web Crypto use,
strict browser cookie parsing, fixed callback destination and absence of sensitive error/log output.
No live Tesla, Supabase or Cloudflare operation was performed.

## Acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Invalid/replay/delayed responses cannot clear a newer cookie | VERIFIED | Out-of-order response-header regression; callbacks emit no Set-Cookie. |
| Logout, switch, expired/revoked sessions cannot complete | VERIFIED | Worker, frontend lifecycle and real SQL checks; database logout linearization. |
| Valid same-account/same-session completion and refresh work | VERIFIED | Worker entrypoint and frontend completion tests. |
| Delayed old writes cannot overwrite new credentials | VERIFIED | Worker delayed HTTP-failure model plus two-connection real PostgreSQL fencing test. |
| ADMIN, exact scopes, encryption, atomic state and redirect protections retained | VERIFIED | Existing and new Worker/SQL/workerd checks. |
| Hosted migration, coordinated rollout and real Tesla OAuth | NOT_EXECUTED | Outside approved scope; both Tesla flags remain false. |

## Verification status register

VERIFIED locally: 36 new SQL assertions, real PostgreSQL ordering/logout locks, atomic single-use
state, native workerd crypto/redirect regression, Worker/frontend lifecycle tests, typecheck and
security checks. UNVERIFIED hosted: migration permissions/Auth schema, coordinated staging bridge,
real Tesla consent and provider responses. No production readiness claim.

## Outstanding issues

Hosted migration and coordinated staging frontend/Worker rollout require separate approval and
verification. Offline local-only session removal is not supported logout: remote revocation must
complete. A failed/ambiguous consumed callback requires a new attempt; external token exchange and
database persistence cannot be one atomic transaction. Cookie/session theft is outside this mitigation.

## Environment variables

No variables/secrets changed. `STAGING_TESLA_OAUTH_ENABLED` and
`STAGING_TESLA_LIVE_STATUS_ENABLED` remain false in Wrangler. Existing `TOKEN_ENCRYPTION_KEY` provides
the purpose-separated cookie key. The staging frontend must be built with `--mode staging`.

## Instructions for the next task

Review this patch independently. Preserve Wrangler, the verified Tesla public-key asset, all
unrelated uncommitted files and both stashes. Do not apply the migration, enable flags, deploy, commit
or push without the separately authorized task. Reuse the existing encrypted stores and narrow RPCs;
never route staging completion to the old unfenced credential RPC or process-local adapters.

## Next task

Independent targeted review, then separately approved migration and coordinated staging rollout
with flags disabled before any OAuth activation. No real provider test has been performed here.
