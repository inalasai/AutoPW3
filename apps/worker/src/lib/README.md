# Worker request helpers

This folder contains routing, request security helpers, and local in-memory test/development stores.
The durable Supabase rate limiter hashes caller scope before invoking an atomic service-role RPC; the
default limiter remains in-memory only for explicit local/test use. In-memory API fallback requires
`ENVIRONMENT=local` plus `LOCAL_MOCKS=true` (or the explicit `test` environment). Production and staging
API traffic stay disabled until the full durable repository and transaction-safe idempotency are wired
with the remaining durable adapters, with independent explicit staging identity, read-only OAuth and manual live-status exceptions.

**Status:** `staging-identity.ts` handles only exact `GET /api/v1/me` and its GET-only CORS preflight
when `ENVIRONMENT=staging` and `STAGING_IDENTITY_READ_ENABLED=true`. It selects no process-local stores,
requires a persisted profile, and ignores GET idempotency headers. User reads preserve the verified
JWT; privileged access is limited to durable rate limiting. The existing limiter transport requires a
legacy `service_role` JWT in `SUPABASE_SECRET_KEY`; opaque `sb_secret_` keys are rejected here. No flag
is enabled implicitly. Production and scheduled execution remain disabled.

The identity handler uses the shared Supabase transports directly; it has no temporary fetch wrapper
or stage/error logging. Compatibility and redirect rejection are enforced by `../db/supabase-fetch.ts`
and verified by both the Worker entrypoint tests and the local workerd regression.

The staging identity verifier explicitly requires audience `authenticated`, as a string or within a
nonempty array of nonempty strings. Missing, incorrect and malformed audiences fail before rate
limiting or user reads. Audience validation remains opt-in for other callers of the shared verifier.

**OAuth status:** `staging-tesla-oauth.ts` permits only exact POST connect and GET/POST callback under `STAGING_TESLA_OAUTH_ENABLED=true`. GET only redirects to the staging browser completion page; same-origin POST requires the initiating live Supabase session. It reuses `staging-config.ts`, authenticated membership reads, durable rate limiting, encrypted state and tokens. No legacy dependencies enter this path. See the [session/fencing follow-up](../../../../docs/handoffs/TESLA-OAUTH-SESSION-FENCING.md).

**Live-status status:** `staging-tesla-live-status.ts` is a separate exact-route staging gate under `STAGING_TESLA_LIVE_STATUS_ENABLED=true`. It constructs request-scoped RLS site reads, durable rate limiting and encrypted token reads, and revalidates site authority around provider I/O. Every query override is rejected. It never calls the legacy telemetry handler or process-local dependencies. See [Phase 3 handoff](../../../../docs/handoffs/PHASE-3-TESLA-LIVE-STATUS.md).


**Browser-correlation status:** staging OAuth now requires the host-only Secure/HttpOnly/SameSite=Lax
cookie `__Host-autopw3-tesla-oauth` before consuming callback state. A purpose-separated HKDF/HMAC
verifier binds its random 256-bit secret to the state UUID, session, household, expiry and lease owner.
Callbacks never delete the fixed-name cookie; it expires naturally and does not block reconnects.
New service-only RPCs fence persistence against the live session and current actor/household leases.
An authenticated ADMIN can explicitly restart a stale pending attempt. The local migration must precede
an approved coordinated staging Worker/frontend rollout. No feature flag is enabled by this change.

**Site onboarding status:** `staging-tesla-sites.ts` adds exact ADMIN GET discovery and POST site-link
exceptions under default-false `STAGING_TESLA_SITES_ENABLED`. Both require a live Supabase session,
durable rate limiting and current database ADMIN authorization. Linking rediscovers the selected ID
against the household's decrypted credentials; a private short-lived proof binds that observation to
the actor/session/credential revision before the authenticated transactional save. Other household
routes, production, telemetry and cron retain their guards. No frontend workflow is enabled here.


**Status: staging discovery refresh implemented locally.** The existing discovery gate now admits
request-scoped expired-token renewal through authenticated preflight/begin/finish RPCs. A 25-second
request budget bounds the staging site handler and all discovery I/O/body phases. Site linking keeps
its original strict freshness/revision checks; no other feature flag or API guard changes.
See [the refresh contract](../../../../docs/TESLA_DISCOVERY_REFRESH.md) and its failure/recovery limits.

**Status: expired READY recovery implemented locally.** Discovery returns HTTP 409 CONFLICT with
fixed `provider.tesla` detail issue TESLA_REAUTHORIZATION_REQUIRED or TESLA_RECOVERY_REQUIRED.
Supabase authentication failures retain their original status; linking and safety gates are unchanged.
