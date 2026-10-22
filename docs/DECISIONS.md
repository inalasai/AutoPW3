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

# TASK-01 decisions (2026-10-22)

All entries below are **Proposed, awaiting owner approval** (the owner reviews before TASK-02). Vendor facts V1 to V10 are listed in `docs/SYSTEM_ARCHITECTURE.md` section 1. Open items: `docs/UNRESOLVED_QUESTIONS.md`.

## D-004 Role model (TASK-01 decision 1)
- **Status:** Proposed
- **Decision:** Roles `READ_ONLY | READ_WRITE | ADMIN` live on `household_members`, per household. ADMIN is household-scoped. The member directory shows only members of the caller's households and only to ADMINs. No platform super-admin in the app; platform operations use the Supabase and Cloudflare dashboards. Nobody changes their own role; the last ADMIN is protected in the database; READ_WRITE or ADMIN can pause automation, only ADMIN can resume; only ADMIN can set a rule ACTIVE. Cross-household requests return 404, insufficient role 403.
- **Alternatives:** role on the user (rejected: contradicts households and leaks across them); global admin role in-app (rejected: cross-household exposure, out of v1 scope).
- **Rationale:** Matches rule 1 and kit review item 6. Full matrix in `docs/SECURITY_MODEL.md` section 2.

## D-005 Household model, bootstrap and invitations (decision 2)
- **Status:** Proposed
- **Decision:** v1 supports one household; the schema supports many. The first household and first ADMIN are created only by `private.bootstrap_first_admin`, callable by a trusted server role, only when no ADMIN exists, once (a one-row `system_bootstrap` table), audited. Others join by ADMIN invitation: random 256-bit token, stored as SHA-256 hash, single use, default 7 days expiry, default role READ_ONLY, higher role only if the inviter is ADMIN, accepted by a signed-in user whose email matches when an email was specified. Public sign-up creates a zero-privilege user with email confirmation.
- **Alternatives:** first registered user becomes admin (rejected: race and takeover risk); open join codes (rejected: no accountability); email-sending invitations (deferred: the ADMIN copies the invite link in v1, no SMTP dependency).
- **Rationale:** rules 1 and 2; kit review item 7. Open: sign-up policy Q-12.

## D-006 Where credentials live (decision 3)
- **Status:** Proposed
- **Decision:** Tesla access/refresh tokens are stored as AES-256-GCM ciphertext in `tesla_credentials` (random 96-bit nonce, key id, AAD = household id, provider, credential id, key id) using Web Crypto (V6). The key is `TOKEN_ENCRYPTION_KEY` in Cloudflare Worker secrets (V7); during rotation `TOKEN_ENCRYPTION_KEY_PREVIOUS` is also set, rows are re-encrypted by a job, then the old key is removed. The Supabase secret key, Tesla client secret and encryption keys exist only as Worker secrets, never in `vars`, the repo, `VITE_*` variables, logs or the browser. `tesla_credentials` has no grants for `anon` or `authenticated`. Scope `energy_cmds` is requested only when an ADMIN enables controls; read-only operation requests `energy_device_data` only.
- **Alternatives:** Supabase Vault or `pgcrypto` with a database-held key (rejected: key and ciphertext in the same trust domain); Cloudflare Secrets Store beta (deferred: beta); Durable Object storage (rejected: second store).
- **Rationale:** Two independent stores must both be compromised. Rotation is documented. Source: V6, V7, V10.

## D-007 Locking and scheduling on Workers (decision 4)
- **Status:** Proposed
- **Decision:** Postgres `scheduled_jobs` and `job_locks` with atomic claim (`FOR UPDATE SKIP LOCKED`), leases and dedupe keys; Cron Trigger every minute dispatches bounded batches (default 3 jobs). No Durable Objects in v1. All jobs idempotent; cron jitter, skipped and duplicate ticks assumed (V4 gives no exact-time guarantee).
- **Alternatives:** Durable Objects with alarms (V5) (deferred: second state store and extra operational surface for a small single-household app; revisit if lease contention or subrequest cost proves a problem); in-memory locks (invalid on Workers).
- **Rationale:** One source of truth beside the data; testable in pgTAP and with a fake clock; compatible with Free-plan limits if units stay small (V3).

## D-008 Static hosting product (decision 5)
- **Status:** Proposed
- **Decision:** Cloudflare Workers with static assets (V1), not Pages. `not_found_handling = single-page-application`, `run_worker_first = ["/api/*"]`, `_headers` for CSP.
- **Alternatives:** Cloudflare Pages (rejected: Cron Triggers unsupported and Durable Objects limited per V2 matrix); separate hosting for the SPA (rejected: second origin, CORS).
- **Rationale:** Single deployment unit with cron. Note: V1/V2 do not literally say "recommended"; the choice rests on the feature matrix. Workers custom domains need Cloudflare-managed nameservers (V2), see Q-03.

## D-009 JWT verification (decision 6)
- **Status:** Proposed
- **Decision:** Supabase asymmetric JWT signing keys; the Worker verifies locally with `jose` against `https://<project>.supabase.co/auth/v1/.well-known/jwks.json` (V8, V9), caching the JWKS no longer than 10 minutes, with an algorithm allowlist, required `exp`, `iss` equal to the configured issuer, `sub`, `role = authenticated`. `aud` is checked once the real claim is confirmed in TASK-14. HS256 is refused (health check fails). Role and household come from the database per request, never from claims.
- **Alternatives:** `supabase.auth.getClaims()` (acceptable library route for Supabase-issued tokens; not chosen to keep verification explicit and testable); HS256 shared secret (rejected: V8 strongly discourages it); calling `/auth/v1/user` per request (rejected: slow from the edge).
- **Rationale:** Local, fast, revocable via the key discovery endpoint.

## D-010 Shared types source of truth (decision 7)
- **Status:** Proposed
- **Decision:** `packages/shared` holds Zod schemas and inferred TypeScript types, constants and enums, with no logic and no I/O; `apps/web` and `apps/worker` import `@autopw3/shared` as a workspace package consumed as TypeScript source (bundled by Vite and Wrangler). Database types are generated into `packages/shared/src/db/database.types.ts` by an npm script (`db:types`) whose exact CLI command is verified in TASK-05 and never hand-edited. DB row types are mapped to domain types at the Worker boundary. Zod must be 4.5.0 or later (Workers memory note, V3).
- **Alternatives:** types per app (rejected: drift); prebuilt package with a build step (deferred: extra tooling for no gain).
- **Rationale:** Rule 11, one definition of every type.

## D-011 Telemetry storage and lifecycle (decision 8)
- **Status:** Proposed
- **Decision:** Raw power snapshots in `powerwall_metrics_log` (`source = 'TESLA'`, unique `(site_id, sampled_at)`), provider energy in `energy_intervals`, hourly and daily rollups rebuilt from source (never incremented), `cost_rollups_daily` as a recomputable cache. Retention defaults: raw 90 days, intervals and hourly 800 days, daily and cost until deletion. No partitioning in v1 (volumes are small: tens of thousands to about 100,000 rows per site per year); revisit above about 10 million rows. Indexes are the unique `(site_id, time)` keys.
- **Alternatives:** table partitioning (deferred); TimescaleDB (rejected: extra dependency); keep all raw data (rejected: privacy and size).
- **Rationale:** Kit review item 12; privacy minimisation. Defaults need owner confirmation (Q-07).

## D-012 Sign and unit convention (decision 9)
- **Status:** Proposed (ratifies rule 6)
- **Decision:** Power W; energy Wh; percent 0 to 100; solar >= 0; battery > 0 discharging and < 0 charging; grid > 0 importing and < 0 exporting; load >= 0; balance `load ~ solar + battery + grid` with a proposed tolerance of max(100 W, 5 percent of load). Normalisation only inside `apps/worker/src/providers/tesla`. Provider native signs are `UNVERIFIED` (TASK-00 `SIGN_CONVENTION_FINDING.md`), so live data is not persisted as quality `OK` until the mapping is verified from a redacted real response.
- **Alternatives:** adopt an assumed native convention (rejected: rule 3).
- **Rationale:** Consistent with TASK-00; see `docs/ENERGY_ACCOUNTING.md` section 2.

## D-013 Tariff model (decision 10)
- **Status:** Proposed
- **Decision:** Directional (IMPORT/EXPORT), versioned, effective-dated tariffs with local-date half-open ranges and an exclusion constraint against overlap. Price modes FLAT, TIME_OF_USE, DYNAMIC. Seasons, day types (ALL, WEEKDAY, WEEKEND), local-minute slots, date overrides with priority, dynamic price points, standing charge, levies (per kWh or per day, taxable flag), tax mode (INCLUSIVE, EXCLUSIVE, NONE) with VAT rate, export payment model (PER_KWH or NONE). Precedence: effective version, then override, then dynamic price point, then seasonal day-type slot (WEEKDAY or WEEKEND over ALL), then flat. Missing coverage is an error, never zero.
- **Alternatives:** single JSON blob per tariff (rejected: weak constraints); UTC-offset slots (rejected: DST).
- **Rationale:** Rules 7 and 8; kit review item 8. Details in `docs/ENERGY_ACCOUNTING.md` section 5 and `docs/DATABASE_DESIGN.md` section 2.4.

## D-014 Money model (decision 11)
- **Status:** Proposed
- **Decision:** `decimal.js` (version pinned in TASK-02); database `numeric` (rates scale 6, cache amounts scale 8); currency beside every amount; full precision during calculation; round half up to the currency minor unit once per displayed component line; displayed net equals the sum of rounded lines; aggregates sum unrounded values then round once; JSON money and rates are strings; no JavaScript number arithmetic on money.
- **Alternatives:** big.js (viable, fewer rounding modes); integer minor units (rejected: sub-cent rates); banker's rounding (rejected: bills conventionally round half up; owner may override).
- **Rationale:** Rule 8. Stated in `docs/ENERGY_ACCOUNTING.md` section 7.

## D-015 Command lifecycle (decision 12)
- **Status:** Proposed
- **Decision:** States PENDING, CONFIRMED, FAILED, UNKNOWN with phases RECORDED, DISPATCHING, DISPATCHED, RECONCILING, DONE. Intent row inserted user-scoped before any dispatch; unique `(site_id, idempotency_key)` with `params_hash` (same key and body replays, different body 409); only capabilities that TASK-00 marked DOCUMENTED and whose payload is verified may be dispatched; 4xx is final FAILED and never retried; timeouts become UNKNOWN and are reconciled by reading back configuration; CONFIRMED only after read-back match; every transition appends an event and an audit entry; automation uses the same path.
- **Alternatives:** trust HTTP 200 (rejected: rule 4); fire-and-forget (rejected).
- **Rationale:** Rules 4 and 10. Diagram in `docs/SYSTEM_ARCHITECTURE.md` section 12.

## D-016 Privacy (decision 13)
- **Status:** Proposed
- **Decision:** `docs/PRIVACY.md`: data inventory, retention, export and deletion endpoints, no telemetry or tokens in logs, no IPs stored by the app, no analytics. Lawful basis, processor agreements and transfers are for the owner to confirm (Q-10); the app is treated as owner-only until then.
- **Alternatives:** none considered for a legal determination.
- **Rationale:** EU owner; kit review item 13. Not legal advice.

## D-017 Demo/live separation (decision 14)
- **Status:** Proposed
- **Decision:** DEMO data is generated on demand, labelled `source: "DEMO"`, never persisted and never accepted by accounting (type-level and runtime guard). Live tables have `CHECK (source = 'TESLA')`; `energy_sites.provider` is `TESLA` only. The mock adapter is for tests and local development against a disposable database, and the Worker refuses `PROVIDER_MODE=mock` when `ENVIRONMENT=production`. UI shows a persistent DEMO banner.
- **Alternatives:** store demo rows with a flag (rejected: contamination risk).
- **Rationale:** Rule 5.

## D-018 Test strategy and release criteria (decision 15)
- **Status:** Proposed
- **Decision:** Vitest, React Testing Library, Workers-compatible API tests, pgTAP, Playwright with a smoke test from TASK-07, manual owner-run live Tesla checks only. Release criteria listed in `docs/IMPLEMENTATION_ROADMAP.md` section 3; security tests are merge blockers.
- **Alternatives:** none.
- **Rationale:** `docs/TESTING.md` and kit rules.

## D-019 Repository layout ratification (decision 16; supersedes the proposed status of D-001)
- **Status:** Proposed (ratifies D-001 with amendments D-020 and D-021)
- **Decision:** Ratify the layout, workspace package names (`@autopw3/shared`, `@autopw3/domain`, `@autopw3/web`, `@autopw3/worker`), the import-direction table and the task-to-path map in `docs/ai-build-kit/04-REPO-STRUCTURE.md`, with the amendments recorded in D-020 and D-021 and the additions: `docs/UNRESOLVED_QUESTIONS.md`, `_headers` and `.well-known` under the web public assets, and job/lock/usage database functions added in TASK-16.
- **Alternatives:** single package; separate repos (see D-001).
- **Rationale:** Keeps later tasks aligned. `04-REPO-STRUCTURE.md` is updated in this task.

## D-020 Workspace separation and Wrangler config location
- **Status:** Proposed
- **Decision:** `apps/web` and `apps/worker` stay separate workspaces. The Wrangler configuration is `apps/worker/wrangler.jsonc` (JSONC is one of the supported formats, V2); its `assets.directory` points to the web build output. The newer `cloudflare.config.ts` format shown in the cron documentation is not adopted (maturity unverified).
- **Alternatives:** one combined app package (rejected: weaker import-direction enforcement).
- **Rationale:** Clear boundaries with a single deployment (D-021).

## D-021 Single deployed Worker serves SPA and API
- **Status:** Proposed
- **Decision:** One Worker deployment serves static assets and `/api/v1/*` on the same origin, plus the `scheduled` handler. CORS allowlist only for local development and preview origins.
- **Alternatives:** separate API Worker and static site (rejected: CORS, cross-origin tokens, two deployments).
- **Rationale:** Simpler security and deployment; V1.

## D-022 Accounting source of truth
- **Status:** Proposed
- **Decision:** Cost and energy accounting use provider-reported watt-hour `energy_intervals` at their real resolution. Integrating sparse power snapshots is a labelled lower-confidence fallback (`DERIVED`) limited to gaps of at most `maxGapSeconds`; larger gaps stay uncovered. An interval spanning more than one tariff rate is reported unpriceable by default; pro-rata estimate is opt-in and labelled ESTIMATE (Q-08).
- **Alternatives:** integrate snapshots as the default (rejected: Tesla polling is cost-limited, so snapshots are sparse); silently pro-rate (rejected: rule 9).
- **Rationale:** Rules 8 and 9 and the TASK-00 cost finding.

## D-023 Tesla polling budget and spend cap
- **Status:** Proposed
- **Decision:** Every Tesla call first passes an atomic budget check. Defaults: monthly estimated spend cap USD 9.00 (below the USD 10 monthly discount); background live snapshot every 30 minutes; on-demand live refresh at most every 30 seconds per site with a 2,000 per month allowance; daily resumable history sync; token maintenance at least every 7 days; warning at 80 percent, hard stop at 100 percent; on exhaustion the UI shows the last snapshot labelled stale. 4xx responses are billable and never retried in a loop. Expected load about 3,530 Data requests per month (about USD 7.06 at USD 0.002 each); the billing category of energy endpoints is `UNVERIFIED`.
- **Alternatives:** continuous short-interval polling (rejected: about USD 76 per month at 60 seconds under the same assumption); streaming (not documented for energy, TASK-00 Q11).
- **Rationale:** TASK-00 `GO_NO_GO.md` requires a recorded polling budget. Wording: "no subscription, Tesla may charge".

## D-024 Workers plan assumption
- **Status:** Proposed
- **Decision:** Design every job and request handler to fit the Workers Free limits (10 ms CPU, 50 subrequests per invocation, V3). Measure in TASK-14 and TASK-16. If the Free plan proves insufficient, stop and ask the owner before adopting the paid plan, because its price was not verified here and it affects the subscription-free goal (Q-05).
- **Alternatives:** assume the paid plan (rejected: undeclared cost).
- **Rationale:** Honest cost and limits.
