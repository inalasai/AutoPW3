# AutoPW3 — Task Handoff Report

## Task completed
Number and name: TASK-18 Scheduler and Automation Engine
Branch / commit: `Sai-AutoPW3`
Date: 2026-10-26

## Summary
The tariff-aware scheduler and automation engine has been fully implemented and verified. In accordance with strict safety invariants (D-003), automated rules default to `DRY_RUN` or `DISABLED` mode upon creation, recording simulated decisions (`decision: WOULD_ACT`) into `automation_executions` and never dispatching commands to device control endpoints. When an administrator explicitly activates a rule (`mode: ACTIVE`), executions flow strictly through the Task 17 command service (`executeDeviceCommand`, `origin: 'AUTOMATION'`) inheriting intent persistence, read-back reconciliation, and safety limit checks. The engine deterministically resolves conflicting rules by priority order, logs lower-priority matching rules as `SKIPPED_CONFLICT`, gates evaluations against telemetry staleness (`SKIPPED_STALE`), respects the emergency automation pause toggle (`SKIPPED_PAUSED`), and drops outdated runs delayed beyond `maxMissedMinutes` (`SKIPPED_MISSED`). A reactive glassmorphic UI (`AutomationManager`) enables rule authoring, execution log inspection with decision badges, and emergency pause controls.

## Files created
| Path | Purpose |
|---|---|
| `apps/worker/src/services/automation/types.ts` | Context, evaluation result, and runner options type contracts |
| `apps/worker/src/services/automation/evaluator.ts` | Rule condition evaluators (Time Window, Battery SOC, Import Rate with decimal math), capability gating, priority conflict resolution |
| `apps/worker/src/services/automation/evaluator.test.ts` | Unit tests for condition evaluation, priority conflicts, decimal rate comparisons, and emergency pause (9 tests) |
| `apps/worker/src/services/automation/runner.ts` | End-to-end execution runner orchestrating slot idempotency, missed slot detection, dry-run safety barrier, and command dispatch |
| `apps/worker/src/services/automation/runner.test.ts` | Unit tests verifying dry-run zero-dispatch guarantee, active command execution, duplicate slot idempotency, and pause/stale gating (6 tests) |
| `apps/worker/src/routes/automation.test.ts` | Integration tests for rule CRUD routes, activation role gating (ADMIN required), and execution log listing (6 tests) |
| `apps/web/src/features/automation/types.ts` | Form state models and hook return types for the automation manager |
| `apps/web/src/features/automation/use-automation.ts` | React hook managing automation rules, execution log history, activation, and pause switch |
| `apps/web/src/features/automation/RuleEditor.tsx` | Accessible modal form with condition builders (Time Window, Battery SOC, Tariff Rate) and action configuration |
| `apps/web/src/features/automation/RuleList.tsx` | Glassmorphic card list of configured rules with mode status pills, condition summaries, and activation dialogs |
| `apps/web/src/features/automation/ExecutionLog.tsx` | Audit table displaying evaluated executions with decision badges and parameter details |
| `apps/web/src/features/automation/AutomationManager.tsx` | Main feature page layout with safety guardrail banner, emergency pause header, rules list, and audit log |
| `apps/web/src/features/automation/AutomationManager.test.tsx` | Unit tests for AutomationManager rendering, emergency pause, read-only restrictions, and rule creation (4 tests) |
| `apps/web/src/features/automation/index.ts` | Barrel export for automation feature |
| `e2e/automation.spec.ts` | Playwright E2E smoke tests for READ_ONLY restrictions and emergency pause toggle across desktop and mobile |
| `docs/AUTOMATION_OPERATIONS.md` | Operational runbook, safety invariants, evaluation lifecycle, and troubleshooting procedures |
| `docs/handoffs/TASK-18.md` | This task handoff report |

## Files modified
| Path | What changed and why |
|---|---|
| `packages/domain/src/tariff/index.ts` | Re-exported `localDateAndMinute` from calendar module for site-local time window evaluation |
| `apps/worker/src/db/repository.ts` | Extended repository interface with `getRule`, `deleteRule`, `setRuleMode`, `recordAutomationExecution`, `listAutomationExecutions`, and `getHouseholdIdForRule` |
| `apps/worker/src/services/ingestion/dispatcher.ts` | Integrated scheduled rule evaluation (`runAutomationForSite`) into the periodic Cloudflare Worker cron loop |
| `apps/worker/src/routes/automation.ts` | Implemented `handleDeleteRule`, `handleActivateRule` (enforcing ADMIN role), `handleDeactivateRule`, and `handleListExecutions` |
| `apps/worker/src/lib/app.ts` | Mounted routes for rule activation, deletion, and execution log retrieval with authoritative role checks |
| `apps/web/src/app/pages/AppPages.tsx` | Connected `/automation` route to `<AutomationManager />` |
| `docs/DECISIONS.md` | Appended decisions D-105 and D-106 |
| `docs/KNOWN_LIMITATIONS.md` | Appended limitations L-112 and L-113 |
| `docs/ai-build-kit/00-README.md` | Marked TASK-18 complete in the project roadmap |

## Decisions
- **D-105 Priority-based rule evaluation with deterministic conflict resolution**: Rules evaluate in descending numerical priority order. If multiple rules match the same scheduled slot, the highest priority rule executes, while lower priority matching rules are recorded with decision `SKIPPED_CONFLICT`.
- **D-106 Atomic slot idempotency and dry-run safety barrier**: Rules default to `DRY_RUN` mode, producing `WOULD_ACT` records in `automation_executions` and never calling control endpoints. Deduplication by `(ruleId, siteId, scheduledSlot)` prevents re-execution under retries. Promoting to `ACTIVE` requires administrative authorization.

## Database changes
- Utilizes existing database schema defined in Task 03 (`automation_rules` and `automation_executions`).
- `recordAutomationExecution` enforces atomic slot idempotency key uniqueness.
- Repository layer supports full pagination and mode updates.

## API changes
- `POST /api/v1/sites/{siteId}/automation/rules`: Creates an automation rule. Body `mode` is restricted to `DRY_RUN` or `DISABLED` (attempting `ACTIVE` returns 422 `VALIDATION_FAILED`). Requires `READ_WRITE` or `ADMIN`.
- `POST /api/v1/automation/rules/{ruleId}/activate`: Promotes a rule to `ACTIVE`. Authoritatively requires `ADMIN` role (returns 403 `FORBIDDEN` for non-admin).
- `POST /api/v1/automation/rules/{ruleId}/deactivate`: Demotes a rule to `DRY_RUN` or `DISABLED`. Requires `READ_WRITE` or `ADMIN`.
- `DELETE /api/v1/automation/rules/{ruleId}`: Deletes an automation rule. Requires `READ_WRITE` or `ADMIN`.
- `GET /api/v1/sites/{siteId}/automation/executions`: Retrieves paginated history of automation evaluation decisions.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run typecheck` | yes | PASSED | Strict TypeScript check passed across all packages (`shared`, `domain`, `web`, `worker`, `e2e`) |
| `npm run lint` | yes | PASSED | ESLint, architecture rules (no floats for money, boundaries), and Prettier format passed |
| `npm test` | yes | PASSED | 523 web tests + 137 worker tests + domain/shared tests (660+ tests passing) |
| `npm run build` | yes | PASSED | Vite web build + Cloudflare Worker bundle dry-run deploy succeeded |
| `npm run secrets:scan` | yes | PASSED | Secretlint found 0 secrets |
| `npm run test:e2e` | yes | PASSED | All 32/32 Playwright tests passed (desktop & mobile) |

## Manual verification
- Verified in Playwright E2E test that a `READ_ONLY` user sees the disabled create and emergency pause buttons with clear guidance notices, and that write actions are rejected.
- Verified in Playwright E2E test that a `READ_WRITE` user can trigger the emergency pause modal, confirm pause, see the badge update to `AUTOMATION PAUSED`, and resume to `AUTOMATION ACTIVE`.
- Verified in Vitest unit tests that `DRY_RUN` rules never trigger mock Tesla control methods, whereas `ACTIVE` rules dispatch commands via `executeDeviceCommand`.
- Verified in unit tests that duplicate cron triggers for the same slot key are deduplicated without re-executing actions.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|:---:|---|
| Tariff-aware scheduler runs on schedule without duplicate or unsafe actions | VERIFIED | `evaluator.test.ts`, `runner.test.ts`, `dispatcher.ts` |
| Real automation is off by default (`DISABLED` or `DRY_RUN`) | VERIFIED | Schema validator blocks `ACTIVE` on rule creation; defaults to `DRY_RUN` |
| Dry-run records what would have happened into `automation_executions` and never calls control endpoints | VERIFIED | `runner.test.ts`: `setBackupReserveSpy.not.toHaveBeenCalled()`, `executions[0].decision === 'WOULD_ACT'` |
| All actions flow through Task 17 command service (`executeDeviceCommand`, `origin: 'AUTOMATION'`) | VERIFIED | `runner.ts` imports and calls `executeDeviceCommand` with `origin: 'AUTOMATION'` |
| D-003 strictly enforced: no forced charging, no forced export, no solar bypass, no manual islanding | VERIFIED | Evaluator strictly aborts with `SKIPPED_CAPABILITY` on unverified / unsupported actions |
| Conflict resolution by priority | VERIFIED | Evaluator sorts by priority descending; lower priority matching rules marked `SKIPPED_CONFLICT` |
| Emergency pause halts all automated executions | VERIFIED | `runner.test.ts`: records `SKIPPED_PAUSED` and skips dispatch |
| Stale telemetry halts automated executions | VERIFIED | `runner.test.ts`: records `SKIPPED_STALE` when telemetry exceeds threshold |
| Comprehensive operational runbook created | VERIFIED | `docs/AUTOMATION_OPERATIONS.md` |

## Verification status register
- Rule evaluation engine: **VERIFIED** (unit & integration tests)
- Dry-run safety barrier: **VERIFIED** (`runner.test.ts`)
- Scheduled dispatcher: **VERIFIED** (`dispatcher.ts`)
- UI AutomationManager: **VERIFIED** (`AutomationManager.test.tsx`, `App.test.tsx`, `e2e/automation.spec.ts`)
- Physical Tesla Powerwall live actuation: **UNVERIFIED** / requires owner credentials (runs against verified mock in CI/test)

## Outstanding issues
- Multi-household live deployments will use Supabase Postgres database client; currently running in memory/mock for demo and automated test environments.

## Environment variables
- `TOKEN_ENCRYPTION_KEY`: Cloudflare secret (32-byte hex for AES-256-GCM token encryption).
- `SUPABASE_URL`: Cloudflare Worker env variable.
- `SUPABASE_SERVICE_ROLE_KEY`: Cloudflare secret (service role for audited backend operations).

## Instructions for the next task
- Task 19 (Administration and Audit) will implement household member management, invitations, role modifications (with last-admin protection), spend budget caps, data export/retention settings, and audit log inspection.
- Do not modify working automation evaluator or command execution logic.
- Reuse `packages/shared/src/schemas/identity.ts` and `apps/worker/src/routes/identity.ts`.

## Next task
TASK-19 Administration and Audit
