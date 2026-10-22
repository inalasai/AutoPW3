# API Contract (TASK-01)

Status: **PROPOSED, awaiting owner approval.** Written 2026-10-22. Implemented in `apps/worker` (TASK-14 onward); request/response schemas are Zod schemas in `packages/shared` (TASK-05). Roles, signs and units are defined once in `SECURITY_MODEL.md` §2 and `ENERGY_ACCOUNTING.md` §2; this file does not redefine them. Service-access codes S1 to S9 are defined in `SECURITY_MODEL.md` §6.

## 1. Conventions

- Base path `/api/v1`, JSON only (`application/json; charset=utf-8`), UTF-8. Served by the same Worker as the SPA (`SYSTEM_ARCHITECTURE.md` §3). CORS allowlist only for local dev and preview origins.
- **Auth:** `Authorization: Bearer <Supabase access token>` on every route except those marked *public*. The Worker verifies the JWT (D-009) and loads the caller's membership from the database. Role, household and site ids in bodies, query strings or headers are never trusted for authorisation; path ids only select the resource to check.
- **Authorisation outcomes:** missing/invalid/expired token → **401**. Authenticated but not a member of the resource's household (or resource does not exist) → **404** (no existence leak). Member with insufficient role → **403**. The same rule applies to every route, enforced by shared middleware.
- **Request id:** every response has `X-Request-Id`; also in error bodies and audit rows.
- **Error envelope** (all non-2xx):
  ```json
  { "error": { "code": "FORBIDDEN", "message": "Human-readable, no internals", "requestId": "…", "details": [ { "path": "role", "issue": "invalid_enum" } ] } }
  ```
  `details` appears only for `422` and lists field paths and issue codes, never submitted secrets. Codes: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `PAYLOAD_TOO_LARGE` 413, `VALIDATION_FAILED` 422, `RATE_LIMITED` 429 (with `Retry-After`), `NOT_IMPLEMENTED` 501, `PROVIDER_UNAVAILABLE` 502/503, `BUDGET_EXHAUSTED` 429/503 (read routes degrade to cached data instead, see §3), `INTERNAL` 500.
- **Body limit:** 64 KiB by default; 1 MiB on the dynamic-price upload route. Larger → 413.
- **Pagination:** `limit` (default 50, max 200) and opaque `cursor`; responses `{ "items": [...], "nextCursor": string|null }`. Caps are enforced server-side.
- **Time:** all instants are ISO-8601 UTC strings (`2026-10-22T10:00:00Z`). Ranges are half-open `[from, to)`. Local dates are `YYYY-MM-DD` in the site/tariff timezone. Requests with `to <= from` → 422. Maximum range per resolution: snapshots 7 days, `interval` 31 days, `hourly` 92 days, `daily` 1,100 days.
- **Numbers:** power in W, energy in Wh, percentages 0 to 100 as JSON numbers with unit-suffixed names. **Money, rates and any exact decimal are JSON strings** (`"0.317500"`) with an adjacent `currency`. Missing data is `null`, never `0`.
- **Idempotency:** `Idempotency-Key` (8 to 128 chars `[A-Za-z0-9_-]`) is **required** on `POST …/commands` and `POST …/invitations`, optional on other creating POSTs. Same key + same canonical body → original response replayed (`Idempotent-Replay: true`); same key + different body → **409**.
- **Source and freshness:** any reading carries `source` (`TESLA` or `DEMO`), `sampledAt`, `receivedAt`, `ageSeconds`, `quality`, `freshness` (`FRESH | STALE | UNAVAILABLE`). `DEMO` responses only come from `/demo/*` routes.
- **Never returned:** Tesla tokens, client secret, encryption material, password hashes, raw provider payloads, other households' data.
- **Versioning:** breaking changes require `/api/v2`; additive fields are allowed.

## 2. Endpoints

Min role: `any` = any authenticated user, `member` = READ_ONLY or higher, `RW` = READ_WRITE or higher, `ADMIN`. "DB" = enforced again by RLS or a database function. "Task" = the task that implements it (stubs return `501 NOT_IMPLEMENTED` before then).

### 2.1 Platform and identity

| Method | Path | Min role | Notes | Task |
|---|---|---|---|---|
| GET | `/health` | public | `{ "status": "ok" }` only; no config, versions or secrets | 14 |
| GET | `/me` | any | Profile and memberships `[ { householdId, name, role } ]`; empty array for new users | 14 |
| DELETE | `/me/memberships/{householdId}` | any | Leave a household; **409** if last ADMIN; DB | 19 |
| POST | `/me/export` | any | JSON export of the caller's profile and memberships; audited | 19 |
| DELETE | `/me` | any | Delete account after confirmation; uses S9 (auth admin deletion); blocked while sole ADMIN of a household with other members | 19 |

### 2.2 Households, members, invitations, settings

| Method | Path | Min role | Notes | Task |
|---|---|---|---|---|
| GET | `/households/{hid}` | member | Name, timezone | 14 |
| PATCH | `/households/{hid}` | ADMIN | `name`, `timezone` (IANA, validated) | 19 |
| GET | `/households/{hid}/members` | ADMIN | Members of this household only; `{ userId, displayName, role, createdAt }` | 14/19 |
| PATCH | `/households/{hid}/members/{userId}` | ADMIN | `{ role }`; **403** if `userId` = caller; **409** if demotes last ADMIN; DB function; audited | 14/19 |
| DELETE | `/households/{hid}/members/{userId}` | ADMIN | **403** for self (use leave); **409** last ADMIN; audited | 19 |
| POST | `/households/{hid}/invitations` | ADMIN | `{ email?, role?="READ_ONLY", expiresInDays?=7 (max 30) }`; returns the token and link **once** (stored hashed) | 14/19 |
| GET | `/households/{hid}/invitations` | ADMIN | Never returns tokens | 14/19 |
| DELETE | `/households/{hid}/invitations/{id}` | ADMIN | Revoke | 14/19 |
| POST | `/invitations/accept` | any | `{ token }`; email must match if the invitation names one; single use; expiry enforced; creates membership with the invited role | 14/19 |
| GET | `/households/{hid}/settings` | member | Non-sensitive subset: staleness threshold, freshness, automation pause, controls enabled, budget state (spent vs cap) | 14 |
| PATCH | `/households/{hid}/settings` | ADMIN | Spend cap, intervals, retention, `controlsEnabled`; changing `controlsEnabled` to true requires re-consent for `energy_cmds` (D-006) | 19 |
| POST | `/households/{hid}/automation/pause` | RW | Idempotent; audited | 18 |
| POST | `/households/{hid}/automation/resume` | ADMIN | Idempotent; audited | 18 |

### 2.3 Sites and Tesla connection

| Method | Path | Min role | Notes | Task |
|---|---|---|---|---|
| GET | `/households/{hid}/sites` | member | `{ id, name, timezone, connectionState, provider, capabilitiesSummary }` | 14 |
| GET | `/sites/{siteId}` | member | Single site; 404 across households | 14 |
| PATCH | `/sites/{siteId}` | ADMIN | `name` only | 19 |
| POST | `/households/{hid}/provider/tesla/connect` | ADMIN | `{ enableControls?: boolean }` → `{ authorizeUrl }`; creates `oauth_states` row; S8 | 15 |
| GET | `/provider/tesla/callback` | public (state-bound) | `?code&state`; consumes single-use state; exchanges code; stores encrypted tokens; **302** to `/settings?...`; never returns tokens; S1, S8 | 15 |
| GET | `/households/{hid}/provider/tesla` | member | `{ state: NOT_CONNECTED|ACTIVE|NEEDS_REAUTH|REVOKED, scopes, lastRefreshAt }` (no tokens) | 15 |
| GET | `/households/{hid}/provider/tesla/discovered-sites` | ADMIN | Live call (`products`), counts toward budget; returns id, name only | 15 |
| POST | `/households/{hid}/sites` | ADMIN | `{ provider: "TESLA", providerSiteId, name? }`; verifies the id is in the discovered list | 15 |
| DELETE | `/households/{hid}/provider/tesla` | ADMIN | Deletes stored credentials, marks sites `DISCONNECTED`, instructs the user to revoke on Tesla's consent page (programmatic revocation is `UNVERIFIED`); S1 | 15 |

### 2.4 Telemetry and analytics

| Method | Path | Min role | Notes | Task |
|---|---|---|---|---|
| GET | `/sites/{siteId}/live` | member | Latest reading (cached up to 30 s, else a single budgeted refresh under the `fetch:live:<site>` lock); on budget exhaustion or provider failure returns the last snapshot with `freshness: "STALE"` and a `budget` field; S2, S3, S4 | 14/16 |
| GET | `/sites/{siteId}/power` | member | `from`, `to`, `limit`; raw snapshots exactly as stored (real, uneven cadence); max 7 days | 16 |
| GET | `/sites/{siteId}/energy` | member | `from`, `to`, `resolution = interval | hourly | daily`; returns the rows with `completeness`, `resolutionSecondsMin/Max`; no resampling to finer data | 16/13 |
| GET | `/sites/{siteId}/costs` | member | `from`, `to`, `granularity = day | month`; uses `cost_rollups_daily` cache, computes missing days with `packages/domain`; money as strings with currency; returns `coverage` and any `TARIFF_GAP`/`UNPRICEABLE_AT_RESOLUTION` flags | 13/16 |
| GET | `/households/{hid}/demo/live` | member | **DEMO** synthetic reading; `source: "DEMO"`; never persisted | 14 |
| GET | `/households/{hid}/demo/energy` | member | **DEMO** synthetic series for the same query shape as `/energy` | 14 |

### 2.5 Tariffs

| Method | Path | Min role | Notes | Task |
|---|---|---|---|---|
| GET | `/households/{hid}/tariffs` | member | Filter `direction`, `asOf` (local date); paginated | 14 |
| GET | `/tariffs/{tariffId}` | member | Includes seasons, slots, overrides, levies; price points via a separate endpoint | 14 |
| POST | `/households/{hid}/tariffs` | RW | Creates a tariff or, with `tariffKey`, a **new version**; validated by the domain validator (no overlap, full coverage, currency, timezone); overlapping effective dates → 409 | 14 |
| POST | `/tariffs/{tariffId}/validate` | RW | Dry validation, returns problems; no write | 14 |
| PATCH | `/tariffs/{tariffId}` | RW | Only `effectiveTo` (ending a version); other changes need a new version | 14 |
| DELETE | `/tariffs/{tariffId}` | RW | Only if no cached cost or accounting row references it; else 409 | 14 |
| PUT | `/tariffs/{tariffId}/price-points` | RW | Bulk upsert dynamic prices (1 MiB cap, max 5,000 points per call); rates as strings | 14 |

Any tariff change invalidates `cost_rollups_daily` for affected dates (recomputed by a job); audited as `tariff.version_created`.

### 2.6 Capabilities and commands

| Method | Path | Min role | Notes | Task |
|---|---|---|---|---|
| GET | `/sites/{siteId}/capabilities` | member | `[ { capability, status: SUPPORTED | UNVERIFIED | NOT_SUPPORTED | DISABLED_BY_SETTING, reason } ]` from the registry (from TASK-00 matrix); never invented | 14/15 |
| POST | `/sites/{siteId}/commands` | RW | Header `Idempotency-Key` required; body `{ kind, params }`; `kind` must be `SUPPORTED` for the site **and** `controlsEnabled`; automation paused does not block manual commands; inserts intent row user-scoped (DB proves role), then dispatches; returns **202** with `{ id, state: "PENDING", phase }`. Until Task 17: `501 NOT_IMPLEMENTED`. Rate limit: 30 per minute per household (matches Tesla's documented device-command limit) | 14 stub / 17 |
| GET | `/sites/{siteId}/commands` | member | Paginated history | 14/17 |
| GET | `/commands/{commandId}` | member | State, phase, events, outcome wording separates "configuration changed" from "physical outcome guaranteed" | 17 |

Command states returned: `PENDING`, `CONFIRMED`, `FAILED`, `UNKNOWN` (rule 4). `CONFIRMED` only after read-back reconciliation (lifecycle in `SYSTEM_ARCHITECTURE.md` §12).

### 2.7 Automation

| Method | Path | Min role | Notes | Task |
|---|---|---|---|---|
| GET | `/sites/{siteId}/automation/rules` | member | | 14/18 |
| POST | `/sites/{siteId}/automation/rules` | RW | `mode` defaults `DISABLED`; only `DISABLED` or `DRY_RUN` accepted | 14/18 |
| PATCH | `/automation/rules/{ruleId}` | RW | `name`, `definition`, `mode` ∈ {`DISABLED`,`DRY_RUN`}; optimistic `version` check → 409 on mismatch | 14/18 |
| POST | `/automation/rules/{ruleId}/activate` | ADMIN | Sets `ACTIVE`; requires `controlsEnabled`, supported capability, not paused; audited | 18 |
| DELETE | `/automation/rules/{ruleId}` | RW | | 18 |
| GET | `/sites/{siteId}/automation/executions` | member | Paginated; shows decision and reason (including `WOULD_ACT` for dry runs) | 18 |

### 2.8 Administration, audit, privacy

| Method | Path | Min role | Notes | Task |
|---|---|---|---|---|
| GET | `/households/{hid}/audit` | ADMIN | Paginated, filter `action`, `from`, `to`; metadata is allowlisted | 19 |
| POST | `/households/{hid}/export` | ADMIN | Household data export (JSON, bounded, async job if large) | 19 |
| DELETE | `/households/{hid}` | ADMIN | Body `{ confirmName }`; cascades data; audited by an out-of-household record | 19 |

### 2.9 Not HTTP (listed for completeness)

`scheduled()` cron handler: dispatcher, job claim, `token_maintenance`, `sync_live`, `sync_history`, `rollup`, `retention`, `evaluate_rules`, `reconcile_command`, `reencrypt_credentials` (`SYSTEM_ARCHITECTURE.md` §6–7).

## 3. Budget and degradation behaviour

- `/live` never fails hard because of budget: if the monthly spend cap or the on-demand allowance is reached, the route returns the latest stored snapshot with `freshness: "STALE"` and `budget: { "state": "EXHAUSTED" }`, and the UI says so.
- `/discovered-sites` and commands return `BUDGET_EXHAUSTED` when over the cap (commands are never silently dropped; the UI shows the reason).
- All Tesla responses with status below 500 are billable (TASK-00 Q8): the Worker never retries a 4xx in a loop.

## 4. Rate limiting (limits, to be implemented and documented in TASK-14)

Per authenticated user: 120 requests per minute general; 30 per minute on mutating routes; 10 per minute on invitation accept and token-sensitive routes; unauthenticated IP buckets: 60 per minute on public routes. Exceeding returns `429 RATE_LIMITED` with `Retry-After`. Mechanism (Workers rate-limiting binding or database counters) is chosen and verified in TASK-14 (`UNVERIFIED` here).

## 5. Authorisation matrix pointer

The route × role matrix is the table in §2 (Min role column) and must equal `SECURITY_MODEL.md` §2.1. TASK-14 produces executable tests for every route with READ_ONLY, READ_WRITE, ADMIN, cross-household and unauthenticated tokens.
