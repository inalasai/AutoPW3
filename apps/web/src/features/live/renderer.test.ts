import { describe, expect, it } from 'vitest';
import { createFakeContext } from './fake-canvas';
import { SPOKE_IDS, buildFlowModel } from './flow-model';
import type { FlowInput, FlowSample, SpokeId } from './flow-model';
import { computeLayout } from './layout';
import { DEFAULT_PALETTE, drawScene, readPalette } from './renderer';
import type { Scene } from './renderer';

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

const PHASES: Record<SpokeId, number> = { SOLAR: 0.1, BATTERY: 0.2, GRID: 0.3, HOME: 0.4 };

function sceneOf(input: FlowInput, showParticles: boolean): Scene {
  return {
    layout: computeLayout(400, 440),
    model: buildFlowModel(input),
    phases: PHASES,
    showParticles,
    palette: DEFAULT_PALETTE,
  };
}

const SURPLUS: FlowInput = {
  sample: sampleOf({
    solarPowerW: 3800,
    batteryPowerW: -2400,
    gridPowerW: -700,
    loadPowerW: 700,
  }),
  freshness: 'FRESH',
};

describe('drawScene', () => {
  it('clears the canvas first, then draws every spoke and node', () => {
    const fake = createFakeContext();
    drawScene(fake.ctx, sceneOf(SURPLUS, true));
    expect(fake.calls[0]).toEqual({ name: 'clearRect', args: [0, 0, 400, 440] });
    // Four spokes and five nodes (the hub too), each stroked at least once.
    expect(fake.count('stroke')).toBeGreaterThanOrEqual(9);
  });

  it('draws a direction arrowhead for every active spoke, with or without particles', () => {
    const active = sceneOf(SURPLUS, true).model.flows.length;
    expect(active).toBe(4);
    for (const showParticles of [true, false]) {
      const fake = createFakeContext();
      drawScene(fake.ctx, sceneOf(SURPLUS, showParticles));
      // The arrowhead is the only thing that rotates the context for a spoke; icons do not rotate.
      expect(fake.count('rotate')).toBe(active);
    }
  });

  it('draws particles only when asked and only on animated spokes', () => {
    const withParticles = createFakeContext();
    const without = createFakeContext();
    const scene = sceneOf(SURPLUS, true);
    drawScene(withParticles.ctx, scene);
    drawScene(without.ctx, sceneOf(SURPLUS, false));
    const expected = SPOKE_IDS.reduce(
      (sum, id) =>
        sum + (scene.model.spokes[id].animated ? scene.model.spokes[id].particleCount : 0),
      0,
    );
    expect(expected).toBeGreaterThan(0);
    expect(withParticles.count('arc') - without.count('arc')).toBe(expected);
  });

  it('draws no particles for stale data, but still draws arrows and the numbers stay on the page', () => {
    const stale: FlowInput = { ...SURPLUS, freshness: 'STALE' };
    const fake = createFakeContext();
    drawScene(fake.ctx, sceneOf(stale, true));
    const still = createFakeContext();
    drawScene(still.ctx, sceneOf(stale, false));
    expect(fake.count('arc')).toBe(still.count('arc'));
    expect(fake.count('rotate')).toBe(4);
  });

  it('draws unknown spokes dashed and with no arrow', () => {
    const missing: FlowInput = {
      sample: sampleOf({
        solarPowerW: null,
        batteryPowerW: null,
        gridPowerW: null,
        loadPowerW: null,
        batterySocPercent: null,
        quality: 'PARTIAL',
      }),
      freshness: 'FRESH',
    };
    const fake = createFakeContext();
    drawScene(fake.ctx, sceneOf(missing, true));
    expect(fake.count('rotate')).toBe(0);
    const dashes = fake.calls.filter((call) => call.name === 'setLineDash');
    expect(dashes.some((call) => JSON.stringify(call.args) === '[[3,7]]')).toBe(true);
  });

  it('draws nothing as flowing when there is no reading', () => {
    const none: FlowInput = { sample: null, freshness: 'UNAVAILABLE' };
    const fake = createFakeContext();
    drawScene(fake.ctx, sceneOf(none, true));
    expect(fake.count('rotate')).toBe(0);
  });

  it('never draws more particles than the cap, whatever the power', () => {
    const huge: FlowInput = {
      sample: sampleOf({ solarPowerW: 1e9, loadPowerW: 1e9 }),
      freshness: 'FRESH',
    };
    const withParticles = createFakeContext();
    const without = createFakeContext();
    drawScene(withParticles.ctx, sceneOf(huge, true));
    drawScene(without.ctx, sceneOf(huge, false));
    // Two active spokes at most 12 particles each.
    expect(withParticles.count('arc') - without.count('arc')).toBeLessThanOrEqual(24);
  });
});

describe('readPalette', () => {
  it('falls back to the design tokens where the page defines none', () => {
    expect(readPalette(document.documentElement)).toEqual(DEFAULT_PALETTE);
  });

  it('reads custom properties from the element', () => {
    const element = document.createElement('div');
    element.style.setProperty('--color-solar', '#123456');
    document.body.append(element);
    expect(readPalette(element).solar).toBe('#123456');
    element.remove();
  });
});
