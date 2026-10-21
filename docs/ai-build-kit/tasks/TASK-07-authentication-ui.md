# TASK 07 — Authentication and Permission-Aware UI

**Phase 2 · Frontend foundation.**

## Goal
Make identity and access control work end to end before any sensitive feature exists.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, `docs/SECURITY_MODEL.md`, `docs/RLS_POLICY_MATRIX.md`, `docs/handoffs/TASK-04.md`, `TASK-05.md`, `TASK-06.md`, the repo.

## Stop conditions
- Any design requiring service-role credentials or privileged keys in browser code: stop.

## Plan step
Describe the auth state machine (loading, unauthenticated, authenticated-no-household, authorised, expired, error), the session handling, and the role-loading strategy.

## Requirements
- Supabase Auth integration: registration, login, logout, session restoration, email verification handling, password reset, clear error messages (without user-enumeration leaks), session-expiry handling.
- Load profile and household memberships from the database through RLS-protected queries. Role shown in UI comes from the server, never from localStorage or user-editable fields.
- Protected route guards; role-aware navigation (admin links hidden from non-admins; direct entry to `/admin` is also denied with an "unauthorised" page).
- **No-household state:** a newly registered user with no household sees a clear "waiting for an invitation" screen and an accept-invitation entry point.
- `READ_ONLY` users: view permitted data; controls and save buttons disabled with an explanation. Remember the backend will independently reject.
- Demo mode: allow the app to run in demo mode without Supabase, clearly labelled.
- No hardcoded admin, no embedded privileged credentials.
- Introduce a **Playwright smoke test** (register/login mock or local Supabase, protected-route redirect, unauthorised access) to be extended in later tasks.

## Out of scope
Admin panel, role mutation UI, invitations management (Task 19).

## Deliverables
Auth feature module, route guards, role-aware navigation, tests, `docs/AUTHENTICATION_SETUP.md` (including Supabase Auth settings the owner must configure: email confirmations, redirect URLs, password rules).

## Required tests
Registration; login/logout; session restoration; protected redirect; READ_ONLY navigation; ADMIN navigation; unauthorised direct access; expired session; tampered localStorage role has no effect.

## Verification
Type check, lint, unit/component tests, build, Playwright smoke test. Report actual results.

## Acceptance criteria
- A user can register and log in, but cannot grant themselves permission by editing browser state (test demonstrates it).
- All listed tests pass.

## Repo locations
Branch: `task-07-authentication-ui`. Commit prefix: `task-07:`. Write to: `apps/web/src/features/auth`, `apps/web/src/lib`, `e2e/`, `docs/AUTHENTICATION_SETUP.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-07.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-07.md` with auth module API and environment variable names.
