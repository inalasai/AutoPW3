# Review of the original AutoPW3 plan

The original 17-task plan was strong on discipline: small tasks, handoffs, no invented Tesla APIs, "never claim a test passed". This review keeps that and fixes the weaknesses below.

## 1. Structural problems fixed

| # | Finding | Change |
|---|---|---|
| 1 | **Tesla feasibility was left to Task 11**, after ~10 tasks of work built on assumptions about telemetry, units, signs and capabilities. | New **TASK-00** spike (research only) up front. Its findings feed the architecture and sign convention. |
| 2 | **Several tasks were too large** for one AI session: Task 3 (schema + RLS + bootstrap + tests), Task 10 (tariff UI + analytics + financial engine), Task 11 (research + OAuth + adapter), Task 12 (entire API). | Split: schema vs. RLS/security (03/04); tariff manager vs. accounting vs. analytics (11/12/13); research moved to 00; Worker API core separate from Tesla adapter (14/15). |
| 3 | **Backend came after the frontend features** with no stated seam, risking a rewrite when real data arrived. | Telemetry and tariff logic sit behind provider/repository interfaces from Task 08 onward. Worker API core (14) uses the demo provider first. |
| 4 | **Context loss between sessions**: "paste the output into the next prompt" is fragile. | Added `02-PROJECT-CONTEXT.md` (attach every time), repo `AGENTS.md`/`CLAUDE.md` created in Task 02, and a stricter handoff template. |
| 5 | **End-to-end tests only appeared in Task 17.** | A Playwright smoke test is introduced in Task 07 and grows each phase. Task 20 audits rather than discovers. |

## 2. Gaps and contradictions fixed

| # | Finding | Change |
|---|---|---|
| 6 | **Role model contradiction.** Roles live on users, yet the plan has households and "admin lists all users". An admin of one household must not see other households' users. | Decision in Task 01: roles are **per household membership**; ADMIN means household admin; the user directory is household-scoped. Platform operator tasks use the Supabase dashboard, not the app. |
| 7 | **No way for a user to join a household.** New users default to READ_ONLY but would see nothing. | Invitation flow added (Tasks 03/04 tables and policy, Task 19 UI and API). First household created via controlled bootstrap. |
| 8 | **Tariffs ignored tax and levies.** Real bills include VAT, standing charges and levies; export payments may be treated differently. | Tariff model gains tax mode (inclusive/exclusive), VAT rate, per-period levies and an export-payment model (Tasks 10/11). Irish values are labelled examples only. |
| 9 | **"Subscription-free" vs. Tesla access.** Fleet API access involves developer registration, region-specific endpoints and may involve usage billing or approval. | Task 00 must document cost, approval, region (EU for Ireland) and rate limits, and record "subscription-free" as validated or at risk. |
| 10 | **Cloudflare Workers constraints** (CPU time, cron timing, no in-memory shared state) were not addressed for locking and scheduling. | Task 01 must choose a locking approach (database job table with atomic claim, or Durable Objects) and justify it. Also verify current Cloudflare static-hosting guidance rather than assuming. |
| 11 | **JWT verification** in Workers was vague. | Task 14 must use the current Supabase-recommended verification method (verify against official docs), never trust client-supplied claims. |
| 12 | **No data lifecycle.** Five-minute samples grow ~105k rows per site per year, and analytics over raw rows will slow down. | Task 03 adds retention and rollup tables (hourly/daily aggregates); Task 16 populates them; Task 13 reads rollups for long ranges. |
| 13 | **Privacy absent.** Energy data is personal data, and the owner is in the EU. | Task 01 adds a privacy section; Task 19/21 add data export and deletion procedures. |
| 14 | **Observability, backups, rollback missing.** | Task 21 requires migration rollback notes, backup/restore drill, structured logging and alerting guidance. |
| 15 | **Grid sign convention** was "define centrally" but never proposed. | Proposed in `02-PROJECT-CONTEXT.md` (positive grid = import, positive battery = discharge) and ratified or corrected in Tasks 00/01. |

## 3. Prompt-quality improvements

- Every task now has the same skeleton: **Goal, Inputs, Stop conditions, Plan step, Requirements, Out of scope, Deliverables, Verification, Acceptance criteria, Handoff**.
- A mandatory **plan step** (list files, risks, questions) precedes code so you can catch mistakes early.
- **Stop conditions**: the AI must ask or flag rather than guess when facts are missing (especially Tesla API details).
- Acceptance criteria are written to be **checkable by command or test**, not by opinion.
- Leaked UI artifacts from the original ("Writing", "0/17" widget) were removed.
- Tasks state explicitly what is **out of scope**, which discourages scope creep and rewrites of working code.

## 4. Kept from the original

Phase discipline, handoff protocol, "mocks before hardware", decimal-safe money, UTC storage with IANA zones, RLS-first security, no unverified Tesla commands, demo data never mixed with live data, and the visual design tokens.

## 5. Items deliberately left out of v1

Native mobile apps/PWA install, multi-region and multi-household UX (the data model supports it), non-Tesla inverters (the provider interface leaves room), billing/subscriptions, and platform-level super-admin UI. Record these in `docs/KNOWN_LIMITATIONS.md`.

## 6. Things you must verify yourself

I could not verify live Tesla, Cloudflare or Supabase behaviour from here. Treat all vendor-specific details (endpoints, scopes, pricing, limits, product names, JWT methods) as **unverified until Task 00 and the relevant tasks cite current official docs**.

## 7. Repository integration (added)

The kit now lives in the repo under `docs/ai-build-kit/`, with `AGENTS.md`/`CLAUDE.md` at the root so agents load the rules automatically. `04-REPO-STRUCTURE.md` defines a workspaces monorepo (`apps/web`, `apps/worker`, `packages/shared`, `packages/domain`, `supabase/`, `e2e/`), import-direction rules, a git/PR workflow and a task-to-path map. Each task file gained a "Repo locations" section. A PR template and CODEOWNERS gate security-sensitive paths. Pure energy logic gets its own package so UI, Worker rollups and automation reuse one tariff/accounting implementation.
