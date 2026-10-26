# AutoPW3

**Subscription-free residential energy management for Tesla Powerwall sites.**  
Live energy-flow visualization, tariff-aware analytics, supported device controls, safe automation, and household administration.

---

## Overview

AutoPW3 is a modern, privacy-first web application designed for Tesla Powerwall owners who want complete visibility and safe control over their home energy system without ongoing subscription fees or cloud lock-in.

### Key Capabilities
- **Animated Live Energy Flow:** High-performance 60 FPS HTML5 Canvas animation loop showing real-time solar generation, home consumption, battery state-of-charge, and grid import/export flows with particle physics and accessible screen-reader summaries.
- **Tariff Engine & Versioning:** True interval-cost accounting supporting time-of-use (TOU) rates, weekend/weekday pricing, seasonal variations, exact decimal currency math (`NoFloatMoney`), and DST-correct schedules.
- **Tariff-Aware Analytics:** Historical energy and cost charts (Recharts), financial savings breakdown, counterfactual metrics ("what would this cost without solar/battery?"), and formula-injection-safe CSV exports.
- **Safe Hardware Controls:** Intent-logged command state machine with read-back reconciliation. Adheres strictly to physical safety limits: unsupported operations (forced charging, forced export, solar bypass, manual islanding) are rejected at the schema level.
- **Dry-Run Automation Engine:** Scheduled rule engine that defaults to `DRY_RUN` mode, evaluating real condition states (time windows, battery SOC, import rate thresholds) and recording simulated outcomes (`WOULD_ACT`) without dispatching commands to physical hardware.
- **Household Administration & RBAC:** Authoritative monotonic role hierarchy (`READ_ONLY` < `READ_WRITE` < `ADMIN`), cross-household tenant isolation (404 rejection), cryptographic member invitations (zero SMTP dependency), and last-admin protection.
- **Compliance & Privacy Operations:** Immutable audit trail, automated telemetry retention purges, GDPR Article 20 data portability (portable JSON exports for households and accounts), and GDPR Article 17 Right to Erasure workflows.

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Lucide icons, Recharts, HTML5 Canvas.
- **Edge Backend:** Cloudflare Workers (Static Assets + API + periodic Cron Triggers).
- **Database & Auth:** Supabase (PostgreSQL 17 with universal Row-Level Security, Supabase Auth).
- **Domain Engine:** Pure TypeScript domain models (`@autopw3/domain`) with zero external network or clock side-effects.
- **Testing & Verification:** Vitest, React Testing Library, Playwright, pgTAP SQL tests, Secretlint, ESLint, Prettier.

---

## Repository Map

```
autopw3/
├── apps/
│   ├── web/             # React front end (UI, routing, feature modules)
│   └── worker/          # Cloudflare Worker API, Tesla adapter, ingestion, automation
├── packages/
│   ├── shared/          # Unified Zod schemas, route contracts, database types
│   └── domain/          # Pure energy domain (telemetry, tariff engine, accounting math)
├── supabase/
│   ├── migrations/      # 12 versioned migrations (schema, RLS, functions, constraints)
│   └── tests/database/  # 11 pgTAP SQL security and isolation test suites
├── e2e/                 # Playwright end-to-end smoke tests (desktop & mobile-360)
└── docs/                # Architecture, runbooks, security audits, and handoff reports
```

---

## Quickstart (Local Demo Mode)

AutoPW3 runs out of the box in **Demo Mode** with realistic, synthetic energy telemetry and mock authentication—**zero credentials or external accounts required**.

### Prerequisites
- Node.js 22 or newer
- npm 10 or newer

### Installation & Launch
```bash
# 1. Clone repository and install dependencies
git clone https://github.com/inalasai/AutoPW3.git
cd AutoPW3
npm install

# 2. Run test and validation pipeline
npm run check

# 3. Start local development server (demo mode)
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Commands & Scripts

```bash
npm run typecheck      # TypeScript strict check across all workspaces & e2e
npm run lint           # ESLint, architectural boundary checks, Prettier
npm test               # Run all 678 Vitest unit and integration tests
npm run build          # Production build for web client and Cloudflare Worker
npm run secrets:scan   # Secretlint scan across all repository files
npm run db:verify      # Verify all 12 migrations and constraints on PostgreSQL 17
npm run db:test        # Run all 336 pgTAP SQL security tests on PostgreSQL 17
npm run db:types       # Verify database TypeScript types drift
npm run check          # Run the full validation pipeline above
npm run test:e2e       # Run Playwright E2E smoke tests (desktop & mobile)
npm run dev            # Start web application in demo mode
npm run dev:worker     # Start Cloudflare Worker locally via Wrangler
```

---

## Production Deployment & Operational Guides

For setting up a live instance with your own Supabase project and Tesla Developer credentials, consult the operational runbooks:

- 📖 **[Deployment Runbook](docs/DEPLOYMENT_RUNBOOK.md):** Step-by-step ordered setup for Supabase, Cloudflare Workers, and Tesla OAuth.
- 📋 **[Release Checklist](docs/RELEASE_CHECKLIST.md):** Release verification matrix and owner's first-run guide.
- 🔒 **[Security Audit Report](docs/SECURITY_AUDIT.md):** Defense-in-depth review, threat model, and Endpoint × Role matrix.
- 🧪 **[Test & Verification Report](docs/TEST_REPORT.md):** Complete test execution logs and verification evidence.
- 🛡️ **[Operational Security Checklist](docs/SECURITY_CHECKLIST.md):** Credential management, key rotation schedules, and audit cadence.
- 🚨 **[Disaster Recovery & Backup Guide](docs/RECOVERY_GUIDE.md):** Database backup policy, restore drills, key rotation, and rollback runbooks.
- 📊 **[Verification Register](docs/VERIFICATION_REGISTER.md):** Detailed feature verification status register.

---

## Security & Privacy by Design

AutoPW3 adheres to strict non-negotiable security principles:
1. **Zero Secret Leakage:** Tesla access/refresh tokens are encrypted at rest using AES-256-GCM and never leave the server.
2. **Authoritative Role Control:** The browser is never trusted. Every mutation is authorized by database row-level security per household.
3. **Hardware Safety Invariant:** Automated rules default to dry-run. Destructive or unverified operations (forced charging, forced export, islanding) are prohibited.
4. **GDPR Ready:** Built-in self-service tools for Article 20 data export and Article 17 account/household erasure with last-admin protection.

To report security issues, review [SECURITY.md](SECURITY.md).

---

## License

All rights reserved until a public license is designated by the project owner.
