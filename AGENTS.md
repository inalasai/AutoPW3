# AGENTS.md — AutoPW3

Instructions for any AI coding agent working in this repository. Humans: see `docs/ai-build-kit/00-README.md`.

## What this project is
AutoPW3 is a subscription-free residential energy-management web app for Tesla Powerwall sites: live energy-flow view, tariff-aware analytics, supported device controls and safe automation. Stack: React + TypeScript + Vite + Tailwind, Cloudflare Workers, Supabase (Auth + Postgres with RLS), Tesla Fleet API, Recharts, Canvas.

## Read these first, in order
1. `docs/ai-build-kit/02-PROJECT-CONTEXT.md` — non-negotiable rules (roles, signs/units, money, time, demo vs live, security).
2. `docs/ai-build-kit/04-REPO-STRUCTURE.md` — where code goes and what may import what.
3. The task file you were given in `docs/ai-build-kit/tasks/` (one task per session).
4. The previous handoff in `docs/handoffs/` and the docs it lists.

## How to work
- Do **one task per session**. Do not start the next task or implement other layers.
- **Plan first**: list files to create/change, risks and questions before writing code. Obey the task's stop conditions.
- Work on branch `task-NN-<slug>`. Commit in small steps: `task-NN: <what>`.
- Write complete files. No placeholders like "rest unchanged".
- Run the checks the task names. Report exact commands and real results. **Never claim something passed unless you ran it**; otherwise write `NOT_EXECUTED` and give the command.
- Finish with `docs/handoffs/TASK-NN.md` using `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`. If acceptance criteria are unmet, say **TASK NOT COMPLETE**.
- Keep the README in every folder you touch accurate (what it holds, status, rules). Update `Status:` lines.
- Never commit real credentials. See `docs/CREDENTIALS.md`. Tests and how to run them: `docs/TESTING.md`.
- Append to `docs/DECISIONS.md` and `docs/KNOWN_LIMITATIONS.md`; never rewrite history in them.

## Hard rules (summary — full text in 02-PROJECT-CONTEXT.md)
- Roles `READ_ONLY | READ_WRITE | ADMIN`, per household membership; default `READ_ONLY`; backend and database are authoritative, never the browser.
- No secrets in the repo, logs, fixtures or prompts. Tesla tokens are encrypted at rest and never leave the server.
- Never invent Tesla endpoints, scopes, payloads or capabilities. Cite official docs or mark `UNVERIFIED` and use the mock.
- Money is decimal-safe (never floats), serialised as strings. Time is UTC `timestamptz` plus IANA timezone; handle DST.
- Signs: solar ≥ 0; battery > 0 discharging; grid > 0 importing; units in field names (`...W`, `...Wh`, `...Percent`).
- Demo data is labelled `source: DEMO` and can never reach live tables or live accounting.
- Automation defaults to `DRY_RUN`/`DISABLED`; dry-run never calls control endpoints. Never run live control commands against real hardware.
- Do not rewrite working code from earlier tasks unless a documented defect requires it.

## Commands
Filled in by Task 02. Expected root scripts (npm workspaces):
```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e   # Playwright (from Task 07)
npm run db:reset   # local Supabase reset (Task 03)
npm run db:test    # SQL security tests (Task 04)
npm run db:types   # regenerate DB types (Task 05)
```
Until Task 02 is complete these do not exist yet.
