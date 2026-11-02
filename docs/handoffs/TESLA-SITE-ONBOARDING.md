# AutoPW3 — Task Handoff Report

## Task completed

Number and name: Gated staging Tesla energy-site discovery and durable household linking.
Branch / commit: Raj-AutoPW3 / 606b7d4; uncommitted workspace implementation.
Date: 2026-11-01.

## Summary

One default-false staging flag admits authenticated ADMIN discovery and linking at two exact paths.
Discovery reads only Tesla products using existing encrypted household credentials. Linking verifies
the selected decimal ID afresh, then commits the site, actual-actor audit and idempotent response in
one authenticated database transaction. No telemetry, refresh, control, automation or cron is enabled.

## Files created

| Path | Purpose |
| --- | --- |
| `apps/worker/src/lib/staging-tesla-sites.ts` | Two narrow staging exceptions; config/JWT/session/rate/ADMIN guards; verified discovery and linking. |
| `apps/worker/src/lib/staging-tesla-sites.test.ts` | Worker entrypoint tests with encrypted durable-store transport; errors, isolation, retries, concurrency and guards. |
| `apps/worker/src/db/site-link-repository.ts` | Request-scoped actual-user-JWT context and mutation RPC adapter with output validation. |
| `packages/shared/src/schemas/tesla-site-link.test.ts` | Strict request and honest metadata response contract checks. |
| `supabase/migrations/20261101170000_link_discovered_tesla_sites.sql` | Private verification/idempotency storage, service-only preparation and authenticated transactional mutation. |
| `supabase/tests/database/145_tesla_site_linking.test.sql` | 49 local SQL assertions for permissions, roles, sessions, tenancy, provenance, retries, fencing and audit. |
| `scripts/db/tesla-site-link-concurrency.mjs` | Three real two-connection row/index lock races in the throwaway database. |
| `docs/handoffs/TESLA-SITE-ONBOARDING.md` | This handoff, exact manifest and staging rollout prerequisites. |

## Files modified

| Path | What changed and why |
| --- | --- |
| `apps/worker/src/lib/app.ts` | Calls the new exact staging exception before the existing global fail-closed guard. |
| `apps/worker/src/env.ts` | Adds optional `STAGING_TESLA_SITES_ENABLED`; absent or non-exact-true remains disabled. |
| `apps/worker/wrangler.jsonc` | Adds only the new staging flag with value false; existing environment configuration is preserved. |
| `apps/worker/src/db/system-client.ts` | Allows only the new server-side preparation RPC; user context/link RPCs are not privileged dependencies. |
| `apps/worker/src/providers/tesla/client.ts` | Hardens reused `listProducts`: approved region, bounded timeout/body/list, strict IDs, nullable safe names, sanitized failures and redirect rejection. |
| `packages/shared/src/schemas/sites.ts` | Adds staging request/metadata response schemas without changing legacy route DTOs. |
| `scripts/db-test.mjs` | Invokes the isolated three-case site-link concurrency helper. |
| `supabase/tests/database/100_hardening_and_grants.test.sql` | Preserves the exhaustive allowlist assertion, adding exactly the two new authenticated RPCs; no assertions removed. |
| `apps/worker/src/db/README.md` | Scoped user repository and transactional persistence status. |
| `apps/worker/src/lib/README.md` | New flag, routes, dependencies and unchanged guards. |
| `apps/worker/src/providers/tesla/README.md` | Product discovery validation and transport bounds. |
| `packages/shared/README.md` | New staging-only schema contract. |
| `scripts/README.md` | Real concurrency test scope and fixture isolation. |
| `supabase/migrations/README.md` | Migration prerequisites and no hosted application. |
| `supabase/tests/database/README.md` | New 49 assertions and exact privilege-allowlist expansion. |
| `docs/DECISIONS.md` | Append D-124. |
| `docs/KNOWN_LIMITATIONS.md` | Append L-139. |
| `docs/handoffs/README.md` | Links this handoff. |

## Decisions

D-124 records the narrow rollout and actor-aware access split. Authenticated context and final mutation
use public key plus actual user JWT. Only verified provider provenance is recorded through a service-role
RPC. Its UUID capability is never returned by the Worker and cannot be forged by ordinary users.

The proof is scoped to actor, live session, household, canonical provider ID and current credential
revision. The revision hashes ciphertext/nonce and canonical metadata internally and returns only an
opaque SHA-256 value; expiry is represented as epoch to avoid timezone-dependent hashes. Credential
changes, including same-timestamp replacements, fence old observations.

The final function independently derives auth.uid()/session/expiry, requires current ADMIN, locks
session/membership/credentials/request, then inserts without overwriting any existing site. A global
provider/site-ID conflict in another household returns a generic conflict. Same-household duplicates
return the existing metadata. New rows remain CONNECTING with null capabilities; timezone comes from
the household and the optional safe name comes from Tesla. No fabricated LIVE state or capabilities.

Idempotency is actor + household + this operation + key. The canonical site ID is the complete client
payload identity: caller names, timezones, scopes, household IDs and control settings are rejected.
Same-key retries return the original result/status, including after an ambiguous HTTP failure. A changed
payload conflicts until the 24-hour record expires. Two-minute pending proofs can be renewed only after
fresh backend discovery. Cleanup removes at most ten expired records for that actor/household per call.
Read-only provider GETs can repeat during retries; idempotency concerns the database mutation.

## Database changes

One new forward-only migration depends on `20261101160000_fence_staging_tesla_oauth.sql` and reuses
its live-session/ADMIN helper without modifying OAuth code or schema. It adds private RLS-enabled
`tesla_site_link_requests`; no public table, public RLS policy or existing table grant is changed.

- `tesla_site_link_context(uuid)`: authenticated-only, current-session ADMIN metadata context.
- `worker_prepare_tesla_site_link(...)`: service-role-only, backend-verified provider selection.
- `link_discovered_tesla_site(uuid,uuid,text)`: authenticated-only, atomic mutation/audit/result.
- Private helper `tesla_site_credential_context(...)` has no execute grant to public/user/service roles.

All SECURITY DEFINER functions use empty search_path. Existing direct ADMIN PostgREST site-insert grants
remain part of the prior architecture; the new workflow does not claim to constrain every privileged or
manual database writer. No hosted migration or real household/site mutation was performed.

## API changes

Both require ENVIRONMENT=staging, the exact true site flag, a valid Supabase bearer with session_id,
an active Auth session, current household ADMIN, complete durable config and durable rate limiting
(ten attempts per actor/minute). Production/local execution, query overrides, encoded aliases,
trailing slashes and other methods remain closed. No frontend onboarding UI is added.

| Request | Response |
| --- | --- |
| GET `/api/v1/households/{householdId}/provider/tesla/discovered-sites` | 200 `{items:[{providerSiteId,name}]}`; IDs are positive decimal strings; names can be null. |
| POST `/api/v1/households/{householdId}/sites` | Required Idempotency-Key; body `{providerSiteId}` with optional constant provider TESLA. Returns `{created,site}`: 201 for a new result and its same-key replays; 200 for an already-owned site under a different key. |

Site metadata contains id (AutoPW3 UUID), householdId, provider, providerSiteId, nullable name,
timezone and connectionState. This gated response deliberately omits the legacy synthetic capability
summary. The discovery provider request is only GET `/api/1/products` on the stored approved region;
no commands, telemetry or refresh endpoints are called. Missing/expired credentials fail closed.

## Checks executed

| Exact command | Executed? | Result | Relevant output/failure |
| --- | --- | --- | --- |
| `npm run test --workspace @autopw3/worker -- src/lib/staging-tesla-sites.test.ts src/providers/tesla/client.test.ts src/providers/tesla/workerd.test.ts src/routes/tesla.test.ts src/lib/staging-tesla-oauth.test.ts src/lib/staging-tesla-live-status.test.ts --configLoader native --pool threads --maxWorkers 1` | yes | PASS | 293 tests / 6 files, including actual local workerd redirect regressions. |
| `npm run test --workspace @autopw3/shared -- src/schemas/tesla-site-link.test.ts --configLoader native --pool threads --maxWorkers 1` | yes | PASS | 10 schema tests. |
| `npm run typecheck` | yes | PASS | All workspaces and e2e. |
| `npm run db:test` | yes | PASS | Final clean run: PostgreSQL 17.10; 19 migrations; 23 files; 631 checks, zero failures (623 SQL assertions and 8 concurrency checks). |
| `npm run db:verify` | yes | PASS | Empty install, idempotent reapplication, reset/reapply, 30 public design tables, RLS/grants/constraints. |

The initial SQL runs were not counted as successful: the privilege allowlist first needed its precise
two-function expansion, fixture demotion needed cleared caller claims, and a run begun before the final
epoch-based fingerprint correction caught the added timezone assertion. The final clean run above
includes all assertions. The prior task's security and concurrency checks remain present.

Targeted ESLint/Prettier, `npm run lint:rules`, `npm run secrets:scan` and `git diff --check` passed.
The last command emitted only existing line-ending warnings. No full application suite, production
build or deployment is claimed. Exact source-check arguments (PowerShell, repository root):

```powershell
$taskSources = @(
  'apps/worker/src/env.ts',
  'apps/worker/src/db/system-client.ts',
  'apps/worker/src/db/site-link-repository.ts',
  'apps/worker/src/lib/staging-tesla-sites.ts',
  'apps/worker/src/lib/staging-tesla-sites.test.ts',
  'apps/worker/src/lib/app.ts',
  'apps/worker/src/providers/tesla/client.ts',
  'packages/shared/src/schemas/sites.ts',
  'packages/shared/src/schemas/tesla-site-link.test.ts',
  'scripts/db-test.mjs',
  'scripts/db/tesla-site-link-concurrency.mjs'
)
node node_modules/eslint/bin/eslint.js @taskSources
node node_modules/prettier/bin/prettier.cjs --check @taskSources apps/worker/wrangler.jsonc
```

## Manual verification

Inspected actual energy_sites constraints, unique provider key, ADMIN insert RLS/grants, existing token
encryption adapter, authenticated transport, session helper and legacy routes before implementation.
Existing OAuth credentials/site counts are user-reported; no live database or Tesla inspection occurred.
All provider requests in tests are intercepted or routed to local workerd fixtures.

## Acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Exact staging-only opt-in and preserved global guard | VERIFIED | Worker entrypoint tests; new flag defaults false. |
| Genuine provider discovery implementation without mock fallback | MOCK_ONLY | Real TeslaClient transport tested against controlled products; no real Tesla call. |
| Durable authenticated linking and server-issued provenance | VERIFIED | Worker transport tests and real PostgreSQL functions/grants/role checks. |
| Tenant/session/revision isolation and no token exposure | VERIFIED | SQL and Worker negative tests and output validation. |
| Idempotent retry, crash recovery and race safety | VERIFIED | Lost-response replay and three real two-connection races. |
| Existing OAuth, read-only scope and telemetry restrictions | VERIFIED | Targeted regressions; no existing flags/scopes enabled. |
| Hosted installation and real Tesla discovery/linking | NOT_EXECUTED | Outside approved local implementation scope. |

## Verification status register

VERIFIED locally: atomic site/audit/idempotency transaction, global uniqueness, actor attribution,
real row/index contention, live session checks, opaque credential revision, safe product validation and
schema/type checks. MOCK_ONLY: Tesla product payloads/permissions/availability. UNVERIFIED: hosted Auth
and PostgREST grants/function visibility, actual Tesla product response and end-to-end staging linkage.

## Outstanding issues

Hosted migration and staging deployment/activation require separate approval. Credentials must remain
unexpired; this phase does not refresh them. A per-actor rate limit is not a monthly spend-cap guarantee.
Existing Settings demo ACTIVE display and other household API guards are unchanged. No provider billing,
real product identity, capabilities or telemetry availability has been verified by this task.

## Environment variables

New staging variable: STAGING_TESLA_SITES_ENABLED=false. No new secret is needed. Reuse existing
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY (legacy service-role JWT), TOKEN_ENCRYPTION_KEY,
APP_BASE_URL, ALLOWED_ORIGINS and ENVIRONMENT. Existing OAuth configuration and live-status flag remain
unchanged. No actual household ID, credentials or account configuration is hard-coded into source.

## Instructions for the next task

1. Independently review the patch and approve hosted actions separately. Verify the session-hardening
   prerequisite and apply only the forward-only migration through the established approved procedure.
2. Deploy only autopw3-staging with the new flag false. Keep existing OAuth settings, live-status false,
   commands/automation/cron and shared deployment workflow safeguards unchanged.
3. After separate activation approval, set only the new staging site flag true. Use an existing ADMIN
   session through a bearer-attaching authorized client; the existing Settings hook does not perform this
   onboarding workflow and is not a reliable connection-status check.
4. GET discovery, select the intended Tesla-returned ID, then POST it with a fresh stable idempotency key.
   Verify the returned AutoPW3 UUID and household metadata. Repeat the same body/key to confirm stable
   replay. No manual SQL insertion or invented provider ID is required or appropriate.
5. Confirm the persisted link under RLS. Obtaining live status remains a separately approved later action;
   do not enable it, commands, polling or automation as part of onboarding rollout.

Preserve all unrelated uncommitted files, the verified public-key asset, the ignored staging frontend
environment and both Git stashes. No commits, pushes, hosted migrations, deployments or secret changes
were performed in this task.

## Next task

Independent review followed by separately approved staging-only migration, deployment and one manual
discovery/linking verification. Keep live telemetry disabled until linkage has been verified.
