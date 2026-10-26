import { describe, expect, it } from 'vitest';
import { FixedClock } from '@autopw3/domain';
import type { CommandRequest } from '@autopw3/shared';
import { InMemoryRepository } from '../../db/repository';
import { MockTeslaClient } from '../../providers/tesla/mock-adapter';
import { TeslaApiError } from '../../providers/tesla/client';
import {
  AutomationPausedError,
  CapabilityNotSupportedError,
  ConflictError,
  SafetyLimitError,
  executeDeviceCommand,
} from './executor';

describe('Device Command Executor', () => {
  const siteId = '22222222-2222-4222-8222-222222222222';
  const householdId = '11111111-1111-4111-8111-111111111111';
  const userId = '55555555-5555-4555-8555-555555555555';

  function setup() {
    const repo = new InMemoryRepository();
    const teslaClient = new MockTeslaClient();
    const clock = new FixedClock(new Date('2026-06-21T12:00:00Z'));
    return { repo, teslaClient, clock };
  }

  it('records intent before dispatch and transitions through phases to CONFIRMED on reconciliation match', async () => {
    const { repo, teslaClient, clock } = setup();

    const request: CommandRequest = {
      kind: 'SET_BACKUP_RESERVE',
      params: { backupReservePercent: 35 },
    };

    const result = await executeDeviceCommand(
      siteId,
      request,
      {
        origin: 'USER',
        actorUserId: userId,
        idempotencyKey: 'test-idemp-001',
      },
      { repo, teslaClient, clock },
    );

    expect(result.success).toBe(true);
    expect(result.replayed).toBe(false);
    expect(result.command.state).toBe('CONFIRMED');
    expect(result.command.phase).toBe('DONE');
    expect(result.command.outcome.configurationConfirmed).toBe(true);
    expect(result.command.outcome.physicalOutcomeGuaranteed).toBe(false);

    // Verify stored in repository
    const stored = await repo.getCommandWithEvents(siteId, result.command.id);
    expect(stored).toBeDefined();
    expect(stored?.command.state).toBe('CONFIRMED');

    // Verify events: RECORDED -> DISPATCHING -> DISPATCHED -> RECONCILING -> CONFIRMED
    const phases = stored?.events.map((e) => e.phase);
    expect(phases).toContain('RECORDED');
    expect(phases).toContain('DISPATCHING');
    expect(phases).toContain('DISPATCHED');
    expect(phases).toContain('RECONCILING');
    expect(phases).toContain('DONE');

    // Verify site config cache was updated
    const config = await repo.getSiteConfiguration(siteId);
    expect(config?.backupReservePercent).toBe(35);
  });

  it('marks state as UNKNOWN when read-back does not match requested parameters', async () => {
    const { repo, clock } = setup();

    // Client where read-back siteInfo returns old backup_reserve_percent (mismatch)
    class MismatchingTeslaClient extends MockTeslaClient {
      override async setBackupReserve() {
        return { response: { code: 201 } };
      }
      override async getSiteInfo() {
        const info = await super.getSiteInfo('', '', '');
        return {
          ...info,
          backup_reserve_percent: 20, // Does not match requested 40
        };
      }
    }

    const request: CommandRequest = {
      kind: 'SET_BACKUP_RESERVE',
      params: { backupReservePercent: 40 },
    };

    const result = await executeDeviceCommand(
      siteId,
      request,
      {
        origin: 'USER',
        actorUserId: userId,
        idempotencyKey: 'test-idemp-mismatch',
      },
      { repo, teslaClient: new MismatchingTeslaClient(), clock },
    );

    expect(result.success).toBe(false);
    expect(result.command.state).toBe('UNKNOWN');
    expect(result.command.errorCode).toBe('RECONCILIATION_MISMATCH');
    expect(result.command.outcome.configurationConfirmed).toBe(false);
    expect(result.command.outcome.physicalOutcomeGuaranteed).toBe(false);
  });

  it('replays identical result when exact same idempotency key is submitted', async () => {
    const { repo, teslaClient, clock } = setup();

    const request: CommandRequest = {
      kind: 'SET_OPERATION_MODE',
      params: { operationMode: 'SELF_CONSUMPTION' },
    };

    const first = await executeDeviceCommand(
      siteId,
      request,
      {
        origin: 'USER',
        actorUserId: userId,
        idempotencyKey: 'idemp-replay-key',
      },
      { repo, teslaClient, clock },
    );

    const second = await executeDeviceCommand(
      siteId,
      request,
      {
        origin: 'USER',
        actorUserId: userId,
        idempotencyKey: 'idemp-replay-key',
      },
      { repo, teslaClient, clock },
    );

    expect(second.replayed).toBe(true);
    expect(second.command.id).toBe(first.command.id);
    expect(second.command.state).toBe('CONFIRMED');
  });

  it('throws ConflictError (409) when idempotency key is reused with different parameters', async () => {
    const { repo, teslaClient, clock } = setup();

    const request1: CommandRequest = {
      kind: 'SET_BACKUP_RESERVE',
      params: { backupReservePercent: 30 },
    };

    await executeDeviceCommand(
      siteId,
      request1,
      {
        origin: 'USER',
        actorUserId: userId,
        idempotencyKey: 'idemp-conflict-key',
      },
      { repo, teslaClient, clock },
    );

    const request2: CommandRequest = {
      kind: 'SET_BACKUP_RESERVE',
      params: { backupReservePercent: 50 },
    };

    await expect(
      executeDeviceCommand(
        siteId,
        request2,
        {
          origin: 'USER',
          actorUserId: userId,
          idempotencyKey: 'idemp-conflict-key',
        },
        { repo, teslaClient, clock },
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('blocks commands originating from AUTOMATION when household automation is paused', async () => {
    const { repo, teslaClient, clock } = setup();

    // Pause automation for household
    await repo.setAutomationPaused(householdId, true);

    const request: CommandRequest = {
      kind: 'SET_BACKUP_RESERVE',
      params: { backupReservePercent: 80 },
    };

    await expect(
      executeDeviceCommand(
        siteId,
        request,
        {
          origin: 'AUTOMATION',
          actorUserId: null,
          idempotencyKey: 'auto-cmd-001',
        },
        { repo, teslaClient, clock },
      ),
    ).rejects.toThrow(AutomationPausedError);

    // But USER manual commands are allowed even when automation is paused
    const userResult = await executeDeviceCommand(
      siteId,
      request,
      {
        origin: 'USER',
        actorUserId: userId,
        idempotencyKey: 'user-cmd-001',
      },
      { repo, teslaClient, clock },
    );
    expect(userResult.success).toBe(true);
  });

  it('rejects unsupported or unverified command types (stop condition)', async () => {
    const { repo, teslaClient, clock } = setup();

    const unverifiedRequest: CommandRequest = {
      kind: 'SET_OFF_GRID_VEHICLE_CHARGING_RESERVE',
      params: { reservePercent: 50 },
    };

    await expect(
      executeDeviceCommand(
        siteId,
        unverifiedRequest,
        {
          origin: 'USER',
          actorUserId: userId,
          idempotencyKey: 'unverified-cmd-001',
        },
        { repo, teslaClient, clock },
      ),
    ).rejects.toThrow(CapabilityNotSupportedError);
  });

  it('rejects invalid backup reserve percentages with SafetyLimitError', async () => {
    const { repo, teslaClient, clock } = setup();

    const invalidRequest = {
      kind: 'SET_BACKUP_RESERVE',
      params: { backupReservePercent: 120 },
    } as unknown as CommandRequest;

    await expect(
      executeDeviceCommand(
        siteId,
        invalidRequest,
        {
          origin: 'USER',
          actorUserId: userId,
          idempotencyKey: 'invalid-reserve-001',
        },
        { repo, teslaClient, clock },
      ),
    ).rejects.toThrow(SafetyLimitError);
  });

  it('handles provider 4xx client errors by marking state FAILED without retries', async () => {
    const { repo, clock } = setup();

    class Client4xxError extends MockTeslaClient {
      override async setBackupReserve(): Promise<{ response?: unknown }> {
        throw new TeslaApiError('Invalid parameter (422)', 422, '/backup');
      }
    }

    const request: CommandRequest = {
      kind: 'SET_BACKUP_RESERVE',
      params: { backupReservePercent: 50 },
    };

    const res = await executeDeviceCommand(
      siteId,
      request,
      {
        origin: 'USER',
        actorUserId: userId,
        idempotencyKey: 'cmd-4xx-001',
      },
      { repo, teslaClient: new Client4xxError(), clock },
    );

    expect(res.success).toBe(false);
    expect(res.command.state).toBe('FAILED');
    expect(res.command.phase).toBe('DONE');
    expect(res.command.errorCode).toBe('PROVIDER_ERROR_4XX');
  });

  it('handles provider timeout by marking state as UNKNOWN', async () => {
    const { repo, clock } = setup();

    class HangingTeslaClient extends MockTeslaClient {
      override async setBackupReserve(): Promise<{ response?: unknown }> {
        // Hang forever
        return new Promise(() => {});
      }
    }

    const request: CommandRequest = {
      kind: 'SET_BACKUP_RESERVE',
      params: { backupReservePercent: 50 },
    };

    const res = await executeDeviceCommand(
      siteId,
      request,
      {
        origin: 'USER',
        actorUserId: userId,
        idempotencyKey: 'cmd-timeout-001',
        timeoutMs: 50, // Short timeout for test
      },
      { repo, teslaClient: new HangingTeslaClient(), clock },
    );

    expect(res.success).toBe(false);
    expect(res.command.state).toBe('UNKNOWN');
    expect(res.command.phase).toBe('DONE');
    expect(res.command.errorCode).toBe('PROVIDER_TIMEOUT');
  });
});
