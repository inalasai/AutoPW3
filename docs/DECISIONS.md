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