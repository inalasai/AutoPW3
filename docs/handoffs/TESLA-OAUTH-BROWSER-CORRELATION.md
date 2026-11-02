# AutoPW3 — Task Handoff Report

> Superseded security details: cookie cleanup, session lifecycle and persistence ordering are corrected
> in [TESLA-OAUTH-SESSION-FENCING.md](TESLA-OAUTH-SESSION-FENCING.md). That follow-up requires a local
> forward-only migration and a coordinated staging frontend/Worker rollout. The historical results
> below describe the earlier patch and do not establish readiness for enabling OAuth.

## Task completed

Number and name: Tesla OAuth browser-correlation security follow-up (no numbered task assigned).
Branch / commit: Raj-AutoPW3 / 606b7d4; local changes only, no commit.
Date: 2026-11-01.

## Summary

The gated staging flow now authenticates a browser cookie bound to the exact OAuth state before any
state consumption, Tesla request or credential write. It reuses the existing durable state/token
adapters and lease RPCs; no database migration or secret change is required. Existing ADMIN checks,
atomic consumption, exact read-only scopes and all deployment guards remain authoritative.

## Files created

| Path | Purpose |
| --- | --- |
| `apps/worker/src/lib/staging-tesla-oauth-cookie.ts` | State-bound cookie, HKDF/HMAC verification, bounded lifetime and opaque actor lease keys. |
| `apps/worker/src/lib/staging-tesla-oauth-cookie.test.ts` | Cookie properties, entropy, tampering, duplicate values, expiry and key isolation. |
| `docs/handoffs/TESLA-OAUTH-BROWSER-CORRELATION.md` | Security and deployment handoff. |

## Files modified

| Path | What changed and why |
| --- | --- |
| `apps/worker/src/lib/staging-tesla-oauth.ts` | Issue correlated cookies, reject uncorrelated callbacks before I/O, serialize pending attempts, clear terminal cookies and release only owned leases. |
| `apps/worker/src/lib/staging-tesla-oauth.test.ts` | Simulate browser cookies; exercise isolation, replay, concurrency, expiry, cleanup and secret-safe responses. |
| `apps/worker/src/providers/tesla/workerd.test.ts` | Exercise actual workerd HKDF/HMAC cookie verification while retaining all HTTP redirect regressions. |
| `apps/worker/src/lib/README.md` | Record the new staging security boundary. |
| `docs/DECISIONS.md` | Append D-122. |
| `docs/KNOWN_LIMITATIONS.md` | Append L-137. |
| `docs/handoffs/README.md` | Link this handoff. |

## Decisions

D-122 keeps state lookup and atomic consumption unchanged. A signed cookie authenticates the fresh
256-bit secret, exact state UUID, absolute expiry, opaque lease key and random lease owner. HKDF
separates cookie authentication from AES-GCM token/state encryption despite reusing the existing
root secret. No token, PKCE verifier or user JWT is placed in the cookie. Set-Cookie is the only
intended transport for correlation material; it is never returned in JSON or logged.

A valid pending cookie rejects another initiation with HTTP 409. An existing atomic database lease
also serializes simultaneous cookie-less initiations by the same actor, including different Workers
or browsers. The successful callback consumes state once; replay losers cannot release its lease.
Current ADMIN authorization is rechecked before exchange and within credential persistence.

## Database changes

None. Existing `worker_acquire_lock` and `worker_release_lock` RPCs accept the 720-second lease,
opaque key and UUID owner. Existing `worker_save_oauth_state` and `worker_consume_oauth_state`
retain their signatures and encrypted envelopes. Existing migrations already grant these RPCs to
service_role and deny anon/authenticated execution. No hosted SQL was run.

## API changes

Only the existing, exact staging connect/callback slice changes. Initiation sets
`__Host-autopw3-tesla-oauth` with Secure, HttpOnly, SameSite=Lax, Path=/, no Domain and Max-Age <=600.
Pending attempts return a fixed 409 error. Missing, malformed, duplicate, tampered, expired or
wrong-transaction cookies return a fixed 422 without state consumption or provider I/O. Valid
correlated terminal outcomes clear the cookie. Malformed callback queries and callbacks carrying a
valid cookie for a different transaction preserve that cookie and its pending lease.

## Checks executed

| Exact command | Executed? | Result | Relevant output/failure |
| --- | --- | --- | --- |
| `npm run test --workspace @autopw3/worker -- src/lib/staging-tesla-oauth-cookie.test.ts src/lib/staging-tesla-oauth.test.ts --configLoader native --pool threads --maxWorkers 1` | yes | PASS | 80 tests, 2 files. |
| `npm run test --workspace @autopw3/worker -- src/lib/staging-tesla-oauth-cookie.test.ts src/lib/staging-tesla-oauth.test.ts src/providers/tesla/workerd.test.ts --configLoader native --pool threads --maxWorkers 1` | yes | PASS | Final focused run: 81 tests, 3 files. |
| `npm run test --workspace @autopw3/worker -- --configLoader native --pool threads --maxWorkers 1` | yes | PASS | 557 tests, 36 files, including native workerd crypto/redirect regressions. |
| `npm run typecheck` | yes | PASS | All workspaces and e2e; an initial unknown-JSON typing error in the new test was fixed. |
| `node node_modules/eslint/bin/eslint.js apps/worker/src/lib/staging-tesla-oauth-cookie.ts apps/worker/src/lib/staging-tesla-oauth-cookie.test.ts apps/worker/src/lib/staging-tesla-oauth.ts apps/worker/src/lib/staging-tesla-oauth.test.ts apps/worker/src/providers/tesla/workerd.test.ts` | yes | PASS | Targeted source/test lint. |
| `node node_modules/prettier/bin/prettier.cjs --check apps/worker/src/lib/staging-tesla-oauth-cookie.ts apps/worker/src/lib/staging-tesla-oauth-cookie.test.ts apps/worker/src/lib/staging-tesla-oauth.ts apps/worker/src/lib/staging-tesla-oauth.test.ts apps/worker/src/providers/tesla/workerd.test.ts apps/worker/src/lib/README.md docs/DECISIONS.md docs/KNOWN_LIMITATIONS.md docs/handoffs/README.md docs/handoffs/TESLA-OAUTH-BROWSER-CORRELATION.md` | yes | PASS | Changed source and documentation formatting. |
| `npm run lint:rules` | yes | PASS | All architecture rules. |
| `npm run secrets:scan` | yes | PASS | No secret values printed. |

Final whitespace and preservation checks are recorded in the final task report.

## Manual verification

Reviewed existing SQL state storage, atomic DELETE RETURNING, hardened lease ownership, expiry bounds,
service-only RPC allowlists and grants. Confirmed no shared production route, token-store interface,
Wrangler configuration, frontend, migration or public-key asset was changed. No Tesla API was called.

## Acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Same-browser callback and encrypted persistence | MOCK_ONLY | Worker entrypoint tests use real crypto with mocked Supabase/Tesla transport. |
| Cross-browser, wrong-state, tampered and expired cookie rejection | VERIFIED | Local helper and Worker tests reject before privileged I/O. |
| Replay and concurrency safety | MOCK_ONLY | Atomic gateway simulation, deferred winning callback and concurrent cookie-less initiation. |
| Cloudflare cryptographic compatibility | VERIFIED | Real local workerd validates HKDF/HMAC and cookie expiry/key rejection. |
| Existing ADMIN/scope/redirect enforcement | VERIFIED | Full Worker regressions pass with unchanged assertions. |
| Hosted OAuth and database behavior | NOT_EXECUTED | Requires independent review and separately approved staging verification. |

## Verification status register

VERIFIED: local typechecks, security helper tests and workerd runtime compatibility.
MOCK_ONLY: complete Worker-to-database/provider flow and actor lease lifecycle.
UNVERIFIED: hosted cookie acceptance, existing lock RPC reachability and real Tesla callback behavior.

## Outstanding issues

- Cookie expiry is ten minutes. A crash, ambiguous consume response or failed cleanup can leave the
  lease until twelve minutes from acquisition. State is never retried after consumption; start a new
  flow when ownership becomes available. Cleanup uses an owner-matched release and bounded expiry.
- Cookie-less requests for different authenticated actors cannot be recognized as one browser before
  it receives a cookie. If such requests race, only the browser's current cookie can authorize its
  matching state; other callbacks fail closed. Already-running callbacks retain their original actor
  and household. Do not run simultaneous flows or switch accounts during consent.
- Browser-disabled/cleared cookies fail closed. A cookie stolen in full remains a bearer capability.
- The seeded Admin Tesla status is not a verified durable connection UI; use a controlled authenticated
  connect request for the eventual first test. Automatic token refresh, controls and cron remain off.

## Environment variables

No new bindings. Existing `TOKEN_ENCRYPTION_KEY` also derives the purpose-specific cookie HMAC key.
Preserve it unchanged. Both `STAGING_TESLA_OAUTH_ENABLED` and `STAGING_TESLA_LIVE_STATUS_ENABLED` remain
false in repository configuration; this task changes no hosted environment.

## Instructions for the next task

1. Independently review cookie authentication, actor leases, cleanup and failed-correlation ordering.
2. Keep both Tesla flags false while deploying approved code, after separate deployment approval.
   Verify the reviewed version serves 100% before activation; do not mix an enabled old version with it.
3. Verify existing state/lock RPC visibility and service-role execution without changing grants.
4. Retain current encryption and Tesla secrets; no migration is needed. Discard old authorization URLs:
   they have no corresponding new browser cookie and are intentionally rejected.
5. Only after approval enable the OAuth flag for one same-browser, current-ADMIN, read-only consent.
   Keep live status, controls, automation and scheduled execution disabled.
   The same-origin connect fetch must use browser credentials (default or `credentials: 'same-origin'`)
   so the browser accepts Set-Cookie. Do not reuse `credentials: 'omit'` from the earlier GET identity
   check. Navigate to the returned authorization URL in the same browser profile; JavaScript must not
   read or copy the HttpOnly cookie.
6. Before rolling back to pre-fix code, disable OAuth; old code would remove this security boundary.

## Next task

Independent security review, followed by separately approved isolated staging deployment and verification.
