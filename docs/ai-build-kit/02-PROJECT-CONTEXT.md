# AutoPW3 — Project Context (attach to every task)

You are helping build AutoPW3, a subscription-free residential energy-management web app focused on Tesla Powerwall sites. It shows live energy flow, analyses historical energy and cost against configurable tariffs, and (where genuinely supported) controls devices and automates tariff-aware behaviour. The primary user is in Ireland, so Irish day/night tariffs and EU data protection matter, but the product must not hard-code Ireland.

Follow this document in every task. If a task file conflicts with it, stop and ask.

## Stack (verify current versions and pin them)

- Frontend: React, TypeScript (strict), Vite, Tailwind CSS, React Router, Recharts, HTML5 Canvas for energy flow.
- Backend: Cloudflare Workers (API and scheduled tasks). Static frontend hosting on Cloudflare using the currently recommended product (verify against current docs).
- Data/Auth: Supabase Auth and PostgreSQL with Row Level Security.
- Provider: Tesla Fleet API (server-side only), behind a provider interface alongside a demo provider.
- Validation: Zod (or equivalent) shared between frontend and Worker.
- Money: a decimal library (e.g. decimal.js or big.js). No floating point for money.
- Tests: Vitest, React Testing Library, Playwright (e2e), pgTAP or equivalent SQL tests.

## Non-negotiable rules

1. **Roles.** `READ_ONLY`, `READ_WRITE`, `ADMIN`. Roles are per household membership. New users default to `READ_ONLY`. Nobody can change their own role. Admin bootstrap is a controlled, one-time, server-side operation. Backend and database are authoritative, the UI only reflects.
2. **Security by default.** RLS on every exposed table, explicit grants, least privilege. Service-role credentials exist only in trusted server code. Tesla tokens are encrypted at rest, never returned to the browser, never logged.
3. **No invented provider behaviour.** Do not guess Tesla endpoints, scopes, payloads or capabilities. Cite current official documentation, or mark the item `UNVERIFIED` and use a mock. Never assume forced charging, forced export, solar bypass or islanding is supported.
4. **Honest status.** Every command outcome is `CONFIRMED`, `FAILED`, `PENDING` or `UNKNOWN`. HTTP 200 alone is not confirmation.
5. **Demo vs live.** Sample data is synthetic, labelled, carries `source: DEMO`, and can never be written to or aggregated with live tables. UI shows a persistent demo indicator.
6. **Units and signs (proposed, ratified in Task 00/01).** Power in watts (`...W`), energy in watt-hours (`...Wh`), percentages `0–100` (`...Percent`), rates per kWh as decimal strings (`...RatePerKwh`). Signs: `solarPowerW ≥ 0` (generation); `batteryPowerW > 0` discharging, `< 0` charging; `gridPowerW > 0` importing, `< 0` exporting; `loadPowerW ≥ 0`. Balance: `loadPowerW ≈ solarPowerW + batteryPowerW + gridPowerW`. Every reading has a UTC timestamp, source and quality flag. If the provider's convention differs, normalise at the adapter boundary only.
7. **Time.** Persist UTC `timestamptz`. Keep the site's IANA timezone alongside. Intervals are half-open `[start, end)`. Handle DST (23- and 25-hour days). Never use fixed UTC offsets for recurring schedules.
8. **Money.** Decimal arithmetic only. Serialise decimals over JSON as strings. Store as `numeric`. Always carry currency. Rates are never silently defaulted to zero; missing coverage is an error.
9. **Data resolution honesty.** Show the real resolution available. Never fabricate finer data than the provider supplied.
10. **Automation safety.** New rules default to `DRY_RUN` or `DISABLED`. Dry-run never calls control endpoints. Missing or stale data, missing capability or missing authorisation means no action. A global pause exists. Commands are idempotent.
11. **Single source of truth for types.** Shared domain types and Zod schemas live in one package/folder (decided in Task 01, built in Task 05). Frontend and Worker import them. Database types are generated from the schema.
12. **No hidden scope.** Do not rewrite working code from earlier tasks unless a documented defect requires it. Record such changes in the handoff.

## Visual identity

Space-black `#020617`/`#090D16`; translucent slate glass panels; borders `#1E293B`; solar `#F59E0B`; battery `#10B981`; grid `#6366F1`; selection `#06B6D4`; monospace for telemetry; restrained glow; accessible contrast, keyboard navigation, reduced-motion support. Must remain readable with effects off.

## Working rules for the AI

- **Plan first.** Before writing code, list the files you will create/change, risks, and questions. If a stop condition in the task triggers, stop.
- **Produce real files**, complete, not snippets or descriptions.
- **Run the checks** named in the task. Report the exact command and real result. Never claim something passed unless you executed it. If a tool is unavailable, say "not executed" and give the command.
- **Do not fabricate** library APIs, versions, endpoints or test results. Check installed package versions and docs.
- **Strict TypeScript.** No `any` without a comment justifying it.
- **No secrets** in code, docs, fixtures or logs. Use placeholders like `YOUR_VALUE_HERE`.
- **Small commits** with clear messages, one branch per task.
- **Finish with a handoff report** in `docs/handoffs/TASK-NN.md` using `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`. Do not mark a task complete if acceptance criteria are unmet.
- Maintain `docs/KNOWN_LIMITATIONS.md` and `docs/DECISIONS.md` (append, do not rewrite history).

## Verification status vocabulary (use in docs and handoffs)

`VERIFIED` (executed and passed) · `MOCK_ONLY` · `AWAITING_CREDENTIALS` · `AWAITING_PROVIDER_APPROVAL` · `UNSUPPORTED_BY_DEVICE` · `UNVERIFIED` · `NOT_EXECUTED`

## Repository rules
- Code layout, import direction and git workflow are defined in `docs/ai-build-kit/04-REPO-STRUCTURE.md`. Follow them. Deviations need a `docs/DECISIONS.md` entry.
- Shared types and schemas: `packages/shared`. Pure energy logic (telemetry, tariff, accounting): `packages/domain`. Never duplicate either in `apps/*`.
- Provider-specific Tesla types stay inside `apps/worker/src/providers/tesla`.
- The repo already contains `AGENTS.md` and `CLAUDE.md`; extend them, do not recreate them.
- Do one task per session, on branch `task-NN-<slug>`, and write only in the paths listed for that task unless you explain why in the handoff.
