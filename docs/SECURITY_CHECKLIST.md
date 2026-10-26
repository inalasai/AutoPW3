# AutoPW3 — Operational Security Checklist

Production operational security checklist and recurring review cadence.

---

## 1. Pre-Deployment Release Gates

Before deploying any release to staging or production, confirm all gates pass:
- [ ] **Dependency Audit:** `npm audit --audit-level=high` reports zero production vulnerabilities.
- [ ] **Secret Scanning:** `npm run secrets:scan` passes with zero findings.
- [ ] **Universal RLS:** `npm run db:verify` passes with 100% checks (all public tables protected, `tesla_credentials` server-only).
- [ ] **Database Security Tests:** `npm run db:test` passes 336 pgTAP assertions with 0 failures on PostgreSQL 17.
- [ ] **Full Type Checking:** `npm run typecheck` succeeds across all workspaces and e2e tests.
- [ ] **Linter & Architecture Rules:** `npm run lint` passes (no money floats, strict import boundaries).
- [ ] **End-to-End Suite:** `npm run test:e2e` passes all 38 Playwright smoke tests.
- [ ] **Security Headers:** Verified CSP, HSTS, X-Frame-Options (`DENY`), X-Content-Type-Options (`nosniff`).

---

## 2. Secrets Management & Storage Hygiene

- [ ] **No Client-Side Secrets:** `apps/web` contains only public `VITE_*` variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DEMO_MODE`).
- [ ] **Server Secrets Storage:** All sensitive credentials (`SUPABASE_SECRET_KEY`, `TOKEN_ENCRYPTION_KEY`, `TESLA_CLIENT_SECRET`) reside exclusively in encrypted Cloudflare Worker secrets.
- [ ] **Token Encryption at Rest:** Powerwall access and refresh tokens are stored exclusively as AES-256-GCM ciphertext with AAD binding.
- [ ] **Invitation Tokens Hashed:** Database stores only SHA-256 hashes of invitation tokens (`token_hash`); raw tokens are never persisted.
- [ ] **Zero Secret Logging:** Audit logs, telemetry records, and application error messages are sanitized of tokens, passwords, and authorization headers.

---

## 3. Recurring Security Cadence

| Frequency | Activity | Responsible Role | Runbook Reference |
|---|---|---|---|
| **Every Commit / PR** | Automated CI pipeline: secrets scan, linter, tests, pgTAP SQL tests | GitHub Actions | `.github/workflows/ci.yml` |
| **Monthly** | Dependency vulnerability review (`npm audit`) and updates | Developer / Maintainer | `docs/DEVELOPMENT_SETUP.md` |
| **Quarterly** | Database backup restore drill into temporary staging database | Administrator / DevOps | `docs/RECOVERY_GUIDE.md` |
| **Biannual** | Master token encryption key rotation (`TOKEN_ENCRYPTION_KEY`) | Administrator / DevOps | `docs/RECOVERY_GUIDE.md` §4 |
| **Annual** | End-to-end security architecture audit & RLS policy review | Security Reviewer | `docs/SECURITY_AUDIT.md` |

---

## 4. Operational Invariants & Safeguards

- **Backend Authoritative:** Client-supplied role headers or local storage values are never trusted. All access decisions evaluate database membership per request.
- **Cross-Household 404:** Accessing resources across households terminates with HTTP 404 (`NOT_FOUND`), preventing existence enumeration.
- **Last-Admin Protection:** Neither self-demotion nor removal of the last remaining active `ADMIN` is permitted.
- **Automations Default Off:** All automation rules initialize in `DRY_RUN` or `DISABLED` mode. Dry-run executions record simulated decisions (`WOULD_ACT`) and never dispatch hardware commands.
- **Physical Safety Limits:** Forced charging, forced export, solar bypass, and manual islanding are strictly rejected at the API schema level (Decision D-003).
