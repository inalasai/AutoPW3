# API Operations Manual — AutoPW3 Cloudflare Worker Backend

This document describes the operational architecture, security pipeline, endpoint specifications, and privileged access register for the AutoPW3 Cloudflare Worker API.

---

## 1. Architectural Overview

The AutoPW3 backend is implemented as a Cloudflare Worker deployed in `apps/worker`. It serves as the authoritative boundary for:
1. **Authentication Verification**: Asymmetric JWT verification against Supabase Auth (RS256/ES256/EdDSA).
2. **Authoritative Access Control**: Household membership and role resolution directly from the database; never trusting client claims.
3. **Domain Validation**: Contract enforcement using shared Zod schemas (`@autopw3/shared`) and domain invariants (`@autopw3/domain`).
4. **Resilience & Safety**: Request size limits (64 KiB), strict CORS, rate limiting, and idempotency deduplication.

---

## 2. Deterministic Middleware Pipeline

Every HTTP request traverses an invariant 12-stage middleware sequence. If any stage fails, processing terminates immediately, returning an RFC 7807-compliant JSON error envelope with appropriate CORS and tracing headers (`x-request-id`).

```mermaid
graph TD
    A[Incoming HTTP Request] --> B[1. CORS Preflight & Origin Verification]
    B --> C[2. Static Asset Delegation for Non-API Paths]
    C --> D[3. Route Matching & Method Check]
    D --> E[4. Request Size Limit Guard (64 KiB)]
    E --> F[5. JWT Verification (RS256/ES256)]
    F --> G[6. Path Parameter Validation (Zod)]
    G --> H[7. Query Parameter Validation (Zod)]
    H --> I[8. Body Schema Validation (Zod)]
    I --> J[9. Idempotency Key Check & Cached Replay]
    J --> K[10. Rate Limiting Check]
    K --> L[11. Authoritative Membership & Role Check]
    L --> M[12. Typed Route Handler Execution]
```

### Stage Details

1. **CORS Guard**:
   - Compares `Origin` against `ALLOWED_ORIGINS` (comma-separated).
   - Non-matching origins receive `403 FORBIDDEN`.
   - Matching `OPTIONS` requests receive `204 No Content` with allowed methods, headers, and credentials.
2. **Static Asset Fallback**:
   - Paths not beginning with `/api/` are delegated to Cloudflare Pages/Assets (`env.ASSETS`).
3. **Route Matching**:
   - Matches against `ROUTES` from `@autopw3/shared`.
   - Unknown `/api/` paths return `404 NOT_FOUND`.
   - Path matched with incorrect HTTP method returns `405 METHOD_NOT_ALLOWED`.
4. **Request Size Guard**:
   - If `Content-Length > 65,536 bytes` (64 KiB) or body stream exceeds 64 KiB, immediately returns `413 PAYLOAD_TOO_LARGE`.
5. **JWT Verification**:
   - Public routes (`/health`, `/invitations/accept`) bypass token checks.
   - Requires `Authorization: Bearer <token>`.
   - Verifies against remote JWKS (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`) cached for 10 minutes.
   - **Strictly rejects HS256 tokens** per D-009.
   - Enforces claims: `exp`, `iss`, `sub`, and `role === 'authenticated'`.
6. **Path Parameter Validation**:
   - Validates RFC 4122 v4 UUIDs for `hid`, `siteId`, `tariffId`, `ruleId`, `userId`. Returns `422 VALIDATION_FAILED` on mismatch.
7. **Query Parameter Validation**:
   - Validates query filters and pagination cursors (`limit`, `cursor`, `direction`, `asOf`).
8. **Body Schema Validation**:
   - Validates JSON payload against route Zod schema. Returns `422 VALIDATION_FAILED` with structured issue paths.
9. **Idempotency Guard**:
   - Mutating routes requiring `Idempotency-Key` (e.g. `POST /invitations`, `POST /commands`) enforce 8–128 character keys (`^[A-Za-z0-9_-]{8,128}$`).
   - Hashes canonical body via SHA-256. Replays cached response with `idempotent-replay: true` if key matches same body.
   - Returns `409 CONFLICT` if key is reused with a different body.
   - **D-036 Compliance**: Sensitive single-use secrets (such as invitation `token` and `link`) are redacted to `null` on replay.
10. **Rate Limiting**:
    - Evaluated per authenticated `userId` or client IP (`CF-Connecting-IP`).
    - Quotas: 120 req/min for general read, 30 req/min for mutating routes, 10 req/min for invitation acceptance / token-sensitive operations, 60 req/min for public unauthenticated endpoints.
    - Exceeding returns `429 RATE_LIMITED` with `Retry-After` header.
11. **Authoritative Membership & Role Check**:
    - Backend looks up caller's membership in the target household directly from the repository.
    - If user does not belong to the household, returns `404 NOT_FOUND` (preventing resource existence enumeration).
    - Checks required role (`READ_ONLY`, `READ_WRITE`, `ADMIN`). Insufficient role returns `403 FORBIDDEN`.
12. **Route Handler**:
    - Executes pure business logic and returns typed JSON response.

---

## 3. Endpoint Registry

| Route Name | Method | Path | Auth Level | Min Role | Description |
|---|---|---|---|---|---|
| `health` | `GET` | `/api/v1/health` | Public | None | Health check endpoint returning `{ status: "ok" }`. |
| `getMe` | `GET` | `/api/v1/me` | Protected | Authenticated | Current user profile and household memberships. |
| `getHousehold` | `GET` | `/api/v1/households/{hid}` | Protected | `READ_ONLY` | Household details and timezone. |
| `listMembers` | `GET` | `/api/v1/households/{hid}/members` | Protected | `ADMIN` | Household members list (ADMIN only). |
| `changeMemberRole`| `PATCH` | `/api/v1/households/{hid}/members/{userId}` | Protected | `ADMIN` | Change a member's role (self-demotion forbidden). |
| `listInvitations` | `GET` | `/api/v1/households/{hid}/invitations` | Protected | `ADMIN` | Active and pending invitations. |
| `createInvitation`| `POST` | `/api/v1/households/{hid}/invitations` | Protected | `ADMIN` | Creates household invitation (Idempotency key required). |
| `revokeInvitation`| `DELETE`| `/api/v1/households/{hid}/invitations/{id}` | Protected | `ADMIN` | Revokes a pending invitation. |
| `acceptInvitation`| `POST` | `/api/v1/invitations/accept` | Protected | Authenticated | Joins household using single-use 256-bit token. |
| `getSettings` | `GET` | `/api/v1/households/{hid}/settings` | Protected | `READ_ONLY` | Household energy and UI settings. |
| `listSites` | `GET` | `/api/v1/households/{hid}/sites` | Protected | `READ_ONLY` | Energy sites associated with household. |
| `getSite` | `GET` | `/api/v1/sites/{siteId}` | Protected | `READ_ONLY` | Energy site details and connection state. |
| `getCapabilities` | `GET` | `/api/v1/sites/{siteId}/capabilities` | Protected | `READ_ONLY` | Device capability registry (documented vs unverified). |
| `getLive` | `GET` | `/api/v1/sites/{siteId}/live` | Protected | `READ_ONLY` | Live telemetry reading from active provider. |
| `getDemoLive` | `GET` | `/api/v1/households/{hid}/demo/live` | Protected | `READ_ONLY` | Deterministic demo telemetry reading. |
| `getDemoEnergy` | `GET` | `/api/v1/households/{hid}/demo/energy` | Protected | `READ_ONLY` | Deterministic synthetic historical energy series. |
| `listTariffs` | `GET` | `/api/v1/households/{hid}/tariffs` | Protected | `READ_ONLY` | Active/historical utility tariffs. |
| `getTariff` | `GET` | `/api/v1/tariffs/{tariffId}` | Protected | `READ_ONLY` | Complete versioned tariff details. |
| `createTariff` | `POST` | `/api/v1/households/{hid}/tariffs` | Protected | `READ_WRITE` | Creates new tariff or version with domain validation. |
| `validateTariff`| `POST` | `/api/v1/tariffs/{tariffId}/validate` | Protected | `READ_ONLY` | Runs domain validation suite against tariff. |
| `endTariff` | `PATCH` | `/api/v1/tariffs/{tariffId}` | Protected | `READ_WRITE` | Sets `effectiveTo` to retire tariff version. |
| `deleteTariff` | `DELETE`| `/api/v1/tariffs/{tariffId}` | Protected | `ADMIN` | Deletes unreferenced tariff draft. |
| `putPricePoints` | `PUT` | `/api/v1/tariffs/{tariffId}/price-points` | Protected | `READ_WRITE` | Ingests dynamic price points for tariff version. |
| `listRules` | `GET` | `/api/v1/sites/{siteId}/automation/rules` | Protected | `READ_ONLY` | Automation rules for site. |
| `createRule` | `POST` | `/api/v1/sites/{siteId}/automation/rules` | Protected | `READ_WRITE` | Creates rule (defaults to `DRY_RUN` / `DISABLED`). |
| `updateRule` | `PATCH` | `/api/v1/automation/rules/{ruleId}` | Protected | `READ_WRITE` | Updates rule; `mode: ACTIVE` requires `ADMIN`. |
| `listCommands` | `GET` | `/api/v1/sites/{siteId}/commands` | Protected | `READ_ONLY` | Audit log of dispatched commands. |
| `createCommand` | `POST` | `/api/v1/sites/{siteId}/commands` | Protected | `READ_WRITE` | Stubbed device control (returns 501 until Task 17). |

---

## 4. Role Authorization Matrix

| Operation Category | READ_ONLY | READ_WRITE | ADMIN | Cross-Household Non-Member |
|---|:---:|:---:|:---:|:---:|
| View Live / Historical Telemetry | Allowed | Allowed | Allowed | `404 NOT_FOUND` |
| View Household & Site Info | Allowed | Allowed | Allowed | `404 NOT_FOUND` |
| View Tariffs & Validate | Allowed | Allowed | Allowed | `404 NOT_FOUND` |
| Create / Edit Tariffs | `403 FORBIDDEN` | Allowed | Allowed | `404 NOT_FOUND` |
| Delete Tariffs | `403 FORBIDDEN` | `403 FORBIDDEN` | Allowed | `404 NOT_FOUND` |
| View Automation Rules | Allowed | Allowed | Allowed | `404 NOT_FOUND` |
| Create / Edit Rules (DRY_RUN) | `403 FORBIDDEN` | Allowed | Allowed | `404 NOT_FOUND` |
| Activate Automation Rule | `403 FORBIDDEN` | `403 FORBIDDEN` | Allowed | `404 NOT_FOUND` |
| Submit Device Command | `403 FORBIDDEN` | Allowed (501) | Allowed (501) | `404 NOT_FOUND` |
| View Member List & Invitations | `403 FORBIDDEN` | `403 FORBIDDEN` | Allowed | `404 NOT_FOUND` |
| Create / Revoke Invitations | `403 FORBIDDEN` | `403 FORBIDDEN` | Allowed | `404 NOT_FOUND` |
| Change Member Role | `403 FORBIDDEN` | `403 FORBIDDEN` | Allowed | `404 NOT_FOUND` |
| Self Role Modification | `403 FORBIDDEN` | `403 FORBIDDEN` | `403 FORBIDDEN` | `404 NOT_FOUND` |

---

## 5. Service Role Access Register (S1–S9)

In accordance with `SECURITY_MODEL.md` section 4, standard API requests execute using **user-scoped database credentials** enforcing PostgreSQL Row-Level Security (RLS). Privileged `service_role` access is strictly isolated and restricted exclusively to the following operations:

| Identifier | Operation Name | Justification | RLS Bypass Mitigation |
|---|---|---|---|
| **S1** | Initial Household Creation | Bootstraps a household and assigns initial ADMIN membership upon account registration. | Transactionally creates both records; cannot be executed by an existing member. |
| **S2** | Invitation Token Issuance | Generates and cryptographically hashes the 256-bit single-use invitation secret. | Table column `token_hash` has no PostgREST grant; raw tokens are never persisted. |
| **S3** | Invitation Acceptance | Atomically verifies token hash, marks accepted, and creates `household_members` row. | Verified via Postgres function with expiration and single-use checks. |
| **S4** | Tesla OAuth Token Encryption | Encrypts Tesla Fleet refresh/access tokens at rest using AES-GCM before database write. | Encrypted tokens never return to client or leave Worker execution memory. |
| **S5** | Background Telemetry Ingestion | Scheduled cron worker writes normalised 5-minute telemetry intervals from Fleet API. | Ingestion operates under site ID verification; writes to partitioned telemetry log only. |
| **S6** | Automation Rule Evaluator | Scheduled cron evaluator checks sensor conditions and dispatches dry-run or real commands. | Evaluator verifies site lock; executes in `DRY_RUN` mode unless explicitly enabled. |
| **S7** | Immutable Audit Log Append | Writes tamper-proof audit records for sensitive administrative or command events. | Audit table is append-only (`BEFORE UPDATE OR DELETE DO INSTEAD NOTHING`). |
| **S8** | Account Deletion Orchestrator | Deletes orphan user data, revokes Tesla tokens, and cleans up storage when an account is deleted. | Guarded by database trigger ensuring last admin cannot be deleted without household succession. |
| **S9** | Platform System Diagnostics | Internal health verification and schema verification checks. | Read-only schema verification; no tenant data exposed. |

---

## 6. Environment Variables and Configuration

| Variable | Description | Example / Default |
|---|---|---|
| `ENVIRONMENT` | Target environment (`local`, `preview`, `production`) | `local` |
| `SUPABASE_URL` | Base URL of the Supabase project | `https://xyz.supabase.co` |
| `SUPABASE_ANON_KEY` | Public anonymous key for client-scoped database queries | (Required) |
| `SUPABASE_SERVICE_ROLE_KEY` | Restricted secret key for operations S1–S8 | (Secret; never committed) |
| `ALLOWED_ORIGINS` | Comma-delimited list of CORS-approved origins | `http://localhost:5173,https://app.autopw3.com` |
| `PROVIDER_MODE` | Active telemetry provider (`demo` or `tesla`) | `demo` |
| `JWT_ISSUER` | Expected JWT issuer claim | `${SUPABASE_URL}/auth/v1` |
| `JWT_JWKS_URL` | Endpoint to fetch JWKS public keys | `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` |
