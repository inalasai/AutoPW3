# TASK 00 — Tesla Fleet API Feasibility Spike (research only)

**Phase 0 · Discovery.** No application code in this task.

## Goal
Establish, from current official documentation, what AutoPW3 can truly do with a Tesla energy site, what it costs, and what approvals are needed, before any architecture is fixed.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`. Web access to official Tesla developer documentation. If you cannot access official docs, say so and stop; do not answer from memory.

## Stop conditions
- Official documentation is unreachable or ambiguous for a capability: record it as `UNVERIFIED`, do not infer.
- Anything you would otherwise guess (endpoint names, fields, scopes): stop and mark it.

## Plan step
List the documentation pages you will consult and the questions you will answer. Then proceed.

## Research questions (answer each with documentation reference, date accessed, and verbatim-free paraphrase)
1. Developer account and application registration requirements. Any approval, review or fees. Is a personal, single-user app permitted?
2. Regional endpoints and registration (Ireland/EU). Partner account registration steps, public-key hosting requirements.
3. OAuth flow: authorisation URL, required scopes for energy sites, token exchange, refresh, expiry, revocation, refresh-token rotation behaviour.
4. Energy-site discovery endpoints and returned fields.
5. Live status: endpoint, method, fields, units, **sign conventions** for solar, battery, grid, load, battery percentage; update cadence.
6. Historical energy data: endpoints, supported resolutions and periods, timezone handling, retention.
7. Site configuration and operating-mode endpoints; backup-reserve endpoints; grid import/export settings. For each: method, payload schema, hardware or firmware restrictions, whether signing is needed for energy products.
8. Rate limits, error codes, retry guidance, usage-based billing or quotas.
9. Whether Fleet API access is **free** for this use. Record clearly whether the "subscription-free" goal is satisfied, at risk, or violated.
10. Whether forced charging, forced export, solar bypass or islanding are documented. Default answer if not documented: **not supported**.
11. Webhooks or streaming (telemetry) options, if any, and their requirements.
12. Terms of service constraints relevant to a self-hosted personal app.

## Deliverables
- `docs/research/TESLA_FEASIBILITY.md`: findings per question, with a confidence level and source link for each.
- `docs/research/TESLA_CAPABILITY_MATRIX_DRAFT.md`: table with columns Capability, Endpoint, Method, Scope/permission, Payload schema, Hardware restrictions, Doc reference, Status (`DOCUMENTED` / `UNVERIFIED` / `NOT_SUPPORTED`).
- `docs/research/TESLA_SETUP_STEPS.md`: ordered list of everything the owner must do manually (accounts, registration, key hosting, redirect URLs, approvals).
- `docs/research/SIGN_CONVENTION_FINDING.md`: provider's native signs and units versus the proposed AutoPW3 convention, and the exact normalisation needed.
- A go/no-go summary: what the MVP can promise, what must be mock-only, and any risk to the subscription-free goal.

## Verification
Every row in the matrix has a source link or is explicitly `UNVERIFIED`. No endpoint name appears without a citation.

## Acceptance criteria
- No capability is marked supported without documentation.
- Costs, approvals and region requirements are stated.
- The sign convention finding is explicit.
- Open questions for the owner are listed separately.

## Repo locations
Branch: `task-00-tesla-feasibility-spike`. Commit prefix: `task-00:`. Write to: docs/research/. Write elsewhere only if you explain why in the handoff.
Research and documents only. No code.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-00.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-00.md`. Task 01 must treat these documents as inputs and may not contradict them.
