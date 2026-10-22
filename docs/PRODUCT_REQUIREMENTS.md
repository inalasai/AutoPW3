# Product Requirements (TASK-01)

Status: **PROPOSED, awaiting owner approval.** Written 2026-10-22. Constrained by `docs/research/GO_NO_GO.md` (TASK-00): conditional go, Tesla integration mock-only until verified, "subscription-free" **at risk** because Tesla Fleet API is pay-per-use with a USD 10 monthly discount per account and a mandatory payment method.

## 1. Vision

AutoPW3 is a self-hosted-style residential energy-management web app for Tesla Powerwall sites: a live energy-flow view, tariff-aware analytics, supported device controls and safe automation. It does not charge a subscription. It cannot promise "free": Tesla bills API usage, so the product keeps usage under a budget and says so (see §6).

Primary user: an owner in Ireland (Irish day/night and time-of-use tariffs, EU data protection) but nothing is hard-coded to Ireland: currency, timezone, tax and levies are data.

## 2. Users and roles

| Persona | Role | Needs |
|---|---|---|
| Owner / household admin | `ADMIN` | Connect Tesla, set budget, invite people, manage roles, turn on controls and automation, view audit, export/delete data |
| Household member who manages settings | `READ_WRITE` | Maintain tariffs, rules in dry-run, issue supported commands, pause automation |
| Household member (read-only) | `READ_ONLY` | See live flow, analytics, costs |
| Platform operator | (owner, via dashboards) | Supabase and Cloudflare administration; no in-app super-admin in v1 |

Roles are per household membership; definition and permission matrix: `docs/SECURITY_MODEL.md` §2.

## 3. Goals and non-goals

Goals (v1): live flow view with honest freshness; tariff manager covering Irish-style tariffs; analytics of energy and cost with stated resolution and coverage; Tesla connection via OAuth; supported settings controls with confirmed outcomes; dry-run-first automation; household roles and invitations; audit; privacy export/delete; demo mode with clear labelling.

Non-goals (v1, recorded in `KNOWN_LIMITATIONS.md`): native mobile apps/PWA install; multi-region and multi-household UX (data model supports it); non-Tesla inverters (provider interface leaves room); subscriptions/billing of AutoPW3 users; platform super-admin UI; forced charge, forced export, solar bypass, islanding (`NOT_SUPPORTED`, TASK-00); vehicle features; Fleet Telemetry streaming for energy sites (`UNVERIFIED`).

## 4. Functional requirements

IDs are referenced by the roadmap and tests.

**Accounts and households**
- FR-1 Register and sign in with email and password; email confirmation. A new user has no household and sees an empty state explaining invitations.
- FR-2 First household and first ADMIN created only by the one-time server-side bootstrap (`SECURITY_MODEL.md` §4).
- FR-3 ADMIN invites people (default `READ_ONLY`); invitees accept while signed in; tokens are hashed, single-use, expiring.
- FR-4 ADMIN changes other members' roles and removes members; nobody changes their own role; the last ADMIN is protected.
- FR-5 Members can leave a household; users can export their data and delete their account.

**Live view**
- FR-6 Animated energy-flow (Canvas) with solar, battery, grid, home, plus battery percentage widget; arrows reflect the sign convention (`ENERGY_ACCOUNTING.md` §2).
- FR-7 Shows data age, `source`, quality and staleness; clear `DEMO` banner in demo mode; works without effects (reduced motion, accessible contrast, keyboard navigation).
- FR-8 Respects the polling budget; when budget is exhausted it shows the last snapshot labelled stale.

**Tariffs**
- FR-9 Tariff manager for IMPORT and EXPORT tariffs: flat, time-of-use, weekday/weekend, seasonal, date overrides, dynamic half-hourly prices, standing charge, VAT/tax mode, levies, export payment model, effective-dated versions, precedence rules (`ENERGY_ACCOUNTING.md` §5).
- FR-10 Validation before saving (no overlap, full coverage, currency, timezone); missing coverage is an error shown to the user, never zero.
- FR-11 Irish values appear only as labelled examples/templates.

**Analytics**
- FR-12 Energy (solar, import, export, battery in/out, home use) and cost charts for day/week/month/year with the real resolution and completeness displayed; DST days display 23/25 hours correctly.
- FR-13 Metrics: net cost, import cost, export credit, standing charge, self-consumption, self-sufficiency, estimated savings (labelled estimate).

**Tesla connection and ingestion**
- FR-14 ADMIN connects Tesla via OAuth, chooses a site; tokens are encrypted and never reach the browser; reconnect flow when `NEEDS_REAUTH`.
- FR-15 System ingests live snapshots and historical energy within the budget; retention and rollups per `DATABASE_DESIGN.md` §4.

**Controls and automation**
- FR-16 Controls page lists capabilities from the registry with status (`SUPPORTED`, `UNVERIFIED`, `NOT_SUPPORTED`, `DISABLED_BY_SETTING`); unsupported controls are disabled with a reason.
- FR-17 Supported commands follow the lifecycle with `PENDING`/`CONFIRMED`/`FAILED`/`UNKNOWN` and read-back confirmation; high-impact actions need confirmation dialogs.
- FR-18 Automation rules default `DISABLED` or `DRY_RUN`; dry-run records what would have happened and never calls control endpoints; only ADMIN sets `ACTIVE`; global pause (READ_WRITE+ pauses, ADMIN resumes); no action on stale or missing data.

**Administration**
- FR-19 Audit log for privileged actions (ADMIN view); budget and retention settings (ADMIN).
- FR-20 Demo data is generated, labelled, never stored, never mixed with live data.

## 5. Feature inventory: routes

| Route | Purpose | Minimum role to view | Notes | Task |
|---|---|---|---|---|
| `/login` | Sign in | public | Redirect to `/live` when signed in | 07 |
| `/register` | Create account | public | Zero-privilege account; link to invitation acceptance | 07 |
| `/invite/:token` (addition) | Accept an invitation after sign-in | any signed-in user | Calls `POST /invitations/accept` | 07/19 |
| `/live` | Animated energy flow | member | DEMO or LIVE, honest freshness | 09 |
| `/analytics` | Energy and cost charts | member | Resolution and completeness shown | 13 |
| `/tariffs` | Tariff manager | member view, RW edit | Versioned; validation panel | 12 |
| `/controls` (addition) | Capability matrix and commands | member view, RW act | Pause button visible to RW+ | 17 |
| `/automation` | Rules, executions, dry-run results | member view, RW edit, ADMIN activate | Defaults off | 18 |
| `/settings` (addition) | Tesla connection, budget, retention, profile, data export/delete | member (profile), ADMIN (connection, budget) | | 15/19 |
| `/admin` | Members, invitations, roles, audit log | ADMIN | Household-scoped | 19 |
| `*` | Not found | public | | 06 |

Navigation hides routes the role cannot use; the Worker and database remain authoritative.

## 6. Cost, "subscription-free" and honesty requirements

- NFR-1 Estimated Tesla spend is capped at a configurable monthly value (default USD 9.00, `DECISIONS.md` D-023). The UI shows month-to-date usage against the cap.
- NFR-2 Product wording must not claim "free"; it states "no subscription; Tesla may charge for API usage; a USD 10 monthly discount per account currently applies" with a link to Tesla's pricing (accessed 2026-10-22; subject to change).
- NFR-3 Requests that return an error are still billable (below 500), so no retry loops.

## 7. Non-functional requirements

- NFR-4 Security: `SECURITY_MODEL.md`; RLS on every table; no secrets in repo/logs/fixtures.
- NFR-5 Accessibility: WCAG 2.1 AA contrast target, keyboard navigation, `prefers-reduced-motion`, readable with effects off; responsive at phone and desktop widths.
- NFR-6 Performance (targets to verify, not measured yet): initial page under 3 s on a mid-range phone on 4G (static assets, code splitting); API p95 under 300 ms excluding Tesla calls; ingestion units sized for Workers limits (Free: 10 ms CPU, 50 subrequests, `SYSTEM_ARCHITECTURE.md` §7).
- NFR-7 Reliability: idempotent jobs, lease-based locks, failure isolation per site, honest stale/unknown states.
- NFR-8 Time/money correctness: UTC storage, IANA zones, DST-tested; decimal arithmetic, string serialisation.
- NFR-9 Privacy: `PRIVACY.md` (data inventory, retention, export, deletion, no telemetry in logs).
- NFR-10 Observability: structured redacting logs with request ids; no payload dumps; Workers Logs retention per Cloudflare (`UNVERIFIED` specifics).
- NFR-11 Test strategy and release criteria: `docs/TESTING.md` plus `IMPLEMENTATION_ROADMAP.md` §3.

## 8. Entities (summary; full list, columns and ER diagram in `DATABASE_DESIGN.md` §1–2)

User profile → household membership (role) → household → energy site → telemetry (power snapshots, energy intervals, rollups, cost cache) / tariffs (versions, seasons, slots, overrides, levies, price points) / commands (+events) / automation rules (+executions); household settings; invitations; provider credentials (ciphertext); usage counters; jobs and locks; audit log. A site belongs to exactly one household; a household has many sites (v1 one); a user may belong to many households (v1 one).

## 9. Acceptance of this document

Approved by the owner before TASK-02 starts. Open questions in `UNRESOLVED_QUESTIONS.md`.
