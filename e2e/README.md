# e2e — end-to-end tests

**Status:** auth smoke test done (TASK-07, `auth.spec.ts`); extended through TASK-20.

## Purpose
Playwright tests that exercise the real app through the browser against mocks or a local Supabase. No live Tesla calls.

## Layout
One spec per journey, for example `auth.spec.ts`, `tariffs.spec.ts`, `analytics.spec.ts`, `controls.spec.ts`, `admin.spec.ts`.

## Required journeys by release
Register and login; READ_ONLY access; tariff create and validate; analytics; Tesla OAuth callback (mock); ingestion (mock); command lifecycle (mock); automation dry-run; invitation and role change; unauthorised rejection.

## How it runs
`playwright.config.ts` (repository root) starts `npm run dev -w @autopw3/web` on port 5183 with `VITE_DEMO_MODE=false` and `VITE_AUTH_MODE=mock`, then runs every spec at 1280 px (`desktop`) and 360 px (`mobile-360`). The mock identity provider is in-memory and development-only; seeded accounts are listed in `docs/AUTHENTICATION_SETUP.md`. First run: `npx playwright install chromium`. Types are checked by `npm run typecheck` (`e2e/tsconfig.json`).

## Rules
- Tests never need real credentials. Use demo mode or a local stack.
- Never commit traces, videos or reports containing tokens (`playwright-report/` is git-ignored).
- Run with `npm run test:e2e`.

Status: `staging-tesla.pw.ts` exercises the actual production-built `--mode staging` app, real Supabase
client code with intercepted fixtures, lost-response duplicate protection, REAUTH/recovery, expiry,
rate limiting and labelled DEMO telemetry. Run after the staging build with
`npx playwright test --config playwright.staging.config.ts`. Every request is intercepted or aborted;
real hosted/Tesla verification remains a separately approved step.

Status: explicit manual read-only OAuth initiation is wired through the existing authenticated endpoint.
It validates the Tesla redirect and cannot run automatically on a recovery error.
# Portable staging fixture

Status: staging browser tests derive the public Supabase origin from the same local staging
configuration as the build. Every request is intercepted; no personal project/account is required
and no provider request is allowed. See [team development](../docs/TEAM_DEVELOPMENT.md).
