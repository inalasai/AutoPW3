/**
 * Injected clock. Domain code never reads the system time directly (lint rule
 * `no-restricted-syntax` in eslint.config.js); callers pass a Clock so tests can use fake time.
 */
export interface Clock {
  /** Current instant. */
  now(): Date;
}

/** Deterministic clock for tests. Advance it explicitly. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
