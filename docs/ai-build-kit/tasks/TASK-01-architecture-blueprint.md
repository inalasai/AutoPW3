# TASK 01 — Architecture and Implementation Blueprint

**Phase 0 · Discovery.** Documents only. No application code.

## Goal
Turn the vision plus Task 00 findings into a consistent technical plan detailed enough that another AI can implement it without making major architectural decisions.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, `docs/handoffs/TASK-00.md`, and the `docs/research/` documents.

## Stop conditions
- A required decision depends on an unanswered owner question: list it under "Unresolved" and propose a default, do not silently choose.
- Any conflict with Task 00 findings: stop and report.

## Plan step
List the documents, diagrams and decisions you will produce, and the questions you need answered.

## Required decisions (record each in `docs/DECISIONS.md` with alternatives and rationale)
1. **Role model.** Roles per household membership (`READ_ONLY`, `READ_WRITE`, `ADMIN`). ADMIN is household-scoped. The user directory shows only household members. Confirm or justify an alternative.
2. **Household model.** v1 supports one household; schema supports many. How the first household and first admin are created (controlled server-side bootstrap). How others join (admin invitations).
3. **Where credentials live.** Tesla tokens encrypted in the database, keys in Cloudflare secrets, accessible only by server-side code. Specify encryption scheme and key-rotation approach.
4. **Locking and scheduling on Workers.** Choose database-job-table with atomic claim versus Durable Objects (or other), accounting for Worker CPU limits and imprecise cron timing. Verify against current Cloudflare docs.
5. **Static hosting product.** Verify the currently recommended Cloudflare approach before choosing.
6. **JWT verification** approach for Supabase tokens in Workers, per current Supabase docs.
7. **Shared types source of truth.** Location and build approach (for example a `shared/` package imported by web and Worker); how DB types are generated.
8. **Telemetry storage and lifecycle.** Raw sample table, hourly/daily rollups, retention policy, partitioning decision, indexes.
9. **Sign and unit convention**, ratified against `SIGN_CONVENTION_FINDING.md`.
10. **Tariff model.** Flat, TOU, weekday/weekend, seasonal, date overrides, dynamic half-hourly prices, separate import/export schedules, standing charge, VAT/tax mode, levies, export payment model, effective-dated versions, precedence rules.
11. **Money model.** Decimal library, scale, rounding rule (state it), JSON serialisation as strings.
12. **Command lifecycle** states, idempotency keys, reconciliation approach.
13. **Privacy.** Data inventory, retention, user data export and deletion, lawful basis note (for the owner to confirm), no telemetry in logs.
14. **Demo/live separation** mechanism enforced in types and database.
15. **Test strategy and release criteria**, including Playwright smoke from Task 07.
16. **Repository layout.** Ratify or amend `docs/ai-build-kit/04-REPO-STRUCTURE.md` (workspaces, package names, import direction, where each task writes). Record every deviation in `DECISIONS.md` and update that file so later tasks follow it.

## Deliverables (all under `docs/`)
`PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `API_CONTRACT.md`, `SECURITY_MODEL.md`, `ENERGY_ACCOUNTING.md`, `IMPLEMENTATION_ROADMAP.md`, `DECISIONS.md`, `PRIVACY.md`, `KNOWN_LIMITATIONS.md`, `UNRESOLVED_QUESTIONS.md`.

Include Mermaid diagrams for: system architecture, authentication flow, Tesla OAuth flow, telemetry ingestion flow, and command lifecycle.

Also include a feature inventory (routes `/login`, `/register`, `/live`, `/analytics`, `/tariffs`, `/automation`, `/admin`, plus any additions such as `/settings` and `/controls`) and an entity list with relationships.

## Out of scope
Writing application code, migrations or UI.

## Verification
Cross-check documents for consistency: one definition of roles, one set of units and signs, one place credentials live. List the cross-checks you performed.

## Acceptance criteria
- No contradictory definitions of roles, units or signs across documents.
- No ambiguity about where credentials are stored and who can read them.
- No claim that any Tesla command is supported unless Task 00 documented it.
- Frontend, Worker and database responsibilities are explicitly separated.
- Unresolved questions and external dependencies are listed separately.

## Repo locations
Branch: `task-01-architecture-blueprint`. Commit prefix: `task-01:`. Write to: `docs/*.md` design docs, `docs/DECISIONS.md`; amend `docs/ai-build-kit/04-REPO-STRUCTURE.md` if needed. Write elsewhere only if you explain why in the handoff.
Ratify the repo layout and record any change as a decision.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-01.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-01.md`. Next task needs the architecture, security model, API contract and decisions. **The owner should review and approve these before Task 02 begins.**
