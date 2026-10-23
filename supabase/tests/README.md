# supabase/tests — SQL security tests

**Status:** TASK-04. 11 files, 336 TAP assertions, passing on a throwaway PostgreSQL 17.10 with a test shim. **Not yet run on a real Supabase stack with real pgTAP** (`NOT_EXECUTED`, L-033).

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
