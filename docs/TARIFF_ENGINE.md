# Tariff engine

Status: **implemented in TASK-10, awaiting owner review.** Code: `packages/domain/src/tariff/`. Pure functions, no I/O, no clock, no persistence, no UI. Rules it implements: `docs/ENERGY_ACCOUNTING.md` sections 4 to 6 and decision D-013; extensions are D-068 to D-081 in `docs/DECISIONS.md`. **Every rate, levy, standing charge and VAT figure in the fixtures and in this document is an ILLUSTRATIVE EXAMPLE.** None is a real supplier's tariff, and none is current (Q-09).

## 1. What it does

| Question | Function |
|---|---|
| Is this tariff (or this set of versions, or these dynamic prices) saveable? | `validateTariff`, `validateTariffSet`, `validatePricePoints` |
| What does one kWh cost at this instant? | `resolveTariffRate` |
| Where, inside a time range, does the rate change or is there none? | `splitIntervalAtBoundaries`, `findCoverageGaps` |
| What does this interval of energy cost, or earn? | `priceInterval` |
| What do the standing charges (and per-day levies) of these local dates cost? | `chargesForLocalDates` |

It does **not** read telemetry, sum a day's intervals, round for display or decide completeness; the accounting engine (TASK-11) does those, calling these functions.

## 2. Data model

The engine uses the shared `Tariff`, `TariffSlot`, `TariffSeason`, `TariffOverride`, `TariffLevy` and `PricePoint` types (`packages/shared/src/schemas/tariffs.ts`) unchanged. Callers pass the schema-parsed objects; the engine does not re-check field formats.

- A tariff is **directional** (`IMPORT` or `EXPORT`), **effective-dated** (`effectiveFrom` inclusive, `effectiveTo` exclusive, both **local dates in the tariff's timezone**; `effectiveTo: null` is open-ended) and versioned. A site's tariffs are all its versions in both directions plus the household defaults (`siteId: null`).
- **Recurring definitions** (slots, seasons, overrides) live in the tariff. **Dated price observations** (dynamic half-hourly prices) are separate data: `PricePoint[]` indexed by `indexPricePoints([{ tariffId, pricePoints }])` and passed in `options.priceObservations`. The two are never mixed.
- Price modes: `FLAT` (one rate), `TIME_OF_USE` (slots, optionally by season, day type and date override), `DYNAMIC` (price points of any resolution).
- A slot is `[startMinute, endMinute)` in local minutes after midnight, `0 <= start < end <= 1440`, with a day type `ALL`, `WEEKDAY` or `WEEKEND`. A window that crosses midnight is **two slots** (for example night is `1380 to 1440` and `0 to 480`), the model the shared schema fixed in TASK-05.
- Money and rates are **decimal strings** (D-014). Energy enters as Wh (string or number) and is converted to kWh exactly.

## 3. Precedence (D-013, with the extensions D-069 and D-070)

For an instant `t` and a direction:

1. **Version.** For each tariff of the direction whose `siteId` is the requested site or `null`, take its local date at `t` (in that tariff's own zone) and keep it if `effectiveFrom <= date < effectiveTo`. If any **site-specific** version is in force, only those compete; otherwise the household defaults do. None: `NO_TARIFF_FOR_DATE`. More than one: `AMBIGUOUS_TARIFF`.
2. **Date override.** Overrides whose `[dateFrom, dateTo)` contains the local date; the highest `priority` wins. Equal priorities that share a date are `AMBIGUOUS_TARIFF` (and `validateTariff` rejects them at save time). An override **replaces the whole day**: its own slots apply, nothing is inherited.
3. **Dynamic price observation.** For a `DYNAMIC` tariff, the price point whose `[intervalStart, intervalEnd)` contains `t`. None: `NO_PRICE_POINT`. Two: `AMBIGUOUS_TARIFF`. Nothing is carried forward or averaged.
4. **Season.** The season whose month-day range contains the local date (ranges may wrap the year end, for example 1 October to 31 March). A season with **no slots inherits the all-year slots**.
5. **Base slots.** The tariff's own slots.
6. **Flat.** `flatRatePerKwh`.

Within one slot list, **day-type slots replace `ALL` slots**: if the list has any `WEEKDAY` slot, weekdays use the `WEEKDAY` slots alone and never the `ALL` ones; likewise `WEEKEND`; with none, the `ALL` slots apply. So a weekend-only exception needs a complete weekend set. A slot is found by half-open comparison `startMinute <= minute < endMinute`.

A rate result carries where it came from: `source` (`OVERRIDE`, `DYNAMIC`, `SEASON`, `BASE`, `FLAT`), the slot or schedule `label`, the schedule name, the tariff id, key and version, and the local date and minute used.

**No silent zero.** There is no code path that returns a zero rate for missing coverage. The problem codes are `NO_TARIFF_FOR_DATE`, `TARIFF_GAP` (no slot covers the time), `NO_PRICE_POINT`, `AMBIGUOUS_TARIFF`. A rate of exactly `0` exists only when a tariff says so.

## 4. Time, timezones and DST

- Instants are **epoch milliseconds**; a rate is looked up by the **tariff's own IANA timezone**, never the browser's and never a fixed offset. Two tariffs of one site must share a zone and a currency (`validateTariffSet`).
- `localDay(date, zone)` gives a local date's first instant, the first instant of the next date and the clock change inside it. Verified values (Europe/Dublin): spring forward 2026-03-29 is **23 hours** (the clocks change at 01:00Z, +60 minutes); fall back 2026-10-25 is **25 hours** (starts 2026-10-24T23:00Z, changes at 01:00Z, -60 minutes). America/New_York 2026-03-08 and 2026-11-01 behave the same way.
- **Skipped local times** (for example 01:30 on the spring-forward day) do not exist. A slot edge inside the skipped hour produces no instant that day, so no boundary is invented, and nothing is priced in a time that did not happen.
- **Repeated local times** (the fall-back hour) occur twice. Every instant is priced by **its own local time**, so both passes through the hour get the rate of the band they fall in, and the day has 25 hours of pricing. A slot edge in the repeated hour is a boundary at **both** instants.
- **Midnight crossing** needs no special handling: the day boundary is always a split point and each side is looked up on its own local date, so an interval from 22:30 to 02:30 prices as two segments.
- **Half-open everywhere.** A slot, a version, a season day, an override and a price point include their start and exclude their end. At exactly `endMinute` the next slot applies; at exactly `effectiveTo` (midnight of that local date) the next version applies. Intervals `[start, end)` split at a boundary produce `[start, boundary)` and `[boundary, end)` with no instant counted twice.
- **Standing charges** are per **local date**, not per 24 hours: a 23-hour and a 25-hour day each cost one standing charge (`chargesForLocalDates`). Partial days are not pro-rated here (L-088).
- Zones that skip a whole local midnight (a few historical cases) are not supported (L-089).

## 5. Validation (`validate.ts`)

All validators return `TariffProblem[]` (`code`, `path`, `message`, the shape the API already returns), never throw for bad data and never change their input. An empty array means saveable.

| Code | Meaning |
|---|---|
| `SLOT_OVERLAP` | two slots of the **same day type** in one list share minutes (day-type replacement of `ALL` is precedence, not overlap) |
| `COVERAGE_GAP` | some local minute of a day type has no rate in the base slots, a season or an override (also: an override or `TIME_OF_USE` tariff with no slots) |
| `SEASON_OVERLAP` / `SEASON_GAP` | two seasons share a calendar day (leap-day-aware, wrap-around ranges); days in no season and no all-year slots |
| `OVERRIDE_PRIORITY_TIE` | two overrides with equal priority share a date |
| `EFFECTIVE_DATE_OVERLAP` | two versions of the same direction and site scope are in force on the same date (`validateTariffSet`) |
| `CURRENCY_MISMATCH`, `TIMEZONE_MISMATCH` | versions of one site disagree (`validateTariffSet`) |
| `TIMEZONE_UNKNOWN` | the zone is not known to the runtime |
| `LEVY_ON_EXPORT` | a levy on an export tariff (levies apply to imports only; it would be ignored) |
| `PRICE_POINT_OVERLAP` | two dynamic price points cover one instant (`validatePricePoints`) |

`TIMEZONE_UNKNOWN`, `TIMEZONE_MISMATCH`, `PRICE_POINT_OVERLAP` and `LEVY_ON_EXPORT` are four codes TASK-10 added to the shared `TARIFF_PROBLEM_CODES` (additive, D-080). Messages never echo user text other than a tariff, season or override name.

## 6. Splitting and coverage (`split.ts`)

`splitIntervalAtBoundaries(startMs, endMs, tariffs, direction, options)` returns contiguous, ordered segments that cover `[startMs, endMs)` exactly, each with one rate result (a rate **or a problem**). Split points are collected from the schedule the resolver would use on each local day: local midnights, the DST change, slot edges (converted to instants), version, season and override changes, and price point edges. Neighbouring segments with the same result are joined, so a flat tariff gives one segment over any range. The tests compare this with a minute-by-minute scan of the resolver. Ranges longer than `MAX_SPLIT_DAYS` (400) throw `RangeError`.

`findCoverageGaps` returns the segments that have no rate, merged where adjacent with the same reason. Empty means fully covered.

## 7. Money and rounding (`money.ts`, `charges.ts`)

- All arithmetic uses the shared `Decimal` clone (28 significant digits, round half up). Rates, energy and amounts are `Decimal` inside the engine and **strings** outside. A number never carries money, and `decimalFrom` throws if given one.
- The engine **does not round**. Amounts are exact decimal text (`'0.738'`, not `'0.74'`). Rounding happens once, at display, with `roundToMinorUnit(amount, currency)` (half up, to the currency's minor unit: 2 for EUR, GBP, USD and ten others, 0 for JPY; an unlisted currency throws rather than guess). The line-by-line sum of rounded values is how ENERGY_ACCOUNTING section 7 says a bill is shown; the worked illustration of section 8 is a test (net `1.426` unrounded, `1.43` as the sum of rounded lines).
- **Tax.** `EXCLUSIVE`: `VAT = taxable x rate / 100`, added on top. `INCLUSIVE`: rates already contain VAT, `VAT = amount - amount / (1 + rate / 100)`, and the total is unchanged. `NONE`: no VAT. A **taxable** levy is inside the VAT base; a non-taxable one is added after it.
- **Levies** (`PER_KWH`, `PER_DAY`) apply to imports only. **Export:** `PER_KWH` pays `kWh x rate` and `NONE` pays exactly zero, by the tariff's own choice, not by a missing rate. An export amount is a credit.
- **Negative prices** are allowed in the engine (a negative dynamic rate gives a negative cost); the stored schema and database still reject them (L-086).
- Result shape `AmountBreakdown`: `baseAmount`, `levyAmount`, `vatAmount`, `totalAmount` (payable: base + levies + VAT, or base + levies when inclusive) and `amountExcludingVat`.

## 8. Pricing an interval (`price.ts`, Q-08)

`priceInterval({ startMs, endMs, energyWh }, tariffs, direction, options)` returns one of:

| `status` | Meaning |
|---|---|
| `PRICED` | one rate (one tariff, one value) held for the whole interval; `parts` has one entry |
| `ESTIMATE` | more than one rate applied and `options.mode: 'PRORATA_ESTIMATE'` was chosen: energy shared by duration across the segments; the last part takes the remainder so the energy adds up exactly |
| `UNPRICEABLE_AT_RESOLUTION` | more than one rate applied in the default `STRICT` mode; the energy cannot be placed inside the interval from what was reported, so it is **not priced** (rule 9). The result lists the segments |
| `UNPRICED` | some part has no rate (a gap, ambiguity or missing price point); the result lists the gaps. Never a zero, in either mode |

Two segments with different tariff versions but the same rate are one basis only when the tariff id is the same; across a version change the interval is mixed (D-074). The default `STRICT` follows ENERGY_ACCOUNTING section 5; the opt-in estimate is the documented `PRORATA_ESTIMATE` and is always labelled.

Throws `RangeError` for an empty or inexact range, negative or non-finite energy, a range over `MAX_SPLIT_DAYS`, or versions with different currencies in one interval.

## 9. API summary

```ts
resolveTariffRate(atMs, tariffs, direction, { siteId?, priceObservations? }): RateResult
//   { ok: true, ratePerKwh, currency, tariffId, tariffKey, version, source, label, scheduleName, localDate, localMinute }
//   { ok: false, code: 'NO_TARIFF_FOR_DATE'|'TARIFF_GAP'|'NO_PRICE_POINT'|'AMBIGUOUS_TARIFF', message, localDate }
splitIntervalAtBoundaries(startMs, endMs, tariffs, direction, options): RateSegment[]   // { startMs, endMs, result }
findCoverageGaps(startMs, endMs, tariffs, direction, options): CoverageGap[]            // { startMs, endMs, code, message }
priceInterval({ startMs, endMs, energyWh }, tariffs, direction, { siteId?, priceObservations?, mode? }): IntervalPrice
chargesForLocalDates(fromDate, toDateExclusive, tariffs, { siteId? }): DayChargesResult  // { ok: true, days, totals, currency } | { ok: false, problems }
validateTariff(tariff): TariffProblem[]
validateTariffSet(tariffs): TariffProblem[]
validatePricePoints(points, path?): TariffProblem[]
indexPricePoints([{ tariffId, pricePoints }]): PriceObservations
roundToMinorUnit(amount, currency): string
```

The full contracts, with the limits and thrown errors, are in the handoff, `docs/handoffs/TASK-10.md`.

## 10. Fixtures (`packages/domain/src/tariff/fixtures/`)

Labelled examples, exported from `@autopw3/domain`. Every name starts `EXAMPLE`, every value is `ILLUSTRATIVE EXAMPLE` (`TARIFF_FIXTURE_NOTICE`), all `EUR` and `Europe/Dublin`.

| Export | What it shows |
|---|---|
| `FLAT_IMPORT_EXAMPLE` | flat 0.30, standing charge 0.60/day, VAT 23% exclusive |
| `DAY_NIGHT_IMPORT_EXAMPLE` | Irish-style day/night: night 00:00-08:00 and 23:00-24:00 at 0.18, day at 0.35, VAT 13.5% inclusive |
| `DAY_NIGHT_PEAK_IMPORT_EXAMPLE` | day, night and peak (17:00-19:00) with a non-taxable per-kWh levy and a taxable per-day levy |
| `SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE` | summer and winter seasons, weekday and weekend sets, a festive-period override and a higher-priority Christmas Day override |
| `DYNAMIC_IMPORT_EXAMPLE` | dynamic half-hourly prices (the prices are separate: `halfHourlyPricePointsForDay(s)`) |
| `DAY_NIGHT_VERSION_1_EXAMPLE`, `_VERSION_2_EXAMPLE` | two versions of one tariff, the second effective 2026-11-01 with a higher standing charge |
| `EXPORT_PER_KWH_EXAMPLE`, `EXPORT_NONE_EXAMPLE` | export paid 0.10 per kWh; export not paid |
| `TARIFF_EXAMPLES` | all of the above by name |
| `halfHourlyPricePointsForDay(date, zone, rateMicroAt?)`, `...ForDays` | 48, 46 or 50 price points a day; negative values allowed for engine tests |
| `rateFromMicro(n)` | millionths to a six-digit decimal string |

## 11. Limits (proposals, `UNVERIFIED`)

`MAX_SPLIT_DAYS = 400`, `MAX_CHARGE_DAYS = 1100`. A longer range is a caller error, not a slow request. They guard memory and time; no real data chose them (L-090).

## 12. Tests

`npm test -w @autopw3/domain` runs them; `npm run test:coverage -w @autopw3/domain` adds the coverage report for `src/tariff` (V8). Files: `calendar`, `money`, `observations`, `resolve`, `split`, `price`, `charges`, `validate`, `fixtures`, `no-float-money` and `properties` (fast-check, fixed seeds so every run tries the same cases). The named TASK-10 cases and where they live are in the handoff.

**No floating-point money** is proven twice: ESLint (`npm run lint:rules`) forbids `parseFloat` and `toFixed` in every package, and `no-float-money.test.ts` scans the engine source for number-based money operations (`parseFloat`, `Number(`, `Math.round`-style rounding, `toNumber`, an unmarked `toFixed`), then checks that every amount leaving the engine is a decimal string and that `0.1 + 0.2` kWh priced piecewise equals the price of `0.3` kWh exactly.

## 13. What this document does not claim

No real supplier tariff was used or checked (Q-09), whether export credits are taxable is the export tariff's own setting and not assumed, and no real Tesla data was used. Nothing here was run against a database, an API or a deployment.
