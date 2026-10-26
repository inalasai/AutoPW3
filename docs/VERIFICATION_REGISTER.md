# AutoPW3 — Feature Verification Register

**Task:** TASK-20 Security Audit and End-to-End Verification  
**Date:** 2026-10-26  
**Status Key:**
- `VERIFIED`: Implemented and fully verified with automated tests (unit, integration, database, or E2E).
- `MOCK_ONLY`: Working against synthetic mock data or in-memory fixtures; verified without live provider dependencies.
- `AWAITING_CREDENTIALS`: Implementation complete; requires real production vendor credentials (e.g. Tesla Fleet API developer account / Supabase project).
- `AWAITING_PROVIDER_APPROVAL`: Blocked on third-party vendor review or agreement (e.g. Tesla Fleet API commercial application approval).
- `UNSUPPORTED_BY_DEVICE`: Excluded or rejected because the physical device / official API does not support the operation (e.g. forced charging, solar bypass).
- `UNVERIFIED`: Payload or command schema implemented per documentation but not yet traced on live physical Powerwall hardware.

---

## 1. Feature Verification Matrix

| Area / Feature | Implementation Location | Verification Status | Notes & Invariants |
|---|---|---|---|
| **Design System & Responsive Shell** | `apps/web/src/components/ui/`, `AppShell.tsx` | `VERIFIED` | Glassmorphic dark theme, accessible colors, single effects toggle switch, WCAG AAA contrast, mobile navigation drawer. |
| **Authentication & Session Lifecycle** | `apps/web/src/features/auth/` | `VERIFIED` | Email/password sign-in, session reload restore, generic invalid credential messaging, public registration with unconfirmed state. |
| **Role-Based Access Control (RBAC)** | `apps/web/src/features/auth/`, `apps/worker/src/lib/app.ts` | `VERIFIED` | Monotonic hierarchy (`READ_ONLY` < `READ_WRITE` < `ADMIN`). Authoritative backend enforcement. Browser edits cannot grant access. |
| **Cross-Household Tenant Isolation** | `apps/worker/src/lib/app.ts`, `supabase/migrations/` | `VERIFIED` | HTTP 404 returned on cross-household access to prevent account/household enumeration. 29 SQL tests in `020_cross_household_isolation`. |
| **Database Schema & Migrations** | `supabase/migrations/` | `VERIFIED` | 12 migration files, 29 tables, RLS enabled on all public tables, PostgreSQL 17 verified via `npm run db:verify`. |
| **SQL Security & RLS Policies** | `supabase/tests/database/` | `VERIFIED` | 336 pgTAP assertions pass with 0 failures (`npm run db:test`). Zero access for `anon`/`PUBLIC`. |
| **Shared Types & Validation** | `packages/shared/src/schemas/` | `VERIFIED` | Zod schemas for all routes, queries, decimal prices, and commands. Zero drift with `database.types.ts`. |
| **Telemetry Normalisation & Signs** | `packages/domain/src/telemetry/` | `VERIFIED` | Signs: Solar ≥ 0, Battery > 0 discharging, Grid > 0 importing. Field names encode units (`...W`, `...Wh`, `...Percent`). |
| **Synthetic Demo Data Generator** | `packages/domain/src/fixtures/` | `VERIFIED` | Deterministic PRNG seed, solar bell curves, evening peaks, storm scenarios. Strictly labelled `source: DEMO`. |
| **DEMO Data Separation Guard** | `packages/domain/src/telemetry/guards.ts` | `VERIFIED` | `assertNotDemo()` and DB check constraints permanently reject `DEMO` records in live tables or live accounting. |
| **Live Energy Flow View** | `apps/web/src/features/live/` | `VERIFIED` | 60 FPS HTML5 Canvas animation loop with particle physics, reduced-motion pause, screen reader ARIA live region. |
| **Tariff Engine & Interval Pricing** | `packages/domain/src/tariff/` | `VERIFIED` | Time-of-use slot resolution, weekend overrides, seasonal rates, exact integer-minor currency math (`NoFloatMoney`), DST handling. |
| **Tariff Manager UI** | `apps/web/src/features/tariffs/` | `VERIFIED` | Profile creation, effective dating, midnight-crossing decomposition, gap validation, 24h preview, role restrictions. |
| **Accounting Engine & Integrations** | `packages/domain/src/accounting/` | `VERIFIED` | Power-to-energy trapezoidal integration, independent import/export costing, standing charges, VAT, efficiency metrics. |
| **Analytics UI & Historical Charts** | `apps/web/src/features/analytics/` | `VERIFIED` | Energy and cost Recharts graphs, day/week/month/year presets, resolution mapping, counterfactual savings, CSV export. |
| **CSV Formula Injection Mitigation** | `apps/web/src/features/analytics/csvExport.ts` | `VERIFIED` | OWASP CSV formula injection defense prepending `'` on `=,+,-,@,\t,\r`. |
| **Worker API Middleware Pipeline** | `apps/worker/src/lib/app.ts` | `VERIFIED` | 12-stage pipeline: CORS, CSP, payload size cap (64 KiB), rate limiting, idempotency replay, JWT verification, Zod validation. |
| **Asymmetric JWT Verification** | `apps/worker/src/lib/jwt.ts` | `VERIFIED` | Verifies Supabase RS256/ES256 signatures with 10-minute remote JWKS cache. HS256 is strictly rejected. |
| **Idempotency Key Handling** | `apps/worker/src/lib/app.ts` | `VERIFIED` | UUIDv4 idempotency keys, cached responses, token redaction on replay (D-036). |
| **Tesla Fleet API Client (Mock)** | `apps/worker/src/providers/tesla/mock.ts` | `MOCK_ONLY` | Verified with `MockTeslaClient` covering OAuth, `live_status`, `energy_sites`, and command endpoints. |
| **Tesla Fleet API Live Connection** | `apps/worker/src/providers/tesla/client.ts` | `AWAITING_CREDENTIALS` | Implementation ready; requires live client ID/secret and registered Tesla application redirect URI. |
| **Tesla Commercial API Access** | Tesla Developer Portal | `AWAITING_PROVIDER_APPROVAL` | Tesla Fleet API commercial application approval and billing payment method setup. |
| **Tesla Token Encryption at Rest** | `apps/worker/src/services/tokens/` | `VERIFIED` | AES-256-GCM encryption with 96-bit random nonce, key ID, and AAD. Rotating key support. Server-side only. |
| **Telemetry Ingestion & Backfill** | `apps/worker/src/services/ingestion/` | `VERIFIED` | Live polling and historical calendar sync separation, resumable cursors, hourly/daily rollups, 90-day retention purges. |
| **Device Controls State Machine** | `apps/worker/src/services/commands/` | `VERIFIED` | Command lifecycle: `RECORDED` → `DISPATCHING` → `DISPATCHED` → `RECONCILING` → `DONE`. Read-back reconciliation. |
| **Powerwall Backup Reserve Command** | `apps/worker/src/services/commands/` | `UNVERIFIED` | Request payload `{ backup_reserve_percent }` implemented per Fleet API energy docs; awaits live physical hardware test. |
| **Powerwall Operation Mode Command** | `apps/worker/src/services/commands/` | `UNVERIFIED` | Request payload `{ default_real_mode }` (`autonomous` / `self_consumption` / `backup`); awaits live physical hardware test. |
| **Forced Grid Charging** | N/A | `UNSUPPORTED_BY_DEVICE` | Not supported by Tesla Fleet API. Schema rejects invocation with 422 `VALIDATION_FAILED` (Decision D-003). |
| **Forced Grid Export** | N/A | `UNSUPPORTED_BY_DEVICE` | Not supported by Tesla Fleet API. Schema rejects invocation with 422 `VALIDATION_FAILED` (Decision D-003). |
| **Solar Inverter Bypass** | N/A | `UNSUPPORTED_BY_DEVICE` | Not supported by Tesla Fleet API. Schema rejects invocation with 422 `VALIDATION_FAILED` (Decision D-003). |
| **Manual Islanding / Grid Disconnect**| N/A | `UNSUPPORTED_BY_DEVICE` | Not supported by Tesla Fleet API energy commands (Decision D-003). |
| **Emergency Automation Pause** | `apps/worker/src/routes/automation.ts` | `VERIFIED` | Global emergency pause toggle (`POST /automation/pause`). Instantly halts automated dispatches across the household. |
| **Automation Rule Evaluation Engine** | `apps/worker/src/services/automation/` | `VERIFIED` | Priority conflict resolution, time windows, battery SOC, import rate comparison, staleness checks. |
| **Dry-Run Safety Barrier** | `apps/worker/src/services/automation/runner.ts` | `VERIFIED` | Rules default to `DRY_RUN` or `DISABLED`. `DRY_RUN` records `WOULD_ACT` decisions and never calls control endpoints. |
| **Household Administration Cockpit** | `apps/web/src/features/admin/` | `VERIFIED` | Member directory, role mutations, invitations list, audit logs viewer, settings manager, privacy compliance. |
| **Last-Admin Protection Invariant** | `apps/worker/src/routes/admin.ts` | `VERIFIED` | Prevents self-demotion and blocks demoting or removing the last remaining `ADMIN` in a household (HTTP 409). |
| **Cryptographic Invitations Lifecycle**| `apps/worker/src/routes/admin.ts` | `VERIFIED` | Generates 256-bit cryptographically secure tokens. Raw token shown once; SHA-256 hash stored. Zero SMTP dependency. |
| **Immutable Audit Logging** | `apps/worker/src/routes/admin.ts`, `supabase/` | `VERIFIED` | Records security and operational events (`bootstrap`, `member`, `invitation`, `settings`, `rule`, `command`). Token redaction. |
| **GDPR Data Portability (Article 20)** | `apps/worker/src/routes/admin.ts` | `VERIFIED` | Sanitized JSON export endpoints for households (`/households/{id}/export`) and personal accounts (`/me/export`). |
| **GDPR Right to Erasure (Article 17)** | `apps/worker/src/routes/admin.ts` | `VERIFIED` | Account deletion with `{ confirm: true }`; household deletion with typed name confirmation `{ confirmName }`. |
