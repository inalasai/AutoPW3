# Testing Strategy

Never claim a check passed unless you ran it and saw the result. Anything not run is `NOT_EXECUTED`.

## Layers

| Layer | Tool | Where | What it proves |
|---|---|---|---|
| Unit | Vitest | `*.test.ts` beside code | Pure logic: tariff, accounting, normalisation, schemas |
| Component | Vitest + React Testing Library | `apps/web/**/*.test.tsx` | UI states, role-aware controls, accessibility |
| API | Vitest | `apps/worker/**/*.test.ts` | Auth, roles, validation, cross-household denial, error sanitisation |
| Database | pgTAP-style SQL (`npm run db:test` on a throwaway PostgreSQL 17 with a test shim; `supabase test db` on a real stack, NOT_EXECUTED so far) | `supabase/tests/database/` | RLS, grants, role escalation denial, bootstrap, invitations, audit, constraints (`npm run db:verify`) |
| End-to-end | Playwright | `e2e/` | Real journeys in the browser against mocks or a local stack |
| Live Tesla | manual only | owner-run | Real-site verification, never automated |

## Commands (after TASK-02, 03, 04, 07)
```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run db:test
npm run test:e2e
```

## Rules
- **Mocks first.** All Tesla behaviour is developed against the mock adapter. Live integration stays `UNVERIFIED` until an authorised site is tested manually.
- **Never run live control commands automatically.** A first real-device test follows `docs/DEVICE_CONTROL_SAFETY.md`.
- **Time:** use an injected fake clock. Test DST spring-forward and fall-back days and boundary instants.
- **Money:** golden values verified independently of the code under test.
- **Determinism:** demo data is seeded; no randomness in tests.
- **Security tests are blockers.** A failing RLS, role-escalation, credential or cross-household test stops the merge.
- **Coverage:** report the real number per package. Do not game it. The tariff and accounting packages are expected to be near-exhaustive.

## Required security tests (summary)
New-user default role; READ_ONLY write denial; cross-household read and write denial; role self-escalation denial; credential table access denial; last-admin protection; bootstrap once only; invitation expiry and reuse; JWT forged or expired; READ_ONLY token rejected on every mutating endpoint; token material absent from API responses and logs; demo data rejected from live tables.

## CI gates
Every pull request runs type check, lint, unit and component tests, build, API tests, database tests and a secrets scan. Production deploys also require the end-to-end suite and manual approval.
