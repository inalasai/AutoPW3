# Durable Application Repository Architecture

**Status: DESIGN ONLY — no repository, migration, or runtime code was implemented for this blueprint.**
This design is based on the current branch contents inspected on 2026-10-31. The Worker must remain
fail-closed in staging and production until the repository phases and their acceptance tests are complete.

## 1. Executive recommendation

Split the current mixed `Repository` contract into two capabilities:

1. **`UserRepository`** is constructed per authenticated HTTP request from the Supabase public key and
   that request's already-verified user JWT. Ordinary user reads and simple, single-row writes go through
   PostgREST as `authenticated`; RLS and SQL triggers remain authoritative. User mutations that span rows,
   need special privileges, or must atomically record idempotency use SECURITY DEFINER RPCs called with
   that same user JWT. Such functions derive the actor from `auth.uid()` and check household role inside
   the transaction. Do not accept a caller-supplied actor ID as proof of authority.
2. **`SystemRepository`** is a separate, server-only capability for scheduled handlers and explicitly
   privileged backend operations. It uses the service-role key only for current documented cases S1–S9
   in `docs/SECURITY_MODEL.md`: tokens, jobs/locks, ingestion/rollups, provider usage, command lifecycle,
   bootstrap, system audit, OAuth callback state, and Auth Admin account deletion. Every tenant-scoped
   operation verifies the site/household relationship in SQL. It does not impersonate an authenticated
   user and must not be injected into request routes.

Use the authenticated PostgREST path for policy-covered user operations; use authenticated, narrow RPCs
for user mutations that require one transaction; and use service-role RPCs only where no user session
exists or the schema explicitly reserves the data for the server. Do not implement the current API as a
general service-role table repository with TypeScript-only checks.

Keep the current per-request JWT verification. After verification, construct a request-local user client
that forwards only that request's original bearer JWT with `SUPABASE_ANON_KEY`. Never put the bearer in a
module singleton, shared client, logger, job payload, or service-role RPC argument. The Worker currently
has no Supabase client construction; `@supabase/supabase-js` is a dependency of `apps/web`, not
`apps/worker`. Either add the pinned client as a Worker dependency after confirming Worker compatibility,
or implement the small PostgREST request surface using Workers `fetch`, following the existing
`SupabaseRpcClient` URL, timeout, and redacted-error rules.

## 2. Inspected implementation and dependency map

The inventory below is derived from `apps/worker/src/db/repository.ts`, its complete interface and
`InMemoryRepository` class, all `repo.*` call sites under `apps/worker/src`, `apps/worker/src/lib/app.ts`,
`apps/worker/src/index.ts`, route and service implementations, current SQL migrations, RLS policy matrix,
JWT verifier, and the durable adapters added by the prior stage.

| Path | Current construction/use | Durable status |
|---|---|---|
| `apps/worker/src/index.ts` fetch | Calls `handleApiRequest(request, env)` without dependencies. | No repository or durable per-request dependencies are constructed. Deployment API paths fail closed. |
| `lib/app.ts` | Receives optional `AppDependencies`; local/test defaults include `InMemoryRepository`, in-memory idempotency, rate limit, OAuth state and token stores. | No repository implementation exists. Service-role RPC adapters are not selected here. |
| `index.ts` scheduled | Explicit local/test mock path constructs `InMemoryRepository` and `InMemoryTokenStore`, then uses `dispatchScheduledCronJobs`. Non-local execution is refused. | Durable queue dispatcher/store exist, but no durable domain repository/handler set is assembled. |
| `lib/jwt.ts` | Verifies asymmetric Supabase JWTs using JWKS; rejects HS256; returns `userId` and optional email. | The verified bearer itself is not passed to a database client because no user-scoped client exists. |
| `db/supabase-rpc.ts` | Minimal Workers-compatible service-role RPC transport. | Suitable only for narrow `service_role` RPCs; it is not a general RLS-preserving repository client. |
| `services/jobs/store.ts` | Calls `public.worker_*` queue/lease/usage RPCs with service role. | Durable queue adapter exists, not used by `index.ts`. |
| `services/tokens/supabase-store.ts` | Calls service-only RPCs for encrypted credentials and single-use OAuth state. | Durable adapters exist, not selected by the actual request constructor. |
| `lib/rate-limiter.ts` | `SupabaseRateLimiter` calls the atomic hashed-key rate-limit RPC. | Adapter exists, not selected by the actual request constructor. |
| `lib/idempotency.ts` | `InMemoryIdempotencyStore` holds response records in a process-local `Map`. | No database table or durable adapter exists. `app.ts` currently calls `get`, dispatches the route, then `set`. |
| `db/repository.ts` | `InMemoryRepository` is the only implementation of `Repository`. | No durable implementation. It mixes user-request, system/cron, and mock-only concerns. |

### Repository contract size and omissions

There are **75 methods total**: 74 required interface methods plus optional `listAllHouseholdIds`. The
contract has no `createHousehold` method even though the database has a one-time `private.bootstrap_first_admin`
function; household creation is bootstrap/operations work, not an ordinary repository operation in v1.
The interface combines authenticated reads/writes with server-only ingestion, command lifecycle,
provider-usage, retention, and global household enumeration. Split it before implementation so a request
route cannot receive a system capability by accident.

## 3. Authentication and authorization flow

```mermaid
sequenceDiagram
    participant C as Client
    participant W as Worker request
    participant J as JWT verifier
    participant U as User PostgREST client
    participant DB as Supabase PostgreSQL
    C->>W: API request + bearer JWT
    W->>J: Verify signature, exp, iss, sub, role
    J-->>W: Verified user ID + email
    W->>U: Create request-local client (anon key + same bearer)
    W->>DB: Query/RPC as authenticated
    DB->>DB: RLS, auth.uid(), constraints, triggers
    DB-->>W: Tenant-filtered result / fixed SQLSTATE
    W-->>C: API response; no JWT or service key returned
```

Required rules:

- Keep `VerifiedUser` and the PostgREST credential bound to the current request. If an async context or
  factory is used, scope it to one `handleApiRequest` call. Never cache an authenticated client by user ID.
- Authenticate before any database operation that can reveal a private resource. Resolve resources through
  the authenticated client so foreign household IDs are invisible to the caller; then preserve the existing
  404 behavior for cross-household requests.
- Keep the Worker role check as early error shaping/defence in depth, but the database RLS or authenticated
  RPC must independently enforce it. Never rely on `ACCESS_MIN_ROLE` alone.
- User-scoped RPCs use the request JWT, not the service-role key. Inside a SECURITY DEFINER function,
  `auth.uid()` still describes the invoking JWT when the request is authenticated. Use an empty
  `search_path`, fully qualified names, explicit execute grants, fixed error codes, and in-function role
  checks.
- Scheduled jobs have no user JWT. They use separate service-only functions and validate each claimed
  job's actual `household_id`, `site_id`, rule, or command against current database relationships before
  acting. A payload or a `p_household_id` parameter alone is not proof of ownership.
- The public Tesla OAuth callback is an exception to request JWT auth: state is single-use and bound to
  the initiating user/household. Before saving credentials, recheck the initiating user's current
  membership/required ADMIN role; initiation-time membership must not survive later revocation as
  authority. Never return credentials from callback storage.

### Access approach comparison

| Approach | RLS and `auth.uid()` | Tenant isolation and transaction | Runtime/error/audit implications | Recommendation |
|---|---|---|---|---|
| **A. Authenticated-user PostgREST with the validated JWT** | Preserves `authenticated`, RLS predicates, `private.is_member`, `private.has_role_at_least`, and `auth.uid()` in policy/function/trigger execution. | RLS filters reads and checks writes. Each PostgREST request is a database transaction; multiple HTTP requests are not one transaction. | Cloudflare Workers can make the required `fetch` calls. Error handling must map SQLSTATE/status to stable API errors without returning database text. Actor-stamping/audit triggers can derive the real user. | **Default for user reads and allowed single-row writes.** Preferred call path for existing authenticated SQL functions. |
| **B. Narrow SECURITY DEFINER function called with user JWT** | Function owner bypasses table RLS internally, but `auth.uid()` still identifies the authenticated caller. The function must check membership/role before any write. | One function call is one transaction; suitable for multi-table mutations, last-admin rules, idempotency plus mutation, and append-only event coupling. | Fetch/RPC is Worker-compatible. Use `search_path=''`, schema-qualified objects, fixed result shapes/errors, and grants only to `authenticated`; trigger actor attribution remains JWT-derived. | **Required for multi-row, special-privilege, or mutation-plus-idempotency work.** Do not route these through service-role wrappers. |
| **C. Direct service-role repository with actor ID supplied by application** | Bypasses RLS. `auth.uid()` is NULL without a user JWT; passing `actor_user_id` does not make it authenticated. | Every tenant predicate and role check must be recreated. A bug is a cross-tenant privilege escalation. Transactions still need SQL RPCs; multiple REST calls are separate transactions. | Worker-compatible, but the service key has broad power. Trigger actor columns become null/system unless a function deliberately writes them. Logging/error exposure impact is high. | **Reject for ordinary user API methods.** Reserve for documented system-only work. If a future privileged user operation is unavoidable, use one reviewed RPC that checks the asserted actor against membership/role and binds the business mutation; never generic table CRUD. |

### Public, authenticated, and privileged dependency sets

| Route/job kind | Dependencies to inject | Prohibited dependencies |
|---|---|---|
| Public health/static | No repository; health response only. | Service client, token store, user client. |
| Authenticated API | `UserRepository` created from that request's verified bearer; user ID/email; rate limiter; idempotency-capable mutation RPC access; Tesla client only where needed. | `SystemRepository`, service-role client, another request's client/JWT, direct token decryption capability unless the handler specifically needs token access. |
| Tesla OAuth initiation | Authenticated `UserRepository`/authenticated RPC, plus OAuth state writer that accepts only a user-authorized start request. | Raw service operations exposed to generic routes; browser-side token storage. |
| Tesla OAuth callback | Narrow OAuth consume/credential-save capability, encrypted `TokenStore`, Tesla client. State carries initiating user and household; function revalidates current role. | Generic `UserRepository` selected from a callback-supplied household; unbound token persistence. |
| Scheduled ingestion/automation/retention | `SystemRepository`, durable job store/executor, encrypted token store, locks, provider usage; all constructed from server bindings. | In-memory repository, synthetic household/site IDs, user JWT, unvalidated job payload scope. |

## 4. Repository method-by-method inventory

**Legend:** Actor/role is the HTTP actor enforced by the route plus database authority; `System` means the
trusted scheduler/service. `JWT` means authenticated-user PostgREST; `JWT RPC` means a narrow
SECURITY DEFINER function called with that user's JWT; `Service RPC` means a narrow service-role function;
`Pure` means derive from the Tesla capability registry, not database access. `T1` = one SQL statement
(including its triggers); `T2` = multiple related writes that must be one SQL transaction; `T3` = external
provider/Auth effect requiring durable outbox/saga; `R` = read-only statement/snapshot. Every `K` is an
operation-scoped key and request fingerprint integrated inside the same function transaction as the write;
it is never a separate middleware reservation. `Natural` refers to a schema unique constraint or stable
upsert key, not the HTTP response cache. Test shorthand is defined after the tables.

### 4.1 Identity, memberships, households, and settings

| Method | Calling service / route | Actor / role | Tables read or written | Existing RLS / SQL function | Txn / idempotency | Authenticated JWT safe? | Dedicated DB RPC required? | Required negative test |
|---|---|---|---|---|---|---|---|---|
| `getHouseholdMemberships` | `handleGetMe`, `GET /me` | Authenticated user; own memberships only | `household_members`, `households` | `household_members_select_self_or_admin`; `households_select_member` | R; no K | Yes, filter user to `auth.uid()` | No; join/select | X1 |
| `getHousehold` | `handleGetHousehold`, `GET /households/{hid}` | Member | `households` | `households_select_member` | R | Yes | No | X1 |
| `getMembership` | `app.ts` request authorization | Current actor; the lookup should be for `auth.uid()` only | `household_members`, optionally `user_profiles` | `household_members_select_self_or_admin`; profile self/shared-ADMIN policy | R | Yes; constrain actor to JWT subject | No | X1, X2 |
| `listMembers` | `handleListMembers`, `GET /households/{hid}/members` | ADMIN | `household_members`, `user_profiles` | Membership list is ADMIN-filtered; profiles visible to self or ADMIN in a household shared with that profile owner | R; stable keyset page | Yes | No; embedded/select query | X1, X2 |
| `updateMemberRole` | `handleChangeMemberRole`, `PATCH /households/{hid}/members/{userId}` | ADMIN; cannot change own role | `household_members`, `audit_log` via trigger | Existing `public.change_member_role`; `private.guard_membership` serializes last-admin changes; `private.audit_membership` | T2; K in same function if route key required | Yes, via existing RPC with user JWT | Yes, existing function; add idempotency-aware version | X1, X2, X3 |
| `createInvitation` | `handleCreateInvitation`, `POST /households/{hid}/invitations` | ADMIN | `household_invitations`, `audit_log` | Existing `public.create_invitation` checks `auth.uid()` and ADMIN; token hash only | T2; K required; idempotency result must not store raw invitation token/link | Yes, via existing function with user JWT | Yes, idempotency-aware authenticated function | X1, X2, X3, X6 |
| `listInvitations` | `handleListInvitations`, `GET /households/{hid}/invitations` | ADMIN | `household_invitations` | `household_invitations_select_admin`; column grant excludes `token_hash` | R; no K | Yes | No | X1, X6 |
| `revokeInvitation` | `handleRevokeInvitation`, `DELETE /households/{hid}/invitations/{id}` | ADMIN | `household_invitations`, `audit_log` | Existing `public.revoke_invitation` checks actor role and writes audit | T1/T2 one function; K recommended | Yes, existing function with user JWT | Yes, use idempotency-aware function | X1, X2, X3 |
| `acceptInvitation` | `handleAcceptInvitation`, `POST /invitations/accept` | Authenticated, not already member; verified Auth email if invite email-bound | `household_invitations`, `household_members`, `auth.users`, `audit_log` | Existing `public.accept_invitation` checks `auth.uid()`, confirmed email, expiry, use/revoke, and inviter authority | T2; K required for stable retry/result | Yes, existing function with user JWT | Yes, idempotency-aware function | X1, X2, X3, X6 |
| `getSettings` | `handleGetSettings`, `GET /households/{hid}/settings` | Member | `household_settings`, `provider_usage_daily` if usage displayed | `household_settings_select_member`, `provider_usage_daily_select_member` | R; one statement or consistent snapshot | Yes | No | X1 |
| `updateSettings` | `handleUpdateSettings`, `PATCH /households/{hid}/settings` | ADMIN | `household_settings`, `audit_log` via trigger | `household_settings_update_admin`; column grant excludes pause fields; `private.audit_settings_changed` | T1 if a single update; K/response in same transaction if HTTP mutation key required | Yes; direct update is RLS-protected | No for simple field patch; authenticated idempotency RPC if result replay is required | X1, X2, X3 |

### 4.2 Sites and Tesla-link state

| Method | Calling service / route | Actor / role | Tables read or written | Existing RLS / SQL function | Txn / idempotency | Authenticated JWT safe? | Dedicated DB RPC required? | Required negative test |
|---|---|---|---|---|---|---|---|---|
| `listSites` | `handleListSites`, `GET /households/{hid}/sites`; cron currently also uses it | Member for API; System for jobs | `energy_sites` | `energy_sites_select_member` | R; stable keyset page; service path must filter household | Yes for API; system variant separate | No for API; system query scoped by job household | X1, X4 |
| `getSite` | Site, telemetry, automation, and command routes/services | Member for API; System for jobs | `energy_sites` | `energy_sites_select_member` | R | Yes for API; system variant separate | No | X1, X4 |
| `getHouseholdIdForSite` | `app.ts` authorizer; ingestion/commands | Current user or System | `energy_sites` | `energy_sites_select_member` for user; service has no RLS | R; do not use a service lookup to disclose a foreign household | Yes for request; system variant separate | No | X1, X4 |
| `getProviderSiteId` | Live/history ingestion and command/provider calls | Member/System | `energy_sites` | `energy_sites_select_member` | R | Yes for API-owned flow; System variant separate | No | X1, X4 |
| `getSiteCapabilities` | `GET /sites/{siteId}/capabilities`; command executor | Member/System | Prefer Tesla capability registry plus `energy_sites.capabilities_snapshot` when site facts are persisted | RLS site read; current `InMemoryRepository` returns a hard-coded list; `evaluateSiteCapabilities` exists under Tesla provider | Pure calculation plus optional snapshot read | Yes for persisted snapshot; capability evaluation itself is pure | No; remove from persistence repository or make pure provider service | X1, X4, X7 |
| `createSite` | `handleCreateSite`, `POST /households/{hid}/sites` | ADMIN | `energy_sites`, possibly `audit_log` | `energy_sites_insert_admin`; unique `(provider, provider_site_id)` and composite `(id, household_id)` constraints | T1 for one row; K or natural upsert required; return existing only if same household/provider | Yes for a single insert under RLS | RPC recommended for idempotent provider-site upsert and audit | X1, X2, X4, X7 |
| `getTeslaLink` | `handleGetTeslaLink`, `GET /households/{hid}/provider/tesla` | Member | `tesla_credentials` | No authenticated grant/policy; `worker_get_tesla_credentials` is service-only and returns ciphertext | R; redact ciphertext, return status/scope/refresh metadata only | No direct table read; route needs a narrowly redacted member-safe RPC | Yes; add member-safe function that never returns ciphertext, or derive status in authorized API layer through a scoped RPC | X1, X5 |
| `setTeslaLink` | OAuth callback after token exchange/refresh | Initiating ADMIN/System callback; state-bound actor | `tesla_credentials`, optionally `energy_sites`, `audit_log` | Existing `worker_save_tesla_credentials` stores encrypted fields but is service-only; no repository link-state table | T2; update credential state and link status atomically; OAuth exchange itself is T3 | No direct user table access | Yes; OAuth-state-bound service function rechecks current initiating ADMIN and commits credential/link metadata | X1, X2, X5 |
| `disconnectTesla` | `handleDisconnectTesla`, `DELETE /households/{hid}/provider/tesla` | ADMIN | `tesla_credentials`, `energy_sites`, pending `oauth_states`, `audit_log` | `worker_delete_tesla_credentials` deletes credentials only; sites have `energy_sites_update_admin` for name/timezone only, system owns connection state | T2 plus token-store call; K; current token deletion and repo update are separate requests and can partially succeed | No direct user write for system-owned state | Yes; one authorized function/service transaction for credential delete + site disconnected + pending state invalidation + audit | X1, X2, X5 |

### 4.3 Tariffs and versions

| Method | Calling service / route | Actor / role | Tables read or written | Existing RLS / SQL function | Txn / idempotency | Authenticated JWT safe? | Dedicated DB RPC required? | Required negative test |
|---|---|---|---|---|---|---|---|---|
| `listTariffs` | `handleListTariffs`, `GET /households/{hid}/tariffs` | Member | `utility_tariffs` and child tariff tables as response shape requires | `utility_tariffs_select_member`; child `*_select_member` policies through parent | R; bounded/keyset; coherent snapshot for full nested tariff | Yes | No; query parent IDs only from authorized household | X1 |
| `getTariff` | `handleGetTariff`/validate/end/delete/price-points routes | Member | `utility_tariffs` and child rows | `utility_tariffs_select_member`, child RLS | R | Yes; do not fetch by service ID before authorization | No | X1 |
| `getHouseholdIdForTariff` | `app.ts` authorizer | Current user | `utility_tariffs` | `utility_tariffs_select_member` | R | Yes; foreign tariff must appear absent | No | X1 |
| `createTariff` | `handleCreateTariff`, `POST /households/{hid}/tariffs` | READ_WRITE or ADMIN | `utility_tariffs`, seasons, overrides, slots, levies, dynamic price points, audit/cost cache invalidation | Parent `utility_tariffs_*_writer`; child `tariff_*_writer`; exclusions and `private.audit_tariff_version` | T2; K and full child graph + result atomic; concurrent exclusion conflict maps to `OVERLAP` | No as several REST writes; parent-only direct insert is insufficient | Yes; authenticated function performs whole graph, household/site check, overlap mapping, idempotency, and cache invalidation | X1, X2, X3, X8 |
| `endTariff` | `handleEndTariff`, `PATCH /tariffs/{id}` | READ_WRITE or ADMIN | `utility_tariffs`, cost-rollup cache | Parent update policy and immutable-version trigger allow only `effective_to`/`name`; database effective range constraint | T1 plus dependent cache invalidation; K or exact set semantics | JWT direct conditional update is possible; add invalidation in same RPC | RPC recommended to atomically close date and invalidate derived costs | X1, X2, X3 |
| `deleteTariff` | `handleDeleteTariff`, `DELETE /tariffs/{id}` | READ_WRITE or ADMIN | `utility_tariffs`, children, `cost_rollups_daily` references | Parent delete policy; child delete cascades; cost tariff FK `ON DELETE SET NULL`; audit trigger | T2 for audit/cache semantics; K | JWT direct delete is role-protected, but app response/audit semantics need transaction | RPC recommended for idempotent result and cache invalidation | X1, X2, X3 |
| `putPricePoints` | `handlePutPricePoints`, `PUT /tariffs/{id}/price-points` | READ_WRITE or ADMIN | `tariff_price_points` | `tariff_price_points_*_writer` policies, parent role check, exclusion on interval overlap | T1 batch is atomic if one request; K; validation and replacement semantics must be defined | Yes if one bulk REST write and RLS; unsafe to split chunks | RPC recommended for exact batch validation/upsert/result; current in-memory method only returns count and does not store points | X1, X2, X3, X8 |

### 4.4 Automation

| Method | Calling service / route | Actor / role | Tables read or written | Existing RLS / SQL function | Txn / idempotency | Authenticated JWT safe? | Dedicated DB RPC required? | Required negative test |
|---|---|---|---|---|---|---|---|---|
| `listRules` | `handleListRules`, `GET /sites/{siteId}/automation/rules` | Member | `automation_rules` | `automation_rules_select_member` | R; site-scoped keyset page | Yes | No | X1, X4 |
| `getRule` | Rule routes/runner | Member/System | `automation_rules` | `automation_rules_select_member`; system variant service-scoped | R | Yes for request path | No | X1, X4 |
| `getHouseholdIdForRule` | `app.ts` authorizer | Current user | `automation_rules` joined to `energy_sites` | `automation_rules_select_member` | R; foreign rule hidden by RLS | Yes | No | X1, X4 |
| `createRule` | `handleCreateRule`, `POST /sites/{siteId}/automation/rules` | READ_WRITE or ADMIN; new rules DISABLED/DRY_RUN | `automation_rules`, audit | `automation_rules_insert_writer`; composite FK proves site/household relation | T1 for one row; K recommended; derive household from authorized site, do not trust a caller household | JWT direct insert is possible if one statement and RLS; audit/idempotency require trigger/RPC | RPC if idempotent response + actor audit are required; otherwise direct insert with same-transaction trigger | X1, X2, X4, X9 |
| `updateRule` | `handleUpdateRule`, `PATCH /rules/{ruleId}` | READ_WRITE or ADMIN; cannot directly set ACTIVE | `automation_rules` | Update policy only while not ACTIVE; column grant excludes `mode`; version column optimistic | T1; CAS `WHERE version=:expected`; K/version conflict | JWT direct conditional update safe for simple allowed columns | No for simple update; RPC if idempotency result/audit coupled | X1, X2, X4, X9 |
| `deleteRule` | `handleDeleteRule`, `DELETE /rules/{ruleId}` | READ_WRITE or ADMIN; ACTIVE rule cannot be deleted | `automation_rules` (cascades executions) | `automation_rules_delete_writer` requires non-ACTIVE; audit behavior must be explicit | T1 plus cascade; K | JWT direct delete is RLS-protected | RPC recommended for audited idempotent response | X1, X2, X4 |
| `setRuleMode` | activate/update rule mode route | RW for DISABLED/DRY_RUN; ADMIN for ACTIVE | `automation_rules`, `audit_log` | Existing `public.set_rule_mode`, derives `auth.uid()`, increments version and audits | T1; K same function | Yes via user JWT | Yes, existing function; add idempotency-aware version | X1, X2, X4 |
| `recordAutomationExecution` | `automation/runner.ts`, scheduled `evaluate_rules` handler | System; tenant/site from claimed job | `automation_executions`, optional command/outbox | Select policy only; unique `(rule_id, scheduled_slot)` and rule/site composite FK; service job wrapper needed | Natural unique slot prevents duplicate row; if ACTIVE `ACTED`, execution and command/outbox must be one T2 transaction | No; table writes are service-owned | Yes; service RPC validates job tenant, inserts once, atomically stages actions/outbox | X1, X4, X9 |
| `listAutomationExecutions` | `handleListExecutions`, `GET /sites/{siteId}/automation/executions` | Member | `automation_executions` | `automation_executions_select_member` via site household | R; keyset by evaluated time/id | Yes | No | X1, X4 |
| `getAutomationPaused` | command executor/automation runner | System or request context after member resolution | `household_settings` | `household_settings_select_member` for user; system job scope | R | Yes for API; system variant separate | No | X1 |
| `setAutomationPaused` | `handlePauseAutomation`/`handleResumeAutomation` | RW to pause; ADMIN to resume | `household_settings`, `audit_log` | Existing `public.set_automation_paused`, derives `auth.uid()` and audits | T1; K same function | Yes via user JWT | Yes; existing function, add idempotency result | X1, X2, X3 |
| `getSiteConfiguration` | command executor after provider readback | System/provider flow; site belongs to job/request household | No matching durable table; `energy_sites.capabilities_snapshot` stores capability facts, not all `SiteConfiguration` values | No policy/function for the in-memory map | R | No current durable table | Yes, after schema decision; or remove from repository and consume validated provider snapshot | X1, X4, X7 |
| `updateSiteConfiguration` | command executor after confirmed readback | System; command's site/household must match | No matching durable table; possibly new typed `site_control_settings` table | No RLS policy/function; current implementation is in-memory with permissive defaults | T1/T2 with command confirmation transaction and audit; K by command ID | No current durable persistence | Yes, schema addition plus service function bound to confirmed command/site | X1, X4, X7 |

### 4.5 Commands and external provider lifecycle

| Method | Calling service / route | Actor / role | Tables read or written | Existing RLS / SQL function | Txn / idempotency | Authenticated JWT safe? | Dedicated DB RPC required? | Required negative test |
|---|---|---|---|---|---|---|---|---|
| `getHouseholdIdForCommand` | `app.ts` authorizer for `/commands/{commandId}` | Current user | `device_command_log` | `device_command_log_select_member` | R; RLS must hide foreign command | Yes | No | X1, X4 |
| `recordCommandIntent` | `handleCreateCommand` → `executeDeviceCommand` | READ_WRITE/ADMIN user; for automation, System | `device_command_log`, initial `device_command_events`, `audit_log` | User insert policy only permits initial `USER/PENDING/RECORDED`; unique `(site_id,idempotency_key)`; command audit trigger; events are service-written | T2; unique site key is natural command idempotency, but key fingerprint must include operation, kind, site/household, actor, and canonical full params; initial event+intent atomic | User intent yes only if user JWT; automation intent needs System RPC | Yes; authenticated intent RPC for user and separate service RPC for automation; both insert initial event atomically | X1, X2, X4, X10 |
| `getCommand` | `handleGetCommand` | Member | `device_command_log` | `device_command_log_select_member` | R | Yes | No | X1, X4 |
| `getCommandById` | command detail route/automation route | Member after command household resolution | `device_command_log`, `device_command_events` | Both member select policies; events policy joins command household | R; return only joined rows within same site/household | Yes | No | X1, X4 |
| `getCommandWithEvents` | command executor/tests | Member/System | `device_command_log`, `device_command_events` | Member read policies; service reads for job | R; coherent snapshot preferred | Yes for API; separate system variant | No | X1, X4 |
| `updateCommand` | `services/commands/executor.ts` | System only after intent/provider result | `device_command_log`, `device_command_events`, `audit_log` as needed | Authenticated table grants exclude lifecycle columns; command log server-owned; events append-only | T2: state/phase/event/lease update must be atomic; external call is T3 | No | Yes; owner/state compare-and-swap service RPC, command/site/household validation | X1, X4, X10 |
| `recordCommandEvent` | `services/commands/executor.ts` | System only | `device_command_events` | Authenticated select only; no insert; append-only trigger; service has no UPDATE/DELETE/TRUNCATE | T2 with corresponding transition; idempotent event ID/transition ID needed | No | Yes; combine with transition RPC | X1, X4, X10 |
| `listCommands` | `handleListCommands`, `GET /sites/{siteId}/commands` | Member | `device_command_log` | `device_command_log_select_member` | R; bounded stable page | Yes | No | X1, X4 |

**Command/outbox requirement:** the database row is the durable intent, not proof the Tesla request was
sent. Insert intent and outbox/dispatch state in one transaction, then have a service worker claim it with
a bounded owner lease. Do not hold a database transaction during network I/O. Before the provider call,
persist `DISPATCHING`; after a timeout/crash, transition to `UNKNOWN` and reconcile/read back before any
possible retry. Tesla endpoint-level idempotency must not be assumed. A provider response body is never
stored or logged wholesale; persist allowlisted status/error codes and sanitized state only. Initial user
command intent remains user-authorized; subsequent lifecycle updates are system-only.

### 4.6 Telemetry, rollups, usage, and retention

| Method | Calling service / route | Actor / role | Tables read or written | Existing RLS / SQL function | Txn / idempotency | Authenticated JWT safe? | Dedicated DB RPC required? | Required negative test |
|---|---|---|---|---|---|---|---|---|
| `recordPowerSample` | `live-fetcher.ts` | System ingestion | `powerwall_metrics_log` | Member select only; inserts service-only; unique `(site_id,sampled_at)`, `source='TESLA'` | T1/batch; natural key is `(site,sampled_at)`; use deliberate upsert to preserve in-memory replace semantics | No | Service insert/upsert RPC or one bounded service PostgREST statement with validated site scope | X4, X5 |
| `getLatestPowerSample` | `handleGetLiveTelemetry`; command/runner | Member/System | `powerwall_metrics_log` | `powerwall_metrics_log_select_member` via site | R | Yes for API | No | X1, X4 |
| `queryPowerSamples` | `handleGetPower` | Member | `powerwall_metrics_log` | `powerwall_metrics_log_select_member` | R; `[from,to)`, max limit, stable `(sampled_at,id)` cursor | Yes | No | X1, X4 |
| `recordEnergyIntervals` | `historical-sync.ts` | System ingestion | `energy_intervals` | Member select only; writes service-only; primary key `(site_id, interval_start, resolution_seconds)` | One bounded batch transaction; natural conflict key; validate every row/source before upsert | No | Service batch RPC recommended for atomic validation and tenant/site proof | X4, X5 |
| `queryEnergyIntervals` | `handleGetEnergy`, rollup service | Member/System | `energy_intervals` | `energy_intervals_select_member` via site | R; `[from,to)`, bounded server query | Yes for API | No | X1, X4 |
| `getHourlyRollups` | telemetry/analytics service | Member | `telemetry_rollups_hourly` | `telemetry_rollups_hourly_select_member` | R; bounded range | Yes | No | X1, X4 |
| `saveHourlyRollups` | `rollups.ts` | System ingestion | `telemetry_rollups_hourly` | Member select; service write only; PK `(site_id,bucket_start)` | One bounded upsert batch; natural bucket key | No | Service batch RPC or scoped service statement | X4, X5 |
| `getDailyRollups` | telemetry/analytics service | Member | `telemetry_rollups_daily` | `telemetry_rollups_daily_select_member` | R; local-date/timezone semantics, bounded range | Yes | No | X1, X4 |
| `saveDailyRollups` | `rollups.ts` | System ingestion | `telemetry_rollups_daily` | Member select; service write only; PK `(site_id,local_date)` | One bounded upsert batch; natural site/local-date key | No | Service batch RPC or scoped service statement | X4, X5 |
| `getSyncState` | live/history ingestion | System | `telemetry_sync_state` | Member select only; system writes | R; `site_id + stream` | No user route required | No; SystemRepository read | X4, X5 |
| `updateSyncState` | live/history ingestion | System | `telemetry_sync_state` | Member select only; server write; PK `(site_id,stream)` | T1 upsert with merge/CAS semantics; retry-safe field set | No | Service upsert RPC | X4, X5 |
| `updateSiteConnectionState` | ingestion/credential lifecycle | System | `energy_sites` | Authenticated admin update allows only name/timezone; connection state is system-owned | T1; combine with sync/credential transitions when invariant spans rows | No | Service RPC scoped to exact site and household | X4, X5 |
| `recordProviderUsage` | `live-fetcher.ts`, `historical-sync.ts`, Tesla calls | System; household from validated site/job | `provider_usage_daily` | Member select only; existing `private.record_provider_call`, `public.worker_record_provider_call` | T1 atomic counter today, but not idempotent on retry and optional caller `date` is not represented in current wrapper | No | Extend service RPC with stable provider-call ID/event and explicit UTC day | X4, X5 |
| `getProviderUsage` | settings/budget/status consumers | Member or System | `provider_usage_daily` | `provider_usage_daily_select_member` | R; UTC day and category | Yes for member | No | X1 |
| `purgeOldMetricsLog` | retention job | System | `powerwall_metrics_log` (not energy intervals unless separately specified) | No authenticated delete; service role | T1 bounded delete/count; dry-run count must use same cutoff | No | Service RPC with batch limit, household/site guard, and audit/metrics | X4, X5 |
| `purgeOldScheduledJobs` | retention job | System | `scheduled_jobs` | Server-only, no authenticated grant; existing durable job functions manage lifecycle | T1 bounded cleanup of terminal jobs only; never delete queued/running rows | No | Existing system access but new bounded retention RPC recommended | X4, X5 |

### 4.7 Membership administration, audit, export, and account operations

| Method | Calling service / route | Actor / role | Tables read or written | Existing RLS / SQL function | Txn / idempotency | Authenticated JWT safe? | Dedicated DB RPC required? | Required negative test |
|---|---|---|---|---|---|---|---|---|
| `removeMember` | `handleRemoveMember`, `DELETE /households/{hid}/members/{userId}` | ADMIN; cannot remove self or last ADMIN | `household_members`, `audit_log` | Existing `public.remove_member`; membership guard + audit trigger | T2 logically one function; K same function | Yes, call existing RPC using user JWT | Yes, existing function; add idempotency-aware variant | X1, X2, X3 |
| `updateHousehold` | `handleUpdateHousehold`, `PATCH /households/{hid}` | ADMIN | `households`, `audit_log` | `households_update_admin`; no household audit trigger/function currently | T1 for fields, plus same-transaction user audit | Yes for update | RPC recommended to add actor-derived audit/idempotency atomically | X1, X2, X3 |
| `updateSite` | `handleUpdateSite`, `PATCH /sites/{siteId}` | ADMIN | `energy_sites`, `audit_log` | `energy_sites_update_admin` allows name/timezone only; no site audit trigger currently | T1 plus audit; current route does these as two calls | Yes for field update | RPC recommended for audit/idempotency atomically | X1, X2, X4 |
| `listAudit` | `handleListAudit`, `GET /households/{hid}/audit` | ADMIN | `audit_log` | `audit_log_select_admin` | R; filter/order/keyset and bounded max | Yes | No | X1, X2 |
| `recordAuditEvent` | `handleRemoveMember`, `handleUpdateSettings`, `handleUpdateHousehold`, `handleUpdateSite`, `handleLeaveHousehold`; possible System use | Do not expose generic user-supplied actor/action/metadata | `audit_log` | No authenticated INSERT grant; `private.touch_audit` is restricted; triggers own many actions | Must be in same transaction as mutation; no independent K | No | Replace with mutation-specific actor-derived audit trigger/RPC; retain a separate allowlisted system-only method if needed | X1, X2, X5, X11 |
| `exportHouseholdData` | `handleExportHousehold`, `GET /households/{hid}/export` | ADMIN | `households`, members/profiles, settings, sites, tariffs/children, rules, executions, safe recent audit; no credentials/tokens | RLS select policies; audit ADMIN policy; no export RPC | R; one consistent snapshot required for a multi-table export; no mutation idempotency | Yes through authenticated RPC or repeatable-read function | RPC recommended to return allowlisted snapshot under actor role; do not include token/ciphertext/provider payloads | X1, X2, X6 |
| `deleteHousehold` | `handleDeleteHousehold`, `DELETE /households/{hid}` | ADMIN plus exact name confirmation | Household and all cascade children/credentials/jobs; audit lifecycle | **No authenticated DELETE grant or delete function**; RLS docs mark deletion deferred (L-032), but route/method exist | T2 transaction and high-impact K; immutable final audit/archive policy needed | No direct authenticated delete | New authenticated RPC required; must match documented deletion retention/privacy and cascade semantics | X1, X2, X3, X6 |
| `exportMe` | `handleExportMe`, `GET /me/export` | Authenticated user; own profile and memberships only | `user_profiles`, `household_members`, `households` | `user_profiles` self policy; membership own-row policy; household member policy | R; consistent snapshot | Yes, constrain to `auth.uid()` rather than caller ID | RPC optional; authenticated query/join works | X1, X2, X6 |
| `deleteAccount` | `handleDeleteMe`, `DELETE /me` | Authenticated user only; never caller-selected other ID; last-admin/domain rules | `auth.users`, profile, memberships, OAuth states, `audit_log`, deletion request/outbox | RLS on app tables; existing Security Model S9 expects Auth Admin deletion, but no repository implementation or SQL RPC exists | T3: PostgreSQL and Supabase Auth Admin are separate systems; durable deletion request/outbox and retry-safe saga required | Database cleanup can be user-verified; Auth Admin call requires service privilege | Yes; user-authenticated request RPC validates self/last-admin and creates request, privileged worker performs Auth Admin delete/reconcile | X1, X2, X3, X5, X6 |
| `leaveHousehold` | `handleLeaveHousehold`, `DELETE /households/{householdId}/members/me` | Authenticated actor leaves self; last ADMIN guard | `household_members`, `audit_log` | Existing `public.leave_household`; guard and audit trigger | T1/T2 one function; K same function | Yes via user JWT | Yes, existing function; add idempotency-aware variant | X1, X2, X3 |
| `listAllHouseholdIds` (optional) | Current cron dispatcher only | System only; never API/user capability | `households`, perhaps joined eligible site/credential rows | No authenticated policy for enumeration; private/system functions | R; bounded page, no full unbounded enumeration | No | Replace with existing `public.worker_schedule_due_jobs` paging or a bounded eligible-household RPC | X1, X5 |

### Negative-test shorthand

- **X1 — cross-household:** a user in household A queries/changes every resource ID from household B; read is indistinguishable from missing (404/empty) and writes cause no row, audit, or side effect.
- **X2 — role/actor:** READ_ONLY cannot mutate; READ_WRITE cannot do ADMIN-only actions; actor cannot query/change another user's membership/profile through self-only methods; self-role change and last-ADMIN removal fail under concurrent calls.
- **X3 — duplicate/concurrent mutation:** two independent database connections submit the same key/body together; one business effect and one audit/outbox result; same key/different operation, tenant, actor, or body is isolated or conflicts.
- **X4 — site/tenant binding:** site, tariff, rule, command, telemetry, rollup, job, and household IDs must agree through FK/SQL checks; a site from B cannot be attached to A, including on service-role RPCs.
- **X5 — privileged-only:** authenticated/anon cannot read credentials/OAuth/job/rate-limit tables or call service functions; a service operation with mismatched job household/site fails closed.
- **X6 — privacy:** no token/ciphertext, other household data, unconfirmed email, raw provider response, or deleted user's personal data leaks through list/export/idempotency.
- **X7 — capability/configuration:** unknown capability/site configuration defaults safe; no hard-coded supported result or persisted control state can enable an unsupported/live command.
- **X8 — tariff integrity:** concurrent overlapping tariff/price intervals fail atomically; invalid child references, foreign site and update conflicts roll back the entire operation.
- **X9 — automation:** rule/site/household mismatch fails; duplicate `(rule, slot)` is one execution; ACTIVE/ACTED safety rules and outbox behavior survive a crash between evaluation and dispatch.
- **X10 — command lifecycle:** command key/body/kind mismatch conflicts; duplicate provider dispatch is prevented; worker crash after request produces UNKNOWN/reconcile, not blind resend; events and state transitions stay consistent.
- **X11 — audit provenance:** caller cannot choose another actor, system actor, action, target, or unapproved metadata; every mutation has exactly one accurate audit record in the same transaction.

## 5. Existing SQL functions, policies, and schema reuse

### Existing authenticated-user functions to reuse (with the caller's JWT)

- `public.create_invitation`, `public.accept_invitation`, `public.revoke_invitation` — invitation lifecycle;
- `public.change_member_role`, `public.remove_member`, `public.leave_household` — membership changes;
- `public.set_automation_paused`, `public.set_rule_mode` — role-checked automation controls;
- `private.is_member`, `private.has_role_at_least` — policy/function helpers only, not client-exposed endpoints;
- `private.bootstrap_first_admin` — one-time trusted bootstrap only, not a general household-create route.

These functions use `auth.uid()` and are granted to `authenticated`. A service-role-only caller has no
authenticated actor, so do not invoke them with `SUPABASE_SECRET_KEY` and hope an actor parameter will
substitute for the JWT.

### Existing service-only functions/adapters to reuse for SystemRepository

`private.claim_jobs`, `private.acquire_lock`, `private.release_lock`, `private.record_provider_call` and
their public service-only `worker_*` wrappers; `worker_enqueue_job`, `worker_schedule_due_jobs`,
`worker_claim_jobs`, `worker_finish_job`, `worker_fail_job`, `worker_acquire_lock`,
`worker_release_lock`, `worker_record_provider_call`; encrypted Tesla credential RPCs; single-use OAuth
state RPCs; and `worker_check_rate_limit`. These are not general repository methods and do not authorize
user household operations. `worker_schedule_due_jobs` should replace global `listAllHouseholdIds` in the
durable scheduler.

### Existing constraints/policies to preserve

- Every exposed table has RLS; anon has no table/function authority. `service_role` bypasses RLS and has
  explicit exceptions only; append-only audit/command-event protections remain.
- Household member policies expose the caller's own role, with ADMIN member-list visibility. The latest
  profile policy allows self and ADMINs in a household shared with the profile owner.
- Site and child table composite FKs enforce `(site_id, household_id)` agreement. Tariff child policies
  authorize via the parent tariff. Automation and command records have composite site relationships.
- User-readable data policies use the membership role helper. Telemetry, rollups, sync state, credentials,
  OAuth state, job tables, locks, and rate-limit storage have the existing member/service distinctions.
- `private.guard_membership` protects last ADMIN and serializes membership changes. `private.audit_membership`,
  `private.audit_settings_changed`, tariff/command audit triggers, and `private.stamp_actor` are authoritative
  audit mechanisms when requests preserve user JWT context.
- Command unique key `(site_id,idempotency_key)`, automation unique slot `(rule_id,scheduled_slot)`, telemetry
  keys, and job `dedupe_key` are useful business-level deduplication barriers. They do not replace response
  idempotency for unrelated operations.

No existing table stores the full `SiteConfiguration` object used by the in-memory command code. Decide on
a typed `site_control_settings` table (composite site/household FK, RLS, safe defaults, ADMIN/RW policy)
or remove that persistence responsibility from `Repository`. Do not silently put control state into an
unvalidated JSON snapshot. The existing `energy_sites.capabilities_snapshot` is for discovered capability
facts, not desired control settings.

## 6. Durable business idempotency

### Scope and fingerprint

For each user mutation, compute the canonical request fingerprint after shared Zod parsing and before any
side effect. Include normalized method/operation, path resource, household (if any), site (if any), operation
type, and full canonical nested request body. Scope a key by `(auth.uid(), household_id nullable, operation,
key_hash)`; never key only by user ID. Hash the presented key before persistence. Do not store raw bearer,
raw idempotency key, invitation token, OAuth token, encryption data, or raw provider payload.

Same scope/key and same fingerprint returns the prior stable result. Same scope/key with a different
fingerprint returns 409. A different household, actor, or operation has a different scope. Authenticate and
authorize the caller **before** replaying any result.

### Transactional function protocol

Add a server-only `api_idempotency_records` table with actor ID, nullable household ID, operation enum/text,
32-byte key hash, 32-byte request hash, safe result reference/JSON, status, and bounded expiry. Add a unique
constraint that treats NULL household scope as equal (PostgreSQL `UNIQUE NULLS NOT DISTINCT`, or equivalent
unique index). RLS on, no direct grants to anon/authenticated; clients only use narrowly granted functions.

Each mutation RPC must, in the **same PostgreSQL transaction**:

1. derive actor from `auth.uid()` (or for SystemRepository validate the claimed job's owner/scope);
2. authorize the exact household/site/operation;
3. acquire/lock the scoped key and compare fingerprint;
4. if completed, return the stable prior result; if mismatched, return conflict;
5. perform the business mutation, audit write, and any outbox insertion;
6. store a safe replay result/reference and complete the idempotency row;
7. commit all of the above together.

Use a transaction-level advisory lock or a unique-key insert followed by a row lock; a concurrent duplicate
must wait for the first transaction. If the first transaction aborts, both the mutation and idempotency row
roll back and the waiting transaction may perform the mutation. There must be no externally visible
committed `IN_PROGRESS` reservation that can be abandoned between HTTP requests.

Completed records can expire after a documented retention period and be removed in bounded batches. The
cleanup job must never delete a pending external command/outbox or the command's natural unique key. Reuse
after expiry has explicitly defined semantics. Keep command-site uniqueness and rule-slot uniqueness as
long-lived domain deduplication even after HTTP response records expire.

Invitation creation is a special case: first response may return the generated 256-bit token, but the
persisted idempotency result must contain only the safe invitation DTO with `token=null` and `link=null`.
On a duplicate, return that safe result; never persist the one-time raw token just to replay it.

### Mutation-by-mutation scope and crash behavior

| Mutation | Key scope / fingerprint | Atomic DB work | Duplicate/concurrent/crash behavior |
|---|---|---|---|
| Create/revoke invitation; accept invite | actor + household (accept resolves household from token under row lock) + operation + key; hash normalized invite attributes/token digest without storing raw token | invite row and status, membership insert, trigger audit, and safe idempotency result in one authenticated RPC | one invitation/acceptance; concurrent accept serializes on invite; rollback leaves invitation reusable; replay never returns raw token again |
| Member role/remove/leave | actor + household + operation + target + desired role | role/delete, last-admin guard/advisory lock, trigger audit, idem result | one effect and one audit; same key replays; competing admin changes serialize; new key still cannot violate last-admin |
| Household/settings/site changes | actor + household/site + operation + canonical patch + expected version where applicable | row update, audit, cache invalidation/result | same key replays; another key with same desired-state patch is harmless or version-conflicts; no audit duplication |
| Create site | actor + household + provider + provider site ID + normalized name/timezone | validated unique provider/site insert/upsert, audit, safe result | same provider site in same household returns same site; foreign-household provider-site collision conflicts; no duplicate site |
| Create/end/delete tariff and price-point replace | actor + household + tariff key/version + operation + full canonical parent/children | full parent/child graph, exclusion checks, audit, cost-cache invalidation | overlapping concurrent tariffs/price points fail atomically; same key replays; no partial child graph |
| Create/update/delete rule and mode | actor + household/site + rule ID or client key + expected version + full rule/mode | rule mutation, actor audit, version increment, result | same key one rule version; stale version conflicts; ACTIVE role rule remains ADMIN-only |
| User command intent | actor + household + site + `createCommand` + command kind + full canonical params | command row, initial event, audit, command dispatch outbox, result reference | one command ID. Replays return same command. Provider work proceeds asynchronously; a crash after DB commit leaves durable outbox to recover. |
| Automation execution/action | system job/household/site + rule + scheduled slot + action index | execution row + generated command intent/outbox in one service transaction | existing unique `(rule,slot)` plus stable action index prevents duplicates; crash before commit rolls back both, crash after commit resumes outbox |
| Pause/resume | actor + household + desired pause state + operation | settings state, audit, safe result | no duplicate audit on no-op; existing auth function retained with idempotency-aware response |
| Command lifecycle/reconciliation | command ID + transition/event ID; provider call attempt ID | state CAS, lease/attempt, event append, provider-call accounting/result | transition retries replay; external calls are not in DB transaction; timeout/crash becomes UNKNOWN/reconcile, never blind repeat |
| Telemetry batch and rollup | system + site + stream or unique sample/interval/bucket key | bounded insert/upsert batch and sync cursor update where coordinated | unique natural keys suppress duplicate ingestion; batch rollback is all-or-nothing; cursor moves only with successful data writes |
| Provider usage | stable provider-call/event ID + household + category + UTC day | unique usage event plus atomic daily counter | retry of usage recording does not double count; current counter-only RPC needs an event ID extension |
| Account deletion | actor=self + deletion request ID + fingerprint | DB tombstone/outbox and permitted membership cleanup; external Auth Admin deletion is a separate idempotent saga | repeated request observes same pending/completed deletion; worker retries Auth Admin safely and reconciles “already absent”; no false 204 before completion |

### External effects and outbox

Database idempotency cannot include a Tesla HTTP request or Supabase Auth Admin API in a PostgreSQL
transaction. Store an outbox/command state transition in the same transaction as user mutation. A worker
claims it with a bounded lease, performs the external call once, stores only sanitized outcome, and reconciles
uncertain outcomes. A lease expiry alone does not prove that the provider did not act. Do not automatically
repeat a non-idempotent Tesla command after an ambiguous timeout. The account deletion saga similarly reports
pending until Auth Admin completion is confirmed and its result is persisted/reconciled.

## 7. Known current defects/inconsistencies to correct during implementation

1. **HTTP idempotency leaks across operation/household and replays before authorization.** `app.ts` scopes
   records only to `user?.userId`, performs `get()` before household membership/role resolution, and does
   not include route/method/tenant in the scope. A same-user same-key/body request can receive a cached
   response from another route/household or after permissions change. Move replay behind authentication,
   resource resolution, and authorization; use the composite scope above.
2. **Command fingerprint omits command operation.** `executeDeviceCommand` hashes `request.params` only;
   the same site/key and same params for a different `kind` may be treated as a replay. Its current
   `JSON.stringify(params, Object.keys(root).sort())` is not a robust recursive canonicalizer. Fingerprint
   operation, kind, site/household, actor, and all recursively canonicalized params.
3. **Audit duplication and spoofable generic audit.** Existing SQL membership/settings triggers/functions
   audit role changes, invitations, pause, and household settings. `handleRemoveMember`, `handleLeaveHousehold`,
   and `handleUpdateSettings` then separately call `recordAuditEvent`, causing duplicate audit rows if the
   durable repository uses the existing SQL functions/triggers. `recordAuditEvent` accepts actor/action/
   metadata fields but audit has no authenticated INSERT grant; a service implementation could forge actor
   attribution. Replace user audit calls with mutation-owned trigger/function audit; keep system audit as a
   separate allowlisted service operation.
4. **Delete household contradicts current database contract.** `handleDeleteHousehold`/`deleteHousehold`
   exist, but `households` has no authenticated DELETE grant or SQL delete function; the RLS matrix says
   deletion is deferred (L-032). Must not report success until an explicitly approved audited RPC and
   cascade/privacy contract exist.
5. **Account deletion is incomplete and semantics conflict.** In-memory `deleteAccount` only removes
   membership map entries; it does not delete `auth.users` or profiles. Security Model S9 expects Auth
   Admin deletion. Its last-admin rule differs from `private.guard_membership`, which blocks removal of
   any final admin while the household exists. Define transfer/delete-household behavior and an Auth Admin
   saga before implementing; do not return 204 on only membership removal.
6. **In-memory invitation and membership rules are weaker than SQL.** `createInvitation` ignores its
   caller ID; `acceptInvitation` does not require a confirmed matching Auth email or recheck inviter ADMIN
   status for elevated roles; `updateMemberRole`/`removeMember` last-admin counts have no database
   serialization. Only SQL functions/triggers are authoritative.
7. **In-memory tariff/site/control behavior diverges from schema.** `createTariff` only stores the parent
   in its in-memory map; `putPricePoints` returns a count without persisting; `endTariff` does not apply
   database validation; `createSite` may reuse a UUID-shaped provider ID as the database ID, although
   `energy_sites.id` and `provider_site_id` are separate identifiers; `getSiteCapabilities` returns a
   hard-coded list; `getSettings` reports literal zero spend and default control values; and site control
   configuration is process-local with permissive defaults and no matching table.
8. **Telemetry semantics need explicit upsert/cursor design.** In-memory `recordPowerSample` replaces a
   duplicate timestamp, while current SQL unique constraint rejects a duplicate insert. Define an upsert
   policy that cannot silently replace conflicting provider data. `updateSyncState` must commit its cursor
   only with the corresponding data batch, or a crash can skip missing intervals.
9. **Provider usage and OAuth lifecycle need retry/authorization closure.** The current usage counter has
   no provider-call event ID, so retrying a counter RPC overcounts. OAuth-state save is service-role scoped
   and checks membership at start, but callback must revalidate current required role before credential
   save. Credential deletion and site disconnect currently happen as separate calls.

## 8. Database changes and RPC plan

Reuse existing tables and functions whenever they satisfy the transaction and actor requirements. Add
forward-only migrations only for the gaps below; never edit the existing migrations.

### Required new schema

1. **`api_idempotency_records`**: actor, nullable household, operation, SHA-256 key/request hashes, safe
   result reference/JSON, created/expiry. Unique scoped key; RLS on, no direct API table grant; bounded
   cleanup for completed rows only.
2. **Site control settings**: a typed site-scoped settings table if `SiteConfiguration` remains a durable
   responsibility. Include household binding/composite FK, validated enums/ranges, safe defaults, and
   policies. Keep observed capability snapshot separate from desired controls.
3. **Command outbox/lease**: either add reviewed dispatch lease/attempt/outcome columns to
   `device_command_log` or add a dedicated outbox with FK, unique command/action id, owner lease, attempt
   and sanitized state. Preserve command events as append-only. Do not use an in-memory dispatch marker.
4. **Provider-call events**: unique request/call ID associated with household/category/day and an atomic
   counter increment, so retries do not double count.
5. **Account-deletion requests/outbox**: server-only durable state for the cross-system Auth Admin saga,
   with no retained user content, retry status, actor self-binding, and defined audit retention. FK behavior
   must preserve a minimal deletion audit without retaining unnecessary PII.

### Required authenticated RPCs

Use a new versioned name or reviewed replacement function in a forward migration, with JWT-derived actor
checks and idempotency inside the transaction:

- mutation-aware invitation create/revoke/accept and member role/remove/leave;
- site create/upsert, disconnect/link metadata, and audited household/site changes;
- full tariff graph creation and price-point batch replacement; end/delete with cost-cache invalidation;
- any rule mutation that needs coupled response/audit/idempotency; retain `set_rule_mode` role semantics;
- user command-intent insert plus initial event/outbox plus result reference;
- delete-household only after the policy decision and retention contract are settled;
- authenticated account-deletion request (self only), not direct Auth Admin deletion.

Simple profile read, household/site read, settings patch, tariff/rule single-row read, and member-visible
telemetry read should remain direct RLS-filtered selects. Simple one-row writes can remain authenticated
PostgREST writes only where grants, RLS, triggers, and retry semantics are adequate.

### Required service-only RPCs

- Claim/transition command outbox state with compare-and-swap/owner checks; sanitize outcome and append event
  atomically.
- Revalidate job household/site/rule/command relationships on every execution operation.
- Ingest bounded telemetry/rollup batches and update sync cursors transactionally.
- Record provider usage once per call ID; run bounded retention; derive provider-link metadata and disconnect
  credential/site state consistently.
- Retry Auth Admin account deletion from a server-only outbox and record completion/reconciliation.

Existing `public.worker_*` functions stay service-role only and do not get broadened to `authenticated`.

## 9. Implementation sequence

| Phase | Scope | Deliverable and stop gate |
|---|---|---|
| 0. Contract split and decisions | Split `Repository` into `UserRepository` and `SystemRepository`; remove or relocate `listAllHouseholdIds`, `getSiteCapabilities` (pure), and site configuration if schema decision is unresolved. Correct command fingerprint and audit call ownership. | Type-only contract review; no runtime enablement. Settle site control config, household deletion, account deletion, and idempotency expiry semantics. |
| 1. Request-scoped authenticated DB context | Construct user PostgREST client only after JWT verification using public key + that bearer; add safe error mapping and request-local tests. | Assert per-request JWT isolation, no service key on user path, `auth.uid()` matches verified `sub`. |
| 2. Read-only identity/site/telemetry/tariff/rule/command/audit | Implement bounded selects, stable keyset cursors, embedded/join serialization. Use RLS. | Cross-household 404/no-row suite for every resource ID family, including altered IDs and cursor values. |
| 3. Simple authenticated single-row writes | Settings, household/site fields, simple rule updates with expected version; ensure audit triggers and column-level grants. | Role matrix and stale-version tests; exactly one audit event; all values constrained. |
| 4. Identity/membership/invitation transactions | Reuse existing authenticated RPCs, add idempotency-aware variants, preserve last-admin/verified-email behavior. | Two-connection invite acceptance, role/demotion races, actor and audit attribution, safe replay tests. |
| 5. Site/Tesla lifecycle | Add idempotent site upsert, admin/household checks, OAuth current-role recheck, credential/link atomic update and disconnect. | Site foreign-household collision; revoked initiator callback rejection; no credential leakage. |
| 6. Tariff versions and child sets | Transactional create/end/delete/price point operations; FK/overlap constraints; cache invalidation. | Concurrent overlapping requests; all-or-nothing child writes; foreign site/child rejection. |
| 7. Automation and command outbox | Natural execution-slot idempotency; atomic execution/action outbox; user intent RPC; service state transitions/leases; ambiguous provider recovery. | Duplicate cron/HTTP requests, crash at every transition boundary, no blind duplicate Tesla command. Keep controls disabled/mock pending provider verification. |
| 8. System telemetry, usage, and retention | Service-only bounded operations; idempotent provider event; site/household job validation; sync cursor atomicity. | Worker crash/retry, duplicate ingest, invalid job tenant/site, retention bound tests. |
| 9. Exports, household deletion, account deletion | Consistent snapshot exports; policy-approved household deletion; self-only Auth Admin saga; last-admin final-state rules. | Export isolation/privacy, cascade and append-only audit checks, Auth API retry/reconcile tests. |
| 10. Runtime construction and activation review | Request factory injects UserRepository and user JWT-bound RPC; scheduled factory injects SystemRepository and service adapters. Remove all deployment defaults. | Staging-like tests must pass before enabling API. Cron remains disabled until all required job handlers use SystemRepository. Owner review required for auth, RLS, controls, Auth Admin, and migration. |

Do not implement phases by routing every method through one unrestricted generic RPC. Keep methods typed,
bounded, and mapped to the narrow policy/function that owns their data.

## 10. Test strategy

### Local PostgreSQL / Worker tests

- Extend `npm run db:test` with user-JWT/role setup for every new authenticated function, execute grants,
  RLS behavior, `auth.uid()` actor stamping, idempotency table denial, function search paths, and SQLSTATE
  mapping. The current throwaway PostgreSQL test shim is not real Supabase Auth; use the same role/claim
  shim carefully and state its limits.
- Use two independent PostgreSQL connections for same-key concurrent calls, different-body collision,
  simultaneous last-admin changes, tariff exclusions, invitation single-use, rule-slot execution, command
  intent, and provider-usage event deduplication.
- Worker tests must instantiate the actual request dependency factory with two different JWTs concurrently
  and prove headers never cross. Test invalid/expired JWTs cannot instantiate a user repository; unauthenticated
  requests cannot reach privileged repository methods.
- Inject a crash after every command/outbox stage: before commit, after DB commit/before response, before
  provider call, after provider acceptance/before response persistence, and during reconciliation. Assert
  no duplicate external call under an ambiguous outcome.
- Test adapter limits, stable cursor pages, upper limits, SQL error translation, timeout behavior, canceled
  request handling, no response-body leakage, and no secret/token logging.
- Run migration idempotency from empty and existing schema; enforce RLS policy matrix; no hosted database
  access is needed for these checks.

### Requires real Supabase staging (not covered by local SQL shim)

- Sign-in-issued JWT signature/key rotation, actual Supabase PostgREST role selection, `auth.uid()` inside
  authenticated SECURITY DEFINER RPCs, RLS on real Auth schema, email-confirmed invitation acceptance, and
  real execute grants.
- Auth Admin deletion endpoint permissions and “already absent” retry semantics.
- Cloudflare Worker binding/secrets isolation, separate isolates/concurrent requests, actual Worker fetch
  networking/timeouts, Cron Trigger delivery overlap, and any Durable Object/Rate Limiting binding if later
  selected.
- A staging deployment/verification needs explicit owner authorization in a later task. It is out of scope
  here; do not use production credentials or hardware.

## 11. Security risks and mitigations

| Risk | Mitigation/design control |
|---|---|
| Service role bypasses every RLS policy | Keep system client separate and non-injectable into routes; allowlist cases; service RPCs verify DB relationships and bounded scope. |
| Stale/cross-request JWT context | Build one authenticated client per request from the verified bearer; no module singleton, mutable global header, or client cache by user ID. |
| Caller-supplied household/site/actor IDs | Resolve through user RLS for HTTP; functions derive actor from `auth.uid()` and compare site/household with database rows; job functions validate claimed rows. |
| Idempotency replay before authorization / key scope collision | Authenticate, resolve resource, and authorize first; scope by actor + tenant + operation; same DB transaction as mutation. |
| Provider timeout causes duplicate actuation | Durable command outbox, explicit UNKNOWN state and read-back reconciliation; never resend ambiguous non-idempotent controls. Controls remain off until verified. |
| Duplicate/missing audit actor | User writes run with user JWT; `auth.uid()` stamping; audit trigger in same transaction. System events use a fixed SYSTEM actor. Remove generic user-supplied audit writer. |
| Invitation token or Tesla/OAuth secret persisted in replay/log | Invitation table stores hash; replay record stores safe DTO only; tokens encrypted in existing credential table; OAuth state verifier encrypted and state hashed; sanitized errors/log allowlist. |
| Export or account deletion crosses household boundary | User-scoped consistent snapshot; actor self-binding for `/me`; Auth Admin only after self verification; deletion saga and cascade tests. |
| Pagination leaks/omits records or permits query amplification | Stable composite keyset cursors, bounded max page/range, household filter in same query. |
| In-memory mock semantics differ from DB | Make database semantics authoritative; shared contract tests run against both; keep mocks explicit and label their limitations. |

## 12. Outstanding architectural decisions

1. Is `site_control_settings` the durable home for desired site-level control configuration, or should the
   current `SiteConfiguration` repository methods be removed? It must not share the provider-observed
   `capabilities_snapshot` field.
2. What is the approved household-deletion policy and retention for append-only audit rows? Current schema
   permits no API deletion.
3. Does account deletion allow a last/sole household ADMIN to delete their account by deleting the empty
   household, transferring administration, or refusing until transfer? Current in-memory and SQL trigger
   semantics differ.
4. Which mutation routes will require `Idempotency-Key`? Recommended: every non-read HTTP mutation; if a
   simple desired-state update instead uses optimistic concurrency, document that route-specific contract.
5. What is the completed idempotency record retention period and what is the stable replay shape for each
   response? Invitation raw tokens must never be replayed/stored.
6. Does deployment add `@supabase/supabase-js` to the Worker or use a typed fetch-based PostgREST client?
   Both approaches must forward request-local JWTs and work in the pinned Cloudflare Workers runtime.
7. How are Tesla provider-call IDs assigned when calls are retried after network ambiguity? Usage counts
   and command records must not overcount or resend.
8. What exact locally supported `auth.uid()` claim shim is sufficient for migration tests, and which
   semantics are reserved for hosted staging verification?

## 13. Files inspected

- `apps/worker/src/db/repository.ts`, `apps/worker/src/db/supabase-rpc.ts`;
- `apps/worker/src/index.ts`, `apps/worker/src/lib/app.ts`, `apps/worker/src/lib/jwt.ts`,
  `apps/worker/src/env.ts`, `apps/worker/src/lib/idempotency.ts`, `apps/worker/src/lib/rate-limiter.ts`;
- `apps/worker/src/routes/{identity,sites,tesla,tariffs,automation,telemetry,admin}.ts` and route contract
  `packages/shared/src/schemas/routes.ts`;
- `apps/worker/src/services/{commands/executor.ts,commands/types.ts,automation/runner.ts,ingestion/dispatcher.ts,ingestion/live-fetcher.ts,ingestion/historical-sync.ts,ingestion/rollups.ts,ingestion/retention.ts,jobs/store.ts,jobs/executor.ts,tokens/supabase-store.ts}`;
- `apps/worker/src/providers/tesla/{oauth.ts,capabilities.ts}`;
- migrations for identity/site/telemetry/tariff/command/job schema, `20261023130200_identity_and_membership_functions.sql`,
  `20261023130300_rls_policies_and_grants.sql`, profile hardening, job function hardening, and durable Worker wrappers;
- `docs/SECURITY_MODEL.md`, `docs/RLS_POLICY_MATRIX.md`, `docs/DATABASE_DESIGN.md`,
  `docs/DURABLE_RUNTIME_STAGE1_AUDIT.md`, `docs/DURABLE_JOB_PROCESSING.md`;
- `apps/web/package.json` and `apps/worker/package.json` to establish current Supabase SDK dependency placement.

No source implementation or migration was changed as part of this design task.
