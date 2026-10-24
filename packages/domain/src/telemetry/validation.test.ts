import { describe, expect, it } from 'vitest';
import {
  balanceToleranceW,
  energyBalanceResidualWh,
  energyBalanceToleranceWh,
  inspectEnergyValues,
  inspectPowerValues,
  powerBalanceHolds,
  qualityFromIssues,
  resolveValidationOptions,
} from './validation';
import type { EnergyValues, PowerValues } from './validation';

const base: PowerValues = {
  solarPowerW: 3000,
  batteryPowerW: -1000,
  gridPowerW: -500,
  loadPowerW: 1500,
  batterySocPercent: 50,
};

function codes(values: PowerValues): string[] {
  return inspectPowerValues(values).map((i) => i.code);
}

describe('signs and the power balance (load = solar + battery + grid)', () => {
  it('holds when the battery charges (negative) and the site exports (negative grid)', () => {
    // 1500 = 3000 + (-1000) + (-500)
    expect(powerBalanceHolds(base)).toBe(true);
    expect(codes(base)).toEqual([]);
  });

  it('holds when the battery discharges (positive) and the site imports (positive grid)', () => {
    const v = { ...base, solarPowerW: 0, batteryPowerW: 2000, gridPowerW: 800, loadPowerW: 2800 };
    expect(powerBalanceHolds(v)).toBe(true);
  });

  it('fails when the battery sign is inverted: the check is what catches a wrong adapter', () => {
    const inverted = { ...base, batteryPowerW: 1000 }; // charging reported as discharging
    expect(powerBalanceHolds(inverted)).toBe(false);
    expect(codes(inverted)).toContain('BALANCE_MISMATCH');
  });

  it('fails when the grid sign is inverted', () => {
    const inverted = { ...base, gridPowerW: 500 };
    expect(powerBalanceHolds(inverted)).toBe(false);
  });

  it('cannot judge the balance when any of the four values is missing, and says null, not true', () => {
    expect(powerBalanceHolds({ ...base, loadPowerW: null })).toBeNull();
    expect(powerBalanceHolds({ ...base, solarPowerW: null })).toBeNull();
    expect(powerBalanceHolds({ ...base, batteryPowerW: null })).toBeNull();
    expect(powerBalanceHolds({ ...base, gridPowerW: null })).toBeNull();
    expect(codes({ ...base, loadPowerW: null })).toEqual([]);
  });
});

describe('balance tolerance: max(floor, percent of load)', () => {
  it('uses the shared proposal by default: 100 W floor, 5 percent', () => {
    expect(balanceToleranceW(500)).toBe(100); // 5% = 25 W, below the floor
    expect(balanceToleranceW(4000)).toBe(200); // 5% = 200 W, above the floor
  });

  it('passes at exactly the tolerance and fails one watt over', () => {
    const v = (load: number): PowerValues => ({ ...base, loadPowerW: load });
    // sources sum to 1500; tolerance at load 1500 is max(100, 75) = 100
    expect(powerBalanceHolds(v(1600))).toBe(true);
    expect(powerBalanceHolds(v(1601))).toBe(false);
    expect(powerBalanceHolds(v(1400))).toBe(true);
    expect(powerBalanceHolds(v(1399))).toBe(false);
  });

  it('scales with load for a large load', () => {
    const v: PowerValues = {
      ...base,
      solarPowerW: 8000,
      batteryPowerW: 0,
      gridPowerW: 0,
      loadPowerW: 8300,
    };
    expect(powerBalanceHolds(v)).toBe(true); // 300 W off, tolerance 5% of 8300 = 415 W
    expect(powerBalanceHolds({ ...v, loadPowerW: 8500 })).toBe(false); // 500 W off, tolerance 425 W
  });

  it('accepts custom tolerances and rejects invalid ones', () => {
    expect(powerBalanceHolds({ ...base, loadPowerW: 1650 }, { balanceToleranceFloorW: 200 })).toBe(
      true,
    );
    expect(() => resolveValidationOptions({ balanceToleranceFloorW: -1 })).toThrow(RangeError);
    expect(() => resolveValidationOptions({ balanceTolerancePercent: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      resolveValidationOptions({ maxPlausiblePowerW: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });
});

describe('field checks', () => {
  it('flags negative solar and negative load', () => {
    expect(codes({ ...base, solarPowerW: -1 })).toContain('SOLAR_NEGATIVE');
    expect(codes({ ...base, loadPowerW: -1 })).toContain('LOAD_NEGATIVE');
  });

  it('accepts zero solar and zero load', () => {
    expect(
      codes({ ...base, solarPowerW: 0, batteryPowerW: 0, gridPowerW: 0, loadPowerW: 0 }),
    ).toEqual([]);
  });

  it('accepts a battery level of exactly 0 and exactly 100, and flags anything outside', () => {
    expect(codes({ ...base, batterySocPercent: 0 })).toEqual([]);
    expect(codes({ ...base, batterySocPercent: 100 })).toEqual([]);
    expect(codes({ ...base, batterySocPercent: -0.1 })).toContain('SOC_OUT_OF_RANGE');
    expect(codes({ ...base, batterySocPercent: 100.1 })).toContain('SOC_OUT_OF_RANGE');
  });

  it('flags a power far beyond a home as a likely unit mix-up (milliwatts read as watts)', () => {
    const v = { ...base, solarPowerW: 4_200_000 };
    expect(codes(v)).toContain('POWER_IMPLAUSIBLE_MAGNITUDE');
  });

  it('keeps the offending field and observed number on each issue', () => {
    const [issue] = inspectPowerValues({ ...base, batterySocPercent: 130 });
    expect(issue).toMatchObject({
      code: 'SOC_OUT_OF_RANGE',
      field: 'batterySocPercent',
      observed: 130,
    });
  });

  it('changes nothing it inspects', () => {
    const v = Object.freeze({ ...base, solarPowerW: -5 });
    expect(() => inspectPowerValues(v)).not.toThrow();
  });
});

describe('quality from issues', () => {
  it('is OK with no issues and nothing missing', () => {
    expect(qualityFromIssues([], false)).toBe('OK');
  });

  it('is PARTIAL when something is missing but nothing is wrong', () => {
    expect(qualityFromIssues([], true)).toBe('PARTIAL');
    expect(
      qualityFromIssues(
        [{ code: 'FIELD_MISSING', field: 'loadPowerW', observed: null, message: '' }],
        true,
      ),
    ).toBe('PARTIAL');
  });

  it('is SUSPECT for any suspect code, even when other things are merely missing', () => {
    expect(
      qualityFromIssues(
        [
          { code: 'FIELD_MISSING', field: 'loadPowerW', observed: null, message: '' },
          { code: 'SOLAR_NEGATIVE', field: 'solarPowerW', observed: -1, message: '' },
        ],
        true,
      ),
    ).toBe('SUSPECT');
  });
});

describe('energy balance over an interval (home = solar + import - export + discharged - charged)', () => {
  const quarterHour = 900;
  const balanced: EnergyValues = {
    solarGeneratedWh: 1000,
    homeConsumedWh: 400,
    gridImportWh: 0,
    gridExportWh: 350,
    batteryChargedWh: 250,
    batteryDischargedWh: 0,
  };

  it('has a residual of zero for a balanced interval', () => {
    expect(
      energyBalanceResidualWh({
        solarGeneratedWh: 1000,
        homeConsumedWh: 400,
        gridImportWh: 0,
        gridExportWh: 350,
        batteryChargedWh: 250,
        batteryDischargedWh: 0,
      }),
    ).toBe(0);
    expect(inspectEnergyValues(balanced, quarterHour)).toEqual([]);
  });

  it('applies the power tolerance over the interval: 100 W for 15 minutes is 25 Wh', () => {
    expect(energyBalanceToleranceWh(400, quarterHour)).toBe(25);
    expect(energyBalanceToleranceWh(4000, quarterHour)).toBe(200); // 5 percent of the consumption wins
  });

  it('passes at the tolerance and fails above it', () => {
    expect(inspectEnergyValues({ ...balanced, homeConsumedWh: 425 }, quarterHour)).toEqual([]);
    const issues = inspectEnergyValues({ ...balanced, homeConsumedWh: 426 }, quarterHour);
    expect(issues.map((i) => i.code)).toEqual(['ENERGY_BALANCE_MISMATCH']);
  });

  it('flags negative energy and an implausible amount for the interval', () => {
    expect(
      inspectEnergyValues({ ...balanced, gridImportWh: -1 }, quarterHour).map((i) => i.code),
    ).toContain('ENERGY_NEGATIVE');
    // 100 kW for 15 minutes is 25 000 Wh; more than that in 15 minutes is not a home.
    expect(
      inspectEnergyValues({ ...balanced, solarGeneratedWh: 25_001 }, quarterHour).map(
        (i) => i.code,
      ),
    ).toContain('ENERGY_IMPLAUSIBLE_MAGNITUDE');
  });

  it('cannot judge the balance with a missing flow, and reports nothing for it', () => {
    expect(inspectEnergyValues({ ...balanced, gridExportWh: null }, quarterHour)).toEqual([]);
  });
});
