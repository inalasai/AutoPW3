# AutoPW3 - Task Handoff Report

## Task completed
Number and name: Phase 3 - gated read-only Tesla Powerwall live status.
Branch / commit: `Raj-AutoPW3` / baseline `026f0e4488495a4bf9b5ae3eaf05991e6f25a1d9`; implementation uncommitted.
Date: 31 October 2026.

## Summary
A separate default-disabled staging endpoint reads one live Tesla status response for an already persisted authorized energy site. It reuses authenticated RLS reads, the existing encrypted durable household token store, durable rate limiting and Tesla Fleet client; it never invokes demo fallback, normalization, telemetry persistence, refresh, commands or scheduled work. Measurements preserve native numeric values/signs and distinguish absent values/timestamps as null. No real Tesla credentials were accessed and no Tesla API call was made.

## Files created
| Path | Purpose |
|---|---|
| `apps/worker/src/lib/staging-tesla-live-status.test.ts` | 94 entrypoint cases for gates, actor/tenant isolation, encrypted persistence, revocation, scopes, HTTP/configuration failures and native nullable measurements. |
| `apps/worker/src/lib/staging-tesla-live-status.ts` | Request-scoped authenticated member read, durable rate/credential access, ownership rechecks and safe error mapping. |
| `apps/worker/src/providers/tesla/live-status.ts` | Validate stored energy ID and project finite provider fields with no clamping, inversion, derivation or timestamp invention. |
| `docs/handoffs/PHASE-3-TESLA-LIVE-STATUS.md` | Record exact changes, evidence, limits and next verification milestone. |
| `packages/shared/src/schemas/provider-live-status.ts` | Strict public diagnostic response contract; separate from normalized/persisted telemetry. |

## Files modified
| Path | What changed and why |
|---|---|
| `.env.example` | Add independent default-false STAGING_TESLA_LIVE_STATUS_ENABLED. |
| `apps/worker/README.md` | Update current folder status and link the Phase 3 handoff. |
| `apps/worker/src/env.ts` | Declare the staging live-status binding. |
| `apps/worker/src/lib/README.md` | Update current folder status and link the Phase 3 handoff. |
| `apps/worker/src/lib/app.ts` | Invoke the exact staging gate before unchanged global deployment/legacy dependency guards. |
| `apps/worker/src/providers/tesla/README.md` | Update current folder status and link the Phase 3 handoff. |
| `apps/worker/src/providers/tesla/client.test.ts` | Realistic numeric ID fixture; large ID precision, malformed IDs/hosts and bounded transport checks. |
| `apps/worker/src/providers/tesla/client.ts` | Harden existing getLiveStatus using approved host, decimal site ID and bounded transport; preserve existing typed errors. |
| `apps/worker/src/providers/tesla/http.ts` | Extend existing bounded JSON transport with sanitized typed status, timeout, malformed-response and bounded retry information. |
| `apps/worker/src/providers/tesla/oauth-transport.test.ts` | Extend real loopback redirect checks to live_status and update the sanitized transport message assertion. |
| `docs/DECISIONS.md` | Append D-121 with security decisions, Sai comparison and official Tesla reference. |
| `docs/KNOWN_LIMITATIONS.md` | Append L-136 with actual hosted/live prerequisites and scope exclusions. |
| `docs/handoffs/README.md` | Update current folder status and link the Phase 3 handoff. |
| `packages/shared/README.md` | Update current folder status and link the Phase 3 handoff. |
| `packages/shared/src/index.ts` | Export the isolated snapshot schema/type. |

## Decisions
D-121 records the route-specific staging gate, read permission for all household roles, encrypted household credential reuse, explicit native-sign response, no refresh and point-in-time RLS revalidation around provider I/O. The existing `normaliseLiveStatus` is deliberately not changed or called: it asserts a battery sign inversion and can synthesize a timestamp. Neither behavior is appropriate before real provider signs/payloads have been verified.

`git fetch origin` was attempted and denied `.git/FETCH_HEAD` write access. Read-only GitHub compare confirmed remote Raj equals the local baseline, with current Sai pinned to `1e25918b2105f34168e5926b1ace0f7c3c7dee89` (Sai 9 ahead / 5 behind). Reviewed Sai's Fleet client, telemetry handler and application dependency/authorization wiring. Its existing telemetry route writes/caches/falls back to demo and uses the generic repository factory; no safe newer live-status slice was found. Reuse Raj's hardened boundaries; import no Sai facade, store or deployment changes.

## Database changes
None. No tables, RPCs, migrations, policies, grants or generated database types changed. Existing `142_authenticated_site_reads.test.sql` covers authenticated RLS and cross-household site visibility; the complete existing SQL suite is preserved. Service-role calls in this new path are limited to `worker_check_rate_limit` and `worker_get_tesla_credentials`, after verified app identity; the latter is reached only for the household derived from an authorized persisted site. Encrypted envelopes are validated against that household by the existing store.

## API changes
Exact route:
`GET /api/v1/households/{householdId}/sites/{siteId}/provider/tesla/live-status`

- Only `ENVIRONMENT=staging` and exact `STAGING_TESLA_LIVE_STATUS_ENABLED=true`; default false in .env.example and not set in Wrangler.
- Valid Supabase bearer JWT (actual project issuer/JWKS, authenticated audience/role, required expiration and UUID actor).
- All current household roles (`READ_ONLY`, `READ_WRITE`, `ADMIN`) may read. The path household must equal the RLS-visible site's real household. No caller-supplied provider IDs, URLs, query overrides or configuration writes.
- Persisted `provider=TESLA`, bounded positive decimal provider ID kept as a string (1-20 digits, no leading zero or whitespace), and non-DISCONNECTED site required. A persisted CONNECTING site may obtain its first read; no connection state is changed or fabricated.
- Rate limit: ten attempts per authenticated actor/minute, across household/site path choices, enforced with the existing durable PostgreSQL counter. No monthly monetary cap or provider-usage recording is claimed.
- Active credentials are loaded/decrypted by household. Require `energy_device_data`, Bearer token type and an approved stored NA/EU origin; no alternate-region discovery/retry. Expired or expiring access tokens (30-second request margin) fail with reconnect guidance. No refresh or lease subsystem is added or activated.
- Site ownership/provider-ID/membership are re-read through authenticated RLS after privileged token loading and again after the provider response. Revocation or remapping during either wait denies the read. This does not claim a continuous database transaction over external I/O.
- Call exactly `GET /api/1/energy_sites/{storedProviderSiteId}/live_status`, no body. Ten-second signal includes response reading, maximum 64 KiB, redirects rejected. HTTP failures, malformed envelope/JSON, timeouts and network failures are sanitized; upstream bodies are never included in errors/logs.
- Strict GET-only OPTIONS preflight for this exact route with approved origin and headers. No privileged or provider I/O on preflight. All active responses are no-store/no-referrer. No authorization/client/provider secrets appear in the response.
- Existing identity/OAuth flags are independent. General telemetry, product discovery/site mutation, commands, production API, cron and deployment workflow guards remain unchanged.

Success is validated by `ProviderLiveStatusSchema`:

```typescript
{
  siteId: string; // authorized internal UUID
  source: 'TESLA';
  signConvention: 'TESLA_NATIVE';
  batterySocPercent: number | null;
  solarPowerW: number | null;
  batteryPowerW: number | null;
  gridPowerW: number | null;
  loadPowerW: number | null;
  providerTimestamp: string | null; // provider-supplied ISO datetime with zone; no synthesized time
}
```

Mapping uses existing Raj candidate fields `percentage_charged`, `solar_power`, `battery_power`, `grid_power`, `load_power`, `timestamp`. Zero is a real value. Missing/null maps to null; malformed known fields (including non-finite numbers, out-of-range SOC or invalid timestamp) fail closed. At least one actual numeric measurement is required. No home-load calculation, sign inversion, zero filling, received timestamp, freshness classification, capabilities or device statuses are invented. Unknown provider fields are omitted. This snapshot is NOT the normalized LiveReading/accounting/persistence model; its sign direction remains unverified. The original timestamp string and offset are retained.

Errors use existing API envelopes and request IDs:

| Condition | HTTP/code | Detail issue when applicable |
|---|---|---|
| Disabled/outside staging/wrong method or path | Existing guards | No Tesla request |
| Missing/invalid app JWT | 401 UNAUTHENTICATED | No privileged reads |
| Missing/foreign/revoked/disconnected site or household mismatch | 404 NOT_FOUND | Same message hides foreign resource existence |
| Configuration failure | 502 PROVIDER_UNAVAILABLE | No fallback |
| Missing/expired credentials or missing read scope | 502 PROVIDER_UNAVAILABLE | tesla_credentials_missing / tesla_credentials_expired / tesla_read_scope_missing |
| Bad stored provider ID or region | 502 PROVIDER_UNAVAILABLE | tesla_site_id_invalid / tesla_region_invalid |
| Tesla 401 / 403 / 404 | 502 PROVIDER_UNAVAILABLE | tesla_unauthorized / tesla_forbidden / tesla_site_not_found; no app-session logout implied |
| Local or Tesla throttling | 429 RATE_LIMITED | Retry-After; Tesla integer seconds bounded 1-3600, default 60 |
| Tesla 5xx | 502 PROVIDER_UNAVAILABLE | tesla_service_unavailable |
| Network / timeout / malformed or measurement-free response | 502 PROVIDER_UNAVAILABLE | tesla_network_failure / tesla_timeout / tesla_invalid_response |
| Other Tesla HTTP error | 502 PROVIDER_UNAVAILABLE | tesla_http_failure |
| Database authentication/permission error | 401 / 403 | Sanitized database authorization failure |
| Other database/credential verification failure | 502 PROVIDER_UNAVAILABLE | Sanitized failure; never stored/demo data |

## Checks executed
| Exact command | Executed? | Result | Relevant output |
|---|---|---|---|
| `git fetch origin` | yes | BLOCKED | Permission denied opening .git/FETCH_HEAD; used read-only GitHub compare/file reads instead. |
| `npm run test --workspace @autopw3/worker -- --configLoader native --pool threads --maxWorkers 4` | yes | PASS, exit 0: 523 tests / 33 files | Entire Worker suite, including existing identity/OAuth/job/security tests. |
| `npm run test --workspace @autopw3/shared -- --configLoader native --pool threads --maxWorkers 4` | yes | PASS, exit 0 | 226 tests / 15 files. |
| `npm run typecheck` | yes | PASS, exit 0 | Every workspace plus e2e. |
| `npm run lint` | yes | PASS, exit 0 | ESLint, architecture checks and Prettier. |
| `npm run db:test` | yes | PASS, exit 0 | PostgreSQL 17.10: 538 SQL assertions + 3 two-connection checks = 541 ok, 0 not ok, 21 files; policy manifest matches 52 policies. |
| `npm run db:verify` | yes | PASS, exit 0 | 17 migrations apply/reapply idempotently; seed/reset/constraints/security and 30 design tables verified. |
| `npm run secrets:scan` | yes | PASS, exit 0 | No live credentials read. |
| `git diff --check` | yes | PASS, exit 0; CRLF-to-LF notices only | Whitespace validation. |

Both database commands completed normally with their original runners and cleanup in this Phase 3 session. No stdio adapter, preload, process monkeypatch, migration change or assertion bypass was used. The Phase 2 historical process restrictions did not recur; that older handoff remains a historical record. These results are local PostgreSQL, never hosted Supabase verification. Two added final-review regressions reject decimal provider IDs with trailing newlines; no tests were weakened.

## Manual verification
Reviewed actual gate placement before legacy dependencies, exact routes/methods, query rejection, persisted household/provider mapping, RLS calls, encrypted envelope binding, credential separation, HTTP retry/error behavior, native sign/null mapping and absence of live write paths. Loopback HTTP regression tests prove 301/302/303/307/308 never contact the redirect destination. No real Tesla API request or genuine device reading occurred. Final branch/HEAD remain Raj-AutoPW3 / 026f0e4488495a4bf9b5ae3eaf05991e6f25a1d9; the two stashes remain ce40d5f and 491ac14. Initial working tree was clean. No commit, push, branch change, stash mutation, deployment or hosted migration occurred. Wrangler, scheduled handler, deployment workflow, database runners and migrations are unchanged.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Staging default-disabled exact-route GET and narrow preflight | VERIFIED / MOCK_ONLY | Worker entrypoint tests; config flag false and absent in Wrangler. |
| Existing durable site and credential adapters reused | VERIFIED / MOCK_ONLY | Real adapters exercised through mocked PostgREST/RPC with real encrypted envelopes. |
| Household member reads, cross-household/revocation denial | VERIFIED / MOCK_ONLY | Local SQL RLS regressions and entrypoint tests including revocation during I/O. |
| HTTP host/ID/scope/expiry restrictions | MOCK_ONLY | Approved/rejected origins, ID precision/invalid inputs, scope/expiry, timeout and real loopback redirects. |
| Native values and absent data distinction | MOCK_ONLY | Finite partial response, real zeroes, negative signs and timestamp preservation tests. |
| No demo, persistence, refresh, commands or cron | VERIFIED / MOCK_ONLY | Forbidden-dependency spies, sole provider GET assertion, command path denial and scheduled guard. |
| Local verification | VERIFIED | Commands and exact final results above/below. |
| Hosted/live behavior | NOT_EXECUTED | Deliberately outside authorized implementation scope. |

## Verification status register
VERIFIED: local SQL migrations/security, clean database runner completion and static gate/credential separation review.
MOCK_ONLY: Worker-to-Supabase/Tesla end-to-end path, provider HTTP failures/timeouts and native field mapping; redirect behavior additionally exercised with real local HTTP servers.
AWAITING_CREDENTIALS / AWAITING_PROVIDER_APPROVAL: separately approved isolated staging configuration and Tesla app/account regional onboarding.
UNVERIFIED: hosted Supabase/PostgREST/RLS/RPC behavior, actual owner Powerwall payload, field availability, timestamp format, signs and physical device status. No genuine reading is claimed.

## Outstanding issues
- Isolated staging must have the existing migrations/RPCs, project-bound auth, valid encrypted household credentials and matching encryption key. No hosted migration/configuration/deployment action is authorized by this handoff.
- An authorized persisted Tesla energy-site row must already exist with the correct numeric provider ID. Durable site discovery/creation is not implemented/enabled by this phase; future provisioning needs its own reviewed task or separately approved trusted setup. Never synthesize a provider ID or bypass membership/RLS to obtain one.
- Tesla partner/regional app registration and actual consent must be verified externally. The live read needs only the existing stored read grant; Tesla OAuth client credentials are not required by this read route. Reconnect via the separately gated Phase 2 flow if credentials expire.
- Real provider fields/signs/timestamps require one separately authorized owner read. Native data must not be fed into normalized energy accounting or directional UI until actual sign conventions are confirmed.
- Hosted runtime integration and access-log redaction remain unverified. Do not log bearer headers, credential data or sensitive provider payloads.
- Per-actor rate limiting does not enforce monetary or household spend caps; no automatic polling, background job, refresh or usage-ledger behavior is introduced.
- Production, commands, automation, scheduled work, history/backfill and generic repository/idempotency work remain outside this phase.

## Environment variables
New: `STAGING_TESLA_LIVE_STATUS_ENABLED` (false in .env.example, absent in Wrangler; no deployed value set).
Read-path requirements: ENVIRONMENT, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY (legacy service_role JWT; sb_secret_ still unsupported), TOKEN_ENCRYPTION_KEY, APP_BASE_URL, ALLOWED_ORIGINS. LOCAL_MOCKS=true is refused.
Existing STAGING_IDENTITY_READ_ENABLED and STAGING_TESLA_OAUTH_ENABLED remain independent and disabled by default. The read uses only stored regional metadata; it does not read caller/configured alternate Tesla URLs or require OAuth client secrets.

## Instructions for the next task
Review this exact uncommitted slice. Preserve the full existing security suite and deployment guards; do not import Sai persistence implementations or enable general telemetry. Confirm hosted prerequisites and obtain explicit approval before setting any deployed flag, applying migrations or deploying. Tokens/keys must be configured privately, never supplied in chat or fixtures. Record a genuine response only after authorization and sanitize any retained artifact; do not change signs from an assumption.

## Next task
After review and separate deployment/configuration approval, verify the isolated staging endpoint against one already authorized owner Powerwall. If no durable linked site exists, first implement/review the smallest safe provisioning/discovery prerequisite. GO for committing the tested code does not authorize deployment or claim production readiness.
