# AutoPW3 — Release Checklist & Verification Status

**Release:** v1.0.0-rc  
**Date:** 2026-10-26  
**Auditor:** Automated Independent Verification  

---

## 1. Verified Working

The following capabilities have been fully implemented and verified with automated test suites (unit, integration, SQL security tests, or Playwright E2E smoke tests):
- **Responsive App Shell & Theme:** Accessible glassmorphic design system, WCAG AAA compliant text contrast, single effects toggle switch, and responsive navigation drawer (`desktop` and `mobile-360`).
- **Authentication & RBAC:** Supabase Auth integration, session reload restoration, monotonic roles (`READ_ONLY` < `READ_WRITE` < `ADMIN`), authoritative server enforcement, and immunity to browser storage privilege tampering.
- **Cross-Household Tenant Isolation:** Strict 404 rejection on cross-household access to prevent account/household enumeration.
- **Database Schema & RLS:** 12 migrations, 29 tables, RLS enabled on all public tables, zero privileges for `anon`/`PUBLIC`, verified on PostgreSQL 17.10 via `npm run db:verify` and `npm run db:test` (336 assertions).
- **Telemetry Processing & Signs:** Sign conventions strictly enforced: Solar ≥ 0, Battery > 0 discharging, Grid > 0 importing. Field names encode units (`...W`, `...Wh`, `...Percent`).
- **Live Energy Flow View:** 60 FPS HTML5 Canvas energy flow animation loop with particle physics, freshness indicators, and screen reader live region announcements.
- **Tariff Engine & Versioning:** Time-of-use slots, weekend overrides, seasonal rates, exact decimal currency math (`NoFloatMoney`), DST transition handling, and effective-dated profile versioning.
- **Tariff Manager UI:** Visual schedule editor, midnight-crossing decomposition, gap detection, 24h preview, and role restrictions.
- **Accounting Engine & Analytics UI:** Power-to-energy trapezoidal integration, independent import/export costing, standing charges, VAT, counterfactual savings metrics, Recharts graphs, and formula-injection-safe CSV export.
- **Worker API Middleware Pipeline:** 12-stage pipeline: CORS, CSP, payload size cap (64 KiB), rate limiting, idempotency replay, JWT verification, Zod validation.
- **Token Encryption at Rest:** AES-256-GCM encryption with 96-bit random nonce, key ID, and associated authenticated data (AAD = `householdId`, `provider`, `credentialId`, `keyId`).
- **Telemetry Ingestion & Rollups:** Live status polling, historical calendar sync separation, hourly (UTC) and daily (DST-aware) rollups, and 90-day retention purges.
- **Device Controls State Machine:** Command lifecycle (`RECORDED` → `DISPATCHING` → `DISPATCHED` → `RECONCILING` → `DONE`) with intent logging and read-back reconciliation.
- **Emergency Automation Pause:** Immediate household-wide emergency pause switch (`POST /automation/pause`).
- **Automation Rule Engine:** Priority conflict resolution, time window, battery SOC, import rate comparison, staleness checks.
- **Dry-Run Safety Barrier:** Rules default to `DRY_RUN` / `DISABLED`. `DRY_RUN` produces `WOULD_ACT` records in `automation_executions` and never dispatches commands to physical hardware.
- **Household Administration:** Member directory, role mutations, invitations list, audit history, settings management, last-admin protection, self-demotion denial.
- **Cryptographic Invitations:** 256-bit cryptographically secure tokens. Tokens shown once to admin; only SHA-256 hashes stored in database. Zero-SMTP onboarding.
- **Immutable Audit Logging:** Structured security and operational logs with sensitive token redaction.
- **GDPR Compliance Operations:** Article 20 JSON exports for households and personal accounts; Article 17 Right to Erasure requiring typed name confirmation.

---

## 2. Mock-Only

The following components are tested and functional against verified synthetic mocks, isolated from third-party vendor network calls:
- **`MockTeslaClient`:** Simulates Tesla Fleet API OAuth authorization, token refreshing, `live_status`, `energy_sites`, and command endpoints.
- **`MockAuthClient`:** In-memory identity provider for local development (`VITE_AUTH_MODE=mock`) and Playwright E2E smoke tests.
- **`TelemetryProvider` (Demo):** Pure synthetic generator with deterministic PRNG seeds, producing realistic solar bell curves, evening peaks, and grid import scenarios labelled `source: DEMO`.

---

## 3. Awaiting Credentials

The following integrations are implemented and tested, but require production credentials provided by the system owner:
- **Production Supabase Project:** Requires owner's EU project URL, anon key, and service role key.
- **Tesla Fleet API Client Credentials:** Requires registered `TESLA_CLIENT_ID` and `TESLA_CLIENT_SECRET` from the Tesla Developer Portal.
- **Domain Nameservers:** Cloudflare Workers custom domain setup (`autopw3.example.com`).

---

## 4. Awaiting Provider Approval

- **Tesla Fleet API Commercial Application Approval:** Access to the live Tesla Fleet API requires Tesla's third-party application review and billing agreement ($10/month free tier discount per account, followed by pay-per-use data and command rates).

---

## 5. Not Supported by the Connected Device

In compliance with Project Rule 3 and Decision D-003, the following operations are **not documented by the Tesla Fleet API energy endpoints** and are explicitly rejected at the API schema level:
- **Forced Grid Charging:** Not supported by Tesla Powerwall Fleet API.
- **Forced Grid Export:** Not supported by Tesla Powerwall Fleet API.
- **Solar Inverter Bypass:** Not supported by Tesla Powerwall Fleet API.
- **Manual Islanding / Grid Disconnect:** Not supported by Tesla Powerwall Fleet API.

---

## 6. Known Limitations and Release Blockers

### Known Limitations (Non-Blocking)
- **L-091 Currency Support:** Tariff engine currently supports 13 major currencies (EUR, GBP, USD, CHF, CAD, AUD, NZD, SEK, NOK, DKK, PLN, CZK, JPY).
- **L-114 Invitation Delivery:** In v1, invitation tokens are generated by the admin and shared via a copyable link; automated outbound transactional email dispatch via external SMTP provider is deferred to future operational iterations.
- **L-116 Dev-time Undici Advisory:** Advisory GHSA-4qv8-2p9j-2685 in `wrangler/miniflare` devDependency; zero runtime impact on production web or edge Worker bundles.

### Release Blockers
- **Zero Open Critical or High Security Blockers:** All 678 Vitest tests, 336 pgTAP security tests, and 38 Playwright E2E smoke tests pass with 0 failures.

---

## 7. First-Run Owner Guide

Follow this step-by-step procedure when launching a new AutoPW3 instance for a residential Powerwall site:

### Step 1: Start in Demo Mode
1. Run `npm run dev` to start the web app in demo mode (`VITE_DEMO_MODE=true`).
2. Familiarize yourself with the interface: observe live solar/battery/home/grid particle flows, test tariff editing, and inspect analytics graphs. No real hardware or database connections are active.

### Step 2: Bootstrap Household and First Admin
1. Deploy the production stack per `docs/DEPLOYMENT_RUNBOOK.md`.
2. Register the owner account at `/register` and confirm your email.
3. In the Supabase SQL editor, execute `SELECT private.bootstrap_first_admin('<owner-user-id>', 'Primary Household', 'UTC');`.
4. Sign in as admin at `/login`. Verify that the `/admin` navigation link appears and that you have `ADMIN` role.

### Step 3: Connect Tesla Fleet API
1. Navigate to `/settings`.
2. Under **Tesla Connection Status**, click **Connect Tesla Fleet API**.
3. Authorize AutoPW3 in the Tesla OAuth portal. The redirect will exchange the authorization code for encrypted tokens stored in Cloudflare Worker secrets.
4. Verify that the connection status badge updates to `ACTIVE`.

### Step 4: Verify Telemetry Freshness
1. Navigate to `/live`.
2. Confirm that real Powerwall telemetry appears, the battery gauge reflects physical SOC %, and the freshness badge indicates `LIVE (<60s)`.
3. Check `/analytics` to confirm that hourly and daily rollups begin accumulating.

### Step 5: Configure Household Operational Boundaries
1. In `/settings`:
   - Set **Monthly Spend Cap** to `$9.00 USD` (ensures query costs remain comfortably under Tesla's $10 monthly discount).
   - Set **Stale Data Threshold** to `300s` (5 minutes).
   - Verify that **Enable Powerwall Remote Controls** remains disabled initially.

### Step 6: Review Dry-Run Automations
1. Navigate to `/automation`.
2. Create an automation rule (e.g., "Charge battery when import tariff is low").
3. Ensure the rule mode is `DRY_RUN`.
4. Observe the **Execution History** table over subsequent evaluation cycles. Verify that the rule evaluates conditions properly and records decisions as `WOULD_ACT` without sending any physical commands.

### Step 7: (Optional) Enable Supported Hardware Controls
1. When satisfied with telemetry freshness and dry-run rule decisions, navigate to `/settings` and toggle **Enable Powerwall Remote Controls** to enabled.
2. In `/controls`, test a cautious, supported change (e.g., adjust the **Backup Reserve %** by 5%).
3. Verify that the confirmation dialog appears, displays the safety disclaimer ("Configuration Confirmed ≠ Physical Outcome Guaranteed"), and successfully reconciles the new state after dispatch.
