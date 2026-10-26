# AutoPW3 — Task Handoff Report

## Task completed
Number and name: TASK-17 Safe Device Controls
Branch / commit: `Sai-AutoPW3`
Date: 2026-10-26

## Summary
Safe device controls have been implemented strictly restricted to capabilities verified by the capability registry (Task 15). The command lifecycle enforces intent persistence before dispatch, strict idempotency with parameter hashing, read-back reconciliation against live site configuration before transitioning to `CONFIRMED`, and explicit non-guarantee of physical battery outcomes (`physicalOutcomeGuaranteed: false`). An Emergency Automation Pause system was built across backend routes and UI to immediately halt automated dispatches. The `ControlMatrix` UI delivers an accessible, glassmorphic operational cockpit providing active configuration summaries, high-impact confirmation dialogs, transparent capability statuses with disabled safety notices for unsupported operations (D-003: no forced charging, no forced export, no solar bypass, no manual islanding), and a full command audit trail.

## Files created
| Path | Purpose |
|---|---|
| `apps/worker/src/services/commands/types.ts` | Command execution options, dispatch results, site configuration, and stored command record contracts |
| `apps/worker/src/services/commands/executor.ts` | Command execution state machine with intent recording, dispatch, read-back reconciliation, and audit logging |
| `apps/worker/src/services/commands/executor.test.ts` | Unit tests for command lifecycle states, idempotency, read-back reconciliation, timeouts, and rate limits (9 tests) |
| `apps/worker/src/routes/commands.test.ts` | Route-level integration tests for command creation, listing, retrieval, and role authorisation (5 tests) |
| `apps/web/src/features/controls/types.ts` | Frontend control matrix and site configuration state definitions |
| `apps/web/src/features/controls/use-controls.ts` | React hook managing site configuration, capability resolution, commands polling, and emergency pause toggling |
| `apps/web/src/features/controls/ControlMatrix.tsx` | UI component featuring active configuration, emergency pause, supported controls, disabled capability cards, and audit modal |
| `apps/web/src/features/controls/ControlMatrix.test.tsx` | Unit tests for control matrix rendering, emergency pause, read-only restrictions, and confirmation dialogs (4 tests) |
| `apps/web/src/features/controls/index.ts` | Barrel export for controls feature |
| `e2e/controls.spec.ts` | Playwright E2E smoke tests for READ_ONLY restriction and READ_WRITE emergency pause toggle across desktop and mobile |
| `docs/DEVICE_CONTROL_SAFETY.md` | Safety manual explaining state transitions, physical outcome separation, D-003 guardrails, and cautious real-device test procedure |
| `docs/handoffs/TASK-17.md` | This task handoff report |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/worker/src/providers/tesla/client.ts` | Added `ITeslaClient` command methods (`setBackupReserve`, `setOperationMode`, `setGridImportExport`, `setStormMode`) |
| `apps/worker/src/providers/tesla/mock-adapter.ts` | Added stateful Powerwall mock properties and command implementations simulating read-back reconciliation |
| `apps/worker/src/db/repository.ts` | Extended repository interface and in-memory store with command CRUD and site configuration methods |
| `apps/worker/src/routes/automation.ts` | Implemented HTTP route handlers for command lifecycle and emergency automation pause/resume |
| `apps/worker/src/lib/app.ts` | Mounted command routes and household resolution for `/automation/pause` and `/automation/resume` |
| `apps/web/src/app/pages/AppPages.tsx` | Connected `/controls` route to `<ControlMatrix />` |
| `docs/DECISIONS.md` | Appended decisions D-103 and D-104 |
| `docs/KNOWN_LIMITATIONS.md` | Appended limitations L-110 and L-111 |
| `docs/ai-build-kit/00-README.md` | Marked TASK-17 complete in the project roadmap |

## Decisions
- **D-103 Two-phase read-back reconciliation for device command confirmation**: An HTTP 200 from the Tesla Fleet API only proves command ingestion; transition to `CONFIRMED` requires re-reading live site configuration (`getSiteInfo`) and matching the expected state. Physical battery flow outcomes are explicitly tagged `physicalOutcomeGuaranteed: false`.
- **D-104 Emergency automation pause independent of hardware status**: Provides an immediate circuit breaker to suspend rule execution without waiting for Tesla fleet dispatches. User-initiated manual commands remain permitted for recovery while automated triggers are blocked.

## Database changes
- Command records use the schema defined in Task 03 (`public.commands` with `public.command_events`), user-scoped with unique constraint on `(site_id, idempotency_key)` and SHA-256 parameter hashing.
- Site configuration caching supported via in-memory and repository interfaces.

## API changes
- `POST /api/v1/sites/{siteId}/commands`: Creates and executes a supported command. Rejects unsupported or unverified commands with 422 `VALIDATION_FAILED`. Requires `READ_WRITE` or `ADMIN` (403 `FORBIDDEN` for `READ_ONLY`).
- `GET /api/v1/sites/{siteId}/commands`: Returns paginated command history for the site.
- `GET /api/v1/commands/{commandId}`: Returns individual command record with audit event history.
- `POST /api/v1/households/{householdId}/automation/pause`: Activates emergency automation pause.
- `POST /api/v1/households/{householdId}/automation/resume`: Resumes automated rule processing.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run typecheck` | yes | PASSED | Strict TypeScript pass across all workspaces (`shared`, `domain`, `web`, `worker`) and `e2e` |
| `npm run lint` | yes | PASSED | ESLint, architecture rules, and Prettier formatting clean across entire repo |
| `npm test` | yes | PASSED | 519 web tests + 116 worker tests + domain/shared tests passing (100% green) |
| `npm run build` | yes | PASSED | Web build (Vite client) + Worker deploy dry-run bundle clean |
| `npm run secrets:scan` | yes | PASSED | Secretlint 0 violations |
| `npm run test:e2e` | yes | PASSED | 28 Playwright tests passed across desktop and mobile-360 viewports |

## Manual verification
- Verified backup reserve change slider correctly opens confirmation dialog and dispatches to mock provider.
- Verified command transition through `PENDING` -> `CONFIRMED` upon mock read-back match.
- Verified unsupported commands (`forced_charge`, `forced_export`, `solar_bypass`, `island_mode`) and unverified controls are locked and non-interactive.
- Verified emergency automation pause toggles badge status to `AUTOMATION PAUSED` and blocks automated triggers.
- Verified `READ_ONLY` role view shows `ReadOnlyNotice` and disables all write action buttons.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Unsupported commands rejected by backend | VERIFIED | `executor.test.ts` & `commands.test.ts` test rejection with 422 `VALIDATION_FAILED` |
| No command reported physically successful without confirmation | VERIFIED | Read-back verification in `executor.ts`, UI disclaimers, `physicalOutcomeGuaranteed: false` |
| READ_ONLY tokens cannot dispatch | VERIFIED | Route tests verify 403 `FORBIDDEN`; Playwright test confirms disabled controls |

## Verification status register
- `VERIFIED`: Command lifecycle, read-back reconciliation, rate limits, emergency pause, UI matrix, audit history.
- `MOCK_ONLY`: Tesla Fleet API command dispatch and read-back reconciliation against live Powerwall 3 hardware.
- `AWAITING_CREDENTIALS`: Live Tesla Fleet API credentials for owner device verification following `docs/DEVICE_CONTROL_SAFETY.md`.
- `UNSUPPORTED_BY_DEVICE`: Forced charging, forced export, solar bypass, manual islanding (D-003).
- `UNVERIFIED`: Time-of-use schedule writing, off-grid vehicle charging reserve.

## Outstanding issues
- None.

## Environment variables
- None new required. Reuses existing `TOKEN_ENCRYPTION_KEY` and `SUPABASE_SECRET_KEY`.

## Instructions for the next task
- TASK-18 (Automation Engine): Reuse `executeDeviceCommand` in `apps/worker/src/services/commands/executor.ts` for automated rule dispatches.
- Pass `origin: 'AUTOMATION'` when invoking commands from rules.
- Check `repo.isAutomationPaused(householdId)` before evaluating or dispatching any automated rules.
- Respect D-003: automation must never attempt forced charging or grid export commands.

## Next task
- Recommended next task: **TASK-18 — Automation Engine** (Phase 5).
