# TASK 20 — Security Audit and End-to-End Verification

**Phase 6 · Release.** Run in a **fresh session**, as an independent reviewer. Do not add features.

## Goal
Find and fix integration defects and security gaps; produce an honest verification report.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, entire repository, all `docs/handoffs/*`, `docs/KNOWN_LIMITATIONS.md`.

## Stop conditions
- A critical security check fails: fix if the fix is contained; otherwise record as a **release blocker** and stop short of declaring readiness.
- Do not rewrite working features unnecessarily; report defects, fix them minimally.

## Plan step
List the review areas, tools you will use (dependency audit, secrets scan, static analysis) and test suites to run.

## Build and test verification (run from a clean checkout)
Install from lockfile; type check; lint; unit tests; component tests; Worker tests; migration reset and apply; RLS/pgTAP security tests; production build; Playwright end-to-end for: register/login; READ_ONLY dashboard access; tariff create/validate; analytics calculations; Tesla OAuth callback (mock); ingestion (mock); command lifecycle (mock); automation dry-run; invitation and admin role change; unauthorised request rejection.

Report only what you executed.

## Security review checklist
Secrets in repo/history/logs; environment variable handling; RLS and grants on every table; cross-household access; role escalation paths; admin bootstrap one-time property; OAuth state/CSRF/redirect validation; token encryption and key handling; API authorisation per endpoint (generate and check an endpoint × role matrix); JWT verification; CORS; input validation and size limits; rate limiting; idempotency; sensitive logging; error response leakage; CSV injection; XSS (any `dangerouslySetInnerHTML`, URL handling); dependency vulnerabilities; Content-Security-Policy and security headers; demo/live data separation; automation default-off.

## Deliverables
`docs/SECURITY_AUDIT.md` (findings by severity, status fixed/open), `docs/TEST_REPORT.md` (commands, results), `docs/VERIFICATION_REGISTER.md` (each feature labelled `VERIFIED`, `MOCK_ONLY`, `AWAITING_CREDENTIALS`, `AWAITING_PROVIDER_APPROVAL`, `UNSUPPORTED_BY_DEVICE`, `UNVERIFIED`), updated `docs/KNOWN_LIMITATIONS.md`, and fixes with tests for anything repaired.

## Acceptance criteria
- Zero open critical or high security findings, or an explicit blocker list with "NOT READY".
- All executed tests pass; anything not executed is listed as `NOT_EXECUTED`.
- The verification register is complete and honest about Tesla live status.

## Repo locations
Branch: `task-20-security-audit-e2e`. Commit prefix: `task-20:`. Write to: `docs/SECURITY_AUDIT.md`, `docs/TEST_REPORT.md`, `docs/VERIFICATION_REGISTER.md`; minimal fixes elsewhere. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-20.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-20.md`.
