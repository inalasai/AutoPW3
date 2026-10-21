# TASK 08 — Telemetry Domain and Demo Provider

**Phase 3 · Energy domain.**

## Goal
Create the telemetry abstraction so the dashboard can be built before any real Powerwall is connected.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, shared types from Task 05, `docs/ENERGY_ACCOUNTING.md`, `docs/research/SIGN_CONVENTION_FINDING.md`, `docs/handoffs/TASK-05.md` to `TASK-07.md`.

## Stop conditions
- Sign convention in shared types disagrees with the research finding: stop and report.

## Plan step
Describe the provider interface, the normaliser layout and the scenario list.

## Requirements
- A `TelemetryProvider` interface (live snapshot, historical series with explicit resolution, capability info) that the Tesla adapter will implement later. Document it.
- Normalisation functions separate from provider code, using the central sign convention.
- Deterministic synthetic datasets (seeded; no randomness at render time) for a day, a week and a month, with an Irish-latitude-like solar curve and plausible household demand.
- Scenarios: solar surplus, battery charging, battery discharging, grid import, grid export, low battery, missing data, stale data, negative/invalid readings.
- Every sample carries timestamp (UTC), source (`DEMO`), unit-explicit fields and a quality flag. Labelled synthetic everywhere.
- Utilities: timestamp normalisation, sort, deduplicate, gap detection, stale detection (configurable threshold), validation (energy-balance tolerance check, SOC range).
- Guard so demo data cannot flow into live ingestion or live accounting paths (type-level `source` discrimination plus runtime assertion).
- Fixtures reusable by later tasks.

## Out of scope
UI, Tesla calls, persistence.

## Deliverables
Telemetry domain module, demo provider, fixtures, data-quality utilities, unit tests (signs, units, timestamps, invalid values, gaps, staleness, energy balance), `docs/TELEMETRY_MODEL.md`.

## Verification
Type check, lint, tests, build. Report actual results.

## Acceptance criteria
- Same inputs always produce identical datasets.
- Every sample has timestamp, source and unit; stale and invalid data is flagged.
- Attempting to pass `DEMO` data to a live-accounting function fails at compile time or runtime (test proves it).

## Repo locations
Branch: `task-08-telemetry-demo-provider`. Commit prefix: `task-08:`. Write to: `packages/domain/src/telemetry`, `packages/domain/src/fixtures`, `docs/TELEMETRY_MODEL.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-08.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-08.md` with the provider interface and fixture index.
