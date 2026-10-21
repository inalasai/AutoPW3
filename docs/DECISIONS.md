# Decisions

Append-only log. Each entry: ID, date, status, decision, alternatives, rationale.

## D-001 Repository layout
- **Status:** Proposed (ratify or amend in TASK-01)
- **Decision:** npm-workspaces monorepo: `apps/web`, `apps/worker`, `packages/shared`, `packages/domain`, plus `supabase/`, `e2e/`, `docs/`. Details in `docs/ai-build-kit/04-REPO-STRUCTURE.md`.
- **Alternatives:** single package with folders; separate repos.
- **Rationale:** Web and Worker must share one set of types and one tariff/accounting implementation; workspaces enforce import direction.
