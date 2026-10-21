# supabase — database

**Status:** not started (TASK-03, 04, 16).

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

## Commands (available after TASK-03/04)
```bash
npm run db:reset   # reset local database and apply migrations + seed
npm run db:test    # run SQL security tests
npm run db:types   # regenerate packages/shared/src/db/database.types.ts
```
Design docs: `docs/DATABASE_DESIGN.md`, `docs/RLS_POLICY_MATRIX.md`.
