# TASK 21 — Deployment and Release

**Phase 6 · Release.**

## Goal
Produce a documented, repeatable deployment and a release checklist. Deploy only if the owner supplies credentials and approves.

## Inputs
`AGENTS.md`, `docs/ai-build-kit/02-PROJECT-CONTEXT.md`, `docs/ai-build-kit/04-REPO-STRUCTURE.md`, `docs/handoffs/TASK-20.md`, `docs/SECURITY_AUDIT.md`, `docs/VERIFICATION_REGISTER.md`, repository.

## Stop conditions
- Task 20 left open critical or high findings: **do not produce a "ready" declaration**; list blockers.
- Never write real secret values into any file. Use placeholders and secure configuration instructions.
- Verify Cloudflare and Supabase procedures against current official docs; do not rely on memory.

## Plan step
List environments (local, staging, production), the order of deployment steps and rollback points.

## Requirements
Verified, ordered instructions for:
- Supabase: project setup, region choice (EU for the owner's data protection needs, owner to confirm), applying migrations, Auth configuration (email confirmation, redirect URLs, password policy), key handling, **admin bootstrap procedure** execution and verification that it cannot rerun.
- Cloudflare: static frontend deployment, Worker deployment, secrets (token-encryption key, Tesla client credentials, Supabase keys), cron triggers, custom domains, CORS allowlist, security headers/CSP.
- Tesla: redirect URLs, key hosting, region endpoints, per Task 00/15 setup steps.
- CI/CD workflows: test gates before deploy; staging deployment; manual approval for production; migrations applied safely (documented ordering relative to code).
- Health checks and smoke tests post-deploy.
- **Backups and recovery:** database backup policy, a documented restore drill, migration rollback notes, encryption-key backup/rotation procedure, token reconnect procedure after key loss.
- Observability: structured logs without secrets, alerting suggestions (sync stale, cron failures, command UNKNOWN spikes), uptime check.
- `.env.example`, `wrangler` configuration (current format), scripts.

## Deliverables
`README.md` (final), `docs/DEPLOYMENT_RUNBOOK.md`, `docs/RECOVERY_GUIDE.md`, `docs/SECURITY_CHECKLIST.md`, `docs/RELEASE_CHECKLIST.md` with sections:
1. Verified working
2. Mock-only
3. Awaiting credentials
4. Awaiting provider approval
5. Not supported by the connected device
6. Known limitations and release blockers

Also a first-run owner guide: create household, start in demo → connect Tesla → verify freshness → review dry-run automations → (optionally) enable a single supported control manually.

## Verification
Run build and test commands from a clean checkout. Run a deployment dry-run to staging only if credentials are provided; otherwise mark `NOT_EXECUTED`.

## Acceptance criteria
- The app builds from a clean checkout; security tests pass.
- Runbook is complete, ordered and uses placeholders for all secrets.
- Release checklist states the true verification status of Tesla integration and all other features.
- No claim of production readiness while a critical blocker exists.

## Repo locations
Branch: `task-21-deployment-release`. Commit prefix: `task-21:`. Write to: `.github/workflows/`, `README.md`, `docs/DEPLOYMENT_RUNBOOK.md`, `docs/RECOVERY_GUIDE.md`, `docs/SECURITY_CHECKLIST.md`, `docs/RELEASE_CHECKLIST.md`. Write elsewhere only if you explain why in the handoff.
Open a PR with `.github/pull_request_template.md` and save the handoff to `docs/handoffs/TASK-21.md` (template: `docs/ai-build-kit/03-HANDOFF-TEMPLATE.md`).

## Handoff
`docs/handoffs/TASK-21.md`.
