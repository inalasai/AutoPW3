# Decisions

Append-only log. Each entry: ID, date, status, decision, alternatives, rationale.

## D-001 Repository layout
- **Status:** Proposed (ratify or amend in TASK-01)
- **Decision:** npm-workspaces monorepo: `apps/web`, `apps/worker`, `packages/shared`, `packages/domain`, plus `supabase/`, `e2e/`, `docs/`. Details in `docs/ai-build-kit/04-REPO-STRUCTURE.md`.
- **Alternatives:** single package with folders; separate repos.
- **Rationale:** Web and Worker must share one set of types and one tariff/accounting implementation; workspaces enforce import direction.

## D-002 Tesla Fleet API feasibility outcome (TASK-00)
- **Status:** Proposed (research finding, Task 01 to ratify)
- **Decision:** Conditional go. Use the third-party OAuth authorization-code flow (scopes `openid`, `offline_access`, `energy_device_data`, plus `energy_cmds` only if controls are enabled); Tesla access is server-side only; the Fleet API base URL is discovered per user (`GET /api/1/users/region`) and not hard-coded; the Tesla adapter stays mock-only for payloads, sign normalisation and all controls until verified from a redacted real read-only response. Polling is demand-driven and budgeted.
- **Alternatives:** poll `live_status` continuously (rejected: roughly $76/month under the unverified assumption that it is billed as Data, after the $10 discount); assume Fleet Telemetry works for Powerwall (rejected: documentation reached covers vehicles only).
- **Rationale:** Fleet API is pay-per-use (Data 500 requests/$1, commands 1,000/$1) with a $10 monthly discount per account and a mandatory payment method. Subscription-free goal is AT RISK. Full evidence: `docs/research/TESLA_FEASIBILITY.md`, `docs/research/GO_NO_GO.md`.

## D-003 Forced charge, forced export, solar bypass and islanding are NOT_SUPPORTED (TASK-00)
- **Status:** Proposed
- **Decision:** Treat these as unsupported. They are absent from the official energy endpoint list. `grid_import_export` is a permission toggle, not a force command.
- **Alternatives:** emulate via mode/reserve/TOU changes (rejected for v1: effect on dispatch is undocumented).
- **Rationale:** Project rule 3 (no invented provider behaviour). Source: https://developer.tesla.com/docs/fleet-api/endpoints/energy (accessed 2026-10-22).
