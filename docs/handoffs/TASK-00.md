# AutoPW3 — Task Handoff Report

## Task completed
Number and name: TASK-00 — Tesla Fleet API Feasibility Spike (research only)
Branch / commit: `Raj-AutoPW3` (committed directly on this branch at the owner's request, instead of `task-00-tesla-feasibility-spike`; see Decisions). Commit hash: see `git log` after the `task-00:` commit.
Date: 2026-10-22

**Completeness:** All deliverables exist. All acceptance criteria are met as *documentation* criteria. Several research questions could only be answered as `UNVERIFIED` because the official pages reached did not state the answer. This is allowed by the task's stop conditions, but it means Task 01 inherits open items (listed below). No live Tesla call was made.

## Summary
Twelve research questions were answered from the official Tesla developer documentation (16 sources, all accessed 2026-10-22). The result is a conditional go: the OAuth flow, scopes, energy endpoints and registration process are documented; payload schemas, native signs, EU base URL, energy-command signing, history resolutions and energy streaming are not, and stay `UNVERIFIED`/mock-only. The "subscription-free" goal is at risk, because Fleet API is pay-per-use with a $10 monthly discount and a mandatory payment method.

## Files created
| Path | Purpose |
|---|---|
| `docs/research/TESLA_FEASIBILITY.md` | Findings for all 12 questions with sources, confidence and owner questions |
| `docs/research/TESLA_CAPABILITY_MATRIX_DRAFT.md` | Capability matrix with status per row |
| `docs/research/TESLA_SETUP_STEPS.md` | Ordered manual setup steps for the owner |
| `docs/research/SIGN_CONVENTION_FINDING.md` | Sign and unit finding; native signs `UNVERIFIED`; normalisation plan |
| `docs/research/GO_NO_GO.md` | Go/no-go summary |
| `docs/handoffs/TASK-00.md` | This report |

## Files modified
| Path | What changed and why |
|---|---|
| `docs/research/README.md` | Added `Status:` line and file index (AGENTS.md: keep folder READMEs accurate) |
| `docs/DECISIONS.md` | Appended D-002 and D-003 (append-only) |
| `docs/KNOWN_LIMITATIONS.md` | Appended L-003 to L-010 (append-only) |

Written outside `docs/research/`: `docs/handoffs/`, `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md`. These are required by AGENTS.md and the task's handoff step, not a deviation from the task's scope.

## Decisions
- D-002: conditional go; third-party OAuth; server-side only; base URL discovered per user; adapter mock-only until verified; budgeted polling.
- D-003: forced charge / forced export / solar bypass / islanding are `NOT_SUPPORTED`.
- Process deviation: work was committed on `Raj-AutoPW3` rather than `task-00-tesla-feasibility-spike`, as the owner instructed ("work off this local branch"). The task file and AGENTS.md specify the task branch and a pull request; the PR was **not** opened (NOT_EXECUTED).

## Database changes
None.

## API changes
None. (No application code.)

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| Fetch 16 official Tesla doc/metadata URLs listed in `TESLA_FEASIBILITY.md` | yes | All 16 cited sources returned content; guessed URLs that returned 404 were not used | 404: `getting-started/base-urls`, `regions-and-countries`, `regions`, `api-overview`, `overview`, `error-codes`, `discovery`, `api-endpoints`, `support/announcements`, `support/terms`, `support/terms-and-privacy`; sitemap and `llms.txt` returned no content |
| Every matrix row has a source or is `UNVERIFIED` | yes (manual review) | pass | Rows with none are `UNVERIFIED` or `NOT_SUPPORTED` |
| `npm run typecheck/lint/test/build` | not applicable | NOT_EXECUTED | No code and no toolchain yet (Task 02) |
| Secrets scan | NOT_EXECUTED | n/a | No secrets were written; no scanner exists yet (Task 02) |
| Pull request via `.github/pull_request_template.md` | NOT_EXECUTED | n/a | Work stayed on `Raj-AutoPW3`; owner to decide |

## Manual verification
Re-read each deliverable against the fetched pages. Statements that the pages did not support were rewritten as `UNVERIFIED`. The pricing table is arithmetic on the published rates and rests on one stated, unverified assumption (billing category of `live_status`).

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| No capability is marked supported without documentation | VERIFIED (documentation review) | Matrix: `DOCUMENTED` rows cite S2/S6/S7/S8; others `UNVERIFIED`/`NOT_SUPPORTED` |
| Costs, approvals and region requirements are stated | VERIFIED (documentation review), with gaps flagged | Feasibility Q1, Q2, Q9; EU base URL and approval criteria `UNVERIFIED` |
| The sign convention finding is explicit | VERIFIED (documentation review) | `SIGN_CONVENTION_FINDING.md` states native signs are `UNVERIFIED` and how to settle them |
| Open questions for the owner are listed separately | VERIFIED (documentation review) | Feasibility "Open questions" O1 to O7 |
| Every matrix row has a source link or is `UNVERIFIED`; no endpoint without citation | VERIFIED (documentation review) | See matrix |
| No code | VERIFIED | Only Markdown files changed |

"VERIFIED" here means checked by reading, not by executing against Tesla.

## Verification status register
- `UNVERIFIED`: native `live_status` signs and field names; update cadence; EU base URL; payloads for backup/operation/grid_import_export/storm_mode/off-grid reserve; TOU scope; whether energy commands need signing; energy streaming; history `period` values, time-zone format, resolution, retention; billing category per endpoint; programmatic revocation; PKCE requirement; access-token lifetime; Fleet API agreement text; personal-app approval criteria.
- `AWAITING_PROVIDER_APPROVAL`: developer application approval; payment method and billing limit.
- `UNSUPPORTED_BY_DEVICE`/`NOT_SUPPORTED`: forced charging, forced export, solar bypass, islanding.
- `MOCK_ONLY` (required for later tasks): all Tesla controls and sign normalisation.

## Outstanding issues
- Owner questions O1 to O7 in `TESLA_FEASIBILITY.md`. Most important: O1 (can an individual get approved), O2 (EU base URL), O5 (payment method), O6 (redacted read-only `live_status`/`site_info` sample).
- First-time EU registration may need the base URL before `users/region` is usable; unresolved.
- Linked pages not fetched: example TOU tariff JSON, Fleet Telemetry "Available Data", pricing estimator.
- Documentation inconsistency: Fleet Telemetry config limit stated as 5 (overview) vs 3 (config get endpoint). Vehicle-only, recorded for completeness.
- Tesla docs can change; findings are dated 2026-10-22.

## Environment variables
None added. (Task 02 will define names in `.env.example`; Client ID/Secret and encryption key belong in Cloudflare secrets and local git-ignored `.env`.)

## Instructions for the next task
- Task 01 must treat `docs/research/*` as inputs and not contradict them. Key constraints: third-party OAuth with `offline_access`; token calls to `fleet-auth.prd.vn.cloud.tesla.com`; server-side tokens; base URL discovered per user; refresh tokens are single-use and rotate (per-site refresh lock, persist before use); budgeted, demand-driven polling; billing counts all responses below 500.
- Record the polling budget and the "subscription-free" wording in `docs/DECISIONS.md`.
- Keep all `UNVERIFIED` capabilities behind the mock provider; surface them as such in the capability registry.
- Do not change the research files except by dated corrections.

## Next task
TASK-01 Architecture blueprint. Prerequisite: owner reviews this handoff and answers at least O1 and O5, or accepts proceeding with mock-only live integration.
