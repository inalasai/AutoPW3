# Local database test helpers

Status: local verification only; no hosted database or provider calls.

This folder contains the PostgreSQL test shim, lightweight TAP functions and concurrency helpers
used by the root database runners. Tesla linking/refresh helpers use synthetic encrypted fixtures
and real row contention on throwaway PostgreSQL. Refresh migration atomicity tests inject a failure
before grants and verify catalog rollback, including execution inside an outer transaction.

Never use these reset helpers or synthetic records against hosted databases. No credentials belong
in fixtures. Run `npm run db:test` and `npm run db:verify` from the repository root.

Status: linking races also verify JWT and credential expiry after request-row/unique-index waits.
Atomic-install tests cover both refresh files and the post-lock linking forward migration.

Status: expiry races now use the database clock and enough setup headroom to observe the intended
lock before expiring authority. They wait until the actual deadline and retain bounded statement
timeouts; failures identify the exact race phase. No production timing or authorization was changed.
