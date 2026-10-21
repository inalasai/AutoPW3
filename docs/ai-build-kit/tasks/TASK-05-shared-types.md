# TASK 05 — Shared Domain Types and Validation

**Phase 1 · Foundation.**

## Goal
Create the single source of truth for TypeScript types and runtime schemas so the frontend, Worker and database never disagree.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, `docs/API_CONTRACT.md`, `docs/ENERGY_ACCOUNTING.md`, migrations, generated DB types, `docs/handoffs/TASK-04.md`.

## Stop conditions
- Conflict between API contract and database: stop and list it; do not pick silently.

## Plan step
List all schemas, their file layout and how DB types are generated and consumed.

## Requirements
Implement TypeScript types **and** Zod (or equivalent) schemas for:
- Users, household membership, roles, invitations.
- Energy sites and device capabilities (supported / unsupported / unverified).
- Normalised live telemetry and historical samples, including `source` and `quality`.
- Tariff profiles, windows, overrides, taxes, levies, effective dates.
- Automation rules, conditions, actions, modes.
- Financial inputs/outputs, using decimal-safe values; define JSON serialisation as strings and parsing helpers.
- Tesla provider response types **kept separate** from normalised internal types, with a clearly marked normalisation boundary.
- API request/response contracts, pagination, standard error shape with stable error codes.
- Device command requests, idempotency keys, lifecycle states and results.

Centralise the sign convention (constants and documented helper functions). Use units in field names. Validate dates, timezones (IANA), rates, percentages (0–100), time windows, roles and command parameters. No duplicated interfaces elsewhere. Generate Supabase DB types and document the command.

## Out of scope
Business logic, UI, Worker handlers.

## Deliverables
Shared package/folder with types, schemas and helpers; API contract types; type-generation instructions; unit tests for valid and invalid payloads; `docs/DOMAIN_TYPES.md`. Update existing code to import from the shared package.

## Verification
```bash
npm run typecheck
npm run lint
npm test
npm run build
```
Report actual results.

## Acceptance criteria
- Web and Worker import shared contracts; no parallel definitions remain.
- Invalid payloads are rejected by tests (bad role, SOC 120, malformed timezone, negative window length, non-string money).
- All checks pass.

## Repo locations
Branch: `task-05-shared-types`. Commit prefix: `task-05:`. Write to: `packages/shared/src/` (`schemas/`, `types/`, `constants/`, `db/database.types.ts` generated), `docs/DOMAIN_TYPES.md`. Write elsewhere only if you explain why in the handoff.
Update `apps/*` only to import from `@autopw3/shared`.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-05.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-05.md` with schema index and import conventions.
