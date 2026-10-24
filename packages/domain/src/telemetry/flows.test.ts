import { describe, expect, it } from 'vitest';
import { DEFAULT_LOW_BATTERY_PERCENT, describeFlows } from './flows';

const base = {
  solarPowerW: 3000,
  batteryPowerW: -1000,
  gridPowerW: -500,
  loadPowerW: 1500,
  batterySocPercent: 50,
};

describe('describeFlows (battery > 0 discharging, grid > 0 importing)', () => {
  it('reads charging and exporting from negative signs', () => {
    expect(describeFlows(base)).toEqual({
      battery: 'CHARGING',
      grid: 'EXPORTING',
      solarSurplus: true,
      lowBattery: false,
    });
  });

  it('reads discharging and importing from positive signs', () => {
    expect(
      describeFlows({
        ...base,
        solarPowerW: 0,
        batteryPowerW: 1200,
        gridPowerW: 300,
        loadPowerW: 1500,
      }),
    ).toMatchObject({ battery: 'DISCHARGING', grid: 'IMPORTING', solarSurplus: false });
  });

  it('calls exact zero idle', () => {
    expect(describeFlows({ ...base, batteryPowerW: 0, gridPowerW: 0 })).toMatchObject({
      battery: 'IDLE',
      grid: 'IDLE',
    });
  });

  it('solar equal to load is not a surplus', () => {
    expect(describeFlows({ ...base, solarPowerW: 1500 }).solarSurplus).toBe(false);
  });

  it('low battery is at or below the threshold, which can be changed', () => {
    expect(DEFAULT_LOW_BATTERY_PERCENT).toBe(15);
    expect(describeFlows({ ...base, batterySocPercent: 15 }).lowBattery).toBe(true);
    expect(describeFlows({ ...base, batterySocPercent: 16 }).lowBattery).toBe(false);
    expect(
      describeFlows({ ...base, batterySocPercent: 25 }, { lowBatteryPercent: 30 }).lowBattery,
    ).toBe(true);
  });

  it('gives null, never a guess, for anything it cannot tell', () => {
    expect(
      describeFlows({
        solarPowerW: null,
        batteryPowerW: null,
        gridPowerW: null,
        loadPowerW: null,
        batterySocPercent: null,
      }),
    ).toEqual({ battery: null, grid: null, solarSurplus: null, lowBattery: null });
  });
});
