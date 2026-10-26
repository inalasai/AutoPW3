import { describe, expect, it } from 'vitest';
import type { LiveEnergyInterval } from '../telemetry/types';
import { aggregateEnergyTotals, computeCompletenessReport } from './energy';

describe('energy totals and completeness', () => {
  const i1: LiveEnergyInterval = {
    intervalStart: '2026-06-21T00:00:00Z',
    intervalEnd: '2026-06-21T01:00:00Z',
    resolutionSeconds: 3600,
    solarGeneratedWh: 1000,
    homeConsumedWh: 1500,
    gridImportWh: 1000,
    gridExportWh: 500,
    batteryChargedWh: 200,
    batteryDischargedWh: 0,
    source: 'TESLA',
    quality: 'OK',
  };

  const i2: LiveEnergyInterval = {
    intervalStart: '2026-06-21T01:00:00Z',
    intervalEnd: '2026-06-21T02:00:00Z',
    resolutionSeconds: 3600,
    solarGeneratedWh: 2000,
    homeConsumedWh: 2000,
    gridImportWh: 500,
    gridExportWh: 1000,
    batteryChargedWh: 0,
    batteryDischargedWh: 300,
    source: 'TESLA',
    quality: 'OK',
  };

  it('sums energy flows with exact decimal arithmetic', () => {
    const totals = aggregateEnergyTotals([i1, i2]);
    expect(totals.solarGeneratedWh).toBe('3000');
    expect(totals.homeConsumedWh).toBe('3500');
    expect(totals.gridImportWh).toBe('1500');
    expect(totals.gridExportWh).toBe('1500');
    expect(totals.batteryChargedWh).toBe('200');
    expect(totals.batteryDischargedWh).toBe('300');
    expect(totals.netGridWh).toBe('0');
    expect(totals.netBatteryWh).toBe('100');

    expect(totals.solarGeneratedKwh).toBe('3');
    expect(totals.homeConsumedKwh).toBe('3.5');
    expect(totals.gridImportKwh).toBe('1.5');
  });

  it('handles null values without coercing to zero', () => {
    const iNull: LiveEnergyInterval = {
      ...i1,
      solarGeneratedWh: null,
    };
    const totals = aggregateEnergyTotals([iNull, i2]);
    // Only i2 contributes to solar
    expect(totals.solarGeneratedWh).toBe('2000');
  });

  it('computes completeness report and resolution tracking', () => {
    const period = {
      from: '2026-06-21T00:00:00Z',
      to: '2026-06-21T04:00:00Z', // 4 hours = 14400s
      timezone: 'Europe/Dublin',
    };
    // 2 hours covered out of 4
    const report = computeCompletenessReport([i1, i2], period, 1);
    expect(report.expectedSeconds).toBe(14400);
    expect(report.coveredSeconds).toBe(7200);
    expect(report.completenessRatio).toBe(0.5);
    expect(report.totalIntervals).toBe(3);
    expect(report.accountedIntervals).toBe(2);
    expect(report.excludedSuspectIntervals).toBe(1);
    expect(report.minResolutionSeconds).toBe(3600);
    expect(report.maxResolutionSeconds).toBe(3600);
    expect(report.fieldCompleteness.solarGenerated).toBe(0.5);
  });
});
