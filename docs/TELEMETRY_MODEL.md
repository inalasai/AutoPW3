# Telemetry model

**Status:** TASK-08 complete for the demo provider and the data-quality rules. The live Tesla adapter does not exist yet (TASK-15); nothing here has been checked against real Tesla data, so every numeric threshold below is a proposal marked `UNVERIFIED`.
**Code:** `packages/domain/src/telemetry/` (interface, normaliser, utilities, guard, demo provider) and `packages/domain/src/fixtures/` (seeded demo site, datasets, scenarios).
**Related:** `docs/DOMAIN_TYPES.md` (schemas and sign convention), `docs/ai-build-kit/02-PROJECT-CONTEXT.md` (rules), `docs/SECURITY_MODEL.md`.

## 1. What this module is for

Everything that supplies readings (the demo provider now, the Tesla adapter in TASK-15) produces the same shapes, and everything that consumes readings (the Worker routes, ingestion, the Live View, accounting) depends on one interface rather than on a provider. This module defines that interface, the rules that decide whether a reading can be trusted, and a synthetic site that exercises all of it with no network, no credentials and no database.

It does not call Tesla, draw any screen or store anything.

## 2. Units and signs

One definition, in `packages/shared/src/constants/signs.ts`:

| Field | Unit | Sign |
|---|---|---|
| `solarPowerW` | W | always 0 or more |
| `batteryPowerW` | W | more than 0 discharging, less than 0 charging |
| `gridPowerW` | W | more than 0 importing, less than 0 exporting |
| `loadPowerW` | W | always 0 or more |
| `batterySocPercent` | percent | 0 to 100 |
| `...Wh` | Wh | always 0 or more; direction is in the field name (`gridImportWh`, `gridExportWh`, `batteryChargedWh`, `batteryDischargedWh`) |

Balance: `loadPowerW = solarPowerW + batteryPowerW + gridPowerW` (power) and `homeConsumedWh = solarGeneratedWh + gridImportWh - gridExportWh + batteryDischargedWh - batteryChargedWh` (energy).

## 3. The provider interface

`TelemetryProvider<S extends DataSource>` (`telemetry/provider.ts`). `S` is the provider's own source, `'DEMO'` for the demo provider and `'TESLA'` for the future live one; it is stamped on every result.

| Member | Returns |
|---|---|
| `source` | `S` |
| `getCapabilities()` | `TelemetryCapabilities`: source, `synthetic`, `verification` (`SYNTHETIC`, `VERIFIED`, `MOCK_ONLY`, `UNVERIFIED`), live cadence, power resolution and range, energy resolutions and ranges, per-field support (`SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED`) |
| `getLiveSnapshot({ siteId })` | `{ source, sample, issues }`: one normalised power sample and whatever normalisation flagged |
| `getPowerSeries({ siteId, from, to })` | `{ source, resolutionSeconds, samples, gaps, completeness }` over `[from, to)` |
| `getEnergySeries({ siteId, from, to, resolution, timezone })` | `{ source, resolution, items }`; items have the API's `EnergySeriesPoint` shape |

Contract every implementation keeps:

- Output is already in the project convention. Provider-native names, signs and units are converted inside the provider and nowhere else.
- Every sample has `source`, a UTC `sampledAt`, a `quality` flag and unit-explicit fields. A missing value is `null`, never 0.
- A series states its real resolution and is never resampled to finer data than the provider has. Gaps are reported, not filled. `completeness` is covered time divided by requested time and is never rounded up.
- Ranges are half-open `[from, to)` and limited by `MAX_RANGE_DAYS` (power 7 days, interval 31, hourly 92, daily 1100).
- Energy buckets are whole: a request starting part-way into a bucket returns the whole bucket, with its real `start` and `end`, not a slice of it. `interval` and `hourly` buckets are aligned to UTC; `daily` buckets are local calendar days in the request's IANA `timezone`, so a DST day is 23 or 25 hours long.
- The interface reads. It persists nothing. Ingestion decides what is stored, and only live `TESLA` data may be.
- Methods are asynchronous because the live adapter does I/O. Failures throw `TelemetryProviderError` with one of: `UNAVAILABLE`, `RATE_LIMITED`, `BUDGET_EXHAUSTED`, `NOT_AUTHORISED`, `INVALID_REQUEST`, `RANGE_INVALID`, `RANGE_TOO_LARGE`, `UNSUPPORTED_RESOLUTION`, `OUT_OF_COVERAGE`. The message is short and never contains provider payloads or credentials.

## 4. Normalisation

`normalisePowerReading(raw, { source, receivedAt })` and `normaliseEnergyInterval(raw, { source })` in `telemetry/normalise.ts`. The input is a `RawPowerReading` / `RawEnergyInterval`: project convention, but every field is `unknown` and unchecked. Converting Tesla's own fields and signs into that shape is the Tesla adapter's job (TASK-15); it is not done here.

The receive time is an input, so a result never depends on the clock.

| Situation | What happens | Quality |
|---|---|---|
| Value present and sensible | kept | `OK` |
| Value missing (`undefined` or `null`) | `null`, issue `FIELD_MISSING`; never 0 | `PARTIAL` |
| Value cannot be represented (negative solar or load, battery level outside 0 to 100, negative energy) | `null`, issue names the field and the observed number | `SUSPECT` |
| `NaN`, `Infinity` | `null`, `VALUE_NOT_FINITE` | `SUSPECT` |
| A string such as `"2000"` | `null`, `VALUE_NOT_A_NUMBER`; strings are never coerced because a provider that starts sending strings has probably also changed units | `SUSPECT` |
| Representable but doubtful (magnitude above 100 000 W, power or energy balance fails) | kept, issue added | `SUSPECT` |
| No sample time | receive time used, `timestampOrigin: 'RECEIVED'`, issue `TIMESTAMP_MISSING` | `PARTIAL` |
| Unreadable sample time | receive time used, `TIMESTAMP_INVALID` | `SUSPECT` |
| Sample time more than 120 s after the receive time | kept, `TIMESTAMP_IN_FUTURE` | `SUSPECT` |
| Energy interval with no readable start/end or end not after start | `interval: null`, `INTERVAL_INVALID` | not applicable |

Nothing is silently corrected: no clamping, no sign flipping, no zero-filling. `SUSPECT` samples are stored and shown with a warning but excluded from accounting (section 7).

Issue codes (`DATA_ISSUE_CODES`): `TIMESTAMP_MISSING`, `TIMESTAMP_INVALID`, `TIMESTAMP_IN_FUTURE`, `FIELD_MISSING`, `VALUE_NOT_FINITE`, `VALUE_NOT_A_NUMBER`, `SOLAR_NEGATIVE`, `LOAD_NEGATIVE`, `SOC_OUT_OF_RANGE`, `POWER_IMPLAUSIBLE_MAGNITUDE`, `BALANCE_MISMATCH`, `ENERGY_NEGATIVE`, `ENERGY_IMPLAUSIBLE_MAGNITUDE`, `ENERGY_BALANCE_MISMATCH`, `INTERVAL_INVALID`. Each issue is `{ code, field, observed, message }`. Only `FIELD_MISSING` and `TIMESTAMP_MISSING` make a reading `PARTIAL` rather than `SUSPECT`.

Tolerances (all `UNVERIFIED` against real data; one place to change them, `ValidationOptions`):

- Power balance holds when `|load - (solar + battery + grid)| <= max(100 W, 5% of load)` (`BALANCE_TOLERANCE_FLOOR_W`, `BALANCE_TOLERANCE_PERCENT` in `@autopw3/shared`). If any of the four values is `null` the balance is not judged.
- Energy balance holds when the residual is within `max(100 W x interval hours, 5% of home consumption)`.
- Implausible magnitude: above 100 000 W (`DEFAULT_MAX_PLAUSIBLE_POWER_W`), and the matching energy for the interval length.

## 5. Series utilities (`telemetry/series.ts`)

| Function | Behaviour |
|---|---|
| `sortBySampledAt` | Stable sort by instant (not by text, so offsets are respected); unreadable instants last |
| `dedupeBySampledAt` | One per instant. Keeps the later `receivedAt`, then the better quality (`OK`, `PARTIAL`, `SUSPECT`), then the later in the input. Returns `{ items, dropped }` |
| `detectGaps(samples, { expectedIntervalSeconds, maxGapSeconds? })` | A gap is a spacing above `maxGapSeconds` (default twice the expected interval, so one missed sample is not a gap). Reports `{ from, to, seconds, missingSamples }`, where `from` is the last sample before the hole and `to` the first after it |
| `detectGapsInRange` | As above, plus a leading gap (first sample starts late), a trailing gap (last sample stops early), and one gap for the whole range when there are no samples |
| `coverageFraction` | Time covered divided by range. A sample covers up to the next sample if that is within the allowance, otherwise only its own interval |

## 6. Freshness (`telemetry/freshness.ts`)

`freshnessOf(sampledAt, now, { staleAfterSeconds?, maxFutureSkewSeconds? })` returns `{ ageSeconds, freshness }`. `now` is passed in, never read.

- `FRESH`: age is at most the threshold. The default threshold is 3600 s (`DEFAULT_STALE_AFTER_SECONDS`) and is configurable; a reading exactly at the threshold is `FRESH`, one second later is `STALE`.
- `STALE`: older than the threshold.
- `UNAVAILABLE`: no timestamp or an unreadable one; or a timestamp more than 120 s in the future (`DEFAULT_FUTURE_SKEW_SECONDS`), which is not trusted as fresh. A timestamp slightly ahead (clock skew) counts as age 0.

`toLiveReading` and `toDemoLiveReading` add age and freshness to a sample and produce an object that parses against `LiveReadingSchema` / `DemoLiveReadingSchema`.

## 7. The demo/live guard (`telemetry/guards.ts`)

Rule: demo data can never reach live tables or live accounting. Three layers:

1. **Types.** `LivePowerSample` has `source: 'TESLA'`. Passing a `DemoPowerSample` (`source: 'DEMO'`) or the broad `PowerSample` to a function that asks for live samples is a compile error. `guards.test.ts` holds `// @ts-expect-error` lines that prove it; if the types ever allowed it, `npm run typecheck` fails.
2. **Runtime.** Types vanish at a JSON boundary or behind a cast, so the entry functions check:
   - `assertLiveSource(value, path)`: throws `DemoDataInLivePathError` unless `source` is exactly `'TESLA'` (a missing, lower-case or unknown source is refused).
   - `requireLiveSamples(samples, path)`: checks every sample; one demo sample among thousands throws.
   - `acceptForLiveIngestion(sample)`: refuses `DEMO`, then validates with `PersistedPowerSampleSchema`, which accepts `TESLA` only.
   - `selectAccountableSamples(samples)`: the placeholder live-accounting gate: requires live samples and leaves `SUSPECT` ones out, reporting how many (so the caller lowers completeness).
3. **Database.** The CHECK constraint `source = 'TESLA'` on the live tables (TASK-03/04).

The error message names the path and carries no sample data. Real accounting (TASK-11) and ingestion (TASK-16) must take `LivePowerSample` and begin with `requireLiveSamples`.

## 8. Timestamps and time zones (`telemetry/timestamps.ts`)

- `parseInstantMs` accepts an ISO 8601 instant with a zone (`Z` or an offset), a `Date`, or epoch milliseconds. A string with no zone is rejected, because it would be read in whichever zone the machine is in. `formatInstant` writes UTC, dropping `.000`.
- Local days come from the platform's IANA database through `Intl`, never from a fixed offset. `localDayBounds(localDate, timeZone)` finds the instants a local day starts and ends by bisection, so `Europe/Dublin` gives 23 hours on 2026-03-29, 25 on 2026-10-25 and 24 on any other day. `localDateOf`, `localMinuteOfDay`, `addLocalDays`, `dayOfWeek`, `utcOffsetMinutes` and `isKnownTimeZone` are the helpers around it.

## 9. The demo site (`fixtures/`)

All of it is synthetic. Every record says `source: 'DEMO'`.

- **A model, not stored data.** `DemoSiteModel` computes snapshots from a seed (default `20260101`) and a Dublin-like site: 5.8 kW array at 53.35 N, 13.5 kWh battery with a 5 kW limit and a 10% reserve, `Europe/Dublin`. Solar follows the sun's elevation (declination and equation-of-time formulae), scaled by a per-day clearness and a smooth half-hourly cloud factor. Load follows a household clock (morning and evening peaks, a weekday/weekend difference, brief appliance spikes) on local time, so it is consistent across DST. The battery follows a self-consumption policy.
- **Deterministic.** Noise comes from a hash of the seed and the step index (`fixtures/prng.ts`); there is no `Math.random()`, no clock and nothing at render time. The model simulates forward from a fixed epoch and remembers each step, so a step has the same value whatever was asked first. Two new models give identical datasets; a test pins a fingerprint of each dataset.
- **Whole watts.** Power is rounded to whole watts, so the power balance is exact (residual 0). The battery level is 0.1 percent and is the level before that step's flow.
- **Coverage.** 2026-01-01 up to (not including) 2031-01-01 (`DEMO_EPOCH_MS`, `DEMO_HORIZON_MS`). Outside it, the provider throws `OUT_OF_COVERAGE` rather than inventing data.
- **Resolution.** Power snapshots every 300 s; energy intervals of 900 s, each the sum of three snapshots split by direction and rounded to 0.1 Wh.

### Provider

`createDemoTelemetryProvider({ clock, model?, scenario? })` returns a `TelemetryProvider<'DEMO'>`. The live snapshot is the model's step containing the injected clock's `now()` (so a `FixedClock` gives the same snapshot every time and it agrees with the series for that instant). With a `scenario`, the live snapshot is that scenario's reading instead; the series always use the model. `apps/worker/src/providers/demo` (TASK-14) will wrap it for the `/demo/*` routes.

### Fixture index

| Id / function | Content | Size |
|---|---|---|
| `demoDay()` (`DEMO_DAY`) | Local day 2026-06-21, summer solstice | 288 power samples, 96 energy intervals |
| `demoWeek()` (`DEMO_WEEK`) | Local days 2026-10-24 to 2026-10-30; includes the 25-hour day when clocks go back | 169 hours: 2028 power, 676 energy |
| `demoMonth()` (`DEMO_MONTH`) | June 2026, 30 local days | 8640 power, 2880 energy |
| `demoDayWithGap()` | The day with 10:00 to 11:30 UTC missing | 18 samples absent; one 5700 s gap (09:55 to 11:30) |
| `demoDataset(id)` | By id (`DEMO_DATASET_IDS`) | |
| `demoPowerSamples(model, fromMs, toMs)`, `demoEnergyIntervals(...)` | Any range in the demo world | |
| `withoutSamplesBetween(samples, from, to)` | Makes a hole in any series | |

A dataset is `{ id, description, source: 'DEMO', seed, timezone, from, to, power, energy }`.

### Scenarios (`DEMO_SCENARIOS`)

Each is one raw reading, its age in seconds and what normalisation must make of it. Age is relative to when the scenario is shown, so a fresh scenario stays fresh under any clock and the stale one stays stale.

| Id | Situation | Quality | Freshness | Issue codes |
|---|---|---|---|---|
| `SOLAR_SURPLUS` | Solar above load; battery charging; exporting | `OK` | `FRESH` | none |
| `BATTERY_CHARGING` | Surplus charges the battery; nothing crosses the meter | `OK` | `FRESH` | none |
| `BATTERY_DISCHARGING` | Evening, no sun; battery supplies the load | `OK` | `FRESH` | none |
| `GRID_IMPORT` | Heavy load; battery and grid both supply | `OK` | `FRESH` | none |
| `GRID_EXPORT` | Bright afternoon, full battery; exporting | `OK` | `FRESH` | none |
| `LOW_BATTERY` | Night, battery at 7%; load from grid | `OK` | `FRESH` | none |
| `MISSING_DATA` | Load and battery power not supplied | `PARTIAL` | `FRESH` | `FIELD_MISSING` |
| `STALE_DATA` | Clean reading 3.5 hours old | `OK` | `STALE` | none |
| `INVALID_READINGS` | Negative solar, battery level 130, NaN load, 250 kW battery | `SUSPECT` | `FRESH` | `POWER_IMPLAUSIBLE_MAGNITUDE`, `SOC_OUT_OF_RANGE`, `SOLAR_NEGATIVE`, `VALUE_NOT_FINITE` |

`describeFlows(values, { lowBatteryPercent? })` (`telemetry/flows.ts`) reads a sample as `{ battery: CHARGING | DISCHARGING | IDLE | null, grid: IMPORTING | EXPORTING | IDLE | null, solarSurplus, lowBattery }` using the sign convention; it returns `null` for anything it cannot tell. The low-battery threshold defaults to 15 percent (a proposal).

## 10. Tests

`packages/domain`: 226 tests across `telemetry/*.test.ts` and `fixtures/*.test.ts`. They cover signs and units, timestamps (zones, DST, malformed input), invalid and missing values, gaps (boundaries, leading and trailing), duplicates, staleness (boundary, skew, configurable threshold), energy and power balance, the guard (compile-time and runtime, including a demo sample hidden among 5000 live ones), determinism (repeat runs, fresh models, query order, golden fingerprints) and the 23, 24 and 25 hour days. Run with `npm test -w @autopw3/domain`.

## 11. Not verified

- Every tolerance and threshold in section 4 and 6 is a proposal. They are `UNVERIFIED` until real Tesla data exists (TASK-15, owner question Q-06).
- The demo site is a plausible invention. It has no battery losses, no tariff behaviour and no outages, and is not a forecast or a benchmark.
- The golden fingerprints depend on the JavaScript engine's `Math.sin`, `Math.exp` and `Math.pow`. They are stable on the engine used here (Node); a different engine could produce different last digits and need regenerating (see L-070).
