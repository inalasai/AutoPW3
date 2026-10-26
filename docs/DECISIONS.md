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

## Owner approval of TASK-01 (2026-10-23)
- **Status:** Approved
- **Decision:** The owner approved the TASK-01 blueprint on 2026-10-23 with the single word "approve": decisions D-004 to D-024 move from Proposed to Approved, and the defaults listed in `docs/UNRESOLVED_QUESTIONS.md` are accepted as working defaults. Questions that need external facts or owner action (Q-01 Tesla application, Q-02 EU base URL, Q-04 payment method and billing limit, Q-06 read-only live verification, Q-13 Supabase signing keys) stay open and are not answered by this approval.
- **Rationale:** The TASK-01 handoff requires owner approval before TASK-02 begins. The original Proposed status lines above are left unchanged (append-only register).

## D-025 TypeScript pinned to 6.0.3, not 7.0.2 (TASK-02)
- **Status:** Approved (stop-condition correction, TASK-02)
- **Decision:** Root `typescript` is pinned to 6.0.3. The newest release on npm (7.0.2) cannot be installed together with `typescript-eslint` 8.72.0, whose peer range is `typescript >=4.8.4 <6.1.0` (`npm install` failed with `ERESOLVE`).
- **Alternatives:** TypeScript 7 with `--force` or `--legacy-peer-deps` (rejected: unsupported, ESLint typing rules may break silently); dropping `typescript-eslint` (rejected: loses the lint rules this project depends on).
- **Rationale:** Task 02 stop condition: correct the version, record it, do not change architecture. Revisit when `typescript-eslint` supports TypeScript 7.

## D-026 Worker tests run in Node with Vitest, not a workerd pool (TASK-02)
- **Status:** Approved
- **Decision:** `apps/worker` tests call `handleRequest(request, env)` directly in Node with a fake `ASSETS` binding. `@cloudflare/vitest-pool-workers` is not installed in TASK-02. Local runtime behaviour is checked separately with `wrangler dev`.
- **Alternatives:** workerd pool now (rejected for the skeleton: extra dependency and moving parts before any binding needs it); revisit in TASK-14 if tests need real Workers APIs.
- **Rationale:** Smallest toolchain that proves the handler contract. Limitation recorded as L-022.

## D-027 Server database key variable is `SUPABASE_SECRET_KEY` (TASK-02)
- **Status:** Approved
- **Decision:** `.env.example` and the lint rule use `SUPABASE_SECRET_KEY` (the name in the approved `SYSTEM_ARCHITECTURE.md` section 8) instead of the kit's provisional `SUPABASE_SERVICE_ROLE_KEY`. `docs/CREDENTIALS.md` was updated. `SUPABASE_ANON_KEY` is unchanged. Whether the project uses Supabase's newer publishable/secret keys or legacy anon/service-role keys is `UNVERIFIED` until the Supabase project exists (Q-13).
- **Alternatives:** keep the old name (rejected: two names for one secret).
- **Rationale:** One name per secret across documents (Task 01 consistency rule).

## D-028 Dependency pinning, line endings and formatting scope (TASK-02)
- **Status:** Approved
- **Decision:** All dependency versions are exact (no `^` or `~`) with `package-lock.json` committed. `.gitattributes` forces LF. Prettier checks code and config only (`docs/`, `supabase/` and all Markdown are excluded). ESLint enforces the import-direction table, no ambient time or randomness in `packages/domain`, and a heuristic float-money rule; `scripts/check-lint-rules.mjs` proves each rule fires.
- **Alternatives:** caret ranges (rejected: the task requires pinned versions); formatting all Markdown (rejected: rewrites approved documents).
- **Rationale:** Reproducible installs and rules that cannot rot silently.

## D-029 Database verification without Docker: embedded PostgreSQL 17 (TASK-03)
- **Status:** Approved
- **Decision:** Because Docker, `psql` and the Supabase CLI were not available, migrations are verified by `npm run db:verify`, which starts a throwaway PostgreSQL 17 through the `embedded-postgres` npm package (devDependencies `embedded-postgres` 17.10.0-beta.17, `pg` 8.23.1, `@types/pg` 8.23.1, all MIT; the "beta" suffix is the package's own label, the server is PostgreSQL 17.10). A test-only shim (`scripts/db/local-shim.sql`) supplies `auth.users`, the roles `anon`/`authenticated`/`service_role` and Supabase's default table grants. `npm run db:reset` is defined as `supabase db reset` but is `NOT_EXECUTED`.
- **Alternatives:** PGlite (rejected: WASM build, less faithful to real PostgreSQL behaviour such as roles and `pg_timezone_names`); skipping verification (rejected: AGENTS.md rule on real checks).
- **Rationale:** Real PostgreSQL catches real constraint and exclusion-constraint behaviour. It does not replace a run on a real Supabase stack or the TASK-04 pgTAP tests (L-026, L-027).

## D-030 TASK-03 schema choices and deviations from DATABASE_DESIGN.md
- **Status:** Approved
- **Decision:** The migrations implement `docs/DATABASE_DESIGN.md` with these differences, each made to enforce an existing rule in the database:
  1. Composite foreign keys `(site_id, household_id) -> energy_sites (id, household_id)` (also `(season_id, tariff_id)`, `(override_id, tariff_id)`, `(rule_id, site_id)`) so child rows cannot cross households, sites or tariffs.
  2. Exclusion constraint rejecting equal-priority overlapping `tariff_overrides` (design left this to the engine).
  3. `household_settings`: table-level checks `stale_after_seconds > live_background_interval_minutes * 60` (design said "in function") and `live_on_demand_min_interval_seconds >= 30` (D-023).
  4. `scheduled_jobs.household_id` added (nullable, cascade) for household-level jobs such as `token_maintenance`.
  5. No extra descending index on `powerwall_metrics_log`: the unique `(site_id, sampled_at)` index serves range scans in both directions.
  6. `device_command_log.kind` uses upper-case names for the six endpoints TASK-00 marked `DOCUMENTED`: `SET_BACKUP_RESERVE`, `SET_OPERATION_MODE`, `SET_GRID_IMPORT_EXPORT`, `SET_STORM_MODE`, `SET_OFF_GRID_VEHICLE_CHARGING_RESERVE`, `SET_TIME_OF_USE_SETTINGS`. Payloads remain `UNVERIFIED`.
  7. `automation_executions` check constraints: a non-`ACTIVE` evaluation can never be `ACTED` and never links a command (dry run never acts).
  8. Additional integrity checks: tariff direction-specific columns, `FLAT` iff a flat rate is present, VAT rate present iff taxed, slot belongs to at most one of season/override, daily rollup length 23 to 25 hours, hourly bucket on a whole UTC hour, nonce length 12 bytes, `https` Fleet base URL, 32-byte hashes.
  9. Append-only triggers on `device_command_events` and `audit_log` allow only foreign-key cascades (trigger depth > 1) and, for `audit_log`, the `ON DELETE SET NULL` of `actor_user_id`. Retention deletes arrive in TASK-16 through a reviewed function.
  10. Timezone validation accepts any `pg_timezone_names` entry except `posix/` and `right/` aliases.
- **Alternatives:** keep the design literally and rely on the engine (rejected for items 1, 2, 7: cheap to enforce in the database and the database is authoritative).
- **Rationale:** Rules 1, 3, 5 and the "database is authoritative" principle. Items are listed in the TASK-03 handoff for owner review.

## Note on a formatting repair (TASK-03)
- **Status:** Approved
- **Decision:** The entries from the TASK-01 approval record to D-028 and limitations L-021 to L-025 were first committed in TASK-02 with inline code formatting stripped and some words corrupted by a PowerShell escaping fault in the tool used to append them (for example "typescript" shown with a leading tab). Their wording was restored in TASK-03 from the original text. No decision content changed. D-001 to D-024 and L-001 to L-020 were not touched.

## D-031 RLS and privilege model (TASK-04)
- **Status:** Approved
- **Decision:** Policies apply to `authenticated` only; `anon` has no table, sequence or function privilege and no policy. Table writes are granted only where a role may legitimately write directly (tariffs and their children, automation rules except `mode`, sites, settings columns, command intent rows), at column level wherever a table also holds system-owned columns. Membership checks use `private.is_member` and `private.has_role_at_least` (`SECURITY DEFINER`, `search_path = ''`); `authenticated` gets `USAGE` on schema `private` and `EXECUTE` on those two functions only. `FORCE ROW LEVEL SECURITY` is **not** used, which departs from `SECURITY_MODEL.md` section 4: the definer helpers and functions rely on the owner bypassing RLS, and the owner role is not reachable through the API. `private.lock_down_public_tables()` was redefined: it still enables RLS and revokes PUBLIC and anon everywhere, but keeps `authenticated` privileges on tables that have policies and revokes them on tables that have none, so a later table migration cannot wipe these grants and a new table stays closed until it gets policies.
- **Alternatives:** `FORCE ROW LEVEL SECURITY` plus `BYPASSRLS` on a function-owner role (rejected: adds a role that Supabase hosting may not let a migration create); policies for `PUBLIC` (rejected: `anon` could match).
- **Rationale:** Rules on roles and "backend and database are authoritative". The policy list is mirrored in `docs/RLS_POLICY_MATRIX.md` and compared by `npm run db:test`.

## D-032 Privileged operations only through audited functions (TASK-04)
- **Status:** Approved
- **Decision:** Roles, membership, invitations, rule activation and pausing are changed only by `SECURITY DEFINER` functions that read the caller from the JWT: `create_invitation`, `accept_invitation`, `revoke_invitation`, `change_member_role`, `remove_member`, `leave_household`, `set_automation_paused`, `set_rule_mode`. Differences from `DATABASE_DESIGN.md` section 3: `leave_household` was added (SECURITY_MODEL invariant 2); `set_automation_paused` takes the household id (the schema allows many households); an ACTIVE rule cannot be edited directly even by an ADMIN (it must be moved out of ACTIVE with `set_rule_mode`, audited); READ_ONLY and READ_WRITE see only their own membership row (the product table says listing members is ADMIN only); household deletion is not granted to anyone through the API until an audited function exists (L-032).
- **Alternatives:** table-level update policies on `household_members` (rejected: column privileges and policies cannot express "not your own row and not the last admin" as simply or audit it).
- **Rationale:** One audited path per privileged action; table grants stay minimal.

## D-033 Admin bootstrap, invitations and new users (TASK-04)
- **Status:** Approved
- **Decision:** Implements D-005. The bootstrap is `private.bootstrap_first_admin(email, household_name, timezone)`, executable by the owner role and `service_role` only and not reachable through PostgREST; the owner runs it once from the SQL editor (`docs/ADMIN_BOOTSTRAP.md`). It needs an existing user with a confirmed email, writes a permanent `system_bootstrap` marker (stores a hash of the email only) and an audit row, and cannot rerun even if the household is deleted. Recovery is a documented manual break-glass in the dashboard, not a callable function. Invitations: the database generates the 256-bit token (`pgcrypto`, hex), stores only its SHA-256, returns the token once, default lifetime 168 hours (hours, not days, so DST cannot change it), maximum 30 days. Acceptance needs a signed-in user, an open unexpired token, a confirmed email equal to the invited one when an email was set, and, for a role above READ_ONLY, an inviter who is still an ADMIN; every failure of the token returns the same error. The auth trigger creates `user_profiles` only and never raises.
- **Alternatives:** a public bootstrap RPC for the Worker (rejected: extra exposed surface for a one-time action); Worker-generated tokens (rejected: the database would trust a caller-chosen value).
- **Rationale:** D-005 and `SECURITY_MODEL.md` sections 2 and 4.

## D-034 Integrity triggers apply to every writer (TASK-04)
- **Status:** Approved
- **Decision:** Triggers, not policies, enforce: last-admin protection (advisory lock per household, so concurrent demotions cannot both succeed; deleting a household and deleting a non-last-admin account still work); no self role change (using the JWT subject, so it holds even for definer functions); immutable membership keys; tariff version immutability (only `name` and `effective_to` may change); append-only `audit_log` and `device_command_events` including TRUNCATE (and the server role loses UPDATE, DELETE and TRUNCATE on them); spoof-proof `created_by`, `updated_by` and `requested_by`; audit rows for membership, tariff, settings and command changes. Audit metadata passes through a per-action key allowlist (`private.touch_audit`).
- **Alternatives:** relying on policies and application code (rejected: the Worker's secret key bypasses RLS).
- **Rationale:** The database is authoritative; the server role must not be able to break these invariants by accident.

## D-035 Security test approach without Docker (TASK-04)
- **Status:** Approved
- **Decision:** Tests are pgTAP-style SQL files in `supabase/tests/database` using only `plan`, `ok`, `is`, `isnt`, `throws_ok`, `lives_ok` and `finish`. `npm run db:test` runs them on the throwaway PostgreSQL 17 from D-029 with `scripts/db/pgtap-lite.sql` (a small test-only look-alike for those functions) and an extended shim that adds `auth.uid()`, `auth.jwt()` and `email_confirmed_at`. The same files are meant to run under real pgTAP with `supabase test db` (NOT_EXECUTED). The run also compares `pg_policies` with the manifest in `docs/RLS_POLICY_MATRIX.md`.
- **Alternatives:** wait for Docker (rejected: security is the highest-risk area and should be exercised now); a separate Node-only test suite (rejected: it could not be reused on the real stack).
- **Rationale:** AGENTS.md: run real checks, say what was not run. Limitation recorded as L-033.

## D-036 Contract adjustments found while writing the shared types (TASK-05)
- **Status:** Approved by the owner (four questions answered in TASK-05)
- **Decision:** (1) `POST /households/{hid}/sites` takes an optional IANA `timezone`; the Worker defaults it to the household timezone (the database requires `energy_sites.timezone`). (2) `Idempotency-Key` stays required on invitations; a replay returns the original invitation with `token` and `link` set to `null` because the token exists only as a hash; same key with a different body is `409`. (3) VAT is a percentage everywhere: `vatRatePercent` is a decimal string such as `"23.0000"`; `ENERGY_ACCOUNTING.md` sections 6 and 8 were corrected from fraction wording (`1 + vatRate`) to `1 + vatRatePercent / 100`. (4) Database types come from our own generator (`npm run db:types`, `-- --check` for drift) because Docker and the Supabase CLI are unavailable. Additive: error code `METHOD_NOT_ALLOWED` (405) added to the contract (the Worker already returned it), and the discovered-sites item is `providerSiteId` plus `name`.
- **Alternatives:** a token-returning replay (rejected: would require storing the token); a fractional VAT rate (rejected: the database column and tariff documents already use percent); waiting for Docker (rejected: types are needed now).
- **Rationale:** `docs/API_CONTRACT.md`, `docs/ENERGY_ACCOUNTING.md` and the migrations must agree; the shared package is where a disagreement becomes a failing test.

## D-037 Zod 4 strict schemas, decimal strings and one route table (TASK-05)
- **Status:** Approved
- **Decision:** Request bodies and responses are `z.strictObject` schemas in `@autopw3/shared`; types are inferred, not hand-written. Money, rates and VAT are decimal strings with bounds mirroring the `numeric(p, s)` columns, parsed with a private `decimal.js` clone (precision 28, half up) so global configuration is untouched. Every endpoint of `API_CONTRACT.md` section 2 is one entry in `ROUTES` (method, path, access, task, query, body, response); `RouteBody`, `RouteQuery` and `RouteResponse` derive from it. Tests compare `ROUTES` with the contract table, and enums and bounds with the migration SQL.
- **Alternatives:** hand-written interfaces beside schemas (rejected: drift); OpenAPI generation (rejected: another toolchain for one team).
- **Rationale:** D-014 money model and D-005 (the backend and database are authoritative); the web app and the Worker cannot disagree if they import the same definition.

## D-038 Normalisation boundary and persisted-source rule (TASK-05)
- **Status:** Approved
- **Decision:** Raw Tesla shapes live only in `apps/worker/src/providers/tesla/raw-types.ts` (loose records, `UNVERIFIED`) with a declared `NormaliseLiveStatus` function type as the only crossing. Shared schemas for persisted samples and intervals accept `source: 'TESLA'` only, matching the database `CHECK`; only API live and demo responses accept `'DEMO'`. Command lifecycle (`PENDING`, `CONFIRMED`, `FAILED`, `UNKNOWN`) is data in shared constants, with `physicalOutcomeGuaranteed` fixed at `false`.
- **Alternatives:** one sample schema with both sources (rejected: it would let demo data be validated as writable).
- **Rationale:** AGENTS.md hard rules: demo data never reaches live tables; never invent Tesla payloads.

## D-039 Proposed shapes the documents do not define (TASK-05)
- **Status:** Proposed (to confirm in the task that implements each)
- **Decision:** Command parameter shapes per kind (our normalised model; the Tesla payload mapping stays `UNVERIFIED`), rule definition version 1 (conditions `TIME_WINDOW`, `BATTERY_SOC`, `IMPORT_RATE` combined with AND, actions are command requests, 1 to 10 conditions and 1 to 5 actions), the export and delete request and response bodies, tariff problem codes, and the mapping from database error messages to API error codes (`DB_ERROR_TO_API_ERROR`).
- **Alternatives:** leave them undefined (rejected: tasks 14 to 19 need a shape to build against and a test to change when the shape changes).
- **Rationale:** Smallest shape that satisfies the contract; each is marked in the code and listed in `docs/KNOWN_LIMITATIONS.md`.

## D-040 Design tokens in CSS and one effects switch (TASK-06)
- **Status:** Approved
- **Decision:** Colours, type, radii, layout sizes and four glow levels are Tailwind 4 `@theme` tokens in `apps/web/src/styles/tokens.css`. A single attribute, `<html data-effects="on|off">`, turns off glow, glass transparency, blur, background light and animation. `prefers-reduced-motion` forces it off and sets the default to off. The choice is stored in `localStorage` (`autopw3.effects`). System font stacks only.
- **Alternatives:** per-component glow props (rejected: no single switch); web fonts (rejected: CSP `default-src 'self'`, and no external assets).
- **Rationale:** Task requirement of one glow-off switch; readable with effects off; accessibility.

## D-041 react-router and route inventory as data (TASK-06)
- **Status:** Approved (dependency approved by the owner)
- **Decision:** `react-router` 8.5.0 (MIT) with `BrowserRouter`. Routes are data in `apps/web/src/app/routes.ts` (path, title, nav entry, access hint, owning task). `AppFrame` holds providers and routes without a router so tests use `MemoryRouter`; `App` adds `BrowserRouter`. `/invite/:token` is included as a public placeholder because the PRD describes invitations, although the task's route list omits it.
- **Alternatives:** hand-rolled routing (rejected: focus, links, history); a route table in the shared package (rejected: it holds page concerns, not API contract).
- **Rationale:** Smallest accepted router; later tasks replace page components, not the table.

## D-042 Navigation visibility is a hint (TASK-06)
- **Status:** Approved (owner chose this behaviour)
- **Decision:** In demo mode every nav entry shows. With demo off only public entries show until a `role` prop is supplied by the session (TASK-07), then entries up to that role via `roleAtLeast`. A hidden route still renders its own state; the Worker and database authorise.
- **Rationale:** AGENTS.md: backend and database are authoritative, never the browser.

## D-043 Accessibility approach and axe-core as a dev dependency (TASK-06)
- **Status:** Approved (dependencies approved by the owner)
- **Decision:** Tests use `axe-core` 4.14.0 (MPL-2.0) and `@testing-library/user-event` 14.6.8 (MIT) as dev dependencies only; neither ships in the bundle. jsdom cannot evaluate colour, so axe tests disable `color-contrast` and `src/styles/contrast.test.ts` computes WCAG ratios from `tokens.css` instead; contrast was also checked with axe in a real browser. Focus moves to `h1#page-title` on navigation; modals trap focus and set `inert` on the app root.
- **Alternatives:** `jest-axe` (rejected: another dependency for a thin wrapper).
- **Rationale:** Keeps contrast regressions visible in `npm test` without a browser.

## D-044 Demo indicator design (TASK-06)
- **Status:** Approved
- **Decision:** The demo banner (`role="status"`) sits in a named `region` above the sticky header and scrolls away; a `DEMO` pill in the sticky header stays visible. Components never default missing telemetry to zero: they render a dash with screen-reader text "No data".
- **Rationale:** AGENTS.md: demo data is always labelled; PRD honest-data rule. The banner was moved out of the sticky header because it clipped the sidebar at small heights.

## D-045 `sideEffects: false` for `@autopw3/shared` (TASK-06)
- **Status:** Approved
- **Decision:** `packages/shared/package.json` declares `"sideEffects": false` so the web build tree-shakes unused schemas (web bundle 433 kB to 290 kB, 91 kB gzip).
- **Rationale:** The package holds pure schemas and helpers; the larger bundle came from importing one function.

## D-046 Authentication architecture: `AuthClient` with a live and a development-only adapter (TASK-07)
- **Status:** Approved (dependency `@supabase/supabase-js` 2.118.0, MIT, approved by the owner)
- **Decision:** The web app talks to identity through one interface, `AuthClient` (`features/auth/types.ts`). The live adapter wraps `supabase-js` (PKCE flow, persisted session, `signOut({ scope: 'local' })`) and is loaded lazily. A second adapter keeps accounts, passwords and memberships in page memory and exists for component tests and the Playwright smoke test; `create-client.ts` imports it only inside `import.meta.env.DEV`, so a production build does not contain it, and `VITE_AUTH_MODE=mock` is refused outside development. Demo mode builds no client at all.
- **Alternatives:** a local Supabase stack in tests (rejected: needs Docker, not available here, slow); mocking `fetch` (rejected: couples tests to Supabase wire formats); a mock that ships in production behind a flag (rejected: a switch that can be flipped is a hole).
- **Rationale:** AGENTS.md: no credentials in tests; the same UI code path runs against either adapter. The live adapter is tested only against a faked `SupabaseClient` and stays `AWAITING_CREDENTIALS` against a real project (L-057).

## D-047 The role comes only from the database response (TASK-07)
- **Status:** Approved
- **Decision:** `AuthState` is `loading | unauthenticated | expired | error | no-household | authorised`; only `authorised` carries a role, and that role is the `household_members` row returned under RLS. It is never read from `localStorage`, `sessionStorage`, JWT claims or user metadata. An unknown role value or malformed row is an error (fail closed). v1 has one household per person; `pickMembership` chooses deterministically (name, then id) if a second ever exists. The mock stores only a signed session token in the browser, so editing storage cannot change who or what the mock believes; tests edit storage and forge the token. A quiet re-check when the tab regains visibility reflects a role change made on the server without a reload.
- **Rationale:** `SECURITY_MODEL.md`: backend and database are authoritative. This supersedes the `role` prop of D-042; `AppFrame` no longer accepts one.

## D-048 Invitation acceptance calls `accept_invitation` directly for now (TASK-07)
- **Status:** Approved (owner chose this)
- **Decision:** `AuthClient.acceptInvitation(token)` calls the database function `accept_invitation(p_token)` as the signed-in person. The token is validated with the shared `InvitationTokenSchema` first, never rendered, and every failure shows one message. TASK-14 or TASK-19 switches the call to the Worker (rate limit, audit mapping, error mapping) by changing one method.
- **Alternatives:** wait for the Worker endpoint (rejected: the waiting-for-an-invitation flow could not be completed or tested).
- **Rationale:** The function is `security definer` and checks the caller's confirmed email and the token itself (TASK-04 tests); the browser gains nothing it could not already do through `rpc`.

## D-049 No account enumeration in messages (TASK-07)
- **Status:** Approved
- **Decision:** Sign-in reports "The email or password is not correct." for an unknown address and a wrong password alike. Sign-up reports an already-registered address exactly as a new one (`user_already_exists` is swallowed). A password-reset request shows the same confirmation for any address and surfaces only network and rate-limit failures. An expired, used, withdrawn or unknown invitation reads the same. The minimum password length shown to people (12) is `PASSWORD_MIN_LENGTH` and must match the Supabase Auth setting.
- **Rationale:** `SECURITY_MODEL.md` threat list; OWASP authentication guidance.

## D-050 Supabase origin added to the Content Security Policy at build time (TASK-07)
- **Status:** Approved (owner chose the Vite plugin)
- **Decision:** `public/_headers` keeps `connect-src 'self'`. The plugin `cspConnectSrc` in `vite.config.ts` adds the origin of `VITE_SUPABASE_URL` to `dist/_headers` after the bundle is written, using the pure function `withConnectSrc` (unit-tested; refuses a malformed origin or a missing directive; idempotent). Demo and mock builds add nothing.
- **Alternatives:** hand-editing `_headers` per deployment (rejected: easy to forget and breaks sign-in silently); `connect-src https:` (rejected: too wide).
- **Rationale:** The browser must reach Supabase and nothing else.

## D-051 Configuration validation refuses privileged keys (TASK-07)
- **Status:** Approved
- **Decision:** `readConfig` returns `AuthConfig = none | supabase | mock | invalid`. It rejects a `sb_secret_` key, a JWT whose `role` is `service_role`, placeholder values, a non-`https` URL (plain `http` only for loopback), and reduces the URL to its origin. The start-up screen shows the reason and never the value.
- **Rationale:** AGENTS.md: no secrets in the browser; `VITE_` variables are public.

## D-052 Focus moves to the page title after a navigation, including redirects (TASK-07)
- **Status:** Approved
- **Decision:** `useMoveFocusAfterNavigation` uses `useNavigationType`; the initial load is skipped and every later navigation, including a guard's redirect to `/login`, focuses `h1#page-title`. Applied in `AppShell` and `AuthLayout`. Extends D-043.
- **Rationale:** A redirect that leaves focus on a removed element strands keyboard and screen-reader users.

## D-053 Playwright adopted for the smoke tests (TASK-07)
- **Status:** Approved (`@playwright/test` 1.64.1, Apache-2.0, dev dependency, approved by the owner)
- **Decision:** `playwright.config.ts` runs the dev server on port 5183 with `VITE_DEMO_MODE=false VITE_AUTH_MODE=mock` and runs `e2e/*.spec.ts` at 1280 px and 360 px. `npm run test:e2e` is separate from `npm run check` because the first run needs a browser download; `npm run typecheck` includes `e2e/`.
- **Rationale:** `TESTING.md` end-to-end layer. Keeping it out of `check` keeps the main gate offline-friendly (L-063).
## D-054 Demo data is a seeded model, not stored files (TASK-08)
- **Status:** Proposed (accepted with the task unless the owner objects)
- **Decision:** The demo day, week and month are generated on demand by `DemoSiteModel` from a seed (`20260101`) and a fixed epoch (2026-01-01), covering up to 2031-01-01. Noise is a hash of the seed and the step index, not a random-number generator; the model simulates forward and remembers each step, so a value never depends on what was asked first. A test pins a fingerprint (FNV-1a over the JSON) of each dataset.
- **Alternatives:** committed JSON fixtures (rejected: large diffs, cannot cover five years, tempting to hand-edit); a seeded PRNG stream (rejected: results would depend on the order of calls).
- **Rationale:** Rule 6 and the task: same inputs give identical datasets; nothing is random at render time.

## D-055 The telemetry provider interface is asynchronous and reports problems as typed errors (TASK-08)
- **Status:** Proposed
- **Decision:** `TelemetryProvider<S>` has `getCapabilities`, `getLiveSnapshot`, `getPowerSeries` and `getEnergySeries`; the last three return promises and throw `TelemetryProviderError` with a code (`RANGE_INVALID`, `RANGE_TOO_LARGE`, `OUT_OF_COVERAGE`, `INVALID_REQUEST`, `UNAVAILABLE`, `RATE_LIMITED` and so on). Series results carry the real resolution, the gaps and a completeness that is never rounded up. Energy buckets are whole and may extend beyond the requested range.
- **Alternatives:** synchronous methods (rejected: the live adapter does I/O); returning `{ ok, error }` (rejected: the routes already map errors by code).
- **Rationale:** API_CONTRACT section 1 ranges; rule 9 (never resample to finer data than the provider has).

## D-056 Normalisation never silently corrects (TASK-08)
- **Status:** Proposed
- **Decision:** A missing value is `null` (reading `PARTIAL`). A value the shared schema cannot hold (negative solar or load, battery level outside 0 to 100, negative energy, NaN, Infinity) becomes `null` and the reading `SUSPECT`, with an issue naming the field and what was seen. A representable but doubtful value (implausible magnitude, failed balance) is kept and the reading is `SUSPECT`. Strings are never turned into numbers. Normalisation takes the receive time as an input and never reads a clock. Converting provider-native fields and signs happens in the provider adapter, which hands over a `RawPowerReading`.
- **Alternatives:** clamping negatives to zero (rejected: hides a sign error and would book energy that was not there); coercing numeric strings (rejected: a provider that starts sending strings has probably changed units).
- **Rationale:** Rules 8 and 9; ENERGY_ACCOUNTING section 2 (suspect samples are shown but excluded).

## D-057 Balance tolerances and the plausibility limit are proposals (TASK-08)
- **Status:** Proposed, `UNVERIFIED`
- **Decision:** Power balance holds within the larger of 100 W and 5% of the load (the shared constants `BALANCE_TOLERANCE_FLOOR_W` and `BALANCE_TOLERANCE_PERCENT`); energy balance within the larger of 100 W for the interval and 5% of home consumption; magnitudes above 100 000 W are implausible. All can be changed through `ValidationOptions`.
- **Rationale:** No real Tesla data exists yet (Q-06); real sites may need different values, which TASK-15 should check.

## D-058 Freshness: a reading exactly at the threshold is fresh; future timestamps are not trusted (TASK-08)
- **Status:** Proposed
- **Decision:** `freshnessOf` computes age from an injected `now`: `FRESH` up to and including the threshold (default 3600 s, configurable), `STALE` after it, `UNAVAILABLE` for no or unreadable timestamp or one more than 120 s in the future. A timestamp up to 120 s ahead counts as age 0 (clock skew).
- **Rationale:** Deterministic tests; a reading from the future must not look fresh.

## D-059 The demo/live guard has three layers, and the live accounting gate is a placeholder (TASK-08)
- **Status:** Proposed
- **Decision:** (1) `LivePowerSample` has `source: 'TESLA'`, so passing a demo sample to a function that asks for live samples fails type checking; a test with `@ts-expect-error` proves it. (2) `assertLiveSource`, `requireLiveSamples` and `acceptForLiveIngestion` throw `DemoDataInLivePathError` for anything whose `source` is not exactly `'TESLA'`. (3) The database CHECK `source = 'TESLA'`. `selectAccountableSamples` is the gate the accounting engine (TASK-11) and ingestion (TASK-16) must start from; it also leaves `SUSPECT` samples out and reports how many.
- **Rationale:** Rule 5 and D-017; types disappear at JSON boundaries, so runtime checks are required.

## D-060 Local days come from `Intl` and bisection; sources stay `TESLA | DEMO` (TASK-08)
- **Status:** Proposed
- **Decision:** `localDayBounds` finds when a local day starts and ends by bisecting minutes against the platform's IANA data, so no fixed offsets appear anywhere and a DST day is 23 or 25 hours (Europe/Dublin: 2026-03-29 and 2026-10-25 are tested). The data sources remain the shared `TESLA` and `DEMO`; no `MOCK` source was added (the task text mentions "MOCK", the shared contract does not have it, and the demo provider is the mock).
- **Rationale:** Rule 6; changing the shared enum would touch the database CHECK and generated types for no gain.

## D-061 The Live View splits into a pure flow model, a drawing-only renderer and a thin React wrapper (TASK-09)
- **Status:** Proposed
- **Decision:** `flow-model.ts`, `format.ts`, `layout.ts` and `particles.ts` are pure and tested without a canvas. `renderer.ts` only draws what the model says (it never decides direction, size or animation). `FlowCanvas` owns one `requestAnimationFrame` loop in one effect; phases, timestamps and the canvas size live in that effect's closure, not in React state, so a frame causes no React render. The flow model stays in `apps/web/src/features/live` because the Worker does not need it (the task file allows this).
- **Alternatives:** the model in `packages/domain` (rejected: nothing else uses it yet; it can move if the Worker ever does); animation state in React state (rejected: a render per frame).
- **Rationale:** Task text, "keep flow logic out of the renderer"; testability.

## D-062 The Live View never draws an unknown value as zero and animates only live data (TASK-09)
- **Status:** Proposed
- **Decision:** A missing, non-finite or impossible (negative solar or load) value makes that spoke `UNKNOWN`: a dash, a dashed grey line, no direction. Only `LIVE` data (fresh and not `SUSPECT`) moves particles. `STALE` and `SUSPECT` data keep their numbers and arrowheads on dotted lines with a warning. With no reading, or freshness `UNAVAILABLE`, nothing is shown as a value or drawn as flowing. Stale beats suspect. Active spokes always have an arrowhead, so direction needs no motion.
- **Rationale:** Rules 8 and 9 (missing is `null`, never 0; stale and suspect data are labelled); the product promise of honest data.

## D-063 The data source is chosen by `VITE_TELEMETRY_PROVIDER`, and live never falls back to demo (TASK-09)
- **Status:** Proposed
- **Decision:** `demo` or `live`. Unset means `demo` in demo mode and `live` otherwise, so a real deployment never shows demo data by default. `live` with demo mode on is a contradiction and the page shows the reason; so is any other value (the reason does not echo the value). `live` currently has no provider (Tesla adapter TASK-15, ingestion TASK-16, Worker routes TASK-14), so the page says "No live data source is connected yet" and shows no numbers. `chooseProvider` in `create-provider.ts` is the only place that maps the setting to a provider; adding the live one changes nothing else.
- **Alternatives:** falling back to demo data when live is unavailable (rejected: demo data must never stand in for live data); choosing by editing code (rejected by the task).
- **Rationale:** Rule 5 (demo data never reaches live paths) and the task's "selection through configuration".

## D-064 The visual and timing thresholds are proposals (TASK-09)
- **Status:** Proposed, `UNVERIFIED`
- **Decision:** idle below 10 W; visual level `sqrt(magnitude / 6000 W)` clamped to 0..1; speed 24 to 140 px/s; 1 to 12 particles per spoke (hard upper bounds, whatever the input); frame time clamped to 0.1 s; battery Low below 15% (strict, the domain default), Critical below 5%; poll every 10 s; screen-reader announcements at most every 15 s. Each is a named constant or a prop. No real Tesla data has been used to choose them.
- **Rationale:** Needed to build the page; to be checked with real data (TASK-15, Q-06). Listed in L-077.

## D-065 The battery percentage is rounded down (TASK-09)
- **Status:** Proposed
- **Decision:** `formatPercent` floors, so 14.9% reads "14" and is Low, and 99.9% reads "99". The number never reads higher than the real level and always agrees with the state word at the 15% and 5% boundaries.
- **Alternatives:** rounding to nearest (rejected: it would print "15" next to the word Low).

## D-066 Polling is one request at a time, paused while the tab is hidden, and keeps the last reading on failure (TASK-09)
- **Status:** Proposed
- **Decision:** `useLiveReading` schedules the next request only after the last one finishes, makes none while `document.visibilityState` is hidden, refreshes when the tab is shown again (unless one was made within the interval), keeps the last good reading when a refresh fails and shows a fixed sentence per error kind (provider messages are never shown), and ignores a late answer after unmount. The provider object must be stable; a new one restarts polling.
- **Rationale:** Live Tesla requests will cost money (D-023); a hidden tab should cost nothing; no secrets or provider text in the UI.

## D-067 Accessibility of the Live View (TASK-09)
- **Status:** Proposed
- **Decision:** The canvas is `aria-hidden`. Numbers and directions are real text; a `role="status"` polite live region carries a sentence per node, throttled (first reading at once, later changes at most every 15 s). The battery drawing is a `role="meter"` only when there is a level. Meaning is never colour alone: words, hatching, dotted lines, dashed outlines and arrows. `prefers-reduced-motion` and the in-app effects switch both stop particles; the arrows remain.
- **Rationale:** Task requirements; DESIGN_SYSTEM accessibility rules.

## D-068 The engine returns results, not exceptions, and never a zero for missing coverage (TASK-10)
- **Status:** Proposed
- **Decision:** `resolveTariffRate` returns `{ ok: true, ... }` or `{ ok: false, code, message }`; `priceInterval` returns a status union; `chargesForLocalDates` returns days or problems; validators return `TariffProblem[]`. Bad tariff data is a returned problem. A `RangeError` is thrown only for a caller mistake (an inexact instant, an empty or over-long range, negative energy, a number where money is expected, mixed currencies in one interval). No function returns a zero rate or amount to stand in for a missing one.
- **Alternatives:** throwing for missing coverage (rejected: the accounting engine must count and show unpriced intervals, not abort a day); returning zero (rejected by rule 8).
- **Rationale:** Rule 8; completeness is a first-class number in ENERGY_ACCOUNTING.

## D-069 A site-specific tariff version beats the household default (TASK-10)
- **Status:** Proposed
- **Decision:** For a site, the versions in force are those with that site's id and those with no site id. If any site-specific version is in force on the local date, only site-specific versions compete; otherwise the household defaults do. Two in force in the same group is `AMBIGUOUS_TARIFF`. Without a `siteId` option only household defaults are used.
- **Rationale:** ENERGY_ACCOUNTING names the site scope but not which wins; the database exclusion constraint is per site scope, so both can exist at once. Needs owner confirmation.

## D-070 Precedence details the architecture left open (TASK-10)
- **Status:** Proposed
- **Decision:** (1) Slots of a day type replace the `ALL` slots: if a list has any `WEEKDAY` slot, weekdays use only those, likewise `WEEKEND`. (2) A date override replaces the whole local day with its own slots; nothing is inherited. (3) A season with no slots inherits the all-year slots. (4) Two overrides of equal priority on one date are `AMBIGUOUS_TARIFF` at run time and `OVERRIDE_PRIORITY_TIE` at save time. (5) A dynamic price point is looked up only for a `DYNAMIC` tariff; no price point is `NO_PRICE_POINT`, never carried forward. This was the TASK-10 stop condition (precedence not defined in the architecture), proposed in the plan and recorded here.
- **Alternatives:** weekday slots layered over `ALL` per minute (rejected: harder to validate and explain); an override inheriting uncovered minutes from the base (rejected: a hidden fallback).
- **Rationale:** D-013 gives the order but not these cases; each choice makes a gap visible instead of hiding it.

## D-071 A window across midnight is two slots (TASK-10)
- **Status:** Proposed
- **Decision:** The engine keeps the TASK-05 slot model (`endMinute > startMinute`). Night as 23:00 to 08:00 is `1380-1440` plus `0-480`. Local midnight is always a split point, and each side is looked up on its own local date, so a midnight crossing needs no special case.
- **Rationale:** The shared schema already fixed it; changing it would change the database.

## D-072 DST semantics: price by the instant's local time (TASK-10)
- **Status:** Proposed
- **Decision:** Every instant is priced by the local date and minute it falls on in the tariff's own IANA zone. A skipped local time does not exist, so a slot edge there yields no boundary that day. A repeated local time occurs twice, each instant is priced by the band it falls in, and a slot edge in the repeated hour is a boundary at both instants. A 23-hour day has 23 hours of pricing, a 25-hour day 25. Calendar data comes from the platform's `Intl` time zone data, checked against hand-derived UTC values for Europe/Dublin and America/New_York.
- **Alternatives:** applying a repeated slot once, at its first occurrence (ENERGY_ACCOUNTING section 4 wording; rejected for rate bands because it would leave the second pass unpriced or priced twice).
- **Rationale:** Keeps cost = rate x energy for every real instant; no tz library dependency was added.

## D-073 Splitting uses the schedule the resolver would use (TASK-10)
- **Status:** Proposed
- **Decision:** Split points are gathered per local day from the schedule in force that day (override, season or base), plus day starts, the DST change, version and season changes and price point edges. Neighbouring identical results are joined. The tests compare this with a minute-by-minute scan of the resolver.
- **Rationale:** One source of truth for what applies when; the scan test catches any drift.

## D-074 Pricing statuses and the default for Q-08 (TASK-10)
- **Status:** Proposed (Q-08 still open for the owner)
- **Decision:** `PRICED` when one tariff version and one rate hold for the whole interval; `UNPRICEABLE_AT_RESOLUTION` by default when more than one applies (`STRICT`); `ESTIMATE` only with the opt-in `PRORATA_ESTIMATE`; `UNPRICED` for any gap, in both modes. A version change inside an interval counts as mixed even when the rates are equal.
- **Rationale:** ENERGY_ACCOUNTING section 5 and rule 9 (never fabricate finer data).

## D-075 VAT and levy treatment (TASK-10)
- **Status:** Proposed
- **Decision:** `EXCLUSIVE`: VAT = taxable x rate / 100 added on top. `INCLUSIVE`: VAT = amount - amount / (1 + rate / 100) and the total is unchanged. `NONE`: no VAT. Taxable levies are in the VAT base, non-taxable ones are added after it. Levies apply to imports only; a levy on an export tariff is rejected at validation (`LEVY_ON_EXPORT`) and ignored when pricing. Export `PER_KWH` pays kWh x rate; `NONE` pays exactly zero. Whether export credits are taxed is the export tariff's own setting, not assumed (Q-09).
- **Rationale:** ENERGY_ACCOUNTING section 5; the schema has no export levy.

## D-076 The engine does not round; display rounding is half up to the minor unit (TASK-10)
- **Status:** Proposed
- **Decision:** All amounts are exact decimals (28 significant digits, half up) serialised as strings. `roundToMinorUnit` rounds half up to the currency's minor unit for display, once per line (ENERGY_ACCOUNTING section 7). Known currencies: EUR, GBP, USD, CHF, CAD, AUD, NZD, SEK, NOK, DKK, PLN and CZK have 2 digits, JPY 0; an unlisted currency throws instead of guessing.
- **Rationale:** Rule 6 (money is decimal-safe); rounding early would lose cents across thousands of intervals.

## D-077 Standing charge is per local date (TASK-10)
- **Status:** Proposed
- **Decision:** `chargesForLocalDates(from, to)` charges each local date in `[from, to)` once, using the version in force on that date, whatever its length in hours (a 23-hour and a 25-hour day cost one each). Per-day levies and VAT follow the same rules as energy. A date with no version is a problem entry, never zero. Pro-rating a partial day is left to TASK-11.
- **Rationale:** Suppliers charge per calendar day; ENERGY_ACCOUNTING section 5.

## D-078 Negative prices work in the engine, not in storage (TASK-10)
- **Status:** Proposed
- **Decision:** The engine accepts negative rates and prices (a negative dynamic price gives a negative cost). The shared schemas and database constraints still reject negative rates; they are unchanged and the gap is recorded in L-086. Owner choice at the TASK-10 plan: engine only.
- **Alternatives:** widening the schema and a migration now (rejected for this task: it touches TASK-03 to 05 work).

## D-079 Range limits (TASK-10)
- **Status:** Proposed, `UNVERIFIED`
- **Decision:** `MAX_SPLIT_DAYS` is 400 and `MAX_CHARGE_DAYS` is 1100; a longer range throws `RangeError`.
- **Rationale:** Bounds work per call; the accounting engine splits long ranges itself. Listed in L-090.

## D-080 Four tariff problem codes added to the shared enum; fixtures live in the domain package (TASK-10)
- **Status:** Proposed
- **Decision:** `TIMEZONE_UNKNOWN`, `TIMEZONE_MISMATCH`, `PRICE_POINT_OVERLAP` and `LEVY_ON_EXPORT` were appended to `TARIFF_PROBLEM_CODES` in `packages/shared` (the enum's own comment allows additive codes; nothing stores them). The tariff fixtures are in `packages/domain/src/tariff/fixtures` and exported, so the accounting engine (TASK-11) and web tests can use them; they are not mixed into the demo telemetry fixtures.
- **Rationale:** The validator needs these reasons; the task's write path is the tariff folder.

## D-081 Two development dependencies (TASK-10)
- **Status:** Proposed, approved by the owner at the TASK-10 plan
- **Decision:** `@vitest/coverage-v8` 5.0.5 (same version as Vitest) for the honest coverage report, and `fast-check` 4.10.2 for the property-based tests. Both are devDependencies of `@autopw3/domain` only; neither ships in a bundle.
- **Rationale:** Required by the task (coverage report, property-based tests).

## D-082 Left-Riemann step integration for power-to-energy conversion (TASK-11)
- **Status:** Proposed
- **Decision:** When provider-reported energy intervals are absent, power snapshots are integrated via step (hold-last) left-Riemann integration ($Wh = W \times \Delta t / 3600$). Spans exceeding `maxGapSeconds` (default 3600 s) are left uncovered and never interpolated. Derived intervals are stamped with `quality: 'DERIVED'`.
- **Rationale:** ENERGY_ACCOUNTING §4; rule 9 (never fabricate finer data).

## D-083 Runtime and type-level source isolation for accounting (TASK-11)
- **Status:** Proposed
- **Decision:** `accountForPeriod` defaults to `context: 'LIVE'`. Passing synthetic `DEMO` telemetry in a live context throws `DemoDataInLivePathError`. Demo accounting is supported only when explicitly requested (`context: 'DEMO'`). `SUSPECT` intervals are excluded from totals and tracked against data completeness.
- **Rationale:** Rule 5; D-017 (demo data can never reach live accounting).

## D-084 Independent calculation of import charges and export revenue (TASK-11)
- **Status:** Proposed
- **Decision:** Import energy charges and export revenues are computed independently. Standing charges and daily levies are assessed per local calendar day ($[00:00, 24:00)$ in the site timezone). A 23-hour or 25-hour DST day incurs 1 day of standing charges. Net cost equals import energy + standing charges + import levies + VAT - export revenue.
- **Rationale:** Energy accounting requirements; export credit must not distort or obscure import cost bases.

## D-085 Displayed net cost is the sum of rounded component lines (TASK-11)
- **Status:** Proposed
- **Decision:** Intermediate calculations use arbitrary-precision Decimal arithmetic (28 significant digits). Presentation amounts are rounded half-up to minor units per component line (import energy, standing charges, VAT, export credit). Displayed net is the sum/difference of the rounded component lines, ensuring invoice displays add up on screen.
- **Rationale:** D-014; ENERGY_ACCOUNTING §7; prevents cent mismatches in display presentations.

## D-086 Efficiency metrics and counterfactual savings model (TASK-11)
- **Status:** Proposed
- **Decision:** Implements self-consumption %, self-sufficiency %, and battery round-trip losses ($\max(0, \text{charged} - \text{discharged})$). Counterfactual savings ("no solar, no battery") models 100% of home consumption imported at active tariff rates plus standing charges, always labelled `ESTIMATE`. Documented in `docs/FINANCIAL_MODEL.md`.
- **Rationale:** Task 11 requirements; ENERGY_ACCOUNTING §6.

## D-087 Window-to-slot decomposition for midnight crossing (TASK-12)
- **Status:** Proposed
- **Decision:** The UI presents human-friendly time windows (e.g., 23:00 to 08:00) while the underlying database schema and tariff engine enforce `0 <= startMinute < endMinute <= 1440`. Windows crossing midnight (`startMinute >= endMinute`) are automatically decomposed into two canonical slots: `[startMinute, 1440)` and `[0, endMinute)` with identical rate, label, and day type. When loaded into the editor, matching slots are rejoined into a single window.
- **Rationale:** Aligns user experience with the strict schema constraint established in TASK-05 and D-071.

## D-088 Effective-dated versioning rather than in-place mutation (TASK-12)
- **Status:** Proposed
- **Decision:** Editing an existing tariff generates a new version (`version: n + 1`) under the same `tariffKey`. The previous version's `effectiveTo` is updated to the new version's `effectiveFrom`, preserving historical continuous pricing across telemetry records. Setting `effectiveTo` explicitly archives/ends a tariff without deleting audit history.
- **Rationale:** AGENTS.md and D-034: tariff version immutability; historical calculations must not be rewritten.

## D-089 Visual 24-hour schedule preview with DST clock change support (TASK-12)
- **Status:** Proposed
- **Decision:** The schedule preview is directly driven by the domain tariff engine (`splitIntervalAtBoundaries`, `resolveTariffRate`, `localDay`). Normal days render 24 hours (1,440 mins); spring-forward DST days render 23 hours (1,380 mins); fall-back DST days render 25 hours (1,500 mins) with both passes through repeated local times priced by active slots. An accessible companion segment breakdown table is rendered alongside the visual bar.
- **Rationale:** WCAG accessibility rules; honest representation of DST transitions per D-072.

## D-090 Tariff repository abstraction and role enforcement (TASK-12)
- **Status:** Proposed
- **Decision:** Persistence uses an explicit `TariffRepository` interface. In demo mode and offline tests, `InMemoryTariffRepository` is seeded with `TARIFF_EXAMPLES`. The repository enforces roles: if `currentRole === 'READ_ONLY'`, `saveTariff` and `endTariff` throw `Error('READ_ONLY role cannot persist tariffs')`. In the UI, controls are disabled for `READ_ONLY` sessions with clear explanations.
- **Rationale:** TASK-12 acceptance criterion: READ_ONLY cannot persist in UI and data layer; Worker route comes in TASK-14.

