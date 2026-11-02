# supabase — database

**Status:** 22 migrations, 30 public design tables, 52 RLS policies and 24 SQL test files; 726 local checks include SQL security, concurrency and atomic-install verification on throwaway PostgreSQL 17.10. The local config parses with Supabase CLI 2.122.0 and explicitly allows Auth callbacks/reset, confirms email and requires 12-character passwords. Full Docker `supabase start/reset/test db` remains NOT_EXECUTED here; Docker is unavailable. See [developer setup](../docs/DEVELOPER_SETUP.md) and the [publication handoff](../docs/handoffs/SECURE-GITHUB-PUBLICATION.md).

## Purpose
The PostgreSQL schema, Row Level Security policies, database functions, SQL security tests and local seed data. The database is authoritative for access control.

## Layout
| Path | Content |
|---|---|
| `migrations/` | Versioned SQL, `YYYYMMDDHHMMSS_<verb>_<noun>.sql`. Never edit a merged migration; add a new one. Includes the profile isolation hardening migration. |
| `tests/` | pgTAP-style security tests (`tests/database/*.test.sql`); see `tests/README.md` |
| `seed.sql` | **Local only**, labelled, no real credentials |
| `config.toml` | Local-only Supabase CLI config; parser verified, full Docker startup not executed |

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
npm run db:types -- --check # verify generated database types without rewriting them
```
Design docs: `docs/DATABASE_DESIGN.md`, `docs/RLS_POLICY_MATRIX.md`, `docs/ADMIN_BOOTSTRAP.md`.
