# AutoPW3 — AI Build Kit

A phased set of instructions for building AutoPW3, a subscription-free residential energy-management web app for Tesla Powerwall sites, using an AI coding assistant. The kit lives in this repository so every AI session works from files, not chat history.

Works with Claude Code, Gemini, ChatGPT/Codex or any coding assistant. Agents that can read/write files and run commands work best.

## Contents

| Path | Purpose |
|---|---|
| `AGENTS.md`, `CLAUDE.md` (repo root) | Auto-loaded agent rules |
| `docs/ai-build-kit/00-README.md` | This guide and progress tracker |
| `docs/ai-build-kit/01-REVIEW-AND-CHANGES.md` | Review of the original spec and what changed |
| `docs/ai-build-kit/02-PROJECT-CONTEXT.md` | Non-negotiable project rules |
| `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md` | Handoff report format |
| `docs/ai-build-kit/04-REPO-STRUCTURE.md` | Code layout, import rules, git workflow, where each task writes |
| `docs/ai-build-kit/tasks/TASK-00 … TASK-21` | One prompt per task |
| `docs/handoffs/` | Handoff reports (one per task) |
| `docs/research/` | TASK-00 outputs |
| `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | Append-only registers |
| `.github/pull_request_template.md`, `CODEOWNERS` | Review gates |
| `README.md`, `CONTRIBUTING.md`, `SECURITY.md` (repo root) | Project front page, workflow, vulnerability reporting |
| `.env.example`, `.gitignore`, `.editorconfig` (repo root) | Placeholder config, secret-safe ignores, editor settings |
| `docs/CREDENTIALS.md`, `docs/TESTING.md`, `docs/README.md` | Secrets handling, test strategy, doc index |
| `apps/*/README.md`, `packages/*/README.md`, `supabase/README.md`, `e2e/README.md`, `scripts/README.md` | Where code goes in each folder, with rules |

## Installing the kit into AutoPW3

```bash
git clone https://github.com/inalasai/AutoPW3.git
cd AutoPW3
git checkout -b chore/ai-build-kit
unzip -n ../AutoPW3-ai-build-kit.zip -d .   # -n: never overwrite existing files
git status                                  # review what was added
git add .
git commit -m "chore: add AI build kit"
git push -u origin chore/ai-build-kit
```

If the repository already has `AGENTS.md`, `CLAUDE.md`, `.github/` files or a `docs/DECISIONS.md`, `unzip -n` leaves yours untouched. Merge the kit's content into them by hand. Add a line to your root `README.md` linking to `docs/ai-build-kit/00-README.md`.

## Running a task

1. Previous task's checks passed, work merged to `main`.
2. Start a **fresh** AI session in the repo root (so `AGENTS.md` loads).
3. Give this instruction, naming the task:

   > Do TASK-NN. Read `AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, the task file `docs/ai-build-kit/tasks/TASK-NN-….md` and the previous handoff in `docs/handoffs/`. Start with the plan step. Stop if a stop condition triggers.

4. Review the plan. For migrations, RLS, tokens, commands and middleware, review the code yourself.
5. Run the verification commands yourself. Do not accept "tests pass" without seeing output.
6. Open a PR from `task-NN-<slug>` using the template. Merge when green. Tag `task-NN-done`.
7. Tick the tracker below.

Chat-only assistants: attach the same files and apply the output manually; the rules are identical.

## Rules that save the most pain
- The repository is the source of truth, not the conversation.
- One major layer per task. Do not merge tasks.
- Mocks first. Never test high-impact controls on real hardware until the integration is verified, and then only manually.
- Never paste secrets into prompts or commit them.
- Require complete files; if output truncates, resume at the exact file and line.
- Ask for evidence: commands run, outputs, files changed.
- Never move on if a critical security check or build fails.

## Progress tracker

**Phase 0 — Discovery and contract**
- [x] TASK-00 Tesla Fleet API feasibility spike (research only) — done, see `docs/handoffs/TASK-00.md`
- [x] TASK-01 Architecture blueprint (ratifies `04-REPO-STRUCTURE.md`) — approved by the owner 2026-10-23, see `docs/handoffs/TASK-01.md`

**Phase 1 — Foundation**
- [x] TASK-02 Repository bootstrap — checks pass from a clean clone; CI and PR `NOT_EXECUTED`, see `docs/handoffs/TASK-02.md`
- [x] TASK-03 Database schema and migrations - verified on PostgreSQL 17.10 with a shim; `supabase db reset`, config.toml load, CI and PR `NOT_EXECUTED`, see `docs/handoffs/TASK-03.md`
- [x] TASK-04 RLS, grants, admin bootstrap, SQL security tests - 336 assertions pass on PostgreSQL 17.10 with a shim; `supabase test db`, real Supabase stack, CI, PR and `db:types` `NOT_EXECUTED`, see `docs/handoffs/TASK-04.md`
- [x] TASK-05 Shared types and validation - Zod schemas, route table, drift tests, generated DB types (own generator); real `supabase gen types`, CI and PR `NOT_EXECUTED`, see `docs/handoffs/TASK-05.md`

**Phase 2 — Frontend foundation**
- [x] TASK-06 Design system and app shell - tokens with one effects switch, UI components, responsive shell, placeholder routes, `/dev/components`; PR and GitHub CI `NOT_EXECUTED`, see `docs/handoffs/TASK-06.md`
- [x] TASK-07 Authentication and permission-aware UI - Supabase Auth adapter, dev-only mock adapter, route guards, role-aware nav, Playwright smoke; real Supabase project `AWAITING_CREDENTIALS`, PR and CI `NOT_EXECUTED`, see `docs/handoffs/TASK-07.md`

**Phase 3 — Energy domain**
- [x] TASK-08 Telemetry model and demo provider - `TelemetryProvider` interface, normaliser, data-quality utilities, demo/live guard, seeded demo day/week/month and scenarios; thresholds `UNVERIFIED`, PR and CI `NOT_EXECUTED`, see `docs/handoffs/TASK-08.md`
- [x] TASK-09 Animated Live View - pure flow model, canvas renderer with animation loop and cleanup, battery gauge, status bar, accessible text summary, provider chosen by `VITE_TELEMETRY_PROVIDER`; thresholds `UNVERIFIED`, real devices, PR and CI `NOT_EXECUTED`, see `docs/handoffs/TASK-09.md`
- [x] TASK-10 Tariff engine - rate resolution with deterministic precedence, DST-correct interval splitting and pricing, VAT/levies/standing charge in decimal, validators, example fixtures, property tests; negative prices engine-only, all tariff values `ILLUSTRATIVE EXAMPLE`, PR and CI `NOT_EXECUTED`, see `docs/handoffs/TASK-10.md`
- [x] TASK-11 Accounting engine - power-to-energy integration, energy totals, independent import/export costing, standing charges, VAT, efficiency metrics, counterfactual savings analysis, golden fixtures verified; PR and CI `NOT_EXECUTED`, see `docs/handoffs/TASK-11.md`
- [x] TASK-12 Tariff manager UI - create, edit, clone, archive profiles, midnight-crossing decomposition, 24h preview with DST, live engine validation, effective-dated versioning, role-gating, Playwright smoke tests; PR and CI `NOT_EXECUTED`, see `docs/handoffs/TASK-12.md`
- [x] TASK-13 Analytics UI - historical energy and cost charts (Recharts), summary cards, counterfactual savings ("no solar, no battery"), resolution mapping, telemetry completeness and gap disclosure, accessible data table alternatives, CSV export with formula injection protection, Playwright smoke tests; PR and CI `NOT_EXECUTED`, see `docs/handoffs/TASK-13.md`

**Phase 4 — Backend and Tesla**
- [x] TASK-14 Worker API core - 12-stage middleware pipeline, asymmetric JWT verification (RS256/ES256), Zod validation, sliding-window rate limiting, idempotency key replay with secret redaction, authoritative DB role enforcement (404 on cross-household), typed route handlers, API_OPERATIONS.md; see docs/handoffs/TASK-14.md
- [x] TASK-15 Tesla adapter and OAuth - PKCE authorization-code flow, AES-256-GCM token encryption (Operation S4), rotating refresh token concurrency lock, dynamic regional base URL discovery, central sign normalisation, MockTeslaClient, TESLA_INTEGRATION.md, TESLA_CAPABILITY_MATRIX.md; credentials AWAITING_CREDENTIALS, PR and CI NOT_EXECUTED, see docs/handoffs/TASK-15.md
- [x] TASK-16 Telemetry ingestion - live status polling and historical calendar sync separation, D-006 sign normalisation, DEMO rejection, resumable cursor backfills, per-site failure isolation, hourly (UTC) and daily (DST-aware) rollups, 90-day/30-day retention with dry-run, scheduled cron dispatcher, job & lock database migration (db:verify 100%, db:test 336 ok); PR and CI NOT_EXECUTED, see docs/handoffs/TASK-16.md

**Phase 5 — Controls and operations**
- [ ] TASK-17 Device controls
- [ ] TASK-18 Automation engine
- [ ] TASK-19 Administration and audit

**Phase 6 — Release**
- [ ] TASK-20 Security audit and end-to-end tests
- [ ] TASK-21 Deployment and release

## Tasks that must stay separate

| Tasks | Why |
|---|---|
| 00–01 | Feasibility findings must shape the architecture |
| 03–04 | Schema must be reviewed before security policies are layered on |
| 05–07 | Shared types and auth affect every later feature |
| 08–13 | Financial correctness depends on earlier contracts |
| 14–16 | Different failure modes: API authz, OAuth, ingestion |
| 17–19 | Controls, scheduling and admin each need independent security tests |
| 20 | Independent final review, in a fresh session |
