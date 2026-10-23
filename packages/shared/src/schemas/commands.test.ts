import { describe, expect, it } from 'vitest';
import {
  CommandAcceptedSchema,
  CommandDetailSchema,
  CommandRecordSchema,
  CommandRequestSchema,
  IdempotencyHeaderSchema,
} from './commands';

const uuid = '3f8b1c2e-9a4d-4e7b-8c11-6d5f0a2b7e90';

describe('CommandRequestSchema', () => {
  it('accepts each supported kind with valid parameters', () => {
    for (const body of [
      { kind: 'SET_BACKUP_RESERVE', params: { backupReservePercent: 30 } },
      { kind: 'SET_OPERATION_MODE', params: { operationMode: 'SELF_CONSUMPTION' } },
      { kind: 'SET_GRID_IMPORT_EXPORT', params: { allowGridCharging: false } },
      {
        kind: 'SET_GRID_IMPORT_EXPORT',
        params: { allowGridCharging: true, allowGridExport: false },
      },
      { kind: 'SET_STORM_MODE', params: { enabled: true } },
      { kind: 'SET_OFF_GRID_VEHICLE_CHARGING_RESERVE', params: { reservePercent: 20 } },
      { kind: 'SET_TIME_OF_USE_SETTINGS', params: { tariffId: uuid } },
    ]) {
      expect(CommandRequestSchema.safeParse(body).success).toBe(true);
    }
  });

  it('rejects reserve 120, a negative reserve and a fractional reserve', () => {
    for (const p of [120, -1, 50.5, '30']) {
      expect(
        CommandRequestSchema.safeParse({
          kind: 'SET_BACKUP_RESERVE',
          params: { backupReservePercent: p },
        }).success,
      ).toBe(false);
    }
  });

  it('rejects an unknown kind, including the capabilities Tesla does not document', () => {
    for (const kind of [
      'FORCE_GRID_CHARGE',
      'FORCE_GRID_EXPORT',
      'SOLAR_BYPASS',
      'MANUAL_ISLANDING',
      'RESTART',
      '',
    ]) {
      expect(CommandRequestSchema.safeParse({ kind, params: {} }).success).toBe(false);
    }
  });

  it('rejects wrong or extra parameters for a kind', () => {
    expect(
      CommandRequestSchema.safeParse({ kind: 'SET_STORM_MODE', params: { enabled: 'yes' } })
        .success,
    ).toBe(false);
    expect(
      CommandRequestSchema.safeParse({
        kind: 'SET_STORM_MODE',
        params: { enabled: true, force: true },
      }).success,
    ).toBe(false);
    expect(
      CommandRequestSchema.safeParse({
        kind: 'SET_OPERATION_MODE',
        params: { operationMode: 'BACKUP' },
      }).success,
    ).toBe(false);
    expect(
      CommandRequestSchema.safeParse({ kind: 'SET_GRID_IMPORT_EXPORT', params: {} }).success,
    ).toBe(false);
    expect(
      CommandRequestSchema.safeParse({
        kind: 'SET_TIME_OF_USE_SETTINGS',
        params: { tariffId: 'x' },
      }).success,
    ).toBe(false);
    expect(
      CommandRequestSchema.safeParse({
        kind: 'SET_STORM_MODE',
        params: { enabled: true },
        siteId: uuid,
      }).success,
    ).toBe(false);
  });
});

describe('idempotency header', () => {
  it('requires a valid key', () => {
    expect(IdempotencyHeaderSchema.safeParse({ 'idempotency-key': 'abcd1234' }).success).toBe(true);
    expect(IdempotencyHeaderSchema.safeParse({}).success).toBe(false);
    expect(IdempotencyHeaderSchema.safeParse({ 'idempotency-key': 'short' }).success).toBe(false);
  });
});

describe('command lifecycle responses (rule 4)', () => {
  it('accepts only PENDING for an accepted command', () => {
    expect(
      CommandAcceptedSchema.safeParse({ id: uuid, state: 'PENDING', phase: 'RECORDED' }).success,
    ).toBe(true);
    expect(
      CommandAcceptedSchema.safeParse({ id: uuid, state: 'CONFIRMED', phase: 'DONE' }).success,
    ).toBe(false);
  });

  const base = {
    id: uuid,
    siteId: uuid,
    origin: 'USER',
    providerMode: 'MOCK',
    kind: 'SET_BACKUP_RESERVE',
    params: { backupReservePercent: 30 },
    state: 'PENDING',
    phase: 'DISPATCHED',
    requestedAt: '2026-10-22T10:00:00Z',
    dispatchedAt: '2026-10-22T10:00:01Z',
    finishedAt: null,
    errorCode: null,
    outcome: { configurationConfirmed: false, physicalOutcomeGuaranteed: false },
  };

  it('accepts a pending command and a confirmed one with a finish time', () => {
    expect(CommandRecordSchema.safeParse(base).success).toBe(true);
    expect(
      CommandRecordSchema.safeParse({
        ...base,
        state: 'CONFIRMED',
        phase: 'DONE',
        finishedAt: '2026-10-22T10:00:09Z',
        outcome: { configurationConfirmed: true, physicalOutcomeGuaranteed: false },
      }).success,
    ).toBe(true);
  });

  it('never promises the physical outcome', () => {
    expect(
      CommandRecordSchema.safeParse({
        ...base,
        outcome: { configurationConfirmed: false, physicalOutcomeGuaranteed: true },
      }).success,
    ).toBe(false);
  });

  it('treats an HTTP-200-style success as not confirmed until the state says CONFIRMED', () => {
    // configurationConfirmed true while still PENDING is contradictory.
    expect(
      CommandRecordSchema.safeParse({
        ...base,
        outcome: { configurationConfirmed: true, physicalOutcomeGuaranteed: false },
      }).success,
    ).toBe(false);
  });

  it('requires a finish time exactly for CONFIRMED and FAILED, and allows UNKNOWN without one', () => {
    expect(
      CommandRecordSchema.safeParse({ ...base, state: 'FAILED', errorCode: 'PROVIDER_REJECTED' })
        .success,
    ).toBe(false);
    expect(
      CommandRecordSchema.safeParse({ ...base, state: 'UNKNOWN', phase: 'RECONCILING' }).success,
    ).toBe(true);
    expect(
      CommandRecordSchema.safeParse({ ...base, finishedAt: '2026-10-22T10:00:09Z' }).success,
    ).toBe(false);
  });

  it('rejects an unknown state or phase', () => {
    expect(CommandRecordSchema.safeParse({ ...base, state: 'SUCCESS' }).success).toBe(false);
    expect(CommandRecordSchema.safeParse({ ...base, phase: 'SENT' }).success).toBe(false);
  });

  it('carries append-only events in a detail response', () => {
    const detail = {
      command: base,
      events: [
        { at: '2026-10-22T10:00:00Z', fromState: null, toState: 'PENDING', phase: 'RECORDED' },
      ],
    };
    expect(CommandDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      CommandDetailSchema.safeParse({
        ...detail,
        events: [{ at: 'x', fromState: null, toState: 'PENDING', phase: null }],
      }).success,
    ).toBe(false);
  });
});
