import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  COMMAND_CAPABILITIES,
  COMMAND_KINDS,
  UNSUPPORTED_CAPABILITIES,
  canTransitionCommandState,
  isTerminalCommandState,
  roleAtLeast,
} from '../index';
import {
  batteryChargeW,
  batteryDirection,
  batteryDischargeW,
  gridDirection,
  gridExportW,
  gridImportW,
  powerBalanceResidualW,
} from './signs';

describe('sign convention', () => {
  it('treats battery > 0 as discharging and < 0 as charging', () => {
    expect(batteryDirection(1500)).toBe('DISCHARGING');
    expect(batteryDirection(-1500)).toBe('CHARGING');
    expect(batteryDirection(0)).toBe('IDLE');
    expect(batteryDischargeW(1500)).toBe(1500);
    expect(batteryDischargeW(-1500)).toBe(0);
    expect(batteryChargeW(-1500)).toBe(1500);
    expect(batteryChargeW(1500)).toBe(0);
  });

  it('treats grid > 0 as importing and < 0 as exporting', () => {
    expect(gridDirection(800)).toBe('IMPORTING');
    expect(gridDirection(-800)).toBe('EXPORTING');
    expect(gridDirection(0)).toBe('IDLE');
    expect(gridImportW(800)).toBe(800);
    expect(gridImportW(-800)).toBe(0);
    expect(gridExportW(-800)).toBe(800);
    expect(gridExportW(800)).toBe(0);
  });

  it('computes the instantaneous balance residual: load - (solar + battery + grid)', () => {
    // Solar 3000, battery charging 1000 (-1000), exporting 500 (-500): load = 3000 - 1000 - 500 = 1500.
    expect(
      powerBalanceResidualW({
        solarPowerW: 3000,
        batteryPowerW: -1000,
        gridPowerW: -500,
        loadPowerW: 1500,
      }),
    ).toBe(0);
    // Night: no solar, battery discharging 700, grid importing 300: load = 1000.
    expect(
      powerBalanceResidualW({
        solarPowerW: 0,
        batteryPowerW: 700,
        gridPowerW: 300,
        loadPowerW: 1000,
      }),
    ).toBe(0);
    // A wrong sign shows up as a large residual.
    expect(
      powerBalanceResidualW({
        solarPowerW: 0,
        batteryPowerW: -700,
        gridPowerW: 300,
        loadPowerW: 1000,
      }),
    ).toBe(1400);
  });
});

describe('roleAtLeast (UI hint only)', () => {
  it('orders READ_ONLY < READ_WRITE < ADMIN', () => {
    expect(roleAtLeast('ADMIN', 'READ_WRITE')).toBe(true);
    expect(roleAtLeast('READ_WRITE', 'READ_WRITE')).toBe(true);
    expect(roleAtLeast('READ_ONLY', 'READ_WRITE')).toBe(false);
    expect(roleAtLeast('READ_WRITE', 'ADMIN')).toBe(false);
  });
});

describe('command lifecycle (rule 4)', () => {
  it('never leaves CONFIRMED or FAILED', () => {
    for (const to of ['PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN'] as const) {
      expect(canTransitionCommandState('CONFIRMED', to)).toBe(false);
      expect(canTransitionCommandState('FAILED', to)).toBe(false);
    }
  });

  it('lets PENDING and UNKNOWN resolve, and UNKNOWN stay UNKNOWN', () => {
    expect(canTransitionCommandState('PENDING', 'CONFIRMED')).toBe(true);
    expect(canTransitionCommandState('PENDING', 'FAILED')).toBe(true);
    expect(canTransitionCommandState('PENDING', 'UNKNOWN')).toBe(true);
    expect(canTransitionCommandState('UNKNOWN', 'UNKNOWN')).toBe(true);
    expect(canTransitionCommandState('UNKNOWN', 'CONFIRMED')).toBe(true);
    expect(canTransitionCommandState('PENDING', 'PENDING')).toBe(false);
    expect(canTransitionCommandState('UNKNOWN', 'PENDING')).toBe(false);
  });

  it('treats only CONFIRMED and FAILED as terminal', () => {
    expect(isTerminalCommandState('CONFIRMED')).toBe(true);
    expect(isTerminalCommandState('FAILED')).toBe(true);
    expect(isTerminalCommandState('UNKNOWN')).toBe(false);
    expect(isTerminalCommandState('PENDING')).toBe(false);
  });
});

describe('capability identifiers', () => {
  it('has one command capability per command kind', () => {
    expect([...COMMAND_CAPABILITIES].sort()).toEqual([...COMMAND_KINDS].sort());
  });

  it('lists the undocumented capabilities as unsupported and offers no command for them', () => {
    for (const c of UNSUPPORTED_CAPABILITIES) {
      expect(CAPABILITIES).toContain(c);
      expect((COMMAND_KINDS as readonly string[]).includes(c)).toBe(false);
    }
  });
});
