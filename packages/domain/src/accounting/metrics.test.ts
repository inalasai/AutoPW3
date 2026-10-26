import { describe, expect, it } from 'vitest';
import { FLAT_IMPORT_EXAMPLE } from '../tariff/fixtures';
import type { LiveEnergyInterval } from '../telemetry/types';
import { calculatePeriodCosts } from './costs';
import { aggregateEnergyTotals } from './energy';
import { computeCounterfactuals, computeEfficiencyMetrics } from './metrics';

describe('efficiency metrics and counterfactuals', () => {
  it('computes self-consumption and self-sufficiency percentages correctly', () => {
    // Solar: 5000 Wh, Export: 1000 Wh -> Self-consumed solar = 4000 Wh (80%)
    // Home: 4000 Wh, Import: 1000 Wh -> Self-sufficiency = (4000 - 1000) / 4000 = 75%
    // Battery charged: 1000 Wh, discharged: 900 Wh -> Loss = 100 Wh, efficiency = 90%
    const totals = aggregateEnergyTotals([
      {
        intervalStart: '2026-06-21T12:00:00Z',
        intervalEnd: '2026-06-21T13:00:00Z',
        resolutionSeconds: 3600,
        solarGeneratedWh: 5000,
        homeConsumedWh: 4000,
        gridImportWh: 1000,
        gridExportWh: 1000,
        batteryChargedWh: 1000,
        batteryDischargedWh: 900,
        source: 'TESLA',
        quality: 'OK',
      },
    ]);

    const metrics = computeEfficiencyMetrics(totals);
    expect(metrics.selfConsumedSolarWh).toBe('4000');
    expect(metrics.selfConsumptionPercent).toBe('80.00');
    expect(metrics.selfSufficiencyPercent).toBe('75.00');
    expect(metrics.batteryLossWh).toBe('100');
    expect(metrics.batteryEfficiencyPercent).toBe('90.00');
  });

  it('computes counterfactual "no solar, no battery" scenario and savings', () => {
    const period = {
      from: '2026-06-21T00:00:00Z',
      to: '2026-06-22T00:00:00Z',
      timezone: 'Europe/Dublin',
    };

    const interval: LiveEnergyInterval = {
      intervalStart: '2026-06-21T12:00:00Z',
      intervalEnd: '2026-06-21T13:00:00Z',
      resolutionSeconds: 3600,
      solarGeneratedWh: 2000,
      homeConsumedWh: 2000, // 2 kWh consumption
      gridImportWh: 500, // actual import: only 0.5 kWh
      gridExportWh: 500,
      batteryChargedWh: 0,
      batteryDischargedWh: 0,
      source: 'TESLA',
      quality: 'OK',
    };

    const { costTotals } = calculatePeriodCosts([interval], [FLAT_IMPORT_EXAMPLE], period);
    const counterfactual = computeCounterfactuals(
      [interval],
      [FLAT_IMPORT_EXAMPLE],
      period,
      costTotals,
    );

    expect(counterfactual).not.toBeNull();
    // Counterfactual import cost: 2 kWh * 0.30 = 0.60 base + 0.60 standing = 1.20 taxable + 23% VAT = 1.476 total
    expect(counterfactual?.counterfactualNoSolarNoBatteryNetCost).toBe('1.476');
    // Actual cost: 0.5 kWh * 0.30 = 0.15 base + 0.60 standing = 0.75 taxable + 23% VAT = 0.9225 total
    // Savings: 1.476 - 0.9225 = 0.5535
    expect(counterfactual?.estimatedNetSavings).toBe('0.5535');
  });
});
