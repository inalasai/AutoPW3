# supabase/tests — SQL security tests

**Status:** 17 SQL files, 463 TAP assertions plus two-connection job-claim and overlapping-cron concurrency checks, run on a throwaway PostgreSQL 17.10 with a test shim. Includes adversarial profile visibility, job/lease boundaries, lock ownership, provider usage validation, durable storage RPCs and rate-limit checks. **Not yet run on a real Supabase stack with real pgTAP** (`NOT_EXECUTED`, L-033).

## What is here
`database/*.test.sql` are pgTAP-style files. Each starts `begin; select plan(n);`, ends `select * from finish(); rollback;`, and uses only `plan`, `ok`, `is`, `isnt`, `throws_ok(sql, sqlstate, message, description)`, `lives_ok` and `finish`, so they run unchanged under real pgTAP.

| File | Covers |
|---|---|
| `000_test_helpers.test.sql` | Installs schema `tests` (the only file that commits): `tests.world()`, `tests.as_user('alice')`, `as_anon()`, `as_service()`, fixture creators |
| `010_new_user_defaults` | A new user has a profile and no role, household or data access |
| `020_cross_household_isolation` | Cross-household read and write denial; anon has nothing |
| `030_role_permissions` | `READ_ONLY`, `READ_WRITE`, `ADMIN` allowed and denied actions |
| `040_membership_roles_and_last_admin` | Self-escalation, membership tampering, last-admin protection, audited role changes |
| `050_invitations` | Hashed single-use expiring tokens, email binding, revocation, reuse and expiry denial |
| `060_admin_bootstrap` | Bootstrap works once and only once |
| `070_credentials_and_server_only_tables` | Tesla credentials and server-only tables closed to `anon` and `authenticated`; anon has nothing anywhere |
| `080_live_data_integrity_and_append_only` | `DEMO` insert denial, telemetry written by the server only, append-only logs |
| `090_audit_trail` | Audit rows for privileged actions, metadata allowlist, who can read the trail |
| `100_hardening_and_grants` | `SECURITY DEFINER` search paths, execute grants, RLS everywhere, no views, policy targets |
| `110_profile_isolation` | Profile reads across unrelated, shared, multi-household, and membership-free users and altered UUID queries |
| `120_job_function_hardening` | Job claim limits, exhaustion transitions, lease reclamation, lock input/ownership, provider usage validation |
| `130_durable_job_api` | Service-only PostgREST job API, tenant-scoped enqueue, worker-owned lifecycle, retry/dead-letter transitions, lock and usage wrappers |
| `131_durable_job_scheduling` | Bounded recurring scheduling, overlapping-cron deduplication, and tenant-consistent site jobs |
| `132_secure_storage_rpc` | Service-only encrypted credential CRUD and durable, tenant-checked single-use OAuth state |
| `133_durable_rate_limit` | Atomic service-only counter, hashed scope isolation, enforcement and retry-after bounds |

`scripts/db-test.mjs` also runs a concurrent two-worker claim check using independent PostgreSQL connections and a held row lock.

## How to run
```bash
npm run db:test            # throwaway PostgreSQL 17 + scripts/db/local-shim.sql + scripts/db/pgtap-lite.sql (verified)
supabase test db           # real Supabase stack with pgTAP (NOT_EXECUTED so far; needs Docker)
```
`npm run db:test` also compares the policies in the database with the manifest in `docs/RLS_POLICY_MATRIX.md`.

## Rules
- Fixtures are `example.invalid` users created directly in `auth.users`. No real credentials, tokens or keys.
- A new test file is a new `*.test.sql` file; keep `plan(n)` exact. `060` removes admins inside its own transaction, so run these only against a local test database.
- `scripts/db/pgtap-lite.sql` is not pgTAP. It exists only because the embedded server has no pgTAP extension.
