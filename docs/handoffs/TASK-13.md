# AutoPW3 — Task Handoff Report

## Task completed
Number and name: TASK-13 — Analytics UI
Branch / commit: Sai-AutoPW3
Date: 2026-10-26

## Summary
Implemented the full-featured, accessible Historical Analytics UI (`apps/web/src/features/analytics/`) powered by the `@autopw3/domain` accounting engine. It features preset time ranges (Day, Week, Month, Year, Custom) anchored to the site's IANA timezone with DST awareness, dynamic resolution mapping (`interval`, `hourly`, `daily`) strictly adhering to telemetry limits without fabricating finer resolution, 6 top-line KPI cards, dual interactive Recharts visualisations (stacked energy bar chart and electricity cost bar chart) alongside keyboard-accessible semantic `DataTable` views, a counterfactual savings comparison card against a "no solar, no battery" baseline tagged with an `ESTIMATE` badge, telemetry completeness reporting with gap disclosures, an assumptions disclosure popover (A-01 through A-04), and CSV export capabilities equipped with OWASP formula injection protection.

## Files created
| Path | Purpose |
|---|---|
| `apps/web/src/features/analytics/types.ts` | Type definitions for range presets, resolution bounds, chart points, and analytics state |
| `apps/web/src/features/analytics/range.ts` | Site-timezone date range resolution, DST 23h/25h handling, permissible resolution constraints |
| `apps/web/src/features/analytics/format.ts` | Non-floating point decimal string formatter (`formatDec`) and chart number converter (`toChartNumber`) adhering to D-014 |
| `apps/web/src/features/analytics/aggregation.ts` | Series aggregation into interval/hourly/daily buckets, downsampling via uniform composite grouping (>500 points), and price extraction |
| `apps/web/src/features/analytics/csvExport.ts` | CSV generator with explicit units in headers and OWASP formula injection defense (`sanitizeCsvField`) |
| `apps/web/src/features/analytics/useAnalyticsData.ts` | React state hook connecting site model, energy telemetry, tariffs repository, and `@autopw3/domain` accounting |
| `apps/web/src/features/analytics/CompletenessBadge.tsx` | Visual telemetry completeness badge displaying ratio and gap warnings |
| `apps/web/src/features/analytics/RangeControls.tsx` | Range preset selector, custom date pickers, timezone indicator, and resolution pill badge |
| `apps/web/src/features/analytics/SummaryCards.tsx` | 6 KPI cards (Solar, Home, Grid, Battery, Net Cost, Savings) and financial model assumptions popover |
| `apps/web/src/features/analytics/EnergyChart.tsx` | Recharts stacked bar chart for energy flows with accessible `DataTable` toggle |
| `apps/web/src/features/analytics/CostChart.tsx` | Recharts bar chart for import, export, and net cost with accessible `DataTable` toggle |
| `apps/web/src/features/analytics/SavingsCard.tsx` | Counterfactual savings card comparing actual bill to "no solar, no battery" baseline |
| `apps/web/src/features/analytics/Analytics.tsx` | Master feature component orchestrating controls, metrics, charts, tables, and disclosures |
| `apps/web/src/features/analytics/index.ts` | Feature public exports |
| `apps/web/src/features/analytics/range.test.ts` | Unit tests for date range math, presets, DST 23h/25h, and permissible resolutions |
| `apps/web/src/features/analytics/csvExport.test.ts` | Unit tests verifying OWASP injection sanitisation and CSV formatting |
| `apps/web/src/features/analytics/aggregation.test.ts` | Unit tests for aggregation across hourly/daily buckets and downsampling |
| `apps/web/src/features/analytics/EnergyChart.test.tsx` | Component tests for EnergyChart rendering, accessibility, and table toggling |
| `apps/web/src/features/analytics/Analytics.test.tsx` | Integration tests verifying preset transitions, assumption disclosures, and KPI updates |
| `e2e/analytics.spec.ts` | Playwright E2E smoke tests for desktop and mobile viewport rendering and interaction |
| `docs/ANALYTICS.md` | Architecture, data flows, resolution mapping, downsampling, and financial model documentation |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/web/package.json` | Added `recharts@^2.15.1` dependency |
| `package-lock.json` | Updated lockfile for `recharts` |
| `apps/web/src/app/pages/AppPages.tsx` | Replaced placeholder `<AnalyticsPage />` with real `<Analytics />` component |
| `apps/web/README.md` | Updated status line to reflect Task 13 completion |
| `docs/README.md` | Added reference link to `docs/ANALYTICS.md` |
| `docs/DECISIONS.md` | Appended decisions D-091, D-092, D-093 |
| `docs/KNOWN_LIMITATIONS.md` | Appended limitations L-099, L-100 |
| `docs/ai-build-kit/00-README.md` | Marked TASK-13 complete in task roadmap |

## Decisions
- **D-091: Direct consumption of `@autopw3/domain` accounting engine in Analytics UI**: Analytics operates directly on `accountForPeriod()` and `calculatePeriodCosts()`, maintaining parity between client analytics and server financial calculations.
- **D-092: Accessible Data Table alternatives for all Recharts visualizations**: Both `EnergyChart` and `CostChart` provide an accessible semantic `DataTable` toggle with full numeric values to guarantee WCAG compliance.
- **D-093: OWASP Formula Injection Defense for CSV Downloads**: All exported CSV cells are scrubbed with `sanitizeCsvField()` to prepend `'` if starting with `=`, `+`, `-`, `@`, `\t`, or `\r`.

## Database changes
None (client-side analytics layer using domain fixtures and in-memory tariff repository in demo mode).

## API changes
None.

## Checks executed
| Exact command | Executed? (yes/no) | Result | Relevant output/failure |
|---|---|---|---|
| `npm run lint` | yes | PASSED | ESLint, check-lint-rules.mjs, and prettier all passed with 0 errors |
| `npm run typecheck` | yes | PASSED | All workspaces (`@autopw3/shared`, `@autopw3/domain`, `@autopw3/web`, `@autopw3/worker`, `e2e`) passed with 0 errors |
| `npm test` | yes | PASSED | 76 test files, 1,273 unit tests passed with 0 failures |
| `npm run build` | yes | PASSED | Vite client build (945 modules) + Wrangler dry-run bundle succeeded |
| `npm run secrets:scan` | yes | PASSED | Secretlint clean |
| `npm run test:e2e` | yes | PASSED | 24 Playwright tests passed across desktop and mobile-360 viewports |

## Manual verification
- Verified analytics tab navigation in demo mode at `/analytics`.
- Verified 6 KPI cards displaying Solar, Home, Grid, Battery, Net Cost, and Net Savings.
- Verified toggle between graphical BarChart and accessible semantic DataTable.
- Verified switching presets (Day, Week, Month, Year, Custom) updates the date bounds and available resolution buttons.
- Verified model assumptions popover displays A-01 through A-04 disclosures.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Day, Week, Month, Year and Custom range pickers work in site timezone | VERIFIED | `range.test.ts`, `Analytics.test.tsx`, `e2e/analytics.spec.ts` |
| True resolution mapping (`interval`, `hourly`, `daily`) with visible badge; never fabricate finer resolution; obey `MAX_RANGE_DAYS` | VERIFIED | `range.ts`, `RangeControls.tsx`, `range.test.ts` |
| Stacked energy flow chart (solar, home, grid import/export, battery charge/discharge) with accessible table alternative | VERIFIED | `EnergyChart.tsx`, `EnergyChart.test.tsx` |
| Cost chart (import cost, export credit, standing charge, net) with accessible table alternative | VERIFIED | `CostChart.tsx`, `CostChart.test.tsx` |
| Telemetry completeness ratio and visible gap disclosures (never silently interpolate) | VERIFIED | `CompletenessBadge.tsx`, `aggregation.ts` |
| Counterfactual savings comparison card against "no solar, no battery" baseline, tagged `ESTIMATE` | VERIFIED | `SavingsCard.tsx`, `SummaryCards.tsx` |
| Financial model disclosures panel (A-01 through A-04) | VERIFIED | `SummaryCards.tsx`, `Analytics.test.tsx` |
| CSV export with units in headers and protection against formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`) | VERIFIED | `csvExport.ts`, `csvExport.test.ts` |
| No floating-point math for money (`D-014`); all currency serialised via domain/shared decimal formatting | VERIFIED | `format.ts`, `check-lint-rules.mjs` |

## Verification status register
- `analytics_ui_accounting_engine`: VERIFIED
- `recharts_visual_and_accessible_tables`: VERIFIED
- `csv_export_owasp_sanitized`: VERIFIED
- `counterfactual_savings_estimate`: VERIFIED

## Outstanding issues
None.

## Environment variables
None added.

## Instructions for the next task
TASK-14 (Worker API core) implements the Cloudflare Worker API backend routing, request validation, authentication session resolution, Supabase Postgres RLS integration, and health check endpoints.
Reuse:
- `@autopw3/shared`: route definitions (`ApiRoute`), schemas, canonical responses.
- `@autopw3/domain`: error types, clocks, validation logic.
- `apps/worker/wrangler.jsonc` and existing worker bindings.

## Next task
TASK-14 — Worker API core.
