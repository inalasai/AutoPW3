import { describe, expect, it } from 'vitest';
import { EXPORT_PER_KWH_EXAMPLE, FLAT_IMPORT_EXAMPLE } from '../tariff/fixtures';
import type { LiveEnergyInterval } from '../telemetry/types';
import { calculatePeriodCosts } from './costs';

describe('financial costs and independent net calculations', () => {
  const period = {
    from: '2026-06-21T00:00:00Z',
    to: '2026-06-22T00:00:00Z',
    timezone: 'Europe/Dublin',
  };

  const interval: LiveEnergyInterval = {
    intervalStart: '2026-06-21T12:00:00Z',
    intervalEnd: '2026-06-21T13:00:00Z',
    resolutionSeconds: 3600,
    solarGeneratedWh: 1000,
    homeConsumedWh: 2000,
    gridImportWh: 2000, // 2 kWh
    gridExportWh: 500, // 0.5 kWh
    batteryChargedWh: 0,
    batteryDischargedWh: 0,
    source: 'TESLA',
    quality: 'OK',
  };

  it('computes import and export costs independently', () => {
    const { costTotals } = calculatePeriodCosts(
      [interval],
      [FLAT_IMPORT_EXAMPLE, EXPORT_PER_KWH_EXAMPLE],
      period,
    );

    // Import cost: 2 kWh * 0.30 = 0.60 base
    expect(costTotals.importEnergyCost.baseAmount).toBe('0.6');
    // Export credit: 0.5 kWh * 0.10 = 0.05 base
    expect(costTotals.exportRevenueCredit.baseAmount).toBe('0.05');
    // Standing charge for 1 day: 0.60 base
    expect(costTotals.standingCharges.baseAmount).toBe('0.6');
    // Taxable: 0.60 + 0.60 = 1.20; VAT (23%): 1.20 * 0.23 = 0.276000
    expect(costTotals.standingCharges.vatAmount).toBe('0.138');
    expect(costTotals.importEnergyCost.vatAmount).toBe('0.138');
    expect(costTotals.netCost.vatAmount).toBe('0.276');

    // Unrounded net cost: 0.60 + 0.60 + 0.276 - 0.05 = 1.426
    expect(costTotals.netCost.totalAmount).toBe('1.426');
  });

  it('ensures displayed rounded net cost matches sum of rounded component lines', () => {
    const { costTotals } = calculatePeriodCosts(
      [interval],
      [FLAT_IMPORT_EXAMPLE, EXPORT_PER_KWH_EXAMPLE],
      period,
    );

    const rounded = costTotals.rounded;
    // Component lines:
    // Import total: 0.60 + 0.138 = 0.738 -> rounded 0.74
    expect(rounded.importEnergyCost.totalAmount).toBe('0.74');
    // Standing total: 0.60 + 0.138 = 0.738 -> rounded 0.74
    expect(rounded.standingCharges.totalAmount).toBe('0.74');
    // Export total: 0.05 -> rounded 0.05
    expect(rounded.exportRevenueCredit.totalAmount).toBe('0.05');

    // Sum of rounded lines: 0.74 + 0.74 - 0.05 = 1.43
    expect(rounded.netCost.totalAmount).toBe('1.43');
  });

  it('rejects multiple currencies across tariff set', () => {
    const usdTariff = {
      ...FLAT_IMPORT_EXAMPLE,
      currency: 'USD',
    };
    expect(() =>
      calculatePeriodCosts([interval], [FLAT_IMPORT_EXAMPLE, usdTariff], period),
    ).toThrow(RangeError);
  });
});
