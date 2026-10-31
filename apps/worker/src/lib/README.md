# Worker request helpers

This folder contains routing, request security helpers, and local in-memory test/development stores.
The durable Supabase rate limiter hashes caller scope before invoking an atomic service-role RPC; the
default limiter remains in-memory only for explicit local/test use. In-memory API fallback requires
`ENVIRONMENT=local` plus `LOCAL_MOCKS=true` (or the explicit `test` environment). Production and staging
API traffic stay disabled until the full durable repository and transaction-safe idempotency are wired
with the remaining durable adapters.
