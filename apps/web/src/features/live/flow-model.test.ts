import {
  DEMO_SCENARIOS,
  DEMO_SCENARIO_IDS,
  freshnessOf,
  normalisePowerReading,
} from '@autopw3/domain';
import type { DemoScenarioId } from '@autopw3/domain';
import { describe, expect, it } from 'vitest';
import {
  CRITICAL_BATTERY_PERCENT,
  FULL_SCALE_W,
  IDLE_THRESHOLD_W,
  LOW_BATTERY_PERCENT,
  MAX_PARTICLES,
  MAX_SPEED_PX_PER_SECOND,
  MIN_PARTICLES,
  MIN_SPEED_PX_PER_SECOND,
  SPOKE_IDS,
  buildFlowModel,
  flowVisual,
} from './flow-model';
import type { FlowInput, FlowSample } from './flow-model';

const NOW = new Date('2026-06-21T12:00:00Z');

/** What the Live View receives for a named scenario: the normalised reading and its freshness at NOW. */
function inputFor(id: DemoScenarioId): FlowInput {
  const scenario = DEMO_SCENARIOS[id];
  const { sample } = normalisePowerReading(
    { ...scenario.raw, sampledAt: NOW.getTime() - scenario.ageSeconds * 1000 },
    { source: 'DEMO', receivedAt: NOW },
  );
  return { sample, freshness: freshnessOf(sample.sampledAt, NOW).freshness };
}

function sampleOf(overrides: Partial<FlowSample> = {}): FlowSample {
  return {
    solarPowerW: 0,
    batteryPowerW: 0,
    gridPowerW: 0,
    loadPowerW: 0,
    batterySocPercent: 50,
    quality: 'OK',
    ...overrides,
  };
}

const live = (overrides: Partial<FlowSample> = {}): FlowInput => ({
  sample: sampleOf(overrides),
  freshness: 'FRESH',
});

describe('flow direction for each scenario (battery > 0 discharging, grid > 0 importing)', () => {
  it('SOLAR_SURPLUS: solar to hub, hub to battery, hub to grid, hub to home', () => {
    const model = buildFlowModel(inputFor('SOLAR_SURPLUS'));
    expect(model.data).toBe('LIVE');
    expect(model.flows).toEqual([
      { spoke: 'SOLAR', from: 'SOLAR', to: 'HUB', powerW: 3800 },
      { spoke: 'BATTERY', from: 'HUB', to: 'BATTERY', powerW: 2400 },
      { spoke: 'GRID', from: 'HUB', to: 'GRID', powerW: 700 },
      { spoke: 'HOME', from: 'HUB', to: 'HOME', powerW: 700 },
    ]);
    expect(model.spokes.BATTERY.kind).toBe('CHARGING');
    expect(model.spokes.GRID.kind).toBe('EXPORTING');
  });

  it('BATTERY_CHARGING: the battery takes the surplus and the grid is idle', () => {
    const model = buildFlowModel(inputFor('BATTERY_CHARGING'));
    expect(model.spokes.BATTERY).toMatchObject({ kind: 'CHARGING', from: 'HUB', to: 'BATTERY' });
    expect(model.spokes.GRID).toMatchObject({ kind: 'IDLE', from: null, to: null });
    expect(model.battery.direction).toBe('CHARGING');
  });

  it('BATTERY_DISCHARGING: battery to hub, no solar', () => {
    const model = buildFlowModel(inputFor('BATTERY_DISCHARGING'));
    expect(model.spokes.BATTERY).toMatchObject({
      kind: 'DISCHARGING',
      from: 'BATTERY',
      to: 'HUB',
      magnitudeW: 1900,
    });
    expect(model.spokes.SOLAR.kind).toBe('IDLE');
    expect(model.battery.direction).toBe('DISCHARGING');
  });

  it('GRID_IMPORT: grid to hub', () => {
    const model = buildFlowModel(inputFor('GRID_IMPORT'));
    expect(model.spokes.GRID).toMatchObject({
      kind: 'IMPORTING',
      from: 'GRID',
      to: 'HUB',
      magnitudeW: 300,
    });
    expect(model.gridDirection).toBe('IMPORTING');
  });

  it('GRID_EXPORT: hub to grid', () => {
    const model = buildFlowModel(inputFor('GRID_EXPORT'));
    expect(model.spokes.GRID).toMatchObject({
      kind: 'EXPORTING',
      from: 'HUB',
      to: 'GRID',
      magnitudeW: 4200,
    });
    expect(model.gridDirection).toBe('EXPORTING');
    expect(model.spokes.BATTERY.kind).toBe('IDLE');
  });

  it('LOW_BATTERY: the grid carries the whole load and the gauge is low', () => {
    const model = buildFlowModel(inputFor('LOW_BATTERY'));
    expect(model.spokes.GRID.kind).toBe('IMPORTING');
    expect(model.spokes.BATTERY.kind).toBe('IDLE');
    expect(model.battery).toMatchObject({ state: 'LOW', percent: 7, caveat: null });
  });

  it('MISSING_DATA: a missing value is unknown, never zero, and the rest still shows', () => {
    const model = buildFlowModel(inputFor('MISSING_DATA'));
    expect(model.data).toBe('LIVE');
    expect(model.spokes.BATTERY).toMatchObject({
      kind: 'UNKNOWN',
      magnitudeW: null,
      animated: false,
    });
    expect(model.spokes.HOME).toMatchObject({ kind: 'UNKNOWN', magnitudeW: null });
    expect(model.spokes.SOLAR).toMatchObject({
      kind: 'GENERATING',
      magnitudeW: 2400,
      animated: true,
    });
    expect(model.spokes.GRID.kind).toBe('IMPORTING');
    expect(model.flows.map((f) => f.spoke)).toEqual(['SOLAR', 'GRID']);
  });

  it('STALE_DATA: numbers and directions stay, nothing moves, the gauge says stale', () => {
    const model = buildFlowModel(inputFor('STALE_DATA'));
    expect(model.data).toBe('STALE');
    expect(model.spokes.SOLAR).toMatchObject({ kind: 'GENERATING', magnitudeW: 1200 });
    expect(model.spokes.BATTERY).toMatchObject({ kind: 'CHARGING', magnitudeW: 300 });
    for (const id of SPOKE_IDS) {
      expect(model.spokes[id].animated).toBe(false);
      expect(model.spokes[id].particleCount).toBe(0);
      expect(model.spokes[id].speedPxPerSecond).toBe(0);
    }
    expect(model.battery).toMatchObject({ state: 'STALE', percent: 64, caveat: 'STALE_READING' });
  });

  it('INVALID_READINGS: unrepresentable values are unknown and nothing animates', () => {
    const model = buildFlowModel(inputFor('INVALID_READINGS'));
    expect(model.data).toBe('SUSPECT');
    expect(model.spokes.SOLAR.kind).toBe('UNKNOWN');
    expect(model.spokes.HOME.kind).toBe('UNKNOWN');
    expect(model.battery).toMatchObject({ state: 'UNKNOWN', percent: null, caveat: 'NO_VALUE' });
    // The implausible but representable battery value keeps its direction and its true size, without motion.
    expect(model.spokes.BATTERY).toMatchObject({
      kind: 'DISCHARGING',
      magnitudeW: 250_000,
      animated: false,
      level: 1,
    });
    for (const id of SPOKE_IDS) expect(model.spokes[id].animated).toBe(false);
  });

  it('every scenario produces a model for every spoke', () => {
    for (const id of DEMO_SCENARIO_IDS) {
      const model = buildFlowModel(inputFor(id));
      expect(Object.keys(model.spokes).sort()).toEqual([...SPOKE_IDS].sort());
    }
  });
});

describe('sign flips reverse the direction', () => {
  it('battery: charging becomes discharging', () => {
    const charging = buildFlowModel(live({ batteryPowerW: -2000 })).spokes.BATTERY;
    const discharging = buildFlowModel(live({ batteryPowerW: 2000 })).spokes.BATTERY;
    expect([charging.from, charging.to]).toEqual(['HUB', 'BATTERY']);
    expect([discharging.from, discharging.to]).toEqual(['BATTERY', 'HUB']);
    expect(charging.magnitudeW).toBe(discharging.magnitudeW);
  });

  it('grid: exporting becomes importing', () => {
    const exporting = buildFlowModel(live({ gridPowerW: -1500 })).spokes.GRID;
    const importing = buildFlowModel(live({ gridPowerW: 1500 })).spokes.GRID;
    expect([exporting.from, exporting.to]).toEqual(['HUB', 'GRID']);
    expect([importing.from, importing.to]).toEqual(['GRID', 'HUB']);
  });

  it('solar and home never reverse: a negative value is impossible, so it is unknown', () => {
    expect(buildFlowModel(live({ solarPowerW: -50 })).spokes.SOLAR.kind).toBe('UNKNOWN');
    expect(buildFlowModel(live({ loadPowerW: -50 })).spokes.HOME.kind).toBe('UNKNOWN');
  });
});

describe('zero and near-zero values', () => {
  it('all zero is all idle: no flows, no particles, real zero shown', () => {
    const model = buildFlowModel(live());
    expect(model.flows).toEqual([]);
    for (const id of SPOKE_IDS) {
      expect(model.spokes[id]).toMatchObject({
        kind: 'IDLE',
        from: null,
        to: null,
        magnitudeW: 0,
        particleCount: 0,
        level: 0,
      });
    }
  });

  it('a flow below the idle threshold is idle but keeps its real number', () => {
    const below = buildFlowModel(live({ batteryPowerW: IDLE_THRESHOLD_W - 1 })).spokes.BATTERY;
    expect(below).toMatchObject({ kind: 'IDLE', magnitudeW: IDLE_THRESHOLD_W - 1 });
    const at = buildFlowModel(live({ batteryPowerW: IDLE_THRESHOLD_W })).spokes.BATTERY;
    expect(at).toMatchObject({ kind: 'DISCHARGING', animated: true });
    expect(
      buildFlowModel(live({ batteryPowerW: -(IDLE_THRESHOLD_W - 1) })).spokes.BATTERY.kind,
    ).toBe('IDLE');
  });

  it('the idle threshold is configurable', () => {
    const model = buildFlowModel(live({ gridPowerW: 200 }), { idleThresholdW: 500 });
    expect(model.spokes.GRID.kind).toBe('IDLE');
  });
});

describe('missing, unavailable and stale data', () => {
  it('no reading: everything is unknown and nothing animates', () => {
    const model = buildFlowModel({ sample: null, freshness: 'UNAVAILABLE' });
    expect(model.data).toBe('NONE');
    expect(model.flows).toEqual([]);
    for (const id of SPOKE_IDS)
      expect(model.spokes[id]).toMatchObject({ kind: 'UNKNOWN', magnitudeW: null });
    expect(model.battery).toMatchObject({ state: 'UNKNOWN', percent: null, caveat: 'NO_READING' });
  });

  it('a reading whose time is unusable is not shown as a value, even with numbers', () => {
    const model = buildFlowModel({
      sample: sampleOf({ solarPowerW: 3000 }),
      freshness: 'UNAVAILABLE',
    });
    expect(model.data).toBe('NONE');
    expect(model.spokes.SOLAR.kind).toBe('UNKNOWN');
  });

  it('null values are unknown, not zero', () => {
    const model = buildFlowModel(
      live({
        solarPowerW: null,
        batteryPowerW: null,
        gridPowerW: null,
        loadPowerW: null,
        batterySocPercent: null,
      }),
    );
    for (const id of SPOKE_IDS) expect(model.spokes[id].kind).toBe('UNKNOWN');
    expect(model.battery.state).toBe('UNKNOWN');
  });

  it('NaN and Infinity are unknown', () => {
    const model = buildFlowModel(
      live({
        solarPowerW: Number.NaN,
        batteryPowerW: Number.POSITIVE_INFINITY,
        gridPowerW: Number.NEGATIVE_INFINITY,
      }),
    );
    expect(model.spokes.SOLAR.kind).toBe('UNKNOWN');
    expect(model.spokes.BATTERY.kind).toBe('UNKNOWN');
    expect(model.spokes.GRID.kind).toBe('UNKNOWN');
  });

  it('stale data never animates, however large the flow', () => {
    const model = buildFlowModel({ sample: sampleOf({ solarPowerW: 5000 }), freshness: 'STALE' });
    expect(model.spokes.SOLAR).toMatchObject({
      kind: 'GENERATING',
      animated: false,
      particleCount: 0,
    });
  });

  it('suspect data never animates', () => {
    const model = buildFlowModel({
      sample: sampleOf({ solarPowerW: 5000, quality: 'SUSPECT' }),
      freshness: 'FRESH',
    });
    expect(model.data).toBe('SUSPECT');
    expect(model.spokes.SOLAR.animated).toBe(false);
  });

  it('partial data is still live', () => {
    const model = buildFlowModel({
      sample: sampleOf({ solarPowerW: 5000, quality: 'PARTIAL' }),
      freshness: 'FRESH',
    });
    expect(model.data).toBe('LIVE');
    expect(model.spokes.SOLAR.animated).toBe(true);
  });

  it('stale beats suspect', () => {
    expect(
      buildFlowModel({ sample: sampleOf({ quality: 'SUSPECT' }), freshness: 'STALE' }).data,
    ).toBe('STALE');
  });
});

describe('magnitude clamping', () => {
  it('no flow below the idle threshold, or for a value that is not a positive finite number', () => {
    for (const w of [0, 5, IDLE_THRESHOLD_W - 0.001, -100, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(flowVisual(w)).toEqual({ level: 0, speedPxPerSecond: 0, particleCount: 0 });
    }
  });

  it('speed and count grow with magnitude and stay inside their bounds', () => {
    let previousSpeed = 0;
    let previousCount = 0;
    for (const w of [10, 100, 500, 1000, 2500, 4000, FULL_SCALE_W]) {
      const v = flowVisual(w);
      expect(v.speedPxPerSecond).toBeGreaterThanOrEqual(MIN_SPEED_PX_PER_SECOND);
      expect(v.speedPxPerSecond).toBeLessThanOrEqual(MAX_SPEED_PX_PER_SECOND);
      expect(v.particleCount).toBeGreaterThanOrEqual(MIN_PARTICLES);
      expect(v.particleCount).toBeLessThanOrEqual(MAX_PARTICLES);
      expect(v.speedPxPerSecond).toBeGreaterThanOrEqual(previousSpeed);
      expect(v.particleCount).toBeGreaterThanOrEqual(previousCount);
      previousSpeed = v.speedPxPerSecond;
      previousCount = v.particleCount;
    }
  });

  it('a huge magnitude is clamped to the maximum, not scaled further', () => {
    const max = flowVisual(FULL_SCALE_W);
    expect(max).toEqual({
      level: 1,
      speedPxPerSecond: MAX_SPEED_PX_PER_SECOND,
      particleCount: MAX_PARTICLES,
    });
    expect(flowVisual(250_000)).toEqual(max);
    expect(flowVisual(Number.MAX_VALUE)).toEqual(max);
    expect(flowVisual(Number.POSITIVE_INFINITY)).toEqual({
      level: 0,
      speedPxPerSecond: 0,
      particleCount: 0,
    });
  });

  it('the clamped values reach the spokes of a live model', () => {
    const model = buildFlowModel(live({ solarPowerW: 1_000_000 }));
    expect(model.spokes.SOLAR).toMatchObject({
      magnitudeW: 1_000_000,
      level: 1,
      particleCount: MAX_PARTICLES,
      speedPxPerSecond: MAX_SPEED_PX_PER_SECOND,
    });
  });
});

describe('battery display', () => {
  const state = (percent: number | null, input: Partial<FlowInput> = {}) =>
    buildFlowModel({ ...live({ batterySocPercent: percent }), ...input }).battery;

  it('green above 15%, amber below 15%, critical below 5%', () => {
    expect(LOW_BATTERY_PERCENT).toBe(15);
    expect(CRITICAL_BATTERY_PERCENT).toBe(5);
    expect(state(100).state).toBe('NORMAL');
    expect(state(15).state).toBe('NORMAL');
    expect(state(14.9).state).toBe('LOW');
    expect(state(5).state).toBe('LOW');
    expect(state(4.9).state).toBe('CRITICAL');
    expect(state(0).state).toBe('CRITICAL');
  });

  it('fills to the level', () => {
    expect(state(58)).toMatchObject({ percent: 58, fillFraction: 0.58, caveat: null });
    expect(state(100).fillFraction).toBe(1);
  });

  it('is unknown for a missing or impossible level, never zero', () => {
    for (const bad of [null, -1, 100.1, 130, Number.NaN]) {
      expect(state(bad)).toMatchObject({
        state: 'UNKNOWN',
        percent: null,
        fillFraction: 0,
        caveat: 'NO_VALUE',
      });
    }
  });

  it('is stale for stale data and keeps the last level', () => {
    expect(state(64, { freshness: 'STALE' })).toMatchObject({
      state: 'STALE',
      percent: 64,
      caveat: 'STALE_READING',
    });
  });

  it('is unknown, with the level kept for display, when the reading is suspect', () => {
    const sample = sampleOf({ batterySocPercent: 40, quality: 'SUSPECT' });
    expect(buildFlowModel({ sample, freshness: 'FRESH' }).battery).toMatchObject({
      state: 'UNKNOWN',
      percent: 40,
      caveat: 'SUSPECT_READING',
    });
  });

  it('thresholds can be changed', () => {
    const model = buildFlowModel(live({ batterySocPercent: 25 }), { lowBatteryPercent: 30 });
    expect(model.battery.state).toBe('LOW');
    const critical = buildFlowModel(live({ batterySocPercent: 25 }), {
      lowBatteryPercent: 30,
      criticalBatteryPercent: 26,
    });
    expect(critical.battery.state).toBe('CRITICAL');
  });

  it('carries the battery direction from the flow', () => {
    expect(buildFlowModel(live({ batteryPowerW: -800 })).battery.direction).toBe('CHARGING');
    expect(buildFlowModel(live({ batteryPowerW: 800 })).battery.direction).toBe('DISCHARGING');
    expect(buildFlowModel(live({ batteryPowerW: 3 })).battery.direction).toBe('IDLE');
    expect(buildFlowModel(live({ batteryPowerW: null })).battery.direction).toBeNull();
  });
});

describe('swapping a reading', () => {
  it('turning a surplus reading into an evening reading reverses the battery and grid flows', () => {
    const before = buildFlowModel(inputFor('SOLAR_SURPLUS'));
    const after = buildFlowModel(inputFor('BATTERY_DISCHARGING'));
    expect(before.spokes.BATTERY.from).toBe('HUB');
    expect(after.spokes.BATTERY.from).toBe('BATTERY');
    expect(before.spokes.GRID.kind).toBe('EXPORTING');
    expect(after.spokes.GRID.kind).toBe('IDLE');
    expect(before.battery.direction).toBe('CHARGING');
    expect(after.battery.direction).toBe('DISCHARGING');
    expect(before.battery.percent).toBe(58);
    expect(after.battery.percent).toBe(71);
  });
});
