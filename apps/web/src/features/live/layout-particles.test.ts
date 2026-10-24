import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES, SPOKE_IDS } from './flow-model';
import { computeLayout, pointOnPath } from './layout';
import { MAX_FRAME_SECONDS, advancePhase, particleFractions } from './particles';

/** The page sizes the canvas box with the aspect classes 10/11 (up to 520 px wide) and 100/56 (wider). */
const canvasHeightFor = (width: number): number =>
  Math.round(width <= 520 ? width * 1.1 : width * 0.56);

describe('layout', () => {
  it('puts the hub in the middle, solar above, battery below, grid left and home right', () => {
    for (const [w, h] of [
      [360, 400],
      [1000, 560],
    ] as const) {
      const { nodes } = computeLayout(w, h);
      expect(nodes.HUB).toMatchObject({ x: w / 2, y: h / 2 });
      expect(nodes.SOLAR.y).toBeLessThan(nodes.HUB.y);
      expect(nodes.BATTERY.y).toBeGreaterThan(nodes.HUB.y);
      expect(nodes.GRID.x).toBeLessThan(nodes.HUB.x);
      expect(nodes.HOME.x).toBeGreaterThan(nodes.HUB.x);
    }
  });

  it('keeps every node fully inside the canvas, at phone and desktop sizes', () => {
    for (const width of [320, 360, 390, 520, 768, 1024, 1440]) {
      const height = canvasHeightFor(width);
      const { nodes } = computeLayout(width, height);
      for (const node of Object.values(nodes)) {
        expect(node.x - node.r).toBeGreaterThanOrEqual(0);
        expect(node.x + node.r).toBeLessThanOrEqual(width);
        expect(node.y - node.r).toBeGreaterThanOrEqual(0);
        expect(node.y + node.r).toBeLessThanOrEqual(height);
      }
    }
  });

  it('never lets nodes overlap each other', () => {
    for (const width of [320, 360, 520, 1024]) {
      const { nodes } = computeLayout(width, canvasHeightFor(width));
      const all = Object.values(nodes);
      for (let i = 0; i < all.length; i += 1) {
        for (let j = i + 1; j < all.length; j += 1) {
          const a = all[i];
          const b = all[j];
          if (a === undefined || b === undefined) continue;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
        }
      }
    }
  });

  it('gives every spoke a positive-length path from its node edge to the hub edge', () => {
    const layout = computeLayout(360, 400);
    for (const id of SPOKE_IDS) {
      const path = layout.paths[id];
      expect(path.length).toBeGreaterThan(10);
      const node = layout.nodes[id];
      expect(Math.hypot(path.start.x - node.x, path.start.y - node.y)).toBeGreaterThan(node.r);
      expect(
        Math.hypot(path.end.x - layout.nodes.HUB.x, path.end.y - layout.nodes.HUB.y),
      ).toBeGreaterThan(layout.nodes.HUB.r);
    }
  });

  it('survives a zero-sized or invalid canvas', () => {
    for (const [w, h] of [
      [0, 0],
      [-5, 10],
      [Number.NaN, Number.NaN],
    ] as const) {
      const layout = computeLayout(w, h);
      expect(layout.width).toBe(0);
      for (const node of Object.values(layout.nodes)) {
        expect(Number.isFinite(node.x)).toBe(true);
        expect(Number.isFinite(node.r)).toBe(true);
      }
    }
  });

  it('pointOnPath runs from start to end and clamps', () => {
    const path = computeLayout(360, 400).paths.SOLAR;
    expect(pointOnPath(path, 0)).toEqual(path.start);
    expect(pointOnPath(path, 1)).toEqual(path.end);
    expect(pointOnPath(path, -3)).toEqual(path.start);
    expect(pointOnPath(path, 9)).toEqual(path.end);
    expect(pointOnPath(path, Number.NaN)).toEqual(path.start);
    const mid = pointOnPath(path, 0.5);
    expect(mid.x).toBeCloseTo((path.start.x + path.end.x) / 2, 10);
    expect(mid.y).toBeCloseTo((path.start.y + path.end.y) / 2, 10);
  });
});

describe('particles', () => {
  it('advances in proportion to speed and time, and wraps', () => {
    expect(advancePhase(0, 100, 200, 0.1)).toBeCloseTo(0.05, 10);
    expect(advancePhase(0.98, 100, 200, 0.1)).toBeCloseTo(0.03, 10);
    expect(advancePhase(0, 200, 200, 0.1)).toBeCloseTo(0.1, 10);
  });

  it('does not move when there is no speed, length or time, and survives bad numbers', () => {
    expect(advancePhase(0.3, 0, 200, 0.1)).toBe(0.3);
    expect(advancePhase(0.3, 100, 0, 0.1)).toBe(0.3);
    expect(advancePhase(0.3, 100, 200, 0)).toBe(0.3);
    expect(advancePhase(0.3, 100, 200, -1)).toBe(0.3);
    expect(advancePhase(Number.NaN, 100, 200, 0.1)).toBeCloseTo(0.05, 10);
    expect(advancePhase(0.3, Number.NaN, 200, 0.1)).toBe(0.3);
    expect(advancePhase(0.3, Number.POSITIVE_INFINITY, 200, 0.1)).toBe(0.3);
  });

  it('clamps a long time step so a stalled frame cannot teleport particles', () => {
    const jump = advancePhase(0, 100, 200, 60);
    expect(jump).toBeCloseTo((100 * MAX_FRAME_SECONDS) / 200, 10);
  });

  it('always stays in [0, 1)', () => {
    let phase = 0.9;
    for (let i = 0; i < 1000; i += 1) {
      phase = advancePhase(phase, 140, 90, 0.016);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });

  it('spaces particles evenly from the phase', () => {
    expect(particleFractions(0, 4)).toEqual([0, 0.25, 0.5, 0.75]);
    const shifted = particleFractions(0.1, 2);
    expect(shifted[0]).toBeCloseTo(0.1, 10);
    expect(shifted[1]).toBeCloseTo(0.6, 10);
    expect(particleFractions(0.9, 2)[1]).toBeCloseTo(0.4, 10);
  });

  it('never returns more particles than the hard bound, or any for a bad count', () => {
    expect(particleFractions(0, 5000)).toHaveLength(MAX_PARTICLES);
    expect(particleFractions(0, 0)).toEqual([]);
    expect(particleFractions(0, -3)).toEqual([]);
    expect(particleFractions(0, Number.NaN)).toEqual([]);
    expect(particleFractions(Number.NaN, 2)).toEqual([0, 0.5]);
  });

  it('is deterministic: the same inputs give the same positions', () => {
    expect(particleFractions(0.37, 7)).toEqual(particleFractions(0.37, 7));
  });
});
