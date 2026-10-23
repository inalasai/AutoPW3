# Domain Types and Validation (`@autopw3/shared`)

**Status:** implemented in TASK-05. Source: `packages/shared/src`. Contract the schemas implement: `docs/API_CONTRACT.md`. Database they mirror: `docs/DATABASE_DICTIONARY.md` and `supabase/migrations`.

One schema per shape: a Zod schema is the runtime check and the TypeScript type (`z.infer`). The web app and the Worker import from `@autopw3/shared` only; nobody redefines a shape. The package has no logic beyond validation, small pure helpers (sign conventions, decimal parsing, canonical JSON) and no I/O.

## 1. Import conventions
```ts
import { RoleSchema, type Role, ROUTES, buildErrorResponse } from '@autopw3/shared';
```
- Always import from the package root `@autopw3/shared`, never from a sub-path (`src/schemas/...`).
- `FooSchema` is the Zod schema, `Foo` the inferred type, `FOOS` (upper case, plural) a constant tuple of allowed values.
- Field names carry the unit: `...W`, `...Wh`, `...Kwh`, `...Percent`, `...PerKwh`, `...PerDay`.
- Request bodies use `z.strictObject`: an unknown field is a `VALIDATION_FAILED`, not silently dropped.
- Parse at the edge only (Worker request, web response). Inside the code base pass the parsed, typed value.
- Anything the browser decides is a hint. `roleAtLeast` is for hiding buttons; the Worker and the database authorise.

## 2. Schema index
| File | What it holds |
|---|---|
| `constants/roles.ts` | `ROLES` (`READ_ONLY`, `READ_WRITE`, `ADMIN`), `DEFAULT_ROLE`, `roleAtLeast` |
| `constants/signs.ts` | The sign convention and helpers (section 3) |
| `constants/errors.ts` | `ERROR_CODES`, `ERROR_HTTP_STATUS`, `DB_ERROR_TO_API_ERROR` |
| `constants/enums.ts` | Every closed value list (sources, qualities, tariff enums, command kinds, states and lifecycle transitions, audit actions, rule modes) |
| `constants/limits.ts` | Pagination, body sizes, maximum ranges, idempotency key and invitation limits, text lengths, settings and tariff bounds |
| `constants/capabilities.ts` | Capability identifiers: read, command (one per command kind) and unsupported |
| `schemas/primitives.ts` | UUID, UTC instant, local date, IANA timezone, currency, percent, power, energy, minutes, time window, pagination, ranges |
| `schemas/decimal.ts` | Decimal strings: rate, money amount, percent, spend; `parseDecimal`, `serialiseDecimal`, `Decimal` |
| `schemas/identity.ts` | Profile, household, membership, `me`, members, role change, invitations, settings, automation pause |
| `schemas/sites.ts` | Sites, capabilities, Tesla link status, discovered sites |
| `schemas/telemetry.ts` | Power samples (`source`, `quality`), live reading, energy intervals, series queries and responses |
| `schemas/tariffs.ts` | Tariff, slot, season, override, levy, price point, create and end requests, validation result |
| `schemas/commands.ts` | The six command kinds, request, accepted, outcome, record, events |
| `schemas/automation.ts` | Rule definition v1 (conditions and actions), create and update requests, rule, execution |
| `schemas/accounting.ts` | Cost components, daily and monthly costs, coverage, metrics |
| `schemas/api.ts` | Error envelope and builders, audit entries, export and delete bodies |
| `schemas/routes.ts` | `ROUTES`: every endpoint of `API_CONTRACT.md` section 2 with method, path, access, task, query, body and response schemas |
| `types/routes.ts` | `RouteBody<N>`, `RouteQuery<N>`, `RouteResponse<N>` derived from `ROUTES` |
| `canonical.ts` | `canonicalJson` for idempotency body comparison and `params_hash` |
| `db/database.types.ts` | **Generated** database types (section 6) |

## 3. Sign convention (one definition, `constants/signs.ts`)
Solar >= 0. Battery `> 0` discharging, `< 0` charging. Grid `> 0` importing, `< 0` exporting. Power in W, energy in Wh, battery state in whole percent. Use `batteryDirection`, `gridDirection`, `gridImportW`, `gridExportW`, `batteryDischargeW`, `batteryChargeW` and `powerBalanceResidualW` instead of re-deriving. The balance check uses `BALANCE_TOLERANCE_FLOOR_W` (100 W) or `BALANCE_TOLERANCE_PERCENT` (5 %), whichever is larger. Tesla's native signs are `UNVERIFIED` (L-003); the mapping lives only in the Tesla adapter.

## 4. Normalisation boundary
Tesla-native shapes are defined only in `apps/worker/src/providers/tesla/raw-types.ts`, as loose `Record<string, unknown>` types plus the declared `NormaliseLiveStatus` function type. `@autopw3/shared` holds only normalised internal types. `PersistedPowerSampleSchema` and `EnergyIntervalSchema` accept `source: 'TESLA'` only (the database has the same `CHECK`); only API live and demo responses accept `source: 'DEMO'`, so demo data cannot be validated as something to persist. The lint rules keep the web app away from provider code.

## 5. Money, time and percentages
- Money, rates and any exact amount are **decimal strings** such as `"0.317500"`. The schemas reject numbers, exponents, leading zeros, a plus sign and spaces, and bound the value to the matching `numeric(p, s)` column. A money value is `{ amount, currency }` with an ISO 4217 code.
- Percentages are percent everywhere: `vatRatePercent` is `"23.0000"`, not `0.23` (D-036). VAT is `taxable x vatRatePercent / 100`.
- `parseDecimal(s)` returns a `Decimal` (a private `decimal.js` clone, precision 28, round half up). `serialiseDecimal(value, scale)` returns the string. Do not use `parseFloat`, `Number` or `toFixed` on money (lint rule).
- Instants are UTC ISO strings ending in `Z` (`InstantUtcSchema`). Local dates are `YYYY-MM-DD`. Timezones are IANA names (`Europe/Dublin`); offsets such as `+01:00` are rejected. Tariff windows are local minutes `0` to `1440`, end greater than start.
- **Database numeric columns come back as JSON numbers** from the generated types, which is not exact. Select money columns as `col::text` and parse them with the decimal helpers. `NUMERIC_COLUMNS` lists every affected column.

## 6. Generated database types
`packages/shared/src/db/database.types.ts` is generated and must not be edited by hand.
```bash
npm run db:types             # regenerate from the migrations
npm run db:types -- --check  # fail if the committed file is stale (also run in CI)
```
The script starts the same throwaway PostgreSQL 17 as `db:verify`, applies the migrations and writes a Supabase-shaped `Database` type (`Tables`, `Views`, `Functions`, `Enums`, plus `Tables`, `TablesInsert`, `TablesUpdate` and `Enums` helpers). It is **not** the output of `supabase gen types`, which needs Docker and has not been run (L-038); the shape is compatible with `createClient<Database>()`. Regenerate after every migration.

## 7. How drift is prevented
| Test | Compares | Fails when |
|---|---|---|
| `contract/routes.test.ts` | `ROUTES` with the table in `API_CONTRACT.md` section 2 (method, path, access, task) | a route is added, removed or changed in only one place |
| `contract/db-contract.test.ts` | Enums, bounds, idempotency pattern, audit actions and error messages with the migration SQL | a `CHECK` list or limit changes without the schema |
| `npm run db:types -- --check` | The generated file with the migrations | a migration is added without regenerating |
| `db/database.types.test.ts` | `role_enum` with `ROLES`, function names, `NUMERIC_COLUMNS` | the generated types and constants disagree |

## 8. Invalid payloads that are tested
Unknown role, a state of charge of 120, a malformed timezone (`Europe/Dubln`, `+01:00`), a negative or zero window length, money sent as a JSON number, a non-UTC instant, an impossible local date, a command with out-of-range reserve, an automation rule with an unsupported condition, an error response with `details` on a non-validation error, and `source: 'DEMO'` on a persisted sample.

## 9. Proposals that are not in a task yet
These shapes are our own because the documents do not define them. They are marked in the code and recorded as limitations: the rule definition v1 (L-040), the command parameter model (L-039), the export and delete request and response bodies (L-041), and the database-error to API-error mapping (L-042).
