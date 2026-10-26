# Analytics UI (TASK-13)

**Status:** IMPLEMENTED in `apps/web/src/features/analytics/`. Written 2026-10-26.  
**Related:** `docs/FINANCIAL_MODEL.md`, `docs/ENERGY_ACCOUNTING.md`, `docs/TARIFF_MANAGER.md`, `docs/DECISIONS.md`.

---

## 1. Overview

The Analytics UI gives users clear, accurate, historical views of residential energy flows, financial costs, and counterfactual savings for Tesla Powerwall sites.

The entire interface is driven directly by the `@autopw3/domain` energy and financial accounting engine (TASK-11), ensuring:
1. **Invoice Line Integrity:** Screen figures match exact billing formulas (`Round(Import) + Round(Standing) - Round(Export)`).
2. **True Resolution Mapping:** Telemetry is displayed at its actual reported resolution; finer resolutions are never fabricated (Rule 9).
3. **Transparent Data Completeness:** Gaps in data are highlighted visibly on charts and in data tables; missing intervals are never silently interpolated.
4. **Counterfactual Clarity:** Savings are evaluated against an explicit "no solar, no battery" baseline, prominently tagged as `ESTIMATE`, with underlying assumptions immediately accessible.
5. **Full Accessibility:** Every chart provides an accessible data table alternative with semantic headers and tabular figures.
6. **Hardened CSV Export:** Exported data includes units in headers and sanitises all fields against spreadsheet formula injection attacks.

---

## 2. Architecture & Components

The feature is implemented in `apps/web/src/features/analytics/`:

| Component / Module | Responsibility |
|---|---|
| `types.ts` | Data models: `RangePreset`, `DateRangeState`, `EnergyChartPoint`, `CostChartPoint`, `AnalyticsData`. |
| `range.ts` | Calendar date resolution in the site's IANA timezone; DST-aware day bounds (23h / 25h); resolution capability mapping. |
| `aggregation.ts` | Pure aggregation of raw intervals into interval, hourly, and daily series; downsampling when point count exceeds 500; gap preservation. |
| `csvExport.ts` | CSV generator with OWASP formula injection protection (`=`, `+`, `-`, `@`, `\t`, `\r` escaped); header units. |
| `useAnalyticsData.ts` | Orchestrator hook connecting telemetry datasets, active tariffs from `TariffRepository`, and the `@autopw3/domain` engine. |
| `RangeControls.tsx` | Segmented controls for presets (Day, Week, Month, Year, Custom), date pickers, timezone display, and real resolution badge. |
| `CompletenessBadge.tsx` | Visual indicator of telemetry coverage fraction (`X% Telemetry Coverage`) and gap disclosures. |
| `SummaryCards.tsx` | 6 high-level KPI cards with `TelemetryValue` formatting and info button opening financial assumptions panel. |
| `EnergyChart.tsx` | Recharts stacked visual chart for solar, home, grid import/export, and battery charge/discharge; accessible table switch. |
| `CostChart.tsx` | Recharts bar chart for import costs, export credits, and net invoicing; accessible table switch. |
| `SavingsCard.tsx` | Counterfactual savings card comparing actual net cost against baseline without solar or battery. |
| `Analytics.tsx` | Page coordinator mounted at `/analytics` in `AppPages.tsx`. |

---

## 3. Range & Resolution Mapping

### Timezone & Boundary Semantics
All date ranges are evaluated in the site's configured IANA timezone (`Europe/Dublin` default):
- **Day:** Exactly one local calendar day from local 00:00 to next local 00:00 (24 hours standard; 23 hours on DST spring forward; 25 hours on DST fall back).
- **Week:** 7 consecutive local calendar days.
- **Month:** The entire calendar month of the anchor date (e.g. 2026-06-01 to 2026-06-30).
- **Year:** The entire calendar year (e.g. 2026-01-01 to 2026-12-31).
- **Custom:** User-specified start and end local dates.

### Resolution Permissibility
In accordance with Rule 9 ("never fabricate finer resolution than what telemetry provides"):
- Ranges $\le 1$ day: `interval` (15m raw) or `hourly`.
- Ranges $\le 7$ days: `hourly`, `interval`, or `daily`.
- Ranges $\le 31$ days: `daily`, `hourly`, or `interval`.
- Ranges $\le 92$ days: `daily` or `hourly`.
- Ranges $> 92$ days: `daily`.

The interface displays a visible badge stating the exact resolution in use (e.g. `Resolution: Raw 15-minute intervals`).

### Bounded Data Points (Downsampling)
To guarantee 60fps rendering and instant reactivity on mobile and low-power hardware, series with more than 500 points (`MAX_CHART_POINTS`) are downsampled using **uniform composite grouping**:
- Calculates bucket stride: $K = \lceil N / 500 \rceil$.
- Combines $K$ consecutive intervals into a composite point by summing energy flows with arbitrary-precision decimal arithmetic.
- If any interval within a composite point was marked `SUSPECT` or missing, the composite point is flagged with `isGap = true`.

---

## 4. Visual Identity & Chart Palette

Charts conform to the AutoPW3 dark theme:

| Flow / Metric | Hex Colour | Semantic Meaning |
|---|---|---|
| **Solar Generation** | `#f59e0b` (`--color-solar`) | Amber solar generation |
| **Home Demand** | `#06b6d4` (`--color-select`) | Cyan household load |
| **Grid Import** | `#6366f1` (`--color-grid`) | Indigo electricity purchase |
| **Grid Export** | `#a5b4fc` (`--color-grid-ink`) | Light indigo export credit |
| **Battery Charged** | `#10b981` (`--color-battery`) | Emerald battery stored |
| **Battery Discharged**| `#34d399` (`--color-success`)| Light emerald battery released |
| **Net Cost / Import** | `#f87171` (`--color-danger`) | Destructive / outgoing cost |
| **Net Savings** | `#34d399` (`--color-success`)| Positive financial savings |

---

## 5. Accessibility (WCAG 2.2 AA)

- **Chart-to-Table Toggling:** Every chart component provides a clear button toggling between the Recharts graphical presentation and a semantic `<DataTable>`.
- **Screen Reader Semantics:** Data tables include a descriptive caption (`<caption>`), column headers with `scope="col"`, right-aligned tabular numbers for figures, and unambiguous status tags (`OK` vs `GAP`).
- **Contrast & Effects:** All text and control pairs meet WCAG AA contrast ratios. Glow accents disappear when `<html data-effects="off">` is set or when `prefers-reduced-motion` is active.

---

## 6. Security: CSV Formula Injection Prevention

The CSV export function (`buildEnergyCsv`, `buildCostCsv`, `sanitizeCsvField`) mitigates OWASP CSV Injection attacks:
- Any cell value beginning with `= `, `+ `, `- `, `@ `, `\t `, or `\r ` is prefixed with an apostrophe (`'`), preventing spreadsheet applications (Excel, Google Sheets, Calc) from executing formulas or DDE commands.
- Values containing commas, double quotes, or newlines are properly wrapped in quotes and internal quotes are doubled (`""`).
- Decimal values are formatted with exact scale and serialised as explicit strings.
- Headers explicitly include units: `Timestamp (UTC)`, `Period Label`, `Solar Generated (kWh)`, `Home Consumption (kWh)`, `Grid Import (kWh)`, `Grid Export (kWh)`, `Import Cost (EUR)`, `Net Cost (EUR)`.

---

## 7. Assumptions & Counterfactual Model

All savings metrics display the `ESTIMATE` badge and provide an inline disclosure panel detailing:
- **A-01 (Standing Charges):** Charged per local calendar date in full for any date containing recorded intervals.
- **A-02 (Counterfactual Baseline):** Avoided grid cost and estimated net savings assume 100% of household demand would have been imported at the active import tariff with zero solar and zero battery storage.
- **A-03 (Battery Efficiency):** Computed as $\sum \text{discharge} / \sum \text{charge}$ over the period.
- **A-04 (Tariff Optimisation):** Load shifting benefit evaluated against the volume-weighted average flat import rate.
