# Testing Strategy

Never claim a check passed unless you ran it and saw the result. Anything not run is `NOT_EXECUTED`.

## Layers

| Layer | Tool | Where | What it proves |
|---|---|---|---|
| Unit | Vitest | `*.test.ts` beside code | Pure logic: tariff, accounting, normalisation, schemas |
| Component | Vitest + React Testing Library | `apps/web/**/*.test.tsx` | UI states, role-aware controls, accessibility |
| API | Vitest | `apps/worker/**/*.test.ts` | Auth, roles, validation, cross-household denial, error sanitisation |
| Database | pgTAP-style SQL (`npm run db:test` on a throwaway PostgreSQL 17 with a test shim; `supabase test db` on a real stack, NOT_EXECUTED so far) | `supabase/tests/database/` | RLS, grants, role escalation denial, bootstrap, invitations, audit, constraints (`npm run db:verify`) |
| Contract drift | Vitest in `packages/shared` (`contract/`) and `npm run db:types -- --check` | route table vs `API_CONTRACT.md`, enums and bounds vs migrations, generated types vs migrations | Contract, shared types and database cannot silently disagree (`docs/DOMAIN_TYPES.md` section 7) |
| End-to-end | Playwright | `e2e/` | Real journeys in the browser against mocks or a local stack. TASK-07: sign-in, protected routes, role-aware UI and tamper checks at 1280 px and 360 px against the development-only mock identity provider |
| Live Tesla | manual only | owner-run | Real-site verification, never automated |

## Commands (after TASK-02, 03, 04, 07)
`npm run test:e2e` is not part of `npm run check` (it needs a one-off `npx playwright install chromium`). Run it before handing off any task that changes the browser app.

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run db:test
npm run db:types -- --check
npm run test:e2e
```

## Rules
- **Mocks first.** All Tesla behaviour is developed against the mock adapter. Live integration stays `UNVERIFIED` until an authorised site is tested manually.
- **Never run live control commands automatically.** A first real-device test follows `docs/DEVICE_CONTROL_SAFETY.md`.
- **Time:** use an injected fake clock. Test DST spring-forward and fall-back days and boundary instants.
- **Money:** golden values verified independently of the code under test.
- **Determinism:** demo data is seeded; no randomness in tests. Property-based tests (`fast-check`, in `packages/domain/src/tariff/properties.test.ts`) pass a fixed `seed`, so every run tries the same cases; change the seed or `numRuns` deliberately to search further.
- **Coverage tooling:** `npm run test:coverage -w @autopw3/domain` (V8, `@vitest/coverage-v8`) reports `packages/domain/src/tariff`. It is on demand, not in `npm run check`, and has no threshold; report the printed numbers as they are. The text report hides files at 100%, so read `packages/domain/coverage/coverage-summary.json` for all of them.
- **Canvas and animation (web):** jsdom has no canvas. `test-setup.ts` makes `getContext` return `null`; tests that draw install `features/live/fake-canvas.ts`, which records draw calls, and stub `requestAnimationFrame`. Pixels are not tested; check the look in a browser. Hooks that poll are tested with real timers and short intervals (React's async `act` stalls with fake timers) and need a stable provider object.
- **Security tests are blockers.** A failing RLS, role-escalation, credential or cross-household test stops the merge.
- **Coverage:** report the real number per package. Do not game it. The tariff and accounting packages are expected to be near-exhaustive.

## Required security tests (summary)
New-user default role; READ_ONLY write denial; cross-household read and write denial; role self-escalation denial; credential table access denial; last-admin protection; bootstrap once only; invitation expiry and reuse; JWT forged or expired; READ_ONLY token rejected on every mutating endpoint; token material absent from API responses and logs; demo data rejected from live tables.

## CI gates
Every pull request runs type check, lint, unit and component tests, build, API tests, database tests and a secrets scan. Production deploys also require the end-to-end suite and manual approval.
