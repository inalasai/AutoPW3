# supabase — database

**Status:** schema and security in place (TASK-03, TASK-04): 11 migrations, 29 tables, 52 RLS policies, 8 audited `public` functions plus helpers in schema `private`, local `seed.sql`, 11 SQL test files. Verified on a throwaway PostgreSQL 17.10 with a test shim; `supabase db reset`, `supabase test db` and the hand-written `config.toml` are `NOT_EXECUTED` / `UNVERIFIED` (L-026, L-027, L-033). Job/lock/usage functions are TASK-16. See `docs/DATABASE_SETUP.md`.

## Purpose
The PostgreSQL schema, Row Level Security policies, database functions, SQL security tests and local seed data. The database is authoritative for access control.

## Layout
| Path | Content |
|---|---|
| `migrations/` | Versioned SQL, `YYYYMMDDHHMMSS_<verb>_<noun>.sql`. Never edit a merged migration; add a new one. 1 to 7: tables (TASK-03). 8 to 11: security helpers, integrity and audit triggers, identity and membership functions, policies and grants (TASK-04) |
| `tests/` | pgTAP-style security tests (`tests/database/*.test.sql`); see `tests/README.md` |
| `seed.sql` | **Local only**, labelled, no real credentials |
| `config.toml` | Supabase CLI configuration (hand-written, `UNVERIFIED`) |

## Rules
- RLS enabled on every exposed table with explicit grants. `anon` has no access.
- `SECURITY DEFINER` functions use `search_path = ''`, schema-qualified names and restricted `EXECUTE` (tested).
- `tesla_credentials`, `oauth_states`, `system_bootstrap`, `job_locks`, `scheduled_jobs` are inaccessible to `anon` and `authenticated`: no policy, no grant.
- New users get a profile and no role. Admin bootstrap is one-time and audited (`docs/ADMIN_BOOTSTRAP.md`).
- Privileged changes (roles, membership, invitations, rule activation, pause) only through the audited functions listed in `docs/RLS_POLICY_MATRIX.md`.
- A new migration that creates a table must end with `select private.lock_down_public_tables();`, add policies and explicit grants, and update `docs/RLS_POLICY_MATRIX.md` (the manifest is tested).
- Every migration is reviewed by the owner (CODEOWNERS).

## Commands
```bash
npm run db:verify      # TASK-03: apply migrations to a throwaway PostgreSQL 17 and run constraint checks (verified)
npm run db:test        # TASK-04: SQL security tests on the same throwaway server (verified)
npm run db:dictionary  # same as db:verify, and regenerate docs/DATABASE_DICTIONARY.md
npm run db:reset       # supabase db reset (needs Docker; NOT_EXECUTED so far)
npm run db:types       # TASK-05: regenerate packages/shared/src/db/database.types.ts (not available yet)
```
Design docs: `docs/DATABASE_DESIGN.md`, `docs/RLS_POLICY_MATRIX.md`, `docs/ADMIN_BOOTSTRAP.md`.
