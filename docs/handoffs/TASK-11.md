# AutoPW3 — Task Handoff Report

## Task completed
Number and name: TASK-11 Energy and Financial Accounting Engine  
Branch / commit: `Sai-AutoPW3` (branch requested by owner; commits prefixed `task-11:`).  
Date: 2026-10-26  

**Status: complete for what could be run locally.** All acceptance criteria are met and proven by comprehensive unit and golden fixture tests. 1,227 tests passing across the repository (535 tests in `@autopw3/domain`). All 6 root checks (`typecheck`, `lint`, `test`, `build`, `secrets:scan`, `coverage`) pass.

---

## Summary
`packages/domain/src/accounting` is now a pure, deterministic energy and financial accounting engine. It converts raw power readings into directional energy intervals via a left-Riemann hold-last method with gap handling; calculates energy totals across all flow dimensions using exact arbitrary-precision decimals; computes independent import charges and export revenues using the universal tariff engine (TASK-10); accounts for daily standing charges across 23-, 24-, and 25-hour days; applies VAT and levies; calculates self-consumption %, self-sufficiency %, and battery round-trip losses; evaluates counterfactual "no solar, no battery" savings and tariff optimisation benefits; tracks data completeness without silent extrapolation; and strictly enforces type- and runtime-level isolation between `DEMO` and `LIVE` telemetry.

Every formula, assumption, and counterfactual definition is documented in `docs/FINANCIAL_MODEL.md`.

---

## Files created
All under `packages/domain/src/accounting/` unless stated:

| Path | Purpose |
|---|---|
| `types.ts` | Accounting types: `AccountingInput`, `AccountingOptions`, `AccountingResult`, `EnergyTotals`, `CostTotals`, `EfficiencyMetrics`, `CounterfactualAnalysis`, `CompletenessReport`, `IntervalCostDetail`, `PricingIssues`. |
| `guard.ts` | Source isolation guard (`filterAccountableIntervals`, `requireLiveIntervals`); excludes `SUSPECT` intervals and rejects unlabelled demo data in live context. |
| `integrate.ts` | Power-to-energy conversion via left-Riemann step (hold-last) integration; handles gaps (> `maxGapSeconds` left uncovered) and optional UTC bucketing (`bucketSeconds`). |
| `energy.ts` | Energy flow summation via `Decimal`; completeness ratio calculation; non-overlapping coverage calculation; resolution bounds tracking. |
| `costs.ts` | Independent pricing of import intervals, export intervals, and local calendar day standing charges; VAT calculations; invoice integrity rounding (`Round(Import) + Round(Standing) - Round(Export)`). |
| `metrics.ts` | Self-consumption %, self-sufficiency %, battery round-trip losses/efficiency, and counterfactual savings analysis ("no solar, no battery"). |
| `account.ts` | Master orchestrator entry point (`accountForPeriod`). |
| `fixtures.ts` | 7 golden test fixtures with independently hand-calculated values (Section 8 illustration, 23h DST spring, 25h DST fall, data gaps, mid-range tariff change, SUSPECT exclusion, export-only credit). |
| `index.ts` | Public API re-exported by `packages/domain/src/index.ts`. |
| `guard.test.ts` | 5 unit tests for source compatibility and `SUSPECT` filtering. |
| `integrate.test.ts` | 3 unit tests for step integration, gap handling, and bucketing. |
| `energy.test.ts` | 3 unit tests for decimal flow sums, null field preservation, and completeness. |
| `costs.test.ts` | 3 unit tests for independent import/export costing, rounding, and currency validation. |
| `metrics.test.ts` | 2 unit tests for efficiency metrics and counterfactual savings. |
| `account.test.ts` | 3 unit tests for demo dataset accounting, live guard enforcement, and missing tariffs. |
| `golden.test.ts` | 7 golden tests verifying hand-calculated fixture expectations. |
| `docs/FINANCIAL_MODEL.md` | Complete specification of accounting formulas, invoice integrity rules, efficiency metrics, counterfactual baselines, and flagged assumptions. |
| `docs/handoffs/TASK-11.md` | This handoff report. |

---

## Files modified

| Path | What changed and why |
|---|---|
| `packages/domain/src/index.ts` | Added `export * from './accounting';`. |
| `packages/domain/vitest.config.ts` | Added `src/accounting/**/*.ts` to coverage include and exclude patterns. |
| `packages/domain/README.md` | Updated status and folder table marking accounting as complete. |
| `docs/README.md` | Linked `FINANCIAL_MODEL.md` in documentation index. |
| `docs/DECISIONS.md` | Appended decisions `D-082` through `D-086`. |
| `docs/KNOWN_LIMITATIONS.md` | Appended limitations `L-094` through `L-096`. |
| `docs/ai-build-kit/00-README.md` | Ticked TASK-11 in build tracker. |
| `apps/web/src/features/auth/auth.test.tsx` | Wrapped `document.title` check in `waitFor()` to eliminate asynchronous title update timing race in heavy multi-suite test runs. |
| `packages/domain/src/accounting/.gitkeep` | Removed placeholder file. |

---

## Decisions
- **D-082**: Left-Riemann step integration for power-to-energy conversion ($Wh = W \times \Delta t / 3600$); gaps $> \text{maxGapSeconds}$ left uncovered; derived intervals stamped `quality = 'DERIVED'`.
- **D-083**: Source isolation enforced at type and runtime levels; `accountForPeriod` rejects `DEMO` telemetry unless `context: 'DEMO'` is passed; `SUSPECT` intervals excluded from totals and tracked against completeness.
- **D-084**: Independent calculation of import charges and export revenue; standing charges assessed once per local calendar day ($[00:00, 24:00)$ in site timezone).
- **D-085**: Displayed net cost equals the sum of rounded component lines (`Round(Import) + Round(Standing) - Round(Export)`), ensuring visual invoice consistency.
- **D-086**: Efficiency metrics and counterfactual "no solar, no battery" savings model.

All recorded in `docs/DECISIONS.md` as **Proposed**.

---

## Database changes
None.

---

## API changes
None. Library-level pure domain engine.

---

## Public Functions and Contracts
All functions are pure, deterministic, and accept injected periods and clocks:

```ts
// Master orchestration function
export function accountForPeriod<S extends DataSource>(
  input: AccountingInput<S>
): AccountingResult;

// Power integration fallback
export function powerSamplesToEnergyIntervals<S extends DataSource>(
  samples: readonly PowerSampleOf<S>[],
  options?: IntegratePowerOptions
): EnergyIntervalOf<S>[];

// Energy aggregation & completeness
export function aggregateEnergyTotals<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[]
): EnergyTotals;

export function computeCompletenessReport<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  period: AccountingPeriod,
  excludedSuspectCount: number
): CompletenessReport;

// Independent financial costing
export function calculatePeriodCosts<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  tariffs: readonly Tariff[],
  period: AccountingPeriod,
  options?: AccountingOptions
): CalculateCostsResult;

// Efficiency metrics & counterfactuals
export function computeEfficiencyMetrics(
  energyTotals: EnergyTotals
): EfficiencyMetrics;

export function computeCounterfactuals<S extends DataSource>(
  intervals: readonly EnergyIntervalOf<S>[],
  tariffs: readonly Tariff[],
  period: AccountingPeriod,
  actualCostTotals: CostTotals | null,
  options?: AccountingOptions
): CounterfactualAnalysis | null;
```

---

## Checks executed

| Exact command | Executed? | Result | Relevant output |
|---|---|---|---|
| `npm run typecheck` | yes | PASS | 0 errors across `@autopw3/shared`, `@autopw3/domain`, `@autopw3/web`, `@autopw3/worker`, and `e2e` |
| `npm run lint` | yes | PASS | `eslint .`, `node scripts/check-lint-rules.mjs` (15 rules), `prettier --check .` all pass |
| `npm test -w @autopw3/domain` | yes | PASS | 29 test files passed, 535 tests passed (26 new accounting tests) |
| `npm run test:coverage -w @autopw3/domain` | yes | PASS | 95.3% statements, 97.6% lines across domain package; 95.1% lines in accounting module |
| `npm test` | yes | PASS | 1,227 tests passed across all 4 workspaces (`shared`, `domain`, `web`, `worker`) |
| `npm run build` | yes | PASS | Vite built web app in 787ms; Wrangler dry-run bundle succeeded |
| `npm run secrets:scan` | yes | PASS | 0 secrets found |

---

## Manual verification
- Hand calculations in `SECTION_8_FIXTURE` cross-referenced with `docs/ENERGY_ACCOUNTING.md` Section 8:
  - 2 kWh import @ €0.30/kWh + €0.60/day standing charge + 23% VAT - 0.5 kWh export @ €0.10/kWh.
  - Hand calculated unrounded net: €1.426. Hand calculated rounded display: €1.43.
  - Verified engine output matches both exact unrounded decimals and rounded displayed totals down to 6 decimal places.
- Verified 23-hour DST spring-forward (2026-03-29) and 25-hour DST fall-back (2026-10-25) in Europe/Dublin correctly incur 1 calendar day standing charge.
- Verified missing intervals in a 24-hour day reduce completeness to exactly 0.50 without extrapolating.
- Verified `quality = 'SUSPECT'` intervals are rejected from totals and lower completeness.

---

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Golden fixture totals match hand calculations exactly (to defined decimals). | VERIFIED | `packages/domain/src/accounting/golden.test.ts` (all 7 golden fixtures pass). |
| Costs and export revenue are computed independently. | VERIFIED | `packages/domain/src/accounting/costs.ts` and `costs.test.ts` verify import and export breakdowns are evaluated separately. |
| All assumptions are documented and flagged for owner review. | VERIFIED | `docs/FINANCIAL_MODEL.md` Section 7 documents assumptions A-01 through A-06. |

---

## Verification status register
- `VERIFIED`: Energy accounting, power integration, independent tariff costing, DST standing charges, VAT, efficiency metrics, counterfactual savings, golden fixtures.
- `MOCK_ONLY`: Tesla live provider integration (deferred to TASK-15).
- `UNVERIFIED`: Real battery internal loss calibration (L-094), hardware tolerances.

---

## Outstanding issues & Questions for Owner
Assumptions flagged in `docs/FINANCIAL_MODEL.md` for owner review:
1. **A-01:** Partial-day standing charges apply in full to any local calendar date with active interval coverage.
2. **A-02:** Counterfactual "no solar, no battery" prices 100% of home consumption as imported from the grid under the active import tariff.
3. **A-03:** Battery round-trip efficiency in v1 is estimated as $\sum \text{discharge} / \sum \text{charge}$ over the period; real battery degradation and standby loss are deferred (L-094).
4. **A-04:** Tariff optimisation benefit compares actual energy charges against flat volume-weighted average rate.

---

## Environment variables
No new environment variables required.

---

## Instructions for the next task
The next task is **TASK-12: Tariff Manager UI** in `apps/web/src/features/tariffs/`.
- Re-use `Tariff` types and validators from `packages/domain/src/tariff/validate.ts` (`validateTariff`, `validateTariffSet`).
- Re-use `packages/domain/src/tariff/fixtures/examples.ts` as starting templates for the UI.
- Gated by user role: `READ_ONLY` can view; `READ_WRITE` / `ADMIN` can create/edit.
- Do not modify `packages/domain/src/accounting/` or `packages/domain/src/tariff/` without documenting a defect.

---

## Next task
**TASK-12: Tariff Manager UI** (Phase 3 Energy domain frontend feature).
