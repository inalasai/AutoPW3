# packages/shared — types and schemas

**Status:** skeleton (TASK-02): role constants (`ROLES`, `DEFAULT_ROLE`) and the health response schema, with tests. Domain types and generated DB types arrive in TASK-05. Package name: `@autopw3/shared`; consumed as TypeScript source.

## Purpose
The single source of truth for TypeScript types, Zod schemas, constants and generated database types. Used by the web app and the Worker.

## Where code goes
| Path | Content |
|---|---|
| `src/schemas/` | Zod runtime schemas (API, telemetry, tariffs, rules, commands) |
| `src/types/` | Inferred and hand-written types |
| `src/constants/` | Roles, sign convention, command states, error codes |
| `src/db/database.types.ts` | **Generated** from the Supabase schema. Never hand-edit |

## Rules
- No business logic and no I/O. Depends only on `zod` and the decimal library.
- Units in names (`solarPowerW`, `batterySocPercent`, `importRatePerKwh`). Money is a decimal string over JSON.
- Tesla provider types are not defined here; only normalised internal types are.
- Regenerate DB types with `npm run db:types` after any migration.

## Tests
Valid and invalid payload tests next to schemas (`*.test.ts`).
