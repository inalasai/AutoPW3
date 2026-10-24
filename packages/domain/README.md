# packages/domain - pure energy logic

**Status:** TASK-08 complete: telemetry domain (provider interface, normaliser, data-quality utilities, demo/live guard), the demo telemetry provider and deterministic synthetic fixtures. The tariff engine and accounting engine arrive in TASK-10 and 11. Package name: `@autopw3/domain`; consumed as TypeScript source; `sideEffects: false`.

## Purpose
Deterministic energy logic shared by the web app, Worker rollups and automation: telemetry normalisation and quality checks, the tariff engine and the accounting engine.

## Where code goes
| Path | Content | Task | Status |
|---|---|---|---|
| `src/clock.ts` | Injected `Clock` and `FixedClock` for tests | 02 | done |
| `src/telemetry/` | `TelemetryProvider` interface, normalisers, timestamps and local days, series utilities (sort, dedupe, gaps), freshness, validation, demo/live guard, flow descriptions, demo provider | 08 | done |
| `src/fixtures/` | Seeded demo site model, day/week/month datasets, named scenarios | 08 | done (tariff fixtures and golden values come in 10, 11) |
| `src/tariff/` | Tariff validation, rate resolution, interval pricing, DST handling | 10 | not started |
| `src/accounting/` | Interval energy, import/export cost, savings, completeness | 11 | not started |

Full description of the telemetry model: `docs/TELEMETRY_MODEL.md`.

## Rules
- Pure functions only: no network, no database, no `Date.now()` (inject a clock). ESLint forbids `Date.now()`, zero-argument `new Date()`, `Math.random()`, `performance.now`, `parseFloat`, `toFixed`, `fetch`, `XMLHttpRequest` and `WebSocket` in this package.
- Decimal arithmetic for money; never floats. Half-open intervals `[start, end)`.
- Sign convention: solar >= 0, battery > 0 discharging, grid > 0 importing. Units are in field names.
- A missing value is `null`, never 0. Nothing is silently corrected: invalid values are flagged (`SUSPECT`) and unrepresentable ones become `null`.
- `DEMO` data must be rejected by live-accounting functions: `LivePowerSample` has `source: 'TESLA'` (compile-time) and every live entry point starts with `requireLiveSamples` or `assertLiveSource` (runtime, `DemoDataInLivePathError`).
- Provider-native names and signs are converted in the provider adapter, not in this package. This package starts from the project convention.
- Imports `@autopw3/shared` only.

## Tests
`npm test -w @autopw3/domain` (Vitest). Heavy unit testing is expected here: DST days, midnight crossings, boundaries, golden values checked independently. The demo fixtures have golden fingerprints; regenerate them only for a deliberate model change and record it in `docs/DECISIONS.md`.
