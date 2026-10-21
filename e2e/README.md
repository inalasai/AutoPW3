# e2e — end-to-end tests

**Status:** not started (smoke test in TASK-07, extended through TASK-20).

## Purpose
Playwright tests that exercise the real app through the browser against mocks or a local Supabase. No live Tesla calls.

## Layout
One spec per journey, for example `auth.spec.ts`, `tariffs.spec.ts`, `analytics.spec.ts`, `controls.spec.ts`, `admin.spec.ts`.

## Required journeys by release
Register and login; READ_ONLY access; tariff create and validate; analytics; Tesla OAuth callback (mock); ingestion (mock); command lifecycle (mock); automation dry-run; invitation and role change; unauthorised rejection.

## Rules
- Tests never need real credentials. Use demo mode or a local stack.
- Never commit traces, videos or reports containing tokens (`playwright-report/` is git-ignored).
- Run with `npm run test:e2e`.
