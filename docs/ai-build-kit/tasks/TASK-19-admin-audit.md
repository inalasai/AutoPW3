# TASK 19 — Administration, Invitations and Audit

**Phase 5 · Controls and operations.**

## Goal
Complete household member management, invitations, audit visibility and privacy operations.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, `docs/SECURITY_MODEL.md`, `docs/PRIVACY.md`, RLS and bootstrap (Task 04), Worker API (Task 14), `docs/handoffs/TASK-17.md`, `TASK-18.md`.

## Stop conditions
- Any path where the browser submits a role or privilege and the server believes it without verification: stop.
- Never expose service-role credentials.

## Plan step
Describe the admin API, UI flows and audit event catalogue.

## Admin UI (`AdminPanel`)
Paginated household-member directory (email, registration date, role, status), search and filter, inline role change with confirmation, invite member (email, role), pending invitations with revoke, remove member, audit history viewer with filters, connection status for the Tesla credential (connected/disconnected only, never token data), clear success and error states. Optimistic updates only with correct rollback.

## Backend/security requirements
- Verify ADMIN role server-side on every request; scope to the caller's household.
- No self-promotion; no self-demotion if last active admin; last-admin protection enforced (database plus API).
- Return only necessary user fields.
- Audit every: role change, membership change, invitation create/revoke/accept, tariff update, automation activation or pause, command request/outcome, credential connect/disconnect, relevant security failures. No secrets or bulky raw bodies in audit records; redact.
- **Privacy operations:** user data export (JSON) and account/household deletion procedure per `PRIVACY.md`, with confirmation, audit and documented retention exceptions.

## Out of scope
Platform-wide super-admin UI.

## Deliverables
Admin frontend, backend handlers, privacy export/deletion handlers, tests, Playwright admin flow, `docs/ADMINISTRATION.md`.

## Required tests
Non-admin denial (API and UI); admin listing scoped to household; role change; self-promotion denied; last-admin protection; cross-household denial; invitation lifecycle including expiry and reuse; audit event creation and redaction; export content correctness; deletion cascades as designed.

## Verification
Type check, lint, tests, build, Playwright. Report actual results.

## Acceptance criteria
- Non-admins cannot list members or change roles regardless of frontend state (API test with real token of a lower role).
- Every privileged action has an audit record.
- Export and deletion work against mock/local data.

## Repo locations
Branch: `task-19-admin-audit`. Commit prefix: `task-19:`. Write to: `apps/web/src/features/admin`, `apps/worker/src/routes/admin`, `docs/ADMINISTRATION.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-19.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-19.md`.
