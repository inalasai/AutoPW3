# AutoPW3 ? Task Handoff Report

**TASK NOT COMPLETE:** Implementation and Worker verification are complete; the local database runners could not finish their shutdown phase under current sandbox process permissions. Their assertions passed as described below, but clean successful command exits remain a verification blocker. No hosted behavior is verified.

## Task completed
Number and name: Phase 2 ? durable read-only staging Tesla OAuth (implementation complete; verification exit blocker above).
Branch / commit: `Raj-AutoPW3` / baseline `6fa37c19af4e5d32f248b08290f042f35b5fcb12`; changes uncommitted.
Date: 31 October 2026.

## Summary
The Worker now has a separate disabled-by-default staging connect/callback gate using Raj's existing durable encrypted state and credential adapters. Authenticated user reads retain the actual validated JWT and RLS; only encrypted-state-bound callback authority reaches the service-only persistence RPC. No telemetry, commands, refresh, automation, cron or production paths were enabled.

## Files created
| Path | Purpose |
|---|---|
| `apps/worker/src/lib/staging-config.ts` | Shared strict staging project, key, issuer/JWKS and HTTPS origin checks. |
| `apps/worker/src/lib/staging-tesla-oauth.test.ts` | Worker-entrypoint isolation, replay, concurrent callbacks, configuration, scope and failure regressions. |
| `apps/worker/src/lib/staging-tesla-oauth.ts` | Request-scoped authenticated connect and state-bound callback with durable dependencies only. |
| `apps/worker/src/providers/tesla/README.md` | Update folder status and current OAuth integration boundaries. |
| `apps/worker/src/providers/tesla/http.ts` | Bounded authorization/region HTTP, redirect rejection and sanitized errors. |
| `apps/worker/src/providers/tesla/oauth-transport.test.ts` | Real loopback redirect, timeout, response bounds and scp validation tests. |
| `apps/worker/src/providers/tesla/region.ts` | Exact supported Tesla NA/EU origins. |
| `apps/worker/src/routes/README.md` | Update folder status and current OAuth integration boundaries. |
| `docs/handoffs/PHASE-2-DURABLE-TESLA-OAUTH.md` | Phase 2 handoff, exact verification evidence and remaining prerequisites. |
| `supabase/migrations/20261031160000_authorize_tesla_oauth_persistence.sql` | Service-only ADMIN check and transactional, row-locked credential save plus actor audit; no new tables or weaker RLS. |
| `supabase/tests/database/143_durable_tesla_oauth.test.sql` | 22 SQL grant, role, tenant, scope, host and audit assertions. |

## Files modified
| Path | What changed and why |
|---|---|
| `.env.example` | Disabled OAuth feature flag and explicit regional configuration guidance. |
| `apps/worker/README.md` | Update folder status and current OAuth integration boundaries. |
| `apps/worker/src/db/README.md` | Update folder status and current OAuth integration boundaries. |
| `apps/worker/src/db/system-client.ts` | Allowlist only the two new OAuth authorization/persistence RPCs. |
| `apps/worker/src/env.ts` | Names the OAuth flag and regional audience binding. |
| `apps/worker/src/lib/README.md` | Update folder status and current OAuth integration boundaries. |
| `apps/worker/src/lib/app.ts` | Invoke the exact staging OAuth gate before the unchanged general deployment guard. |
| `apps/worker/src/lib/staging-identity.ts` | Reuse extracted configuration validation without changing identity semantics. |
| `apps/worker/src/providers/tesla/client.ts` | Discover region from configured approved origin without implicit fallback. |
| `apps/worker/src/providers/tesla/oauth.test.ts` | Supply the now-required audience in exchange fixtures. |
| `apps/worker/src/providers/tesla/oauth.ts` | Required audience, bounded sanitized code exchange, granted scp validation and read-only default scopes. |
| `apps/worker/src/routes/tesla.test.ts` | Match the explicit exchange audience to the existing EU mock region. |
| `apps/worker/src/routes/tesla.ts` | Reuse callback orchestration via narrow authority/persistence capabilities; reject provider failures and regional mismatch. |
| `apps/worker/src/services/tokens/README.md` | Update folder status and current OAuth integration boundaries. |
| `apps/worker/src/services/tokens/supabase-store.test.ts` | Reject invalid OAuth actors before any RPC; prevent unscoped-save selection. |
| `apps/worker/src/services/tokens/supabase-store.ts` | Reuse encryption for actor-checked OAuth persistence; validate actor IDs and write acknowledgements. |
| `docs/DECISIONS.md` | Append D-120 and official Tesla sources. |
| `docs/KNOWN_LIMITATIONS.md` | Append L-135; preserve historical entries. |
| `docs/handoffs/README.md` | Update folder status and current OAuth integration boundaries. |
| `scripts/README.md` | Update folder status and current OAuth integration boundaries. |
| `scripts/db-test.mjs` | Add two-connection atomic OAuth-state consumption regression. |
| `supabase/migrations/README.md` | Update folder status and current OAuth integration boundaries. |
| `supabase/tests/database/README.md` | Update folder status and current OAuth integration boundaries. |

## Decisions
D-120 records the narrow route gate, reuse of Raj adapters, explicit region, read-only scopes and transactional callback authorization. Sai's pinned `factory.ts` at `1e25918b2105f34168e5926b1ace0f7c3c7dee89` was consulted only for strict durable dependency construction; no Sai stores, repository facade, local fallback or test encryption key was imported.

The callback consumes state before exchange. A crash, denied consent, lost response or persistence failure after consumption requires a fresh connect; it never retries a single-use authorization code. Independent successful consent attempts for the same household can replace its credentials (last successful authorized save wins); no automatic reconnect or refresh is enabled.

## Database changes
Forward-only migration `20261031160000_authorize_tesla_oauth_persistence.sql` adds:
- `worker_validate_oauth_actor(uuid,uuid)`: service-only current ADMIN check, from trusted consumed state.
- `worker_save_tesla_credentials_for_oauth(...)`: rechecks ADMIN with a membership row lock, delegates existing encrypted credential persistence, and inserts a non-sensitive USER audit with the bound actor in one transaction.

Existing tables, RLS and grants remain authoritative. Both new RPCs revoke PUBLIC/anon/authenticated execution and grant service_role only. The callback never receives an authenticated user's JWT from query parameters or stores it in state. No hosted migration was applied.

## API changes
- `ENVIRONMENT=staging` and exact `STAGING_TESLA_OAUTH_ENABLED=true` only.
- Exact `POST /api/v1/households/{uuid}/provider/tesla/connect`, body `{}` or `{"enableControls":false}`, current ADMIN via request-scoped authenticated identity repository, Supabase JWT issuer/role/expiry/audience validation, durable per-actor rate limit. Narrow POST-only OPTIONS with approved origin/headers.
- Exact `GET /api/v1/provider/tesla/callback`: strictly bounded single-valued state/code or state/error, atomic durable consumption, encrypted actor/household/PKCE binding, current ADMIN check, bounded code exchange, granted scope check, regional discovery, transactional encrypted save. No callback CORS access or arbitrary redirect target.
- Configuration binds incoming HTTPS origin, APP_BASE_URL, allowed origins and exact callback URI. Public and legacy service-role keys remain separate. Opaque sb_secret_ keys remain unsupported.
- Request exactly `openid offline_access energy_device_data`. Validate the documented access-token `scp` claim (string or string array), or explicit token-response scope for opaque tokens; reject missing, mixed-type, insufficient, conflicting or additional scopes. Refresh token and valid expiry required.
- Token exchange supplies explicit approved NA/EU audience. Regional discovery starts there; returned Fleet origin must be approved and match. Failure never falls back to North America or forwards credentials to a returned unapproved host. China is outside this slice.
- Token/region requests reject redirects, time out after 10 seconds and cap response bodies at 64 KiB. Provider errors/callback denials expose no upstream bodies, codes, state, credentials or transport messages. Responses use no-store; active-slice responses set no-referrer.
- Existing staging identity gate, all other incomplete routes, production and scheduled guards remain intact. No generic app repository/idempotency completion is claimed.

## Checks executed
| Exact command | Executed? | Result | Relevant output/failure |
|---|---|---|---|
| `npm run test --workspace @autopw3/worker -- --configLoader native --pool threads --maxWorkers 4` | yes | PASS: 418 tests, 32 files | Native config loader avoids sandbox esbuild process spawning. |
| `npm run typecheck` | yes | PASS (exit 0) | All workspaces and e2e TypeScript. |
| `npm run lint` | yes | PASS (exit 0) | ESLint, architecture checks, Prettier. |
| `npm run db:test` | yes | BLOCKED clean exit | Normal launch: spawn EPERM at embedded-postgres initdb. Temporary file-backed stdio preload: all 538 SQL assertions + 3 two-connection checks passed, zero assertion failures; 52-policy manifest matched. Runner stalled in shutdown; pg_ctl reported Operation not permitted. Interrupted the process group, exit 1. |
| `npm run db:verify` | yes | BLOCKED clean exit | Normal launch: same spawn EPERM. File-backed stdio run completed migration/constraint checks, 17 migrations apply/reapply idempotently, 30 design tables; stalled in shutdown and was interrupted, exit 1. |
| `npm run secrets:scan` | yes | PASS (exit 0) | No live credential inputs used. |
| `git diff --check` | yes | PASS (exit 0), CRLF-to-LF notices only | Whitespace check. |

The stdio adapter was temporary `.phase2-pg-stdio.mjs`, supplied only via process-local `NODE_OPTIONS=--import=file:///C:/AutoPW3/.phase2-pg-stdio.mjs` while invoking the unchanged npm commands. It substituted child-process pipes with files and did not change SQL, assertions, database roles or auth. It was removed afterwards; NODE_OPTIONS was restored. No dependency or permanent harness workarounds were added. The test process groups were interrupted to terminate their local PostgreSQL children; both known test ports (54519 and 62851) were confirmed closed afterwards. Local temporary data/log files may remain after forced shutdown. These are local PostgreSQL results, never hosted Supabase verification.

Earlier targeted runs exposed and corrected test fixture mismatches (explicit audience must match existing EU mock; rate RPC returns a positive retry interval even when allowed). No assertions were removed or relaxed.

## Manual verification
Reviewed exact route/method guards, raw encoded paths, query validation, shared identity config extraction, credential separation, SQL execute grants, current-ADMIN transaction lock and fixed provider hosts. No deployed flags, credentials, cron configuration or deployment workflow were changed. Final branch and HEAD still match Raj-AutoPW3 / 6fa37c19af4e5d32f248b08290f042f35b5fcb12. Both stashes remain: stash@{0} ce40d5f and stash@{1} 491ac14. Initial working tree was clean; all current modifications belong to this task. No commit, push, branch change, stash mutation, deployment or hosted migration occurred.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Existing durable adapters reused | VERIFIED | Runtime constructors use SupabaseOAuthStateStore and SupabaseTokenStore. |
| Actor and household isolation | VERIFIED / MOCK_ONLY | New local SQL assertions passed; entrypoint mocked gateway tests reject other households, roles and revoked actors. |
| Single-use/concurrent callback | VERIFIED / MOCK_ONLY | Two PostgreSQL connections consume once; Worker Promise.all produces one exchange/persistence. |
| Fresh-instance encrypted token persistence | MOCK_ONLY | New SupabaseTokenStore decrypts actual ciphertext saved by another request through the mocked RPC gateway. |
| Provider scope/audience/redirect/timeout security | MOCK_ONLY | Mocked TLS endpoint tests and real loopback redirect tests; no Tesla API contact. |
| Clean local DB verification command exits | FAILED | Infrastructure permission/shutdown block described above. |
| Hosted Supabase/Cloudflare/Tesla behavior | NOT_EXECUTED | Approval/configuration needed. |

## Verification status register
VERIFIED: local database assertions (with runner-exit caveat), migration idempotency assertions, route guards and code review.
MOCK_ONLY: Worker-to-Supabase/Tesla end-to-end path, granted scope shapes, token persistence across newly constructed handlers/stores.
AWAITING_CREDENTIALS / AWAITING_PROVIDER_APPROVAL: isolated staging configuration, Tesla app regional registration/consent approval and exact callback registration. Never send secrets in chat.
UNVERIFIED: hosted RLS/PostgREST schema-cache/grants, actual Tesla token response and regional account behavior, Cloudflare runtime integration.

## Outstanding issues
- Re-run db:test and db:verify where child-process creation and cleanup are permitted, obtaining clean exits before enabling staging.
- Hosted migration application, configuration and deployment need separate approval. This task does none of them.
- Configure actual HTTPS staging app/callback/allowed origins and one known Tesla region. Verify regional onboarding/partner requirements externally; this code never registers an app or pairs a virtual key.
- Confirm actual Tesla scope response includes the required read-only grants. Extra existing consent fails closed; refresh and provider revocation behavior remain for later phases.
- Ensure Cloudflare/access logs exclude OAuth query strings and credentials before hosted use. Application errors/logs do not include them.
- Refresh, telemetry, provider usage/budget enforcement and all control/automation capabilities remain outside this phase. Provider AUTH/DATA usage recording is not added here; no spend-cap claim.

## Environment variables
Names only: STAGING_TESLA_OAUTH_ENABLED (default false in .env.example), SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY (legacy service-role JWT), ALLOWED_ORIGINS, APP_BASE_URL, TESLA_CLIENT_ID, TESLA_CLIENT_SECRET, TESLA_REDIRECT_URI, TESLA_FLEET_API_BASE_URL, TOKEN_ENCRYPTION_KEY. Configure through approved staging vars/secrets only. Existing STAGING_IDENTITY_READ_ENABLED is independent and unchanged. No deployed value was set.

## Instructions for the next task
Review the uncommitted diff and rerun the exact checks above in an environment with working PostgreSQL process cleanup. Preserve Raj's staging project/JWT binding and request-scoped RLS client. Do not enable generic routes or replace durable stores with Sai implementations. Keep callback actor authority sourced solely from consumed authenticated-encrypted state and preserve the final transactional membership check.

## Next task
Isolated hosted staging OAuth verification after clean local checks, explicit approval for staging migration/configuration/deployment, and Tesla portal prerequisites. Product discovery and read-only telemetry require a later separately scoped implementation. Production remains NO-GO.
