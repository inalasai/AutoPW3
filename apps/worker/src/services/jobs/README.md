# Durable jobs

This folder contains the service-role PostgREST adapter and bounded executor for `scheduled_jobs`.
The database owns deduplication, atomic claims, lease ownership, retry timing, and DEAD transitions.
Handlers must validate persisted tenant/site scope against their durable domain repository and must be
idempotent across lease expiry. There are intentionally no production handlers until PostgreSQL-backed
repository and encrypted token adapters exist; production/staging cron remains disabled meanwhile.

Unit tests use mocked PostgREST responses. Database integration tests live in
`supabase/tests/database/130_durable_job_api.test.sql`.
