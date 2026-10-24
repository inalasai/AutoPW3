# AutoPW3 - Task Handoff Report

## Task completed
Number and name: TASK-08 Telemetry domain and demo provider
Branch / commit: `Raj-AutoPW3` (owner chose this branch instead of `task-08-telemetry-demo-provider`); commits prefixed `task-08:`. Not pushed. No PR opened (L-075).
Date: 2026-10-24

**Status: complete for what could be run locally.** All three acceptance criteria are met and proven by tests. Not done: GitHub CI and the pull request (nothing pushed, `NOT_EXECUTED`). Every threshold in the data-quality rules is a proposal that no real Tesla data has checked (`UNVERIFIED`, L-069).

## Summary
`packages/domain` now holds the telemetry model: a `TelemetryProvider` interface that the demo provider implements now and the Tesla adapter will implement in TASK-15; a normaliser that turns an unchecked reading into a schema-valid sample with a quality flag and a list of issues, never silently correcting anything; utilities for timestamps and local days, sorting, de-duplication, gap detection, staleness and energy/power balance; and a three-layer guard that stops `DEMO` data reaching live ingestion or live accounting. A seeded model of a Dublin-like site produces a day, a week (including the 25-hour clocks-back day) and a month of power snapshots and energy intervals, plus nine named scenarios. The same inputs always give identical datasets, and tests prove it.

## Files created
| Path | Purpose |
|---|---|
| `packages/domain/src/telemetry/types.ts` | `DemoPowerSample`, `LivePowerSample`, energy interval types, `DataIssue` and its codes, `RawPowerReading`, `RawEnergyInterval`, `TimeGap` |
| `packages/domain/src/telemetry/timestamps.ts` | instant parsing and formatting, local dates and day bounds through `Intl` (DST-safe), zone check |
| `packages/domain/src/telemetry/validation.ts` | ranges, plausibility, power and energy balance checks, quality from issues |
| `packages/domain/src/telemetry/normalise.ts` | `normalisePowerReading`, `normaliseEnergyInterval` |
| `packages/domain/src/telemetry/series.ts` | sort, dedupe, gap detection (also within a range), coverage |
| `packages/domain/src/telemetry/freshness.ts` | `freshnessOf`, `toLiveReading`, `toDemoLiveReading` |
| `packages/domain/src/telemetry/guards.ts` | demo/live guard (`DemoDataInLivePathError`, `assertLiveSource`, `requireLiveSamples`, `acceptForLiveIngestion`, `selectAccountableSamples`) |
| `packages/domain/src/telemetry/flows.ts` | `describeFlows`: charging, discharging, importing, exporting, surplus, low battery |
| `packages/domain/src/telemetry/provider.ts` | `TelemetryProvider`, `TelemetryCapabilities`, request and result types, `TelemetryProviderError`, `checkRange` |
| `packages/domain/src/telemetry/demo-provider.ts` | `createDemoTelemetryProvider` |
| `packages/domain/src/telemetry/index.ts` | public exports |
| `packages/domain/src/fixtures/prng.ts` | hash-based deterministic noise and a fingerprint function |
| `packages/domain/src/fixtures/demo-model.ts` | `DemoSiteModel`, site configuration, epoch and horizon |
| `packages/domain/src/fixtures/datasets.ts` | `demoDay`, `demoWeek`, `demoMonth`, `demoDayWithGap`, range generators |
| `packages/domain/src/fixtures/scenarios.ts` | `DEMO_SCENARIOS` |
| `packages/domain/src/fixtures/index.ts` | public exports |
| `packages/domain/src/telemetry/*.test.ts` (7 files), `packages/domain/src/fixtures/*.test.ts` (2 files) | unit tests: timestamps, validation, normalisation, series, freshness, guards, flows, demo provider, datasets, scenarios |
| `docs/TELEMETRY_MODEL.md` | the model, rules, interface, fixtures, scenarios and what is unverified |
| `docs/handoffs/TASK-08.md` | this report |

## Files modified
| Path | What changed and why |
|---|---|
| `packages/domain/src/index.ts` | exports telemetry and fixtures |
| `packages/domain/package.json` | `"sideEffects": false` (same reason as D-045, so the web bundle can tree-shake demo data later). Outside the task's named paths |
| `packages/domain/README.md` | status, where code goes, rules. Folder README must stay accurate (AGENTS.md) |
| `docs/README.md` | `TELEMETRY_MODEL` linked |
| `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | D-054 to D-060 and L-068 to L-075 appended. A missing line break between L-066 and L-067 (which made L-067 part of the L-066 row) was repaired; no text was changed |
| `docs/ai-build-kit/00-README.md` | TASK-08 ticked |
| removed | `packages/domain/src/telemetry/.gitkeep`, `packages/domain/src/fixtures/.gitkeep` (folders now have code) |

## Decisions
D-054 demo data is a seeded model, not stored files; D-055 asynchronous provider interface with typed errors; D-056 normalisation never silently corrects; D-057 balance tolerances and plausibility limit are proposals (`UNVERIFIED`); D-058 freshness boundary and future timestamps; D-059 three-layer demo/live guard with a placeholder accounting gate; D-060 local days via `Intl` and bisection, and sources stay `TESLA | DEMO` (no `MOCK` source). All in `docs/DECISIONS.md`.

## Database changes
None.

## API changes
None. The Worker's `/live`, `/power` and `/energy` routes (TASK-14) will call this provider interface; their contracts are unchanged.

## Checks executed
| Exact command | Executed? | Result | Relevant output |
|---|---|---|---|
| `npm run check` (typecheck incl. `e2e/`, lint with architecture rules and Prettier, tests, build, secrets scan), run after the code commit | yes | exit 0 | tests: shared 226 (15 files), domain 226 (11 files), web 321 (14 files), worker 4; lint-rule checks and Prettier pass; web build and `wrangler deploy --dry-run` pass; Secretlint clean. The match between the shared and domain counts is a coincidence |
| `npm run typecheck -w @autopw3/domain`, `npx vitest run` in `packages/domain`, `npx eslint src` in `packages/domain` | yes | pass | 226 tests in 11 files; no ESLint output |
| `npm run lint` and `npm run secrets:scan` after the documentation edits | yes | exit 0 | lint-rule checks and Prettier pass; Secretlint clean |
| `npm run test:e2e` | no | `NOT_EXECUTED` | no browser code changed. Command: `npm run test:e2e` |
| `npm run db:test`, `npm run db:verify`, `npm run db:types -- --check` | no | `NOT_EXECUTED` | no database object changed |
| GitHub CI, PR | no | `NOT_EXECUTED` | nothing pushed |

Two errors were caught by typechecking after the tests passed at runtime (Vitest does not type-check): a data-quality inspection in a test was called with the wrong arguments, which made its tolerance `NaN` so it passed for the wrong reason. It was corrected and the energy-balance check now really runs on every demo interval.

## Manual verification
None by hand; there is no UI. The demo day was inspected only through assertions (sunrise between 03:30 and 05:30 UTC and sunset between 19:30 and 21:30 UTC on 2026-06-21, peak solar below the array size, battery level between reserve and full, an evening load peak between 18:00 and 20:00 local in January and July).

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Same inputs always produce identical datasets | VERIFIED | `datasets.test.ts` "determinism": repeat calls equal; new models with no cache equal the shared one; order of queries does not matter; fingerprints pinned (`day d11807bf`, `week 09edbf7c`, `month e1f99d36`); a different seed gives a different but repeatable world |
| Every sample has timestamp, source and unit; stale and invalid data is flagged | VERIFIED | every demo sample parses against `PowerSampleSchema`, has `source: 'DEMO'`, a UTC `sampledAt` and a quality flag; field names carry units; `normalise.test.ts` (invalid, missing, future, string values), `freshness.test.ts` (stale boundary), `scenarios.test.ts` (`STALE_DATA`, `INVALID_READINGS`, `MISSING_DATA`) |
| Passing `DEMO` data to a live-accounting function fails at compile time or runtime (test proves it) | VERIFIED | `guards.test.ts`: three `@ts-expect-error` lines (compile time, enforced by `npm run typecheck`) each followed by an assertion that it also throws `DemoDataInLivePathError`; JSON round-trip, a cast, one demo sample among 5000 live ones, and a differently cased `source` are refused. The gate is `selectAccountableSamples`, a placeholder until TASK-11 exists (L-074) |
| Deterministic day, week and month with an Irish-latitude solar curve and plausible demand | VERIFIED (against the model's own checks) | sizes 288/96, 2028/676 (169 hours), 8640/2880; June solar well above late-October; solar zero at night |
| Scenarios: surplus, charging, discharging, import, export, low battery, missing, stale, invalid | VERIFIED | `scenarios.test.ts` and `demo-provider.test.ts` hold each scenario to its promised quality, freshness and issue codes, under three different clocks |
| Utilities: timestamp normalisation, sort, dedupe, gaps, stale detection (configurable), validation (energy balance, SOC range) | VERIFIED | `timestamps`, `series`, `freshness`, `validation` tests |
| Tests for signs, units, timestamps, invalid values, gaps, staleness, energy balance | VERIFIED | 226 tests |
| `docs/TELEMETRY_MODEL.md` | done | thresholds `UNVERIFIED` |
| Behaviour against real Tesla data | UNVERIFIED | no adapter or real data yet (TASK-15, Q-06) |

## Verification status register
- Demo provider and fixtures: `VERIFIED` (synthetic by design; labelled `DEMO`).
- Tolerances (100 W / 5% balance, 100 000 W magnitude, 3600 s stale, 15% low battery): `UNVERIFIED` (L-069).
- Treatment of small negative solar readings from real inverters: `UNVERIFIED` (L-071).
- Golden fingerprints on engines other than the Node used here: `UNVERIFIED` (L-070).
- Live accounting guard on real accounting functions: `MOCK_ONLY` until TASK-11 (L-074).

## Outstanding issues
- Check the tolerances and the negative-value policy against real data when TASK-15 provides it.
- Branch name and missing PR (L-075); CI has not run.
- Question for the owner: the demo world ends on 2031-01-01. Is that long enough, or should the horizon be extended?

## Environment variables
None.

## Provider interface (import from `@autopw3/domain`)
`TelemetryProvider<S extends DataSource>`: `source: S`; `getCapabilities(): TelemetryCapabilities`; `getLiveSnapshot({ siteId }): Promise<{ source, sample, issues }>`; `getPowerSeries({ siteId, from, to }): Promise<{ source, resolutionSeconds, samples, gaps, completeness }>`; `getEnergySeries({ siteId, from, to, resolution, timezone }): Promise<{ source, resolution, items }>`. Ranges are half-open and limited by `MAX_RANGE_DAYS`; errors are `TelemetryProviderError` with a code. `createDemoTelemetryProvider({ clock, model?, scenario? })` implements it for `'DEMO'`. Full detail in `docs/TELEMETRY_MODEL.md` section 3.

## Fixture index (import from `@autopw3/domain`)
| Export | Content |
|---|---|
| `demoDay()` | local day 2026-06-21: 288 power samples, 96 energy intervals |
| `demoWeek()` | 2026-10-24 to 2026-10-30 local, 169 hours (clocks go back 2026-10-25): 2028 power, 676 energy |
| `demoMonth()` | June 2026: 8640 power, 2880 energy |
| `demoDayWithGap()` | the day with 10:00 to 11:30 UTC missing: one 5700 s gap, 18 missing samples |
| `demoDataset(id)`, `DEMO_DATASET_IDS` | `DEMO_DAY`, `DEMO_WEEK`, `DEMO_MONTH` |
| `demoPowerSamples(model, fromMs, toMs)`, `demoEnergyIntervals(model, fromMs, toMs)` | any range inside 2026-01-01 to 2031-01-01 |
| `withoutSamplesBetween(samples, from, to)` | make a hole in any series |
| `DEMO_SCENARIOS`, `DEMO_SCENARIO_IDS` | `SOLAR_SURPLUS`, `BATTERY_CHARGING`, `BATTERY_DISCHARGING`, `GRID_IMPORT`, `GRID_EXPORT`, `LOW_BATTERY`, `MISSING_DATA`, `STALE_DATA`, `INVALID_READINGS` |
| `DemoSiteModel`, `defaultDemoSiteModel()`, `DEFAULT_DEMO_SITE` | the seeded site (seed `20260101`, Europe/Dublin, 5.8 kW array, 13.5 kWh battery) |

## Instructions for the next task
- TASK-09 (Live View) consumes `createDemoTelemetryProvider({ clock })`, `describeFlows`, `toDemoLiveReading` and `DEMO_SCENARIOS`; it must pass an injected clock and must not import from `fixtures/demo-model` internals. The demo indicator and "DEMO" labelling are the UI's job.
- Do not change the sign convention, the issue codes or the quality rules without a decision; the golden fingerprints in `datasets.test.ts` fail on any change to the demo model. Regenerate them only for a deliberate change and record it in `docs/DECISIONS.md`.
- TASK-11 (accounting) and TASK-16 (ingestion): take `LivePowerSample`, start with `requireLiveSamples`, and write a test with `@ts-expect-error` for a demo sample as `guards.test.ts` does.
- TASK-15 (Tesla adapter): convert Tesla's own names, signs and units into a `RawPowerReading`, then call `normalisePowerReading` with `source: 'TESLA'`. Do not duplicate validation.
- Do not import `fixtures/` from live code paths.

## Next task
TASK-09 Animated Live View. No prerequisite is open except the owner's say-so and, as before, the local-branch and no-PR handling.
