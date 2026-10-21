# TASK 09 — Animated Live View

**Phase 3 · Energy domain.**

## Goal
Build the main dashboard visual from provider telemetry, using the design system.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, design system (Task 06), telemetry provider and fixtures (Task 08), `docs/handoffs/TASK-06.md` to `TASK-08.md`.

## Stop conditions
- Needing to change the telemetry sign convention: stop; that is a cross-cutting decision.

## Plan step
Describe the component split: flow-model (pure functions), canvas renderer, React wrapper, battery widget, status bar. Keep flow logic out of the renderer.

## Requirements
- `LiveView` page with five connected nodes: Core Hub, Solar, Battery, Home, Grid.
- Pure **flow model** converts normalised telemetry to directed flows (source, target, power) — fully unit-testable without canvas.
- Canvas animation: particles move according to direction; speed and density scale with power magnitude with enforced upper bounds. Directions: solar → bus; charging → battery; discharging → away from battery; import grid → home bus; export → grid.
- Numeric kW readings and directional indicators always visible, independent of animation.
- Vertical battery SOC widget: green normal, amber below 15%, distinct critical-low state, and an unknown/stale state when SOC is unreliable.
- `requestAnimationFrame` loop; cleanup on unmount; handle resize and device pixel ratio; honour `prefers-reduced-motion` (static arrows, no particles); avoid unneeded React renders (animation state outside React state).
- Show telemetry source, last-update time and freshness indicator; demo indicator when source is `DEMO`.
- Usable on mobile, with an accessible text summary (screen-reader live region) of current flows.
- Uses the demo provider until a live provider is configured; selection of provider through configuration, not code edits.

## Out of scope
Tesla integration, persistence, control actions.

## Deliverables
`LiveView.tsx`, flow model, canvas renderer, battery widget, tests, `docs/LIVE_VIEW.md` explaining flow model and visual states.

## Required tests
Flow direction for each scenario; zero values; sign flips reverse direction; missing/stale data; magnitude clamping; unmount cleanup cancels animation frame; reduced-motion path.

## Verification
Type check, lint, tests, build. Run the app and describe what you actually viewed at mobile and desktop widths.

## Acceptance criteria
- Swapping a telemetry fixture reverses the appropriate flow and updates the battery display (test proves it).
- Numbers remain readable without animation.
- All tests pass.

## Repo locations
Branch: `task-09-live-view`. Commit prefix: `task-09:`. Write to: `apps/web/src/features/live`, `docs/LIVE_VIEW.md`. Write elsewhere only if you explain why in the handoff.
Flow model is pure and may live in `packages/domain` if the Worker needs it; otherwise keep it in the feature folder.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-09.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-09.md`.
