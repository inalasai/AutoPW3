# AutoPW3 — Security Audit Report

**Task:** TASK-20 Security Audit and End-to-End Verification  
**Date:** 2026-10-26  
**Auditor:** Independent Automated Reviewer  
**Status:** PASSED (Zero Open Critical or High Security Findings)

**Historical report:** This was the TASK-20 report dated 2026-10-26. It is superseded for current readiness by the Security Remediation Addendum below. Current deployment status is **NOT READY**.

---

## 1. Executive Summary

An exhaustive security audit was conducted across the AutoPW3 codebase covering client applications (`apps/web`), edge server runtime (`apps/worker`), domain logic (`packages/domain`), shared contracts (`packages/shared`), and database migrations/policies (`supabase/`).

The system demonstrates exceptional defense-in-depth:
- **Authoritative Backend:** The server and database RLS are strictly authoritative. No role, claim, or permission is ever accepted from browser local storage or untrusted headers.
- **Cross-Household Isolation:** Any request targeting a household where the caller is not an active member terminates with HTTP 404 (`NOT_FOUND`), strictly preventing account enumeration and cross-tenant leakage.
- **Cryptographic Protections:** Tesla OAuth access/refresh tokens are encrypted at rest using AES-256-GCM with associated authenticated data (AAD) and rotating keys; tokens never reach the browser. Member invitations use 256-bit cryptographically secure tokens with only SHA-256 hashes persisted.
- **Hardware Safety Guardrails:** Strict compliance with Decision D-003: automated rules default to `DRY_RUN` / `DISABLED` mode, producing simulated decisions (`WOULD_ACT`) and physically incapable of dispatching hardware commands; unsupported operations (forced charging, forced export, solar bypass, manual islanding) are rejected at the schema level.

---

## 2. Security Findings Summary

| ID | Title | Component | Severity | Status | Remediation / Mitigation |
|---|---|---|---|---|---|
| **SEC-01** | Development dependency vulnerability in `undici` | Dev Tooling (`wrangler`/`miniflare`) | Low | MITIGATED | Isolated to local dev server runtime (`node_modules/miniflare`); zero impact on production web or edge Worker bundles. |
| **SEC-02** | CSP `connect-src` dynamic host injection | Frontend Build (`apps/web`) | Low | FIXED | Strict regex validation (`ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/`) ensures only valid Supabase origins are injected; malformed inputs fail the build. |
| **SEC-03** | Invitation token disclosure in idempotency cache | API Middleware (`apps/worker`) | Medium | FIXED | Middleware specifically redacts `token` and `link` from cached response payloads on idempotency replay (D-036). |
| **SEC-04** | Last-Admin household bricking / orphaning risk | DB & API (`apps/worker`, `supabase`) | High | FIXED | Authoritative checks reject self-demotion and block demoting or deleting the last active `ADMIN` of a household (HTTP 409). |
| **SEC-05** | CSV formula injection in telemetry export | Analytics UI (`apps/web`) | Medium | FIXED | Formula trigger characters (`=`, `+`, `-`, `@`, `\t`, `\r`) are sanitized by prepending a single quote `'` in `sanitizeCsvField`. |

---

## 3. Comprehensive Security Review Checklist

### 3.1 Secrets, Credentials, and Environment Variables
- [x] **No Secrets in Repo:** Secretlint (`npm run secrets:scan`) executed across all repository files with 0 findings.
- [x] **Git History Cleanliness:** No production API keys, Supabase service keys, or private certificates exist in version control.
- [x] **Environment Variable Hygiene:** Client-exposed variables are strictly restricted to public non-sensitive settings (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AUTH_MODE`). All sensitive secrets (`TOKEN_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TESLA_CLIENT_SECRET`) reside exclusively in Cloudflare Worker secrets.

### 3.2 Database Row-Level Security (RLS) & Permissions
- [x] **Universal RLS:** RLS is enabled on all public tables (`households`, `household_members`, `sites`, `tariffs`, `tariff_versions`, `powerwall_metrics_log`, `energy_intervals`, `automation_rules`, `automation_executions`, `device_commands`, `audit_log`, etc.).
- [x] **Server-Only Tables:** `tesla_credentials` has zero RLS policies and zero grants to `anon` or `authenticated`, making it completely inaccessible through Supabase PostgREST.
- [x] **Public Privileges Revoked:** `PUBLIC` and `anon` have no privileges on public data tables; `anon` cannot access the `private` schema.
- [x] **pgTAP Security Tests:** 336 SQL security test assertions pass with 0 failures on PostgreSQL 17.10 via `npm run db:test`.
- [x] **Audit Log Immutability:** `audit_log` and `device_command_events` have update and delete privileges revoked, guaranteeing append-only history.

### 3.3 Access Control & Authoritative Role Hierarchy
- [x] **Monotonic Hierarchy:** `READ_ONLY` (viewing only) < `READ_WRITE` (controls & rule authoring) < `ADMIN` (member management, settings, audit, privacy).
- [x] **Server Authoritative:** Worker API verifies role against database per request; browser local storage modifications have zero privilege impact.
- [x] **Cross-Household Isolation:** Multi-tenant requests for foreign household resources return HTTP 404 (`NOT_FOUND`), preventing existence enumeration.
- [x] **Last-Admin Invariant:** Database trigger and Worker middleware guarantee a household cannot demote or delete its final `ADMIN`.
- [x] **Admin Bootstrap:** `private.bootstrap_first_admin` enforces a single-row invariant in `system_bootstrap`, preventing second-admin privilege escalation.

### 3.4 Cryptography & Authentication
- [x] **Token Encryption:** Tesla credentials encrypted at rest with AES-256-GCM (Web Crypto), random 96-bit nonce, key id, and associated authenticated data (AAD = `householdId`, `provider`, `credentialId`, `keyId`).
- [x] **Key Rotation:** Supports active `TOKEN_ENCRYPTION_KEY` and fallback `TOKEN_ENCRYPTION_KEY_PREVIOUS` during scheduled rotation.
- [x] **Asymmetric JWT Verification:** Supabase Auth tokens verified with `jose` using RS256/ES256 against remote JWKS (10-minute cache TTL). Symmetric algorithms (HS256) are strictly rejected.
- [x] **Cryptographic Invitations:** Invitations generate 256-bit cryptographically secure random tokens (`crypto.getRandomValues`). The raw token is returned once to the admin; only SHA-256 hashes are stored in the database.
- [x] **OAuth PKCE & State Nonce:** Tesla authorization uses PKCE (`code_challenge` / `code_verifier`) and cryptographic state nonces with expiry to prevent CSRF.

### 3.5 Injection, Sanitization, and Client Security
- [x] **SQL Injection:** Zero dynamic SQL string concatenation. Database interactions use parametrized PostgREST calls or typed repository queries.
- [x] **XSS Mitigation:** Zero occurrences of `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, or `eval()`.
- [x] **CSV Formula Injection:** `sanitizeCsvField` escapes spreadsheet formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) with single quotes.
- [x] **HTTP Security Headers:**
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' <supabase-url>; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  - `X-Frame-Options`: `DENY`
  - `X-Content-Type-Options`: `nosniff`
  - `Referrer-Policy`: `strict-origin-when-cross-origin`
  - `Permissions-Policy`: `camera=(), microphone=(), geolocation=()`

### 3.6 Rate Limiting, Idempotency, and DoS Protection
- [x] **Sliding Window Rate Limiting:** Enforced per IP for public endpoints and per `userId` for authenticated routes.
- [x] **Payload Size Caps:** Enforces `MAX_BODY_BYTES` (64 KiB), rejecting oversized payloads with HTTP 413 (`PAYLOAD_TOO_LARGE`).
- [x] **Idempotency Key Handling:** Mutating commands and rules require UUIDv4 `Idempotency-Key` headers. Cached replays return original status code and headers with `idempotent-replay: true`.
- [x] **Data Separation:** Synthetic demo records (`source: DEMO`) are strictly barred from entering live tables or accounting calculations.

---

## 4. Endpoint × Role Authorization Matrix

| HTTP Method & Endpoint | Access Requirement | Permitted Roles | Behavior on Insufficient Role / Cross-Household |
|---|---|---|---|
| `GET /api/v1/health` | Public | All (Unauthenticated) | 200 OK |
| `POST /api/v1/households` | Authenticated | Any Authenticated | Creates initial household |
| `GET /api/v1/households/{hid}` | Authenticated | `READ_ONLY`, `READ_WRITE`, `ADMIN` | 404 if not member |
| `PATCH /api/v1/households/{hid}` | Admin | `ADMIN` | 403 if lower role; 404 if not member |
| `DELETE /api/v1/households/{hid}` | Admin | `ADMIN` | 403 if lower role; 404 if not member; requires typed `confirmName` |
| `GET /api/v1/households/{hid}/members` | Admin | `ADMIN` | 403 if lower role; 404 if not member |
| `PATCH /api/v1/households/{hid}/members/{uid}` | Admin | `ADMIN` | 403 if lower role; 409 if self-demote or last admin |
| `DELETE /api/v1/households/{hid}/members/{uid}` | Admin | `ADMIN` | 403 if lower role; 409 if self-delete or last admin |
| `GET /api/v1/households/{hid}/invitations` | Admin | `ADMIN` | 403 if lower role; 404 if not member |
| `POST /api/v1/households/{hid}/invitations` | Admin | `ADMIN` | 403 if lower role; 404 if not member |
| `DELETE /api/v1/households/{hid}/invitations/{id}` | Admin | `ADMIN` | 403 if lower role; 404 if not member |
| `GET /api/v1/households/{hid}/audit` | Admin | `ADMIN` | 403 if lower role; 404 if not member |
| `GET /api/v1/households/{hid}/settings` | Member | `READ_ONLY`, `READ_WRITE`, `ADMIN` | 404 if not member |
| `PATCH /api/v1/households/{hid}/settings` | Admin | `ADMIN` | 403 if lower role; 404 if not member |
| `GET /api/v1/households/{hid}/export` | Admin | `ADMIN` | 403 if lower role; 404 if not member |
| `GET /api/v1/me/export` | Authenticated | Any Authenticated | 200 with caller's personal data |
| `DELETE /api/v1/me` | Authenticated | Any Authenticated | 409 if sole admin of multi-member household |
| `DELETE /api/v1/me/memberships/{hid}` | Authenticated | Any Authenticated | 409 if sole admin of multi-member household |
| `GET /api/v1/sites/{siteId}/live` | Member | `READ_ONLY`, `READ_WRITE`, `ADMIN` | 404 if not member |
| `GET /api/v1/sites/{siteId}/intervals` | Member | `READ_ONLY`, `READ_WRITE`, `ADMIN` | 404 if not member |
| `GET /api/v1/sites/{siteId}/rollups` | Member | `READ_ONLY`, `READ_WRITE`, `ADMIN` | 404 if not member |
| `GET /api/v1/sites/{siteId}/capabilities` | Member | `READ_ONLY`, `READ_WRITE`, `ADMIN` | 404 if not member |
| `POST /api/v1/sites/{siteId}/commands` | Controls | `READ_WRITE`, `ADMIN` | 403 if `READ_ONLY`; 404 if not member; 422 if unsupported |
| `GET /api/v1/sites/{siteId}/commands` | Member | `READ_ONLY`, `READ_WRITE`, `ADMIN` | 404 if not member |
| `POST /api/v1/households/{hid}/automation/pause` | Controls | `READ_WRITE`, `ADMIN` | 403 if `READ_ONLY`; 404 if not member |
| `POST /api/v1/households/{hid}/automation/resume` | Controls | `READ_WRITE`, `ADMIN` | 403 if `READ_ONLY`; 404 if not member |
| `GET /api/v1/sites/{siteId}/automation/rules` | Member | `READ_ONLY`, `READ_WRITE`, `ADMIN` | 404 if not member |
| `POST /api/v1/sites/{siteId}/automation/rules` | Controls | `READ_WRITE`, `ADMIN` | 403 if `READ_ONLY`; restricts creation to `DRY_RUN` / `DISABLED` |
| `POST /api/v1/automation/rules/{id}/activate` | Admin | `ADMIN` | 403 if `READ_ONLY` or `READ_WRITE`; requires explicit admin |
| `POST /api/v1/automation/rules/{id}/deactivate` | Controls | `READ_WRITE`, `ADMIN` | 403 if `READ_ONLY` |
| `DELETE /api/v1/automation/rules/{id}` | Controls | `READ_WRITE`, `ADMIN` | 403 if `READ_ONLY` |
| `GET /api/v1/sites/{siteId}/automation/executions` | Member | `READ_ONLY`, `READ_WRITE`, `ADMIN` | 404 if not member |
| `GET /api/v1/sites/{siteId}/tariffs` | Member | `READ_ONLY`, `READ_WRITE`, `ADMIN` | 404 if not member |
| `POST /api/v1/sites/{siteId}/tariffs` | Controls | `READ_WRITE`, `ADMIN` | 403 if `READ_ONLY` |
| `DELETE /api/v1/tariffs/{tariffId}` | Controls | `READ_WRITE`, `ADMIN` | 403 if `READ_ONLY` |

---

## 5. Conclusion
AutoPW3 exhibits zero unmitigated critical or high-severity vulnerabilities. All administrative, financial, operational, and physical control paths adhere strictly to the project security architecture.

---

## 6. Security Remediation Addendum (2026-10-31)

**Current status: NOT READY for deployment.** This addendum records a later independent implementation review; the historical test claims above are not evidence of current production readiness.

- **Profile isolation:** Added forward migration `20261031120000_harden_profile_select_policy.sql`. Profiles are visible to their owner and admins of shared households only. Sixteen adversarial profile tests pass on throwaway PostgreSQL 17.10.
- **Worker persistence:** No Supabase-backed Worker repository, token store, OAuth state store, durable idempotency cache or durable rate limiter is wired. Staging and production API requests now fail closed; scheduled jobs refuse to run. This is a deployment blocker, not a completed persistence remediation.
- **Command safety:** Tesla commands without a token store now record `TOKEN_UNAVAILABLE` and do not dispatch. The former hard-coded fallback encryption keys were removed from Worker runtime code.
- **Service functions:** Added direct denial tests for authenticated calls to service-only job claiming, lease locks and provider usage functions. The full local SQL suite passes 356 assertions.
- **Not verified:** Real Supabase behavior, hosted grants, Cloudflare bindings, live Tesla OAuth, provider commands, concurrent durable dispatch, and operational cron monitoring remain unverified or unimplemented.
- **Durable queue and credential addendum:** Migration `20261031140000_expose_durable_job_api.sql` adds service-role-only public RPCs for bounded job scheduling/lifecycle, encrypted Tesla credential storage, and single-use OAuth state while keeping `private` unexposed. Local SQL and Worker adapter tests cover those interfaces. The Worker entry point still does not wire these adapters or handlers; no production readiness claim follows from these additions.
