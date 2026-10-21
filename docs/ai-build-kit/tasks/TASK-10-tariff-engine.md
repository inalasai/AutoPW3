# TASK 10 — Universal Tariff Engine

**Phase 3 · Energy domain.** Pure library, no UI.

## Goal
Build a tested tariff evaluation and validation library that every financial feature relies on.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, `docs/ENERGY_ACCOUNTING.md`, tariff schemas from Task 05, tariff tables from Task 03, `docs/handoffs/TASK-08.md`, `TASK-09.md`.

## Stop conditions
- Precedence rules not defined in the architecture: propose them, record in `DECISIONS.md`, and proceed only with explicit documentation.

## Plan step
Define the tariff data model as used by the engine, the precedence order and the function contracts.

## Requirements
Support: flat; day/night; three or more periods; weekday/weekend; date-specific overrides; seasonal rates; half-hourly or finer dynamic prices; separate import and export schedules; negative prices where allowed; standing charge (per day); VAT/tax mode (inclusive/exclusive) and levies; export payment model; effective-dated versions.

- Explicit IANA timezone; windows crossing midnight; correct DST behaviour (23h/25h days; ambiguous and skipped local times).
- Half-open intervals; deterministic precedence: date override > dynamic price observation > seasonal > weekday/weekend > default (or as documented).
- Reject overlapping windows (unless intentionally overridden by precedence); detect uncovered intervals; never substitute zero silently.
- Keep recurring definitions separate from dated price observations.
- Decimal arithmetic throughout; documented rounding.
- Functions, for example: `validateTariff(tariff)`, `resolveTariffRate(timestamp, tariff, direction)`, `priceInterval(start, end, tariff, direction)`, `splitIntervalAtBoundaries(...)`, `findCoverageGaps(tariff, range)`. Adapt to shared types.
- Fixtures: realistic Irish-style day/night and day/night/peak tariffs with clearly labelled **example** values (not claimed current), a flat tariff, a dynamic half-hourly tariff, and a tariff with export payment.

## Out of scope
UI, persistence, telemetry.

## Deliverables
Tariff library, schemas, fixtures, thorough unit tests, `docs/TARIFF_ENGINE.md` (data model, precedence, DST handling, examples).

## Required tests
Midnight crossing; DST spring-forward and fall-back days; boundary instants (start inclusive, end exclusive); overlap rejection; coverage gaps; missing rate error; effective-date change mid-range; import/export asymmetry; negative price; standing charge per day across DST; VAT inclusive vs exclusive; property-based tests if available.

## Verification
Type check, lint, tests (with coverage report), build. Report actual numbers.

## Acceptance criteria
- Correct evaluation at boundaries including overnight and DST (named tests pass).
- No floating point money anywhere (lint rule or test proves it).
- Coverage of the tariff module reported honestly.

## Repo locations
Branch: `task-10-tariff-engine`. Commit prefix: `task-10:`. Write to: `packages/domain/src/tariff`, `docs/TARIFF_ENGINE.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-10.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-10.md` with the function contracts and fixture index.
