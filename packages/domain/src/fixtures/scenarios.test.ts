import { describe, expect, it } from 'vitest';
import { describeFlows } from '../telemetry/flows';
import { freshnessOf } from '../telemetry/freshness';
import { normalisePowerReading } from '../telemetry/normalise';
import { powerBalanceHolds } from '../telemetry/validation';
import { DEMO_SCENARIOS, DEMO_SCENARIO_IDS } from './scenarios';

const NOW = new Date('2026-06-21T12:00:00Z');

function run(id: (typeof DEMO_SCENARIO_IDS)[number]) {
  const scenario = DEMO_SCENARIOS[id];
  const sampledAtMs = NOW.getTime() - scenario.ageSeconds * 1000;
  const { sample, issues } = normalisePowerReading(
    { ...scenario.raw, sampledAt: sampledAtMs },
    { source: 'DEMO', receivedAt: NOW },
  );
  return { scenario, sample, issues };
}

describe('demo scenarios', () => {
  it('covers every case the task lists, under their own ids', () => {
    expect([...DEMO_SCENARIO_IDS]).toEqual([
      'SOLAR_SURPLUS',
      'BATTERY_CHARGING',
      'BATTERY_DISCHARGING',
      'GRID_IMPORT',
      'GRID_EXPORT',
      'LOW_BATTERY',
      'MISSING_DATA',
      'STALE_DATA',
      'INVALID_READINGS',
    ]);
    for (const id of DEMO_SCENARIO_IDS) expect(DEMO_SCENARIOS[id].id).toBe(id);
  });

  it.each([...DEMO_SCENARIO_IDS])('%s normalises to exactly what it promises', (id) => {
    const { scenario, sample, issues } = run(id);
    expect(sample.source).toBe('DEMO');
    expect(sample.quality).toBe(scenario.expect.quality);
    expect([...new Set(issues.map((i) => i.code))].sort()).toEqual([...scenario.expect.issueCodes]);
    expect(freshnessOf(sample.sampledAt, NOW).freshness).toBe(scenario.expect.freshness);
  });

  it.each([...DEMO_SCENARIO_IDS])('%s keeps its freshness whatever the clock says', (id) => {
    const scenario = DEMO_SCENARIOS[id];
    for (const now of [NOW, new Date('2027-01-15T03:30:00Z'), new Date('2030-12-01T23:59:00Z')]) {
      const sampledAt = now.getTime() - scenario.ageSeconds * 1000;
      const { sample } = normalisePowerReading(
        { ...scenario.raw, sampledAt },
        { source: 'DEMO', receivedAt: now },
      );
      expect(freshnessOf(sample.sampledAt, now).freshness).toBe(scenario.expect.freshness);
    }
  });

  it('every clean scenario balances: load = solar + battery + grid', () => {
    for (const id of DEMO_SCENARIO_IDS) {
      const { scenario } = run(id);
      if (scenario.expect.quality !== 'OK') continue;
      const { solarPowerW, batteryPowerW, gridPowerW, loadPowerW } = scenario.raw;
      expect(
        powerBalanceHolds({
          solarPowerW: solarPowerW as number,
          batteryPowerW: batteryPowerW as number,
          gridPowerW: gridPowerW as number,
          loadPowerW: loadPowerW as number,
        }),
      ).toBe(true);
    }
  });

  it('each situation reads as it is named, using the project signs', () => {
    const flows = (id: (typeof DEMO_SCENARIO_IDS)[number]) => describeFlows(run(id).sample);
    expect(flows('SOLAR_SURPLUS')).toMatchObject({
      solarSurplus: true,
      battery: 'CHARGING',
      grid: 'EXPORTING',
    });
    expect(flows('BATTERY_CHARGING')).toMatchObject({ battery: 'CHARGING', solarSurplus: true });
    expect(flows('BATTERY_DISCHARGING')).toMatchObject({
      battery: 'DISCHARGING',
      solarSurplus: false,
    });
    expect(flows('GRID_IMPORT')).toMatchObject({ grid: 'IMPORTING', battery: 'DISCHARGING' });
    expect(flows('GRID_EXPORT')).toMatchObject({ grid: 'EXPORTING', solarSurplus: true });
    expect(flows('LOW_BATTERY')).toMatchObject({ lowBattery: true, grid: 'IMPORTING' });
    expect(flows('SOLAR_SURPLUS').lowBattery).toBe(false);
  });

  it('missing data stays null, never zero', () => {
    const { sample } = run('MISSING_DATA');
    expect(sample.loadPowerW).toBeNull();
    expect(sample.batteryPowerW).toBeNull();
    expect(sample.solarPowerW).toBe(2400);
  });

  it('invalid readings are flagged suspect and unrepresentable values are not kept', () => {
    const { sample, issues } = run('INVALID_READINGS');
    expect(sample.quality).toBe('SUSPECT');
    expect(sample.solarPowerW).toBeNull();
    expect(sample.loadPowerW).toBeNull();
    expect(sample.batterySocPercent).toBeNull();
    expect(issues.length).toBeGreaterThanOrEqual(4);
  });

  it('the stale scenario is clean data that is simply old', () => {
    const { sample, scenario } = run('STALE_DATA');
    expect(sample.quality).toBe('OK');
    expect(scenario.ageSeconds).toBeGreaterThan(3600);
  });

  it('are all different from one another', () => {
    const raws = DEMO_SCENARIO_IDS.map((id) => JSON.stringify(DEMO_SCENARIOS[id].raw));
    expect(new Set(raws).size).toBe(raws.length);
  });
});
