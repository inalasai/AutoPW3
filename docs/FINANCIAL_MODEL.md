# Financial and Energy Accounting Model (TASK-11)

**Status:** IMPLEMENTED in `packages/domain/src/accounting/`. Written 2026-10-26.  
**Related:** `docs/ENERGY_ACCOUNTING.md`, `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md`.

---

## 1. Scope & Purpose

This document provides the canonical specification of all formulas, assumptions, rounding rules, efficiency metrics, and counterfactual savings models implemented by the AutoPW3 accounting engine (`packages/domain/src/accounting/`).

The accounting engine is a pure, deterministic library:
- Injected clock and timezone awareness;
- Arbitrary-precision decimal arithmetic via `decimal.js` (D-014);
- No floating-point math for monetary or energy totals;
- Strict isolation between synthetic (`DEMO`) and live (`TESLA`) telemetry;
- Explicit tracking of data completeness and resolution without silent interpolation.

---

## 2. Power-to-Energy Conversion (Integration)

When provider-reported energy intervals (`energy_intervals`) are unavailable, power snapshots (`powerwall_metrics_log`) are integrated using a **left-Riemann step (hold-last)** method:

Given consecutive samples $S_i$ at UTC instant $t_i$ and $S_{i+1}$ at $t_{i+1}$:
$$\Delta t = t_{i+1} - t_i \quad (\text{seconds})$$

1. **Gap Handling:**
   - If $\Delta t > \text{maxGapSeconds}$ (default: 3600 seconds or $2 \times \text{expectedIntervalSeconds}$), the step is identified as a **gap**.
   - Gaps are left **uncovered**; no energy is accumulated across gaps, and data is never silently interpolated (rule 9).
2. **Step Integration ($\Delta t \le \text{maxGapSeconds}$):**
   - $\text{Hours} = \Delta t / 3600$
   - $\text{SolarGeneratedWh} = \text{solarPowerW} \times \text{Hours}$
   - $\text{HomeConsumedWh} = \text{loadPowerW} \times \text{Hours}$
   - **Grid Flows:**
     - If $\text{gridPowerW} > 0$: $\text{gridImportWh} = \text{gridPowerW} \times \text{Hours}$, $\text{gridExportWh} = 0$
     - If $\text{gridPowerW} < 0$: $\text{gridExportWh} = |\text{gridPowerW}| \times \text{Hours}$, $\text{gridImportWh} = 0$
   - **Battery Flows:**
     - If $\text{batteryPowerW} > 0$ (discharging): $\text{batteryDischargedWh} = \text{batteryPowerW} \times \text{Hours}$, $\text{batteryChargedWh} = 0$
     - If $\text{batteryPowerW} < 0$ (charging): $\text{batteryChargedWh} = |\text{batteryPowerW}| \times \text{Hours}$, $\text{batteryDischargedWh} = 0$
3. **Quality & Tagging:**
   - Intervals generated via integration are stamped with `quality = 'DERIVED'` and reported as lower confidence.

---

## 3. Energy Totals and Completeness

### Energy Totals
All flows are summed using exact `Decimal` arithmetic:
- $\text{TotalSolarGeneratedWh} = \sum \text{solarGeneratedWh}$ (where not null)
- $\text{TotalHomeConsumedWh} = \sum \text{homeConsumedWh}$ (where not null)
- $\text{TotalGridImportWh} = \sum \text{gridImportWh}$ (where not null)
- $\text{TotalGridExportWh} = \sum \text{gridExportWh}$ (where not null)
- $\text{TotalBatteryChargedWh} = \sum \text{batteryChargedWh}$ (where not null)
- $\text{TotalBatteryDischargedWh} = \sum \text{batteryDischargedWh}$ (where not null)
- $\text{NetGridWh} = \text{TotalGridImportWh} - \text{TotalGridExportWh}$
- $\text{NetBatteryWh} = \text{TotalBatteryDischargedWh} - \text{TotalBatteryChargedWh}$

Exact kilowatt-hour equivalents: $\text{kWh} = \text{Wh} / 1000$.

### Completeness Tracking
- $\text{CompletenessRatio} = \frac{\text{CoveredSeconds}}{\text{ExpectedPeriodSeconds}}$ (clamped to $[0.0, 1.0]$).
- Gaps reduce completeness; data is never extrapolated.
- Intervals flagged as `SUSPECT` are excluded from all totals and counted against completeness.
- Minimum and maximum observed resolutions (`resolutionSeconds`) are tracked and reported.

---

## 4. Financial Calculations & Independence

### Import Charges
For each interval $[t_{\text{start}}, t_{\text{end}})$ with $\text{gridImportWh} > 0$:
- Priced using active import tariff version via `priceInterval()`.
- $\text{ImportBase} = \text{kWh} \times \text{ratePerKwh}$
- $\text{ImportLevies} = \sum (\text{kWh} \times \text{levyAmount})$ for all `PER_KWH` levies.
- Tax mode evaluation (`EXCLUSIVE`, `INCLUSIVE`, or `NONE`).

### Export Revenue / Credit
For each interval $[t_{\text{start}}, t_{\text{end}})$ with $\text{gridExportWh} > 0$:
- Priced using active export tariff version via `priceInterval()`.
- If `exportPaymentModel === 'PER_KWH'`: $\text{ExportBase} = \text{kWh} \times \text{ratePerKwh}$.
- If `exportPaymentModel === 'NONE'`: $\text{ExportBase} = 0$.
- Export revenue is calculated **completely independently** of import charges.

### Standing Charges and Daily Levies
- Applied per site local calendar date ($[00:00, \text{next } 00:00)$ in the site's IANA timezone).
- A 23-hour DST spring-forward day incurs 1 day standing charge.
- A 25-hour DST fall-back day incurs 1 day standing charge.
- Evaluated via `chargesForLocalDates()`.

### Net Cost Formulation
$$\text{NetCost} = \text{ImportEnergyCost} + \text{StandingCharges} + \text{ImportLevies} + \text{ImportVAT} - \text{ExportCredit}$$

### Rounding and Invoice Integrity (D-014, ENERGY_ACCOUNTING §7)
- Calculations maintain full decimal precision (28 significant digits).
- For presentation/invoicing, each line item (Import Energy, Standing Charge, Levies, VAT, Export Credit) is rounded half-up (`ROUND_HALF_UP`) to the currency's minor unit (e.g. 2 decimal places for EUR).
- **Invoice Line Integrity:** The displayed net cost is the **sum of the rounded component lines**, ensuring displayed screen numbers always add up exactly:
$$\text{DisplayedNet} = \text{Round}(\text{Import}) + \text{Round}(\text{Standing}) - \text{Round}(\text{Export})$$

---

## 5. Efficiency Metrics

1. **Self-Consumed Solar:**
   $$\text{SelfConsumedSolarWh} = \min(\text{SolarGeneratedWh}, \max(0, \text{SolarGeneratedWh} - \text{GridExportWh}))$$
2. **Self-Consumption Ratio (%):**
   $$\text{SelfConsumptionPercent} = \frac{\text{SelfConsumedSolarWh}}{\text{SolarGeneratedWh}} \times 100$$
   *(Returns `null` if SolarGeneratedWh is zero or null).*
3. **Self-Sufficiency Ratio (%):**
   $$\text{SelfSufficiencyPercent} = \min\left(100, \max\left(0, \frac{\text{HomeConsumedWh} - \text{GridImportWh}}{\text{HomeConsumedWh}} \times 100\right)\right)$$
   *(Returns `null` if HomeConsumedWh is zero or null).*
4. **Battery Round-Trip Losses & Efficiency:**
   - $\text{BatteryLossWh} = \max(0, \text{BatteryChargedWh} - \text{BatteryDischargedWh})$
   - $\text{BatteryEfficiencyPercent} = \frac{\text{BatteryDischargedWh}}{\text{BatteryChargedWh}} \times 100$
   *(Returns `null` if BatteryChargedWh is zero or unmeasured).*

---

## 6. Counterfactual Savings Analysis

1. **Counterfactual "No Solar, No Battery":**
   - Assumes 100% of the site's `homeConsumedWh` would have been purchased from the grid under the active import tariff schedule.
   - For each interval, `homeConsumedWh` is priced at that interval's import rate.
   - $\text{CounterfactualNetCost} = \text{CounterfactualImportCharges} + \text{ActualStandingCharges}$.
2. **Avoided Grid Import Cost:**
   $$\text{AvoidedGridImportCost} = \max(0, \text{CounterfactualImportCharges} - \text{ActualImportEnergyCost})$$
3. **Estimated Net Savings:**
   $$\text{EstimatedNetSavings} = \max(0, \text{CounterfactualNetCost} - \text{ActualNetCost})$$
   *Always labelled with `ESTIMATE` ("compared with having no solar and no battery, using the same tariff").*
4. **Tariff Optimisation Benefit:**
   - Evaluates the benefit of load shifting and battery arbitrage:
   - Volume-weighted average import rate $\bar{R} = \frac{\text{ActualImportBase}}{\text{ActualGridImportKwh}}$.
   - Flat cost comparison: $\text{FlatBaseline} = \text{ActualGridImportKwh} \times \bar{R}$.
   - Benefit: $\max(0, \text{FlatBaseline} - \text{ActualImportBase})$.

---

## 7. Assumptions Flagged for Owner Review

| ID | Assumption | Implementation Rule | Status |
|---|---|---|---|
| **A-01** | Partial-day standing charges | Charged in full for any local calendar date with at least one active interval. | **Flagged for Owner Review** |
| **A-02** | Counterfactual baseline | "No solar, no battery" prices 100% of home consumption at the active import tariff. | **Flagged for Owner Review** |
| **A-03** | Battery round-trip efficiency | Computed as $\sum \text{discharge} / \sum \text{charge}$ over the selected period. | **Flagged for Owner Review** |
| **A-04** | Tariff optimisation benefit | Compares actual ToU charges against volume-weighted average rate. | **Flagged for Owner Review** |
| **A-05** | SUSPECT interval exclusion | Excluded from accounting totals; counted against completeness ratio. | **Ratified** (D-022) |
| **A-06** | Unpriceable resolutions | Intervals with multiple rates in strict mode are flagged and omitted from totals. | **Ratified** (D-074) |

---

## 8. Golden Fixture Hand Calculations

The accounting test suite (`packages/domain/src/accounting/golden.test.ts`) verifies these hand-calculated values:

### Fixture 1: Section 8 Illustration (`SECTION_8_FIXTURE`)
- **Inputs:** 1 interval (12:00–13:00 UTC, 2026-06-21), 2.0 kWh import, 0.5 kWh export.
- **Tariff:** Flat import €0.300000/kWh, standing €0.600000/day, 23.0000% VAT exclusive. Flat export €0.100000/kWh.
- **Hand Calculation:**
  - Import energy: $2.0 \times 0.300000 = €0.600000$
  - Standing charge: $1 \text{ day} \times €0.600000 = €0.600000$
  - Taxable base: $0.600000 + 0.600000 = €1.200000$
  - VAT (23%): $1.200000 \times 0.23 = €0.276000$
  - Import total: $1.200000 + 0.276000 = €1.476000$
  - Export credit: $0.5 \times 0.100000 = €0.050000$
  - **Unrounded Net Total:** $1.476000 - 0.050000 = €1.426000$
  - **Rounded Lines:**
    - Import energy line: €0.60 base + €0.138 VAT $\to$ €0.74
    - Standing charge line: €0.60 base + €0.138 VAT $\to$ €0.74
    - Export credit line: €0.05
    - **Displayed Net Total:** $0.74 + 0.74 - 0.05 = \mathbf{€1.43}$
- **Engine Output:** Matches all unrounded and rounded values down to 6 decimals.
