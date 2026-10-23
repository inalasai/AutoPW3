# packages/domain — pure energy logic

**Status:** skeleton (TASK-02): only the injected `Clock` and a `FixedClock` for tests; `decimal.js` is installed for TASK-10/11. Telemetry, tariff and accounting arrive in TASK-08, 10, 11. Package name: `@autopw3/domain`; consumed as TypeScript source.

## Purpose
Deterministic energy logic shared by the web app, Worker rollups and automation: telemetry normalisation and quality checks, the tariff engine and the accounting engine.

## Where code goes
| Path | Content | Task |
|---|---|---|
| `src/telemetry/` | Provider interface, normalisers, gap/stale/validation utilities | 08 |
| `src/tariff/` | Tariff validation, rate resolution, interval pricing, DST handling | 10 |
| `src/accounting/` | Interval energy, import/export cost, savings, completeness | 11 |
| `src/fixtures/` | Deterministic `DEMO` datasets, tariff fixtures, golden values | 08, 10, 11 |

## Rules
- Pure functions only: no network, no database, no `Date.now()` (inject a clock).
- Decimal arithmetic for money; never floats. Half-open intervals `[start, end)`.
- Sign convention: solar ≥ 0, battery > 0 discharging, grid > 0 importing.
- `DEMO` data must be rejected by live-accounting functions (type and runtime guard).
- Imports `@autopw3/shared` only.

## Tests
Heavy unit testing is expected here: DST days, midnight crossings, boundaries, golden values checked independently. Report real coverage, not aspirational.
