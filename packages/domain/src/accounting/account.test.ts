import { describe, expect, it } from 'vitest';
import { demoDay } from '../fixtures';
import { FLAT_IMPORT_EXAMPLE } from '../tariff/fixtures';
import type { LiveEnergyInterval } from '../telemetry/types';
import { accountForPeriod } from './account';

describe('accountForPeriod orchestrator', () => {
  it('accounts for a full demo day when context is DEMO', () => {
    const dataset = demoDay();
    const result = accountForPeriod({
      intervals: dataset.energy,
      tariffs: [FLAT_IMPORT_EXAMPLE],
      options: { context: 'DEMO' },
    });

    expect(result.context).toBe('DEMO');
    expect(result.energyTotals.solarGeneratedWh).not.toBe('0');
    expect(result.completeness.completenessRatio).toBeGreaterThan(0.99);
    expect(result.costTotals).not.toBeNull();
    expect(result.efficiency.selfConsumptionPercent).not.toBeNull();
    expect(result.counterfactuals).not.toBeNull();
  });

  it('rejects demo intervals in default LIVE context', () => {
    const dataset = demoDay();
    expect(() =>
      accountForPeriod({
        intervals: dataset.energy,
        tariffs: [FLAT_IMPORT_EXAMPLE],
      }),
    ).toThrow();
  });

  it('handles energy accounting without tariffs', () => {
    const liveInterval: LiveEnergyInterval = {
      intervalStart: '2026-06-21T00:00:00Z',
      intervalEnd: '2026-06-21T01:00:00Z',
      resolutionSeconds: 3600,
      solarGeneratedWh: 1000,
      homeConsumedWh: 1000,
      gridImportWh: 0,
      gridExportWh: 0,
      batteryChargedWh: 0,
      batteryDischargedWh: 0,
      source: 'TESLA',
      quality: 'OK',
    };

    const result = accountForPeriod({
      intervals: [liveInterval],
    });

    expect(result.energyTotals.solarGeneratedWh).toBe('1000');
    expect(result.costTotals).toBeNull();
    expect(result.counterfactuals).toBeNull();
    expect(result.completeness.completenessRatio).toBe(1);
  });
});
