# Durable job processing

## Database boundary

`public.worker_schedule_due_jobs` creates bounded, tenant-scoped recurring work from the current
household, credential, site and unresolved-command rows. Its deterministic dedupe keys make overlapping
cron delivery idempotent. Site jobs receive household and site IDs from the same database row; the
enqueue RPC rejects a mismatched tenant/site pair. The RPC creates live sync, history sync, daily
rollup, rule evaluation, token maintenance near credential expiry, retention, and command reconciliation
jobs. Credential ciphertext is never selected into a job or returned by the scheduling function.
The scheduler caps each site/household page at 100 and rotates pages by time bucket so a large tenant
set does not permanently starve rows beyond the first page. Pages rotate on five-minute scheduling
buckets while each job's own dedupe slot remains aligned to its configured cadence.

The Worker adapter calls service-role-only `public.worker_*` PostgREST RPCs. Those wrappers are the only
API-exposed path to the private schema functions; the `private` schema remains unexposed. Claims call
`private.claim_jobs`, which uses `FOR UPDATE SKIP LOCKED`, finite batch and lease limits, expired-lease
recovery, and terminal handling for exhausted attempts. Finish/fail calls require the claiming worker ID.
Transient failures are requeued with bounded backoff; permanent failures and exhausted attempts become
`DEAD`. Stored diagnostics are restricted to short error codes, never provider bodies or credentials.

`executeDurableJobBatch` validates the claimed row shape, lease owner and required tenant/site scope before
dispatch. Every future handler must supply an ownership validator that checks the persisted site and
household relationship using the durable repository. The executor processes a bounded batch sequentially
and isolates handler failures. Resource-lock and provider-usage RPCs wrap the existing
private functions, but the current cron runtime does not invoke them because no durable handler is
registered. Atomic job claims are sufficient for per-job exclusivity; locks are reserved for separate
resource coordination such as token refresh.

## Activation status

The queue API and Worker executor are implemented and locally testable. Encrypted PostgREST-backed Tesla
credential, single-use OAuth state, and atomic hashed rate-limit adapters also exist with mocked-RPC
coverage, but are not wired into the Worker entry point. The current Worker still has no PostgreSQL-backed
application `Repository` or durable idempotency adapter. Consequently the scheduled entry point intentionally remains
fail-closed in staging and production and does not invoke this executor. No production handler is
registered: enabling claims before durable handlers exist could consume jobs without the required domain
work. Durable token refresh, telemetry, rollup, automation, command reconciliation and retention handlers
must be implemented against the persistent adapters before cron activation.

## Spend cap

`household_settings.monthly_spend_cap_usd` stores a USD limit and `provider_usage_daily` counts requests by
UTC day and category. There are no authoritative endpoint prices, cost amounts, reservations, billing
period ledger, reconciliation records or currency conversion policy. The configured limit is therefore
not an enforceable spend cap. No spending estimate or budget gate is inferred from request counts.

## Verification

The SQL tests `130_durable_job_api.test.sql`, `131_durable_job_scheduling.test.sql`,
`132_secure_storage_rpc.test.sql`, and `133_durable_rate_limit.test.sql` validate service-only grants,
tenant checks, dedupe, claim lifecycle,
retries, terminal state, leases, usage recording, encrypted storage RPCs and single-use OAuth state on a
throwaway local PostgreSQL instance. Worker tests use mocked PostgREST responses; they do not establish
hosted Supabase or Cloudflare behavior. Do not enable Worker cron until the durable application adapters
and handlers are complete.
