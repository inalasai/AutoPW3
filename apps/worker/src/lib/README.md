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
is enabled in deployment configuration. Production and scheduled execution remain disabled.

The staging identity verifier explicitly requires audience `authenticated`, as a string or within a
nonempty array of nonempty strings. Missing, incorrect and malformed audiences fail before rate
limiting or user reads. Audience validation remains opt-in for other callers of the shared verifier.

**OAuth status:** `staging-tesla-oauth.ts` permits only exact POST connect and GET callback under `STAGING_TESLA_OAUTH_ENABLED=true`. It reuses `staging-config.ts` (extracted unchanged from identity), authenticated membership reads, durable rate limiting, encrypted state and tokens. No legacy dependencies enter this path. See [Phase 2 handoff](../../../../docs/handoffs/PHASE-2-DURABLE-TESLA-OAUTH.md).

**Live-status status:** `staging-tesla-live-status.ts` is a separate exact-route staging gate under `STAGING_TESLA_LIVE_STATUS_ENABLED=true`. It constructs request-scoped RLS site reads, durable rate limiting and encrypted token reads, and revalidates site authority around provider I/O. Every query override is rejected. It never calls the legacy telemetry handler or process-local dependencies. See [Phase 3 handoff](../../../../docs/handoffs/PHASE-3-TESLA-LIVE-STATUS.md).
