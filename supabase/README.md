# supabase — database

**Status:** schema in place (TASK-03): 7 migrations, 29 tables, RLS enabled with no policies (default deny), local `seed.sql`, hand-written `config.toml` (UNVERIFIED, never loaded by the Supabase CLI). Policies, functions and pgTAP tests are TASK-04; job/lock/usage functions are TASK-16. See `docs/DATABASE_SETUP.md`.

## Purpose
The PostgreSQL schema, Row Level Security policies, database functions, SQL security tests and local seed data. The database is authoritative for access control.

## Layout
| Path | Content |
|---|---|
| `migrations/` | Versioned SQL, `YYYYMMDDHHMMSS_<verb>_<noun>.sql`. Never edit a merged migration; add a new one |
| `tests/` | pgTAP security and constraint tests |
| `seed.sql` | **Local only**, labelled, no real credentials |
| `config.toml` | Supabase CLI configuration |

## Rules
- RLS enabled on every exposed table with explicit grants. `anon` has no access unless justified.
- `SECURITY DEFINER` functions use a fixed `search_path` and restricted `EXECUTE`.
- `tesla_credentials` is inaccessible to `anon` and `authenticated`; encrypted values only, keys never stored here.
- New users are `READ_ONLY`; admin bootstrap is one-time and audited.
- Every migration is reviewed by the owner (CODEOWNERS).

## Commands
```bash
npm run db:verify      # TASK-03: apply migrations to a throwaway PostgreSQL 17 and run constraint checks (verified)
npm run db:dictionary  # same, and regenerate docs/DATABASE_DICTIONARY.md
npm run db:reset       # TASK-03: supabase db reset (needs Docker; NOT_EXECUTED so far)
npm run db:test        # TASK-04: pgTAP security tests (not available yet)
npm run db:types       # TASK-05: regenerate packages/shared/src/db/database.types.ts (not available yet)
```
Design docs: `docs/DATABASE_DESIGN.md`, `docs/RLS_POLICY_MATRIX.md`.
