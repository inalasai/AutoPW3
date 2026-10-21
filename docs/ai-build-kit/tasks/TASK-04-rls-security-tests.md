# TASK 04 — RLS, Grants, Bootstrap and SQL Security Tests

**Phase 1 · Foundation.** The most security-critical task in the project.

## Goal
Make the database enforce authorisation independently of any application code.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, `docs/SECURITY_MODEL.md`, `docs/DATABASE_DESIGN.md`, migrations and `docs/handoffs/TASK-03.md`.

## Stop conditions
- If a required behaviour cannot be enforced safely in SQL, document it and where it is enforced instead. Do not leave it unenforced silently.

## Plan step
Produce the RLS policy matrix (table × role × operation) first, review it for gaps, then implement.

## Requirements
- RLS enabled on every exposed table, with explicit `GRANT`/`REVOKE`. `anon` has nothing unless justified.
- Membership helper functions (for example "is member of household", "has role at least X") using `SECURITY DEFINER` only where necessary, with fixed `search_path`, schema-qualified references and `EXECUTE` revoked from `public`.
- Users cannot read data from households they do not belong to.
- Role permissions: `READ_ONLY` reads; `READ_WRITE` modifies tariffs, rules and issues commands via server flow; `ADMIN` manages membership and roles.
- Users cannot change their own role or membership; role changes only through audited, admin-authorised paths.
- Last-active-admin protection enforced in the database.
- `tesla_credentials`: no access for `anon` or `authenticated`; server-side trusted role only. No plaintext tokens or keys in ordinary tables.
- Auth trigger creating `user_profiles` safely; new users never receive ADMIN or any household role automatically.
- One-time, controlled admin bootstrap procedure (for example a function callable only by a trusted role that works only when no admin exists), documented, audited, and impossible to rerun once used.
- Household invitation tables: invitation tokens stored hashed, single use, expiring; acceptance creates `READ_ONLY` membership unless the invitation specifies otherwise and the inviter is ADMIN.
- Audit triggers or functions for privileged actions (role changes, membership changes, bootstrap).
- Demo data cannot enter live telemetry tables.

## Out of scope
Frontend, Worker code, Tesla logic.

## Deliverables
Migrations for policies/functions/triggers, `supabase/tests/` SQL tests (pgTAP or the project's supported approach), `docs/RLS_POLICY_MATRIX.md`, `docs/ADMIN_BOOTSTRAP.md`.

## Required tests
New-user default; `READ_ONLY` write denial; `READ_WRITE` allowed actions; `ADMIN` allowed actions; cross-household read and write denial; role self-escalation denial; membership tampering denial; credential access denial for `authenticated` and `anon`; last-admin protection; bootstrap works once and only once; invitation reuse and expiry denial; demo-source insert denial; audit rows created.

## Verification
Run the test suite against a local Supabase/Postgres and report real pass/fail counts. If you cannot run it, state `NOT_EXECUTED`, provide commands, and do not claim security is verified.

## Acceptance criteria
- A read-only user cannot elevate privileges, read another household's data or retrieve Tesla tokens (demonstrated by passing tests).
- The policy matrix matches the implemented policies.
- Every `SECURITY DEFINER` function has a fixed search path and restricted execute grants.

## Repo locations
Branch: `task-04-rls-security-tests`. Commit prefix: `task-04:`. Write to: `supabase/migrations/`, `supabase/tests/`, `docs/RLS_POLICY_MATRIX.md`, `docs/ADMIN_BOOTSTRAP.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-04.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-04.md` with migrations, policy matrix, test results and generated database types.
