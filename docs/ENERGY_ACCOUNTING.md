# Energy Accounting (TASK-01)

Status: **PROPOSED, awaiting owner approval.** Written 2026-10-22. Implemented in `packages/domain` (TASK-08, 10, 11). This file is the **single definition** of units, signs, time, tariff precedence and money for the project. Decision IDs refer to `docs/DECISIONS.md`.

## 1. Scope

Pure, deterministic functions with an injected clock: normalisation helpers, interval handling, tariff resolution, cost and metric calculation. No I/O, no `Date.now()`. Used identically by the web app, the Worker (rollups, automation) and tests.

## 2. Units and signs (decision 9, D-012) — ratified

| Quantity | Field | Unit | Sign / range |
|---|---|---|---|
| Solar generation | `solarPowerW` | W | ≥ 0 |
| Battery power | `batteryPowerW` | W | **> 0 discharging**, **< 0 charging** |
| Grid power | `gridPowerW` | W | **> 0 importing**, **< 0 exporting** |
| Site load | `loadPowerW` | W | ≥ 0 |
| Battery level | `batterySocPercent` | % | 0 to 100 |
| Energy | `...Wh` | Wh | ≥ 0 for directional flows (`gridImportWh`, `gridExportWh`, `batteryChargedWh`, `batteryDischargedWh`, `solarGeneratedWh`, `homeConsumedWh`) |
| Rate | `...RatePerKwh` | currency per kWh | decimal string, ≥ 0 |
| Standing charge | `standingChargePerDay` | currency per local day | decimal string |

Balance (instantaneous): `loadPowerW ≈ solarPowerW + batteryPowerW + gridPowerW`.

**Ratification against TASK-00:** the proposed convention is adopted as the project's convention. The provider's **native** signs, field names and cadence are `UNVERIFIED` (`docs/research/SIGN_CONVENTION_FINDING.md`). Therefore:
1. Normalisation happens only in `apps/worker/src/providers/tesla` (rule 6).
2. The mapping table in the finding must be completed from a redacted real read-only response (open question Q-06 / TASK-00 O6) before Tesla data is persisted as live.
3. Until then the Tesla adapter is `MOCK_ONLY` for sign handling and ingestion must not persist unverified live data as `quality = OK`.

**Balance check:** `abs(load − (solar + battery + grid)) <= max(balanceToleranceFloorW, balanceTolerancePercent × load)`. Proposed defaults `balanceToleranceFloorW = 100`, `balanceTolerancePercent = 5` (tunable once real data is observed; a proposal, not a fact). Failure sets `quality = SUSPECT`; `SUSPECT` rows are stored, shown with a warning, and excluded from accounting.

Energy fields from `energy_intervals` are provider-reported watt-hours and are not subject to the instantaneous power balance; an analogous energy balance check (same tolerance logic in Wh) flags `SUSPECT` intervals.

## 3. Time (rule 7)

- Persisted: UTC `timestamptz`. Alongside: the site's IANA timezone (`energy_sites.timezone`) and each tariff's timezone.
- Intervals are half-open `[start, end)`; an instant belongs to exactly one interval.
- Local days: `[local midnight, next local midnight)`; length 23 h, 24 h or 25 h on DST changes. Daily rollups store `day_start_utc` and `day_end_utc`.
- Recurring schedules (tariff slots, automation) are expressed in **local wall-clock minutes** plus an IANA zone; they are converted to UTC instants per day with a tz-aware library chosen and tested in TASK-10 (`UNVERIFIED` which one; must handle skipped and repeated local hours). Fixed UTC offsets are forbidden.
- DST rules: a slot that falls in a skipped hour does not occur that day; a slot in a repeated hour occurs once, at its first occurrence (documented and tested). Tariff rate bands are priced by the instant's local time, so a 25-hour day has 25 hours of pricing and a 23-hour day has 23.
- All domain functions accept `now` as a parameter (injected clock) for testability.

## 4. Data resolution and quality (rule 9, D-022)

- **Primary source for accounting:** `energy_intervals` (provider-reported Wh) at the resolution the provider returned. Resolutions and available fields are `UNVERIFIED` until observed.
- **Fallback:** integrating `powerwall_metrics_log` power snapshots with a step (hold-last) method, only across gaps of at most `maxGapSeconds` (default 2 × the background interval, 3600 s by default). Larger gaps are left **uncovered**, never interpolated. Results from this path are flagged `quality = DERIVED` and displayed as lower confidence.
- Every aggregate reports `completeness` = covered seconds ÷ expected seconds, and `resolutionSecondsMin/Max`. The UI shows the real resolution and never smooths to finer data.
- Duplicate or late intervals replace earlier ones for the same key; rollups for the touched local days are recomputed from source, never incremented.

## 5. Tariff model and precedence (decision 10, D-013)

A **tariff** is directional (`IMPORT` or `EXPORT`), versioned and effective-dated; at any instant at most one version applies per `(household, site scope, direction)` (DB exclusion constraint). Elements:

| Element | Description |
|---|---|
| `priceMode` | `FLAT`, `TIME_OF_USE`, `DYNAMIC` |
| Currency, timezone | Required on every tariff |
| Seasons | Month/day ranges (may wrap year-end); none means all year |
| Day types | `ALL`, `WEEKDAY`, `WEEKEND` (weekday/weekend by local calendar date) |
| Slots | Local-minute bands `[start, end)` with a rate and a label |
| Date overrides | Date range replacement schedules with `priority` |
| Dynamic prices | Price points per interval (any resolution, for example half-hourly), UTC instants |
| Standing charge | Per local day, import only |
| Levies | `PER_KWH` or `PER_DAY` amounts, each flagged taxable or not |
| Tax | `tax_mode` `INCLUSIVE`, `EXCLUSIVE`, `NONE` with `vat_rate` |
| Export payment | `PER_KWH` (uses export tariff rates) or `NONE` |

**Rate resolution for an instant `t` (after converting to the tariff's local time):**
1. Select the tariff version whose `[effective_from, effective_to)` contains the local date of `t`. None found → **error** `NO_TARIFF_FOR_DATE`.
2. If any `override` covers the local date, take the override with the highest `priority` (ties are invalid and rejected at validation). Its slots (or, for `DYNAMIC`, its price points if provided) decide the rate. If the override's slots do not cover `t`'s minute → **error** `TARIFF_GAP`.
3. Else, if `priceMode = DYNAMIC`, take the price point containing `t`. None → **error** `NO_PRICE_POINT`.
4. Else, if `priceMode = TIME_OF_USE`, pick the season containing the local date (or "all year"), then within it the slot set for the most specific day type (`WEEKDAY`/`WEEKEND` beats `ALL`), then the slot whose `[start_minute, end_minute)` contains `t`'s local minute. None → **error** `TARIFF_GAP`.
5. Else (`FLAT`) use `flat_rate_per_kwh`.
Missing coverage is never zero and never silently defaulted (rule 8). Validation (`validateTariff`) checks no overlap and full 0 to 1440-minute coverage per season and day-type, no overlapping seasons/gaps, and override priority uniqueness; it runs at save time (API) and again in the engine.

**Pricing an interval:** an energy interval `[a, b)` is priced at the rate in force for the whole interval. If more than one distinct rate applies within the interval (provider resolution coarser than the tariff bands), the interval is **not priced**: it is reported as `UNPRICEABLE_AT_RESOLUTION` and counted against completeness. An opt-in `PRORATA_ESTIMATE` mode (default off) may allocate energy pro rata by time and labels all results `ESTIMATE`. Default behaviour never fabricates finer data (rule 9). Choice of default is an owner question (Q-08).

## 6. Calculations

Let `kWh = Wh / 1000` (exact decimal division).

Per interval (rates in the interval's currency):
- Import energy cost = `gridImportKwh × importRate`.
- Export credit = `gridExportKwh × exportRate` if `export_payment_model = PER_KWH`, else 0 (explicit `NONE`).
- Levies: `PER_KWH` levy = `gridImportKwh × amount`; `PER_DAY` levies are charged per local day in the period (not per interval).
- Standing charge = `standingChargePerDay × number of local days` in the period (DST day counts as one day).
- Tax: if `INCLUSIVE`, rates already include tax; the reported ex-tax amount is `gross / (1 + vatRate)` and VAT is `gross − exTax`. If `EXCLUSIVE`, VAT = `taxableAmount × vatRate` added on top, where taxable amount is energy cost plus standing charge plus taxable levies. `NONE` applies no tax. Whether export credits are taxable is **not assumed**: the export tariff has its own `tax_mode` (default `NONE`), and the owner confirms the correct treatment (Q-09). Irish figures anywhere in fixtures are `ILLUSTRATIVE EXAMPLE` only.
- **Net cost** = import energy cost + standing charge + levies + VAT − export credit.

Energy and efficiency metrics (all from `energy_intervals`, with completeness):
- `selfConsumedSolarWh = solarGeneratedWh − gridExportWh` (clamped at 0, only when both are present).
- `selfConsumptionPercent = selfConsumedSolarWh / solarGeneratedWh × 100`.
- `selfSufficiencyPercent = (homeConsumedWh − gridImportWh) / homeConsumedWh × 100` (clamped 0 to 100).
- **Estimated savings** = `(homeConsumedKwh priced at the import rate for each interval, plus the same standing charge) − actual net cost`. Always labelled `ESTIMATE` ("compared with having no solar and no battery, using the same tariff"); not a bill. Requires `homeConsumedWh`; otherwise not shown.
Fields that are `NULL` in the source produce `null` metrics, not zero.

## 7. Money model (decision 11, D-014)

- **Library:** `decimal.js` (arbitrary precision decimal, selectable rounding modes). Version is pinned in TASK-02 (`UNVERIFIED` exact version now). No JavaScript `number` arithmetic for money anywhere; ESLint rule forbids `parseFloat`/`Number` on money fields in `packages/domain` (TASK-02).
- **Database:** `numeric`. Rates `numeric(12,6)` (six decimal places); computed amounts in cache tables `numeric(18,8)`. `currency char(3)` ISO 4217 beside every money value; arithmetic across different currencies is an error.
- **Precision during calculation:** full `decimal.js` precision (28 significant digits default is kept; set explicitly). **No rounding until presentation or invoice-style totals.**
- **Rounding rule (stated):** round half up (`ROUND_HALF_UP`) to the currency's minor unit (2 decimals for EUR, USD, GBP; exponent from a currency table) once per displayed component line (energy cost, standing charge, levies, VAT, export credit). The displayed net is the **sum of the rounded component lines**, so the screen always adds up. Aggregates over days or months sum **unrounded** values first and round once at the end; they are never sums of rounded daily figures.
- **Serialisation:** JSON money, rates and energy amounts that need exactness are **strings** (for example `"0.317500"`), validated by shared Zod schemas (`decimalString`). Power and SOC are JSON numbers; they are not money.
- **Defaults:** a missing rate is an error (`TARIFF_GAP` etc.), never `0`.

## 8. Worked illustration (fixture seed for TASK-10/11; numbers are illustrative)

Assumptions: EUR, `EXCLUSIVE` tax 0.2300, import rate 0.300000 for a 2 kWh interval, export rate 0.100000 for 0.5 kWh, standing charge 0.600000 per day, one day.
- Import cost = 2 × 0.300000 = 0.600000. Export credit = 0.5 × 0.100000 = 0.050000.
- Taxable = 0.600000 + 0.600000 = 1.200000; VAT = 1.200000 × 0.2300 = 0.276000.
- Net = 0.600000 + 0.600000 + 0.276000 − 0.050000 = 1.426000 → lines rounded: 0.60, 0.60, 0.28, −0.05; displayed net = 1.43 (sum of rounded lines), while the unrounded total is 1.426000. TASK-11 golden tests include this and DST-day cases.
