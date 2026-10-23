# packages/shared - types and schemas

**Status:** implemented (TASK-05). Zod schemas and inferred types for every API shape, constants and enums, the sign convention, decimal-safe money helpers, the route table of `docs/API_CONTRACT.md`, canonical JSON and generated database types. Package name: `@autopw3/shared`; consumed as TypeScript source. Full index and conventions: `docs/DOMAIN_TYPES.md`.

## Purpose
The single source of truth for TypeScript types, Zod schemas, constants and generated database types. Used by the web app and the Worker.

## Where code goes
| Path | Content |
|---|---|
| `src/constants/` | Roles, sign convention, error codes, enums and command lifecycle, limits, capability identifiers |
| `src/schemas/` | Zod runtime schemas (identity, sites, telemetry, tariffs, commands, automation, accounting, API envelope) and `ROUTES` |
| `src/types/` | Types derived from `ROUTES` (`RouteBody`, `RouteQuery`, `RouteResponse`) |
| `src/contract/` | Tests that compare the code with `API_CONTRACT.md` and the migration SQL |
| `src/canonical.ts` | Canonical JSON for idempotency comparison and `params_hash` |
| `src/db/database.types.ts` | **Generated** by `npm run db:types`. Never hand-edit |

## Rules
- No business logic and no I/O. Depends only on `zod` and `decimal.js`.
- Import from the package root only. One definition per shape; the apps never redefine one.
- Units in names (`solarPowerW`, `batterySocPercent`, `importRatePerKwh`). Money is a decimal string over JSON; percent fields are percent, not fractions.
- Tesla provider types are not defined here; only normalised internal types are (`apps/worker/src/providers/tesla/raw-types.ts` holds the raw shapes).
- Regenerate DB types with `npm run db:types` after any migration; CI runs `npm run db:types -- --check`.
- Database `numeric` columns are typed `number` in the generated types but are not exact; select money as `col::text` (`NUMERIC_COLUMNS`).

## Tests
Valid and invalid payload tests beside each schema (`*.test.ts`), compile-time checks with `expectTypeOf`, and the drift tests in `src/contract/`.
