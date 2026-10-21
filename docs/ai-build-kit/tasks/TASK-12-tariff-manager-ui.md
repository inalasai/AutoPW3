# TASK 12 — Tariff Manager UI

**Phase 3 · Energy domain.**

## Goal
Let users create, validate and (with permission) save tariff profiles.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, design system, auth module (Task 07), tariff engine (Task 10), shared types, `docs/handoffs/TASK-10.md`, `TASK-11.md`.

## Stop conditions
- Persistence requires a backend endpoint that does not exist yet: build against a repository interface with a demo/in-memory implementation and a Supabase implementation that goes through RLS; the Worker route comes in Task 14.

## Plan step
Describe the form model, validation flow and repository interface.

## Requirements
- `TariffManager` page: create, edit, clone, archive profiles; add/remove windows; weekday/weekend selection; start/end times (including crossing midnight); independent import and export rates; seasonal ranges and date overrides; currency, timezone, effective date, standing charge, VAT/levies.
- Daily and weekly schedule **preview** (24-hour bar with DST-day variant) driven by the tariff engine.
- Live validation using the engine: overlap, gaps, missing rates; clear, field-level errors.
- Unsaved-changes indicator and navigation guard; save errors shown.
- Effective-dated versioning: editing creates a new version rather than rewriting history, and the UI explains this.
- `READ_ONLY` users see everything but cannot save (disabled controls with explanation); the data layer still enforces it.
- Money inputs handled as strings/decimals, never JS floats.
- Provide Irish example templates labelled as examples with no claim of being current.

## Out of scope
Analytics, Worker endpoints.

## Deliverables
`TariffManager.tsx`, supporting components/hooks/services, tests, extension of Playwright smoke tests (create invalid tariff → blocked; valid → saved in demo mode), `docs/TARIFF_MANAGER.md`.

## Verification
Type check, lint, tests, build, Playwright. Report actual results.

## Acceptance criteria
- Overlapping and incomplete tariffs cannot be saved.
- Midnight-crossing and DST previews are correct.
- READ_ONLY cannot persist (UI test and data-layer test).
- Editing preserves older versions.

## Repo locations
Branch: `task-12-tariff-manager-ui`. Commit prefix: `task-12:`. Write to: `apps/web/src/features/tariffs`, `e2e/`, `docs/TARIFF_MANAGER.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-12.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-12.md`.
