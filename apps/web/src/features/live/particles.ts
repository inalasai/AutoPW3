import { MAX_PARTICLES } from './flow-model';

/**
 * Particle motion as pure arithmetic. A spoke has one "phase" (0 to 1); its particles sit evenly spaced behind
 * it. There is no random number anywhere, so a frame is a function of the phase, the particle count and the
 * spoke's length. The renderer owns the phases, outside React state.
 */

/** The longest time step one frame may advance, in seconds. A hidden tab or a stalled frame must not teleport particles. */
export const MAX_FRAME_SECONDS = 0.1;

/** Phase after `dtSeconds` at `speedPxPerSecond` along a path of `lengthPx`, wrapped to [0, 1). */
export function advancePhase(
  phase: number,
  speedPxPerSecond: number,
  lengthPx: number,
  dtSeconds: number,
): number {
  const start = Number.isFinite(phase) ? phase - Math.floor(phase) : 0;
  if (
    !Number.isFinite(speedPxPerSecond) ||
    !Number.isFinite(lengthPx) ||
    !Number.isFinite(dtSeconds) ||
    speedPxPerSecond <= 0 ||
    lengthPx <= 0 ||
    dtSeconds <= 0
  ) {
    return start;
  }
  const dt = Math.min(dtSeconds, MAX_FRAME_SECONDS);
  const next = start + (speedPxPerSecond * dt) / lengthPx;
  return next - Math.floor(next);
}

/**
 * Positions of `count` particles along a path as fractions in [0, 1), evenly spaced from `phase`. The count is
 * clamped to the model's hard upper bound, so a bad caller cannot draw thousands.
 */
export function particleFractions(phase: number, count: number): number[] {
  const n = Number.isFinite(count) ? Math.min(MAX_PARTICLES, Math.max(0, Math.floor(count))) : 0;
  const base = Number.isFinite(phase) ? phase - Math.floor(phase) : 0;
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const value = base + i / n;
    out.push(value - Math.floor(value));
  }
  return out;
}
