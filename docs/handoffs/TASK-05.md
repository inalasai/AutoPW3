# AutoPW3 - Task Handoff Report

## Task completed
Number and name: TASK-05 Shared domain types and validation
Branch / commit: `Raj-AutoPW3` (owner chose to work on this branch instead of `task-05-shared-types`); commits prefixed `task-05:`. Not pushed. No PR opened.
Date: 2026-10-23

**Status: complete for what could be run locally.** Not done: generated types from the real `supabase gen types` (needs Docker, `NOT_EXECUTED`, L-038), CI on GitHub (nothing pushed). Several shapes are proposals the documents do not define (D-039, L-039 to L-042).

## Summary
`@autopw3/shared` now holds one validated definition for every API shape: identity and roles, sites and capabilities, telemetry with `source` and `quality`, tariffs, device commands and their lifecycle, automation rules, accounting results, pagination and the standard error envelope. Money is a decimal string end to end, signs and units have one definition, and the route table (`ROUTES`) mirrors `docs/API_CONTRACT.md`. Tests fail if the route table, the enums and bounds, or the generated database types drift from the contract or the migrations. The Worker error envelope and the web app's path and response handling now import these definitions.

## Files created
| Path | Purpose |
|---|---|
| `packages/shared/src/constants/{signs,errors,enums,limits,capabilities}.ts`, `constants.test.ts` | Sign convention and helpers, error codes and statuses, closed value lists and command lifecycle, limits, capability identifiers |
| `packages/shared/src/schemas/{primitives,decimal,identity,sites,telemetry,tariffs,commands,automation,accounting,api,routes}.ts` | Zod schemas and inferred types; `ROUTES` registry |
| `packages/shared/src/schemas/*.test.ts` (8 files) and `src/canonical.test.ts` | Valid and invalid payload tests |
| `packages/shared/src/canonical.ts` | Canonical JSON for idempotency body comparison and `params_hash` |
| `packages/shared/src/types/routes.ts`, `routes.test.ts` | `RouteBody`, `RouteQuery`, `RouteResponse` and compile-time checks |
| `packages/shared/src/contract/routes.test.ts`, `db-contract.test.ts` | Drift tests against `API_CONTRACT.md` and the migration SQL |
| `packages/shared/src/db/database.types.ts`, `database.types.test.ts` | Generated Supabase-shaped types and their checks |
| `scripts/db-types.mjs` | `npm run db:types` generator (embedded PostgreSQL 17) with `--check` drift mode |
| `apps/worker/src/providers/tesla/raw-types.ts` | Loose, `UNVERIFIED` raw Tesla shapes and the `NormaliseLiveStatus` boundary type |
| `apps/web/src/lib/api-contract.ts`, `api-contract.test.ts` | `routePath` and `parseRouteResponse` built on `ROUTES` |
| `docs/DOMAIN_TYPES.md` | Schema index, import conventions, boundary, money and time rules, type generation, drift guards |
| `docs/handoffs/TASK-05.md` | This report |

## Files modified
| Path | What changed and why |
|---|---|
| `packages/shared/src/index.ts`, `constants/roles.ts` | Re-exports; `roleAtLeast` (UI hint only) |
| `packages/shared/package.json`, `package-lock.json` | Added `decimal.js` 10.6.0 (exact pin) |
| `apps/worker/src/index.ts`, `index.test.ts` | Error envelope and status from shared (`buildErrorResponse`, `httpStatusFor`); tests parse the envelope with `ErrorResponseSchema` |
| `package.json`, `.prettierignore`, `eslint.config.js` | `db:types` script; generated file excluded from Prettier and ESLint |
| `.github/workflows/ci.yml` | Step `npm run db:types -- --check` (not run on GitHub) |
| `docs/API_CONTRACT.md` | `METHOD_NOT_ALLOWED`, invitation replay without token, optional site `timezone`, discovered-site field names (D-036) |
| `docs/ENERGY_ACCOUNTING.md` | VAT wording corrected to `vatRatePercent` (percent), worked example updated (D-036) |
| `AGENTS.md`, `docs/DEVELOPMENT_SETUP.md`, `docs/DATABASE_SETUP.md`, `docs/TESTING.md`, `docs/README.md`, `packages/shared/README.md`, `apps/worker/README.md`, `apps/web/README.md` | Commands, status lines, new document, boundary notes |
| `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | Appended D-036..D-039 and L-038..L-045 |
| `docs/ai-build-kit/00-README.md` | TASK-05 ticked |
| `.gitkeep` files in `packages/shared/src/{constants,db,schemas,types}` and `apps/worker/src/providers/tesla` | Removed (folders now hold code) |

## Decisions
- **D-036** Owner answers: optional site `timezone` (default household), invitation replay returns no token, VAT as percent, own type generator; additive `METHOD_NOT_ALLOWED`.
- **D-037** Strict Zod 4 schemas, decimal strings, `decimal.js` clone, one `ROUTES` table compared with the contract.
- **D-038** Normalisation boundary file in the Tesla provider folder; persisted samples accept `TESLA` only.
- **D-039** Proposed shapes the documents do not define (command parameters, rule definition v1, export and delete bodies, tariff problem codes, DB-error mapping).

## Database changes
None. No migration was added; `npm run db:types -- --check` confirms the generated types match the 11 existing migrations.

## API changes
No endpoint is implemented. The contract gained: optional `timezone` on `POST /households/{hid}/sites`; invitation replay returns `token: null` and `link: null`; error code `METHOD_NOT_ALLOWED` (405); discovered-site items are `providerSiteId` and `name`. Authorisation rules are unchanged: roles stay in the database and the Worker, and `roleAtLeast` is only a UI hint.

## Checks executed
| Exact command | Executed? | Result | Relevant output/failure |
|---|---|---|---|
| `npm run typecheck` | yes | pass | all four workspaces, strict |
| `npm run lint` | yes | pass | ESLint, 15 architecture rule checks, Prettier (`All matched files use Prettier code style!`) |
| `npm test` | yes | pass | shared 15 files / 226 tests; domain 1 / 3; web 3 / 10; worker 1 / 4 |
| `npm run build` | yes | pass | Vite build and Wrangler dry-run bundle |
| `npm run check` | yes | pass (exit 0) | typecheck, lint, tests, build, secrets scan |
| `npm run db:types -- --check` | yes | pass | `packages/shared/src/db/database.types.ts is up to date`; 11 migrations applied |
| `npm run secrets:scan` | yes | pass | no findings |
| `npm run db:test` | yes | pass | 336 ok, 0 not ok across 11 files |
| `npm run db:verify` | yes | pass | `All database checks passed` |
| Clean clone of the branch into a temp folder: `npm ci`, `npm run check`, `npm run db:types -- --check` | yes | pass | all three exit 0; same test counts as above |
| `npx supabase@2.122.0 gen types typescript --local` | no | `NOT_EXECUTED` | needs Docker |
| GitHub Actions run | no | `NOT_EXECUTED` | nothing pushed |

## Manual verification
Read the generated file's `Functions` section against `supabase/migrations/20261023130200_identity_and_membership_functions.sql` (argument names, types and return shapes of the 8 functions). The drift tests caught one real discrepancy while being written: `GET /sites/{siteId}/automation/executions` was task `18` in the contract and `14/18` in the first draft of `ROUTES`; the registry was corrected.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Types and Zod schemas for users, membership, roles, invitations | VERIFIED | `schemas/identity.ts`, tests |
| Sites and capabilities (supported, unsupported, unverified) | VERIFIED | `schemas/sites.ts`, `constants/capabilities.ts` |
| Normalised telemetry with `source` and `quality` | VERIFIED | `schemas/telemetry.ts`; `TESLA`-only persisted schemas |
| Tariffs | VERIFIED | `schemas/tariffs.ts`; overlap and coverage deferred to TASK-10 (L-044) |
| Automation rules | MOCK_ONLY | Rule definition v1 is a proposal (L-040) |
| Decimal-safe financial values, string serialisation, parsing helpers | VERIFIED | `schemas/decimal.ts`, `decimal.test.ts` |
| Tesla provider types separate, boundary marked | VERIFIED (raw shapes `UNVERIFIED`) | `apps/worker/src/providers/tesla/raw-types.ts` |
| API contracts, pagination, standard error shape with stable codes | VERIFIED | `schemas/api.ts`, `routes.ts`, contract drift test |
| Device commands, idempotency, lifecycle | VERIFIED (parameter shapes `UNVERIFIED`) | `schemas/commands.ts`, `constants/enums.ts`, `canonical.ts` |
| Centralised sign convention | VERIFIED | `constants/signs.ts`, `constants.test.ts` |
| Validation of dates, timezones, rates, percentages, windows, roles, command parameters | VERIFIED | primitives, tariffs, commands tests |
| Generated Supabase DB types with documented command | VERIFIED (own generator; real `supabase gen types` `NOT_EXECUTED`) | `npm run db:types`, `--check` |
| Apps import from `@autopw3/shared`; no parallel definitions | VERIFIED | Worker envelope and web `api-contract.ts`; no duplicate shape existed elsewhere |
| `docs/DOMAIN_TYPES.md` | VERIFIED | Created |
| Tests for invalid payloads (bad role, SOC 120, malformed timezone, negative window, non-string money) | VERIFIED | identity, telemetry, tariffs, decimal tests |

## Verification status register
- Shared types, schemas, drift tests, decimal helpers: VERIFIED (run).
- Generated database types: VERIFIED against PostgreSQL 17.10 only; real Supabase generator `UNVERIFIED`.
- Tesla native shapes, signs, command payloads, `operationMode` values: `UNVERIFIED` (L-003, L-005, L-039); everything stays `MOCK_ONLY`.
- CI workflow change: `NOT_EXECUTED` on GitHub.

## Outstanding issues
- L-038 to L-045 in `docs/KNOWN_LIMITATIONS.md`.
- Owner decisions still open: Q-06 (a redacted read-only `live_status` and `site_info` sample) would settle the native signs and let the normaliser be written.
- Household deletion has no database path (L-032, L-041).

## Environment variables
None added.

## Instructions for the next task
- Import from `@autopw3/shared` only. Use `ROUTES`, `RouteBody`, `RouteQuery`, `RouteResponse` for handlers and clients, and `buildErrorResponse` and `httpStatusFor` for errors. Do not define a second error envelope.
- Money columns: select as `col::text`, parse with `parseDecimal`, serialise with `serialiseDecimal`. Never `parseFloat`, `Number` or `toFixed`.
- After any migration run `npm run db:types` and commit the result; CI checks it.
- When a route is added or changed, edit `docs/API_CONTRACT.md` section 2 and `ROUTES` together; `contract/routes.test.ts` must stay green.
- Tesla raw types stay in `apps/worker/src/providers/tesla`; only a function of type `NormaliseLiveStatus` may produce internal data.
- Must not change: sign convention in `constants/signs.ts`, the persisted-source rule (`TESLA` only), `physicalOutcomeGuaranteed: false`.

## Next task
TASK-06 (design system and app shell). Prerequisites: this task merged or checked out. No credentials needed.
