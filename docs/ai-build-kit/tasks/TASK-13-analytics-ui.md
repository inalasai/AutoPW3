# TASK 13 — Analytics UI

**Phase 3 · Energy domain.**

## Goal
Give users clear historical views of energy and cost, driven by the real accounting engine.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, design system, telemetry provider (Task 08), accounting engine (Task 11), tariff manager (Task 12), `docs/handoffs/TASK-11.md`, `TASK-12.md`.

## Stop conditions
- Needing a number that the accounting engine does not produce: add it to the engine with tests rather than computing it in a component.

## Plan step
Describe the data-access hooks, range → resolution mapping and chart list.

## Requirements
- Range selectors: day, week, month, year, custom, in the site's timezone.
- Charts (Recharts): solar generation, household demand, battery charge/discharge, grid import/export, cost and export revenue; summary cards (totals, self-consumption, net cost, avoided cost, optimisation benefit) with the assumptions available on hover/info.
- Resolution mapping: raw for short ranges, rollups for long ranges; always display the resolution actually used. Never fabricate finer resolution.
- Data completeness indicator and clear missing-data display (gaps visible, not interpolated silently).
- Loading, empty and error states; demo indicator when data is `DEMO`.
- CSV export of exactly what is displayed, with units in headers and decimals as strings; guard against CSV formula injection.
- Performance: memoised aggregation, bounded data points per chart (downsample with a documented method).
- Accessible charts: table alternative or text summary.
- No hardcoded totals outside clearly labelled demo fixtures.

## Out of scope
Server-side rollup jobs (Task 16), Worker endpoints (Task 14).

## Deliverables
`Analytics.tsx`, hooks/services, tests, `docs/ANALYTICS.md`.

## Required tests
Changing the range changes computed outputs; DST day handling; completeness with gaps; CSV content and injection safety; resolution labelling; empty/error states.

## Verification
Type check, lint, tests, build, Playwright extension. Describe actual visual checks.

## Acceptance criteria
- Analytics respond to selected dates and tariff version changes.
- Costs and export revenue are independently displayed.
- No fabricated resolution; completeness visible.

## Repo locations
Branch: `task-13-analytics-ui`. Commit prefix: `task-13:`. Write to: `apps/web/src/features/analytics`, `e2e/`, `docs/ANALYTICS.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-13.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-13.md`.
