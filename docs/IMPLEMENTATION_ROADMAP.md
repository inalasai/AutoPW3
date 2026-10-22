# Implementation Roadmap (TASK-01)

Status: **PROPOSED, awaiting owner approval.** Written 2026-10-22. One task per session, owner gate after each (`HowToBuild.docx`). This roadmap does not change the task files; it records what each task must take from the Task 01 documents and where the architecture needs something extra.

## 1. Task sequence, dependencies and what each must carry from Task 01

| Task | Delivers | Depends on | Must use from Task 01 / watch for | Owner gate |
|---|---|---|---|---|
| 00 | Tesla feasibility | none | Done (2026-10-22) | Answer Q-01…Q-06 as able |
| 01 | Blueprint (this) | 00 | Done when approved | **Approve docs before 02** |
| 02 | Skeleton, CI, lint rules | 01 | Pin `zod >= 4.5.0` (Workers memory, V3), `decimal.js`, `jose`, Wrangler, Vite; `wrangler.jsonc` in `apps/worker` with `assets` pointing at the web build, `run_worker_first: ["/api/*"]`, `not_found_handling: "single-page-application"`, cron `* * * * *`; `_headers` CSP file; ESLint import-direction and no-`Date.now()`-in-domain and no-float-money rules; secrets scan; test that `/.well-known/appspecific/com.tesla.3p.public-key.pem` placeholder is served from a local build (Q-03); `.env.example` names only | Confirm 5 checks pass from clean clone |
| 03 | Schema + migrations | 02 | Use `DATABASE_DESIGN.md` table list and columns exactly (including new tables); `btree_gist` exclusion constraints; IANA timezone trigger; `source = 'TESLA'` checks; RLS enabled default-deny | **Read every migration** |
| 04 | RLS, grants, functions, bootstrap, pgTAP | 03 | Implement `SECURITY_MODEL.md` §2.1 matrix exactly; helper functions in a non-exposed `private` schema; invitation, role-change, pause, rule-mode functions; audit | **Read every policy; run SQL tests** |
| 05 | Shared types and Zod | 04 | Zod schemas for every API body in `API_CONTRACT.md`; `decimalString`; role/state enums; DB types generated into `packages/shared/src/db` (command verified in this task, `UNVERIFIED` now) | |
| 06 | Design system, shell | 05 | Routes per `PRODUCT_REQUIREMENTS.md` §5; DEMO banner component | Browser check |
| 07 | Auth UI, first Playwright smoke | 06 | Zero-privilege empty state, invitation route; verify Supabase settings (Q-12, Q-13, Q-15) | Browser check |
| 08 | Telemetry model, demo provider | 05 | Provider interface; `LiveTelemetry` type excludes DEMO; sign normalisation helpers and balance check; deterministic demo fixtures | |
| 09 | Live view | 08 | Freshness, source, quality, budget states; reduced motion | Browser check |
| 10 | Tariff engine | 08 | `ENERGY_ACCOUNTING.md` §3 and §5 exactly; choose tz library and justify; golden/DST tests | |
| 11 | Accounting engine | 10 | `ENERGY_ACCOUNTING.md` §4, 6, 7; unpriceable-interval handling; rounding rule; golden values computed independently | |
| 12 | Tariff manager UI | 10 | Validation panel shows `TARIFF_GAP` etc.; illustrative Irish templates labelled | Browser check |
| 13 | Analytics UI | 11 | Show real resolution and completeness; DST days | Browser check |
| 14 | Worker API core | 04, 05, 13 | `API_CONTRACT.md` conventions; JWT per D-009 (confirm `aud`); middleware order; user-scoped DB client; list S1–S9 usage per route in `API_OPERATIONS.md`; rate limit mechanism; measure CPU/subrequests against Free limits (Q-05) | Review authz tests |
| 15 | Tesla adapter + OAuth + token encryption | 14 | `SYSTEM_ARCHITECTURE.md` §5, §8; `TESLA_FLEET_API_BASE_URL` config; refresh lease; PKCE; capability registry from the matrix; mock adapter; no live call without owner (Q-01…Q-06) | **Credentials via `.dev.vars` only** |
| 16 | Ingestion, rollups, retention, jobs | 15, 03 | Job and lock functions (`claim_jobs`, `acquire_lock`, `record_provider_call`), budget defaults, `sync_live`/`sync_history`/`rollup`/`retention`/`token_maintenance`; fake-clock tests; DST rollups; measure Free-plan limits | Review jobs SQL |
| 17 | Controls | 16 | Command lifecycle `SYSTEM_ARCHITECTURE.md` §12; unsupported kinds rejected by backend; mock only | **Manual only** |
| 18 | Automation | 17 | Dry-run default; pause; dedupe via `UNIQUE (rule_id, scheduled_slot)`; stale-data guard uses `stale_after_seconds` | **Dry-run only** |
| 19 | Admin, audit, privacy tools | 18 | `PRIVACY.md` export/deletion; last-admin and no-self-role rules in UI and API | Browser + security check |
| 20 | Independent audit + e2e | all | Fresh session; endpoint × role matrix from §2 of `API_CONTRACT.md`; verification register | **Do not deploy with open critical/high** |
| 21 | Deployment, runbook | 20 | Secrets set by the owner; backup/restore drill; rotation procedures; privacy notice template | Owner sets real secrets |

Notes on ordering: Tasks 05 to 13 build the product on the demo provider; Tasks 14 to 16 connect real backends; Tesla live verification stays manual and `UNVERIFIED` until the owner runs it (`docs/research/GO_NO_GO.md`).

## 2. Risk register

| Risk | Impact | Mitigation | Where |
|---|---|---|---|
| Individual app not approved by Tesla | No live data | Mock-first design; Q-01 early | TASK-00/15 |
| Tesla billing exceeds expectations | Cost | Spend cap, counters, no 4xx retries, stale-with-label fallback | D-023 |
| Workers Free CPU/subrequest limits too tight | Ingestion fails | Small bounded jobs; measure in 14/16; escalate to owner (Q-05) | TASK-14/16 |
| Refresh-token race or 3-month expiry | Lock-out | Lease + persist-before-use; weekly maintenance; reconnect flow | TASK-15 |
| Unverified signs/fields | Wrong analytics | No `OK` quality until verified; balance check; Q-06 | TASK-08/15/16 |
| Cron jitter or duplicates | Missed or duplicate actions | Idempotent jobs, dedupe keys, leases, catch-up cursors | TASK-16/18 |
| RLS gap | Data exposure | Matrix-first TASK-04, pgTAP blockers, independent audit | TASK-04/20 |
| Resolution mismatch with tariff bands | Wrong costs | Unpriceable by default, labelled estimate opt-in | TASK-10/11 |
| DST bugs | Wrong day totals/schedules | tz-aware library, 23/25 h tests everywhere | TASK-10/11/16/18 |
| Dependency drift | Build breaks | Pin and lock; audit | TASK-02 |

## 3. Test strategy and release criteria (decision 15, D-018)

Layers and tools (consistent with `docs/TESTING.md`):

| Layer | Tool | Notes |
|---|---|---|
| Unit | Vitest | Pure logic in `packages/domain` and `packages/shared`; golden money and DST fixtures computed independently of the code under test |
| Component | Vitest + React Testing Library | Role-aware UI, accessibility checks, demo banner |
| API | Vitest (Workers test environment chosen in TASK-14, `UNVERIFIED`) | Per route × role × cross-household, forged/expired JWT, oversize body, CORS, pagination caps, idempotency replay, error sanitisation, token absence in responses and logs |
| Database | pgTAP | RLS, grants, escalation denial, bootstrap once, last-admin, invitations, `source` check, append-only, job claim concurrency, lease expiry |
| End-to-end | Playwright | **Smoke from TASK-07** (register/login, zero-privilege empty state), grows each phase; TASK-20 runs the full list; runs against mocks and a local Supabase |
| Live Tesla | Manual, owner-run | Never automated; never control commands against real hardware by agents |

Time: injected fake clock everywhere. Money: decimal only, golden values. Determinism: seeded demo data.

**Release criteria (all must hold; anything unrun is `NOT_EXECUTED` and blocks):**
1. `npm run typecheck`, `lint`, `test`, `build` pass from a clean checkout; CI mirrors them.
2. `npm run db:test` passes, including every required security test in `docs/TESTING.md`.
3. Playwright suite passes: register/login; READ_ONLY dashboard; tariff create/validate; analytics; OAuth callback (mock); ingestion (mock); command lifecycle (mock); automation dry-run; invitation and role change; unauthorised rejection.
4. Secrets scan clean; dependency audit reviewed; no secret in repo history.
5. Security audit (TASK-20): zero open critical/high findings.
6. Verification register honest: Tesla live behaviour `UNVERIFIED` unless the owner ran an authorised manual test.
7. Spend cap enforced and tested; documentation states "no subscription, Tesla may charge".
8. Automation default-off verified; dry-run produces zero provider control calls (mock assertion).
9. Backup/restore drill and rotation procedures documented (TASK-21).
