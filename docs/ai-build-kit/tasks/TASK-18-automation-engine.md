# TASK 18 — Scheduler and Automation Engine

**Phase 5 · Controls and operations.**

## Goal
Run tariff-aware rules on a schedule without duplicate or unsafe actions. Real automation is **off by default**.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, tariff engine (Task 10), ingestion (Task 16), command service (Task 17), job locking decision (Task 01), `docs/handoffs/TASK-16.md`, `TASK-17.md`.

## Stop conditions
- Essential telemetry, capability, authorisation or safety information missing at evaluation time: **do nothing** and log why.
- Never assume cron runs exactly on schedule or only once.

## Plan step
Describe the evaluation pipeline, the locking mechanism, the retry policy and the fake-clock test approach.

## Requirements
- Cron-triggered scheduled handler with clearly separated stages: token maintenance, telemetry sync, rule evaluation, command execution.
- Rule types: scheduled tariff-window actions, price thresholds, battery SOC conditions, backup-reserve targets, supported device actions; per-site settings.
- Rule modes `DISABLED`, `DRY_RUN`, `ACTIVE`. New rules default to `DRY_RUN` or `DISABLED`. **Dry-run never calls control endpoints**; it records what would have happened.
- Persistent evaluation state and execution history (`automation_executions`).
- Atomic job claim/lock with lease expiry; safe against concurrent and duplicate scheduled events; idempotency key derived from rule, site and scheduled slot.
- Bounded retries with exponential backoff and jitter; missed-run recovery within a defined window (older misses are skipped and logged, never replayed blindly).
- IANA timezone for recurring schedules; DST-correct (skipped and repeated local hours).
- Conflict detection between rules (deterministic priority; log suppressed rules).
- Stale-data check using the freshness threshold; token-refresh coordination; per-site failure isolation; global pause and safe shutdown.
- All actions go through the Task 17 command service, so every safety and audit rule applies.

## Out of scope
New device capabilities.

## Deliverables
Scheduled handler, rule evaluation service, job persistence/locking, execution log integration, cron configuration, tests, `docs/AUTOMATION_OPERATIONS.md` (runbook: enabling, pausing, investigating, rolling back).

## Required tests (fake clock and mock provider)
Duplicate delivery; delayed delivery; missed run recovery and expiry; DST spring/fall; conflicting rules; expired token; stale telemetry; missing capability; failed command with retry and backoff; lock lease expiry; global pause; dry-run produces zero provider control calls (assert on the mock).

## Verification
Type check, lint, tests, build. Report actual results.

## Acceptance criteria
- Repeated scheduled events never dispatch duplicate commands.
- Dry-run never calls control endpoints.
- No action occurs on stale or incomplete data.
- Real automation remains disabled by default.

## Repo locations
Branch: `task-18-automation-engine`. Commit prefix: `task-18:`. Write to: `apps/worker/src/services/automation`, `apps/web/src/features/automation`, `docs/AUTOMATION_OPERATIONS.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-18.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-18.md`.
