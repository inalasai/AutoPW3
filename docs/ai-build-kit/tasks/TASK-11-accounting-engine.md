# TASK 11 — Energy and Financial Accounting Engine

**Phase 3 · Energy domain.** Pure library, no UI.

## Goal
Turn normalised telemetry plus tariffs into correct energy totals and money figures, with documented assumptions.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, `docs/ENERGY_ACCOUNTING.md`, telemetry module (Task 08), tariff engine (Task 10), `docs/handoffs/TASK-10.md`.

## Stop conditions
- The accounting document lacks a formula you need (for example battery losses or counterfactuals): write it into `docs/FINANCIAL_MODEL.md` as an explicit assumption and flag it for owner review.

## Plan step
List formulas and the data flow from samples to intervals to totals.

## Requirements
- Convert power samples to interval energy (Wh) with an explicit, documented method (for example left-Riemann on irregular intervals with gap handling). Prefer provider-supplied energy totals where available; do not double count.
- Split intervals at tariff boundaries and timezone/day boundaries.
- Compute separately: import energy and cost; export energy and revenue; net charges (including standing charge and tax); solar generated and self-consumed; battery charged/discharged and, where measurable, losses; avoided grid-import cost (counterfactual: documented as "no solar, no battery" and/or "solar only"); estimated tariff-optimisation benefit (documented counterfactual).
- Avoid double counting battery energy, solar generation and export credits.
- Use the tariff version effective at each interval.
- Data completeness metric: expected vs received intervals; calculations report completeness and never extrapolate silently.
- Resolution-aware: report the resolution used.
- Refuse (type or runtime) to account for `DEMO` data in a "live" context; demo accounting is allowed only when labelled.
- Deterministic outputs; decimals serialised as strings.

## Out of scope
UI, storage, rollup jobs (Task 16).

## Deliverables
Accounting library, tests, golden fixtures with hand-calculated expected values, `docs/FINANCIAL_MODEL.md` listing every formula and counterfactual assumption.

## Required tests
Energy balance across scenarios; import and export cost independently; DST day; mid-range tariff change; gaps reduce completeness not totals silently; no double counting; negative prices; standing charge and VAT; golden values verified by an independent calculation (script or spreadsheet) described in the docs.

## Verification
Type check, lint, tests, build. Report actual output and coverage.

## Acceptance criteria
- Golden fixture totals match hand calculations exactly (to defined decimals).
- Costs and export revenue are computed independently.
- All assumptions are documented and flagged for owner review.

## Repo locations
Branch: `task-11-accounting-engine`. Commit prefix: `task-11:`. Write to: `packages/domain/src/accounting`, `docs/FINANCIAL_MODEL.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-11.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-11.md` with public API of the library and assumptions needing owner sign-off.
