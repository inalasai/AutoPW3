import { describe, expect, it } from 'vitest';
import { accountForPeriod } from './account';
import {
  DATA_GAPS_FIXTURE,
  DST_FALL_BACK_FIXTURE,
  DST_SPRING_FORWARD_FIXTURE,
  EXPORT_ONLY_FIXTURE,
  MID_RANGE_TARIFF_FIXTURE,
  SECTION_8_FIXTURE,
  SUSPECT_EXCLUSION_FIXTURE,
} from './fixtures';

describe('accounting golden fixtures (hand-calculated verification)', () => {
  it('Fixture 1: matches Section 8 illustration exactly', () => {
    const f = SECTION_8_FIXTURE;
    const result = accountForPeriod({
      intervals: f.intervals,
      tariffs: f.tariffs,
      period: f.period,
    });

    // Energy checks
    expect(result.energyTotals.solarGeneratedWh).toBe(f.expected.energy.solarWh);
    expect(result.energyTotals.homeConsumedWh).toBe(f.expected.energy.homeWh);
    expect(result.energyTotals.gridImportWh).toBe(f.expected.energy.gridImportWh);
    expect(result.energyTotals.gridExportWh).toBe(f.expected.energy.gridExportWh);
    expect(result.energyTotals.batteryChargedWh).toBe(f.expected.energy.batteryChargedWh);
    expect(result.energyTotals.batteryDischargedWh).toBe(f.expected.energy.batteryDischargedWh);
    expect(result.energyTotals.netGridWh).toBe(f.expected.energy.netGridWh);
    expect(result.energyTotals.netBatteryWh).toBe(f.expected.energy.netBatteryWh);

    // Financial breakdown checks (unrounded)
    const costs = result.costTotals!;
    expect(costs.importEnergyCost.baseAmount).toBe(f.expected.costs.importBase);
    expect(costs.standingCharges.baseAmount).toBe(f.expected.costs.standingBase);
    expect(costs.netCost.vatAmount).toBe(f.expected.costs.vatAmount);
    expect(costs.exportRevenueCredit.totalAmount).toBe(f.expected.costs.exportTotal);
    expect(costs.netCost.totalAmount).toBe(f.expected.costs.unroundedNetTotal);

    // Rounded presentation lines (must add up)
    expect(costs.rounded.importEnergyCost.totalAmount).toBe(f.expected.costs.roundedImportTotal);
    expect(costs.rounded.standingCharges.totalAmount).toBe(f.expected.costs.roundedStandingTotal);
    expect(costs.rounded.exportRevenueCredit.totalAmount).toBe(f.expected.costs.roundedExportTotal);
    expect(costs.rounded.netCost.totalAmount).toBe(f.expected.costs.roundedDisplayedNetTotal);
  });

  it('Fixture 2: handles DST spring-forward (23-hour day)', () => {
    const f = DST_SPRING_FORWARD_FIXTURE;
    const result = accountForPeriod({
      intervals: f.intervals,
      tariffs: f.tariffs,
      period: f.period,
    });

    expect(result.completeness.expectedSeconds).toBe(f.expected.expectedSeconds);
    expect(result.completeness.coveredSeconds).toBe(f.expected.coveredSeconds);
    expect(result.costTotals?.standingCharges.baseAmount).toBe(f.expected.standingChargeBase);
  });

  it('Fixture 3: handles DST fall-back (25-hour day)', () => {
    const f = DST_FALL_BACK_FIXTURE;
    const result = accountForPeriod({
      intervals: f.intervals,
      tariffs: f.tariffs,
      period: f.period,
    });

    expect(result.completeness.expectedSeconds).toBe(f.expected.expectedSeconds);
    expect(result.completeness.coveredSeconds).toBe(f.expected.coveredSeconds);
    expect(result.costTotals?.standingCharges.baseAmount).toBe(f.expected.standingChargeBase);
  });

  it('Fixture 4: reduces completeness on data gaps without silent extrapolation', () => {
    const f = DATA_GAPS_FIXTURE;
    const result = accountForPeriod({
      intervals: f.intervals,
      tariffs: f.tariffs,
      period: f.period,
    });

    expect(result.completeness.expectedSeconds).toBe(f.expected.expectedSeconds);
    expect(result.completeness.coveredSeconds).toBe(f.expected.coveredSeconds);
    expect(result.completeness.completenessRatio).toBe(f.expected.completenessRatio);
    expect(result.energyTotals.gridImportWh).toBe(f.expected.totalImportWh);
  });

  it('Fixture 5: correctly splits charges across mid-range tariff version change', () => {
    const f = MID_RANGE_TARIFF_FIXTURE;
    const result = accountForPeriod({
      intervals: f.intervals,
      tariffs: f.tariffs,
      period: f.period,
    });

    expect(result.costTotals?.importEnergyCost.baseAmount).toBe(f.expected.importEnergyBase);
    expect(result.costTotals?.standingCharges.baseAmount).toBe(f.expected.standingChargeBase);
  });

  it('Fixture 6: excludes SUSPECT intervals from accounting totals and lowers completeness', () => {
    const f = SUSPECT_EXCLUSION_FIXTURE;
    const result = accountForPeriod({
      intervals: f.intervals,
      tariffs: f.tariffs,
      period: f.period,
    });

    expect(result.completeness.accountedIntervals).toBe(f.expected.accountedIntervals);
    expect(result.completeness.excludedSuspectIntervals).toBe(f.expected.excludedSuspectIntervals);
    expect(result.energyTotals.gridImportWh).toBe(f.expected.totalImportWh);
  });

  it('Fixture 7: evaluates export-only scenario independently', () => {
    const f = EXPORT_ONLY_FIXTURE;
    const resPerKwh = accountForPeriod({
      intervals: f.intervals,
      tariffs: f.tariffsPerKwh,
      period: f.period,
    });
    expect(resPerKwh.energyTotals.gridExportWh).toBe(f.expected.exportWh);
    expect(resPerKwh.costTotals?.exportRevenueCredit.baseAmount).toBe(
      f.expected.exportCreditPerKwh,
    );

    const resNone = accountForPeriod({
      intervals: f.intervals,
      tariffs: f.tariffsNone,
      period: f.period,
    });
    expect(resNone.costTotals?.exportRevenueCredit.baseAmount).toBe(f.expected.exportCreditNone);
  });
});
