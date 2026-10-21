# TASK 17 — Safe Device Controls

**Phase 5 · Controls and operations.**

## Goal
Implement the command lifecycle and control UI for **only those operations the capability registry marks supported**.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, capability registry and matrix (Task 15), Worker API (Task 14), ingestion/state (Task 16), `docs/handoffs/TASK-15.md`, `TASK-16.md`.

## Stop conditions
- A control with `UNVERIFIED` or `UNSUPPORTED` status: build it disabled with an explanation. Do not enable it.
- Never run live control tests against real hardware.

## Plan step
Describe the command state machine and the reconciliation strategy, plus which controls are enabled in v1.

## Backend requirements
1. Authenticate; load authoritative role and membership; require at least `READ_WRITE`.
2. Verify site ownership; check the capability registry for this site.
3. Validate parameters and safety limits (for example backup reserve range and step).
4. Require an idempotency key; replays return the original result.
5. **Record intent before dispatch** (`PENDING`).
6. Dispatch only supported commands, with timeout.
7. Record provider response; **reconcile** by re-reading site configuration and comparing, where possible.
8. Final states: `CONFIRMED`, `FAILED`, `UNKNOWN` (timeouts, ambiguous responses). Never mark `CONFIRMED` on HTTP 200 alone.
9. Command rate limits; global automation pause respected; audit event for every request and outcome.

## Frontend requirements
`ControlMatrix` page: show supported capabilities, current configuration with last-update time, pending/succeeded/failed/unknown states, confirmation dialogs for high-impact actions, disabled unsupported controls with clear reasons, visible **emergency automation pause**, READ_ONLY users cannot dispatch, wording that distinguishes "configuration changed" from "physical outcome guaranteed", command history list.

## Out of scope
Scheduling (Task 18).

## Deliverables
`ControlMatrix.tsx`, backend command modules, mock provider scenarios, tests, `docs/DEVICE_CONTROL_SAFETY.md` including a cautious manual procedure for a first real-device test by the owner.

## Required tests
Authorisation per role; unsupported/unverified command rejection; invalid reserve values; idempotent replay; concurrent duplicates; provider timeout → `UNKNOWN`; reconciliation confirms/denies; rate limit; pause blocks automation-originated commands; audit rows; UI never shows success without confirmation.

## Verification
Type check, lint, tests, build, Playwright flow on mock. Report actual results.

## Acceptance criteria
- Unsupported commands are rejected by the backend regardless of UI state.
- No command is reported as physically successful without confirmation.
- READ_ONLY tokens cannot dispatch (API test).

## Repo locations
Branch: `task-17-device-controls`. Commit prefix: `task-17:`. Write to: `apps/worker/src/services/commands`, `apps/web/src/features/controls`, `docs/DEVICE_CONTROL_SAFETY.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-17.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-17.md`.
