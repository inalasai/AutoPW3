# AutoPW3 — Task Handoff Report

## Task completed
Number and name: TASK-01 — Architecture and Implementation Blueprint (documents only)
Branch / commit: `Raj-AutoPW3` (committed directly on this branch at the owner's request, instead of `task-01-architecture-blueprint`). Commits are prefixed `task-01:`; see `git log`. Not pushed. No pull request opened (`NOT_EXECUTED`).
Date: 2026-10-22

**Status: documents complete, awaiting owner approval. Task 02 must not start until the owner approves** (task file, "Handoff"). Every decision D-004 to D-024 is recorded as "Proposed, awaiting owner approval".

## Summary
The nine design documents, the extended decision and limitation registers, and the unresolved-questions register now exist. They define roles, household bootstrap, credential storage, job scheduling, JWT verification, telemetry storage, tariffs, money, command lifecycle, privacy, demo/live separation, tests and the repository layout in enough detail for TASK-02 onward to proceed without architectural choices. Cloudflare, Supabase and Tesla facts were re-checked against official documentation on 2026-10-22 (sources V1 to V10 in `SYSTEM_ARCHITECTURE.md` section 1); facts that could not be verified stayed `UNVERIFIED` and have a default in `UNRESOLVED_QUESTIONS.md`. No application code, migration or UI was written, and no Tesla call was made.

## Files created
| Path | Purpose |
|---|---|
| `docs/SYSTEM_ARCHITECTURE.md` | Responsibilities (web / Worker / DB), vendor facts, Mermaid diagrams for system, authentication, Tesla OAuth, telemetry ingestion and command lifecycle; locking, credentials, demo/live, polling budget |
| `docs/SECURITY_MODEL.md` | Roles (single definition), permission matrix, DB controls, bootstrap, invitations, service-access cases S1 to S9, threat model, residual risks |
| `docs/DATABASE_DESIGN.md` | Entity diagram, every table with columns/constraints/indexes, functions, retention |
| `docs/ENERGY_ACCOUNTING.md` | Single definition of units, signs, time/DST, tariff precedence, calculations, money model, worked example |
| `docs/API_CONTRACT.md` | Conventions, error envelope, endpoints by area with minimum role and owning task, budget degradation |
| `docs/PRODUCT_REQUIREMENTS.md` | Requirements FR-1 to FR-20, route inventory, non-functional requirements, entities |
| `docs/PRIVACY.md` | Data inventory, retention, export and deletion, lawful basis (owner to confirm, not legal advice) |
| `docs/UNRESOLVED_QUESTIONS.md` | Q-01 to Q-15 with defaults, affected tasks and external dependencies, listed separately |
| `docs/IMPLEMENTATION_ROADMAP.md` | Per-task carry-over notes, risk register, test strategy, release criteria |
| `docs/handoffs/TASK-01.md` | This report |

## Files modified
| Path | What changed and why |
|---|---|
| `docs/DECISIONS.md` | Appended D-004 to D-024 (append-only) |
| `docs/KNOWN_LIMITATIONS.md` | Appended L-011 to L-020 (append-only) |
| `docs/ai-build-kit/04-REPO-STRUCTURE.md` | Ratified with amendments (D-019 to D-021): `wrangler.jsonc`, single Worker serving assets + API + cron, `apps/web/public/`, `UNRESOLVED_QUESTIONS.md`, TASK-16 owns job/lock/usage functions |
| `docs/README.md` | Index links to the new design documents and registers; status note |

Written outside the task's stated paths: `docs/KNOWN_LIMITATIONS.md`, `docs/handoffs/`, `docs/README.md` (required by AGENTS.md: append to limitations, handoff, keep folder README accurate).

## Decisions
D-004 roles; D-005 household, bootstrap, invitations; D-006 credentials; D-007 locking and scheduling (Postgres job table with `FOR UPDATE SKIP LOCKED` and leases, no Durable Objects in v1); D-008 static hosting on Workers (not Pages); D-009 JWT verification (asymmetric keys, `jose`, JWKS, refuse HS256); D-010 shared types; D-011 telemetry storage; D-012 signs; D-013 tariffs; D-014 money; D-015 command lifecycle; D-016 privacy; D-017 demo/live separation; D-018 test strategy; D-019 layout ratified; D-020 `wrangler.jsonc` in `apps/worker`; D-021 one Worker; D-022 provider interval energy is the accounting source; D-023 polling budget and spend cap; D-024 Workers plan. Alternatives and rationale are in `docs/DECISIONS.md`.

Process deviation: committed on `Raj-AutoPW3`, no PR (as in TASK-00).

## Database changes
None (design only). Tables, constraints, functions and policies are specified in `docs/DATABASE_DESIGN.md` for TASK-03/04/16.

## API changes
None (design only). Contract in `docs/API_CONTRACT.md`.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `rg -c` for common UTF-8-read-as-Windows-1252 mojibake sequences over `docs` (run after fixing an encoding fault in `SYSTEM_ARCHITECTURE.md`) | yes | Exit 1, no matches | Clean |
| `rg -n '\x{FFFD}' docs` | yes | No matches | Clean |
| `git diff --stat` on append-only registers | yes | `DECISIONS.md` and `KNOWN_LIMITATIONS.md` additions only, no deletions | An earlier scripted edit had corrupted the existing L-002 dash; restored byte-for-byte meaning, diff now shows additions only |
| Consistency greps (see Manual verification) | yes | See below | Pass |
| `npm run typecheck`, `lint`, `test`, `build` | no, not applicable | `NOT_EXECUTED` | No toolchain exists until TASK-02 |
| Mermaid render check | no | `NOT_EXECUTED` | Diagrams were reviewed as text only; command to run later: `npx @mermaid-js/mermaid-cli -i docs/SYSTEM_ARCHITECTURE.md -o out.md` |
| Pull request via `.github/pull_request_template.md` | no | `NOT_EXECUTED` | Work is on a local branch; nothing pushed |

## Manual verification
Cross-checks performed by reading and ripgrep over the nine design documents:
1. **Roles defined once.** The only definition and permission matrix are `SECURITY_MODEL.md` section 2 and 2.1. Other documents refer to the three names `READ_ONLY | READ_WRITE | ADMIN`. Searched for `viewer`, `superadmin`, `platform admin`, `EDITOR`; one persona label ("Household viewer") in the PRD was reworded to avoid reading as a fourth role.
2. **Units and signs defined once.** `ENERGY_ACCOUNTING.md` section 2 is authoritative. `DATABASE_DESIGN.md` (`battery_power_w`, `> 0 discharging`) and `ENERGY_ACCOUNTING.md` state the same convention; no document states the opposite battery sign. Native Tesla signs remain `UNVERIFIED`.
3. **Credentials in one place.** `SYSTEM_ARCHITECTURE.md` section 8 is authoritative; `SECURITY_MODEL.md` summarises and refers to it; no document places Tesla tokens in the browser, logs or environment files. Service-key access is limited to cases S1 to S9.
4. **Money defined once.** `ENERGY_ACCOUNTING.md` section 7: decimal.js, `numeric(12,6)` rates, round half up once per displayed line, JSON strings. Search for `float`, `parseFloat`, `double precision`, `real` found only prose about lint rules and unrelated words.
5. **No unsupported Tesla command claimed.** `API_CONTRACT.md` and the PRD refer to commands only through the capability registry (`SUPPORTED` / `UNVERIFIED` / `NOT_SUPPORTED`). Forced charge, forced export, solar bypass and islanding stay `NOT_SUPPORTED` (D-003). No endpoint or payload is asserted that TASK-00 did not document.
6. **Responsibilities separated.** `SYSTEM_ARCHITECTURE.md` section 2 assigns web, Worker and database; roles and limits are enforced in the Worker and in RLS, never in the browser.
7. **Layout consistency.** Function names `claim_jobs`, `acquire_lock`, `release_lock` appear with the same names in `DATABASE_DESIGN.md` and `SYSTEM_ARCHITECTURE.md`; `04-REPO-STRUCTURE.md` reflects D-019 to D-021.
8. **Diagrams present.** `SYSTEM_ARCHITECTURE.md` contains five Mermaid diagrams (system, authentication, Tesla OAuth, ingestion, command lifecycle) and `DATABASE_DESIGN.md` contains the entity diagram. Syntax not rendered (see Checks).
9. **Task 00 conflicts.** None found; the proposed spend cap, mock-only adapter and `UNVERIFIED` markers follow TASK-00.

Limit of this verification: consistency was checked by search and reading, not by a tool that validates cross-references. A second reader should skim the permission matrix against `API_CONTRACT.md` minimum roles.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| No contradictory definitions of roles, units or signs across documents | VERIFIED (by search and reading) | Cross-checks 1 and 2 |
| No ambiguity about where credentials are stored and who can read them | VERIFIED (by reading) | Cross-check 3; `SYSTEM_ARCHITECTURE.md` section 8; `SECURITY_MODEL.md` S1 |
| No claim that any Tesla command is supported unless Task 00 documented it | VERIFIED (by search) | Cross-check 5 |
| Frontend, Worker and database responsibilities explicitly separated | VERIFIED (by reading) | `SYSTEM_ARCHITECTURE.md` section 2 |
| Unresolved questions and external dependencies listed separately | VERIFIED | `docs/UNRESOLVED_QUESTIONS.md` Q-01 to Q-15 |
| Mermaid diagrams for all five required flows | NOT_EXECUTED for rendering; present as text | Section 3 to 6 and 12 of `SYSTEM_ARCHITECTURE.md` |
| Owner approval of architecture, security model, API contract and decisions | NOT_EXECUTED | Required before TASK-02 |

## Verification status register
- `UNVERIFIED`: Tesla EU base URL (Q-02), native Tesla signs, payload schemas, energy-command signing (Q-14), energy streaming, history resolutions, billing category for each endpoint, Supabase JWT `aud` value (Q-13), Workers paid plan price (Q-05), MFA availability (Q-15), dot-directory serving of `.well-known` as a Worker static asset (Q-03).
- `MOCK_ONLY`: the entire Tesla adapter until the owner runs verified read-only calls (Q-06).
- `AWAITING_PROVIDER_APPROVAL`: Fleet API application for an individual (Q-01).
- `NOT_SUPPORTED`: forced charge, forced export, solar bypass, islanding (D-003).

## Outstanding issues
- Owner must approve or amend D-004 to D-024 and answer or accept defaults for Q-01 to Q-15 (see `docs/UNRESOLVED_QUESTIONS.md`). Those that gate later work: Q-01 and Q-04 (Tesla access and cost), Q-02/Q-06 (live verification), Q-03 (domain), Q-05 (Workers plan), Q-13 (Supabase signing keys).
- Legal and privacy items (Q-10) need the owner and, if appropriate, a lawyer; `PRIVACY.md` is not legal advice.
- The "subscription-free" goal depends on Tesla's pay-per-use pricing (TASK-00 risk); the design caps estimated spend at USD 9.00 per month by default.
- No Mermaid rendering and no PR were done (`NOT_EXECUTED`).

## Environment variables
Names only; none were created or set in this task. Planned names are listed in `SYSTEM_ARCHITECTURE.md` (for example `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_PREVIOUS`, `TESLA_FLEET_API_BASE_URL`, `TESLA_MONTHLY_SPEND_CAP_USD`, `PROVIDER_MODE`); TASK-02 writes them into `.env.example` as placeholders and records where each is set (local, Cloudflare secret, Supabase, CI).

## Instructions for the next task
TASK-02 must read, in order: `docs/SYSTEM_ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/API_CONTRACT.md`, `docs/DECISIONS.md` (D-004 to D-024), `docs/ai-build-kit/04-REPO-STRUCTURE.md` (amended) and `docs/IMPLEMENTATION_ROADMAP.md` (row 02). It must reuse: workspace names `@autopw3/{shared,domain,web,worker}`, `apps/worker/wrangler.jsonc` with `assets`, `run_worker_first: ["/api/*"]` and cron every minute, `apps/web/public/_headers`, and the lint rules listed in the roadmap (import direction, no `Date.now()` in domain, no float money). It must not change roles, units and signs, credential storage, or the decisions without a new entry in `docs/DECISIONS.md`.

## Next task
TASK-02 (repository skeleton, CI, lint rules). Prerequisite: **owner approval of this handoff and the decisions above**.
