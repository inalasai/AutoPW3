import { describe, expect, it } from 'vitest';
import { FixedClock } from '@autopw3/domain';
import type { CommandRequest } from '@autopw3/shared';
import { InMemoryRepository } from '../../db/repository';
import { MockTeslaClient } from '../../providers/tesla/mock-adapter';
import { TeslaApiError } from '../../providers/tesla/client';
import { InMemoryTokenStore } from '../tokens/store';
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

  async function setup() {
    const repo = new InMemoryRepository();
    const teslaClient = new MockTeslaClient();
    const tokenStore = new InMemoryTokenStore(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );
    await tokenStore.saveTokens(householdId, {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      tokenType: 'Bearer',
      scope: 'openid energy_device_data energy_cmds',
      regionBaseUrl: 'https://fleet-api.example.invalid',
    });
    const clock = new FixedClock(new Date('2026-06-21T12:00:00Z'));
    return { repo, teslaClient, tokenStore, clock };
  }

  it('records intent before dispatch and transitions through phases to CONFIRMED on reconciliation match', async () => {
    const { repo, teslaClient, tokenStore, clock } = await setup();

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
      { repo, teslaClient, tokenStore, clock },
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
    const { repo, tokenStore, clock } = await setup();

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
      { repo, teslaClient: new MismatchingTeslaClient(), tokenStore, clock },
    );

    expect(result.success).toBe(false);
    expect(result.command.state).toBe('UNKNOWN');
    expect(result.command.errorCode).toBe('RECONCILIATION_MISMATCH');
    expect(result.command.outcome.configurationConfirmed).toBe(false);
    expect(result.command.outcome.physicalOutcomeGuaranteed).toBe(false);
  });

  it('fails a Tesla command closed when no token store exists and never dispatches a placeholder token', async () => {
    const { repo, clock } = await setup();
    const client = new MockTeslaClient();
    let dispatches = 0;
    client.setBackupReserve = async () => {
      dispatches += 1;
      return { response: {} };
    };

    const result = await executeDeviceCommand(
      siteId,
      { kind: 'SET_BACKUP_RESERVE', params: { backupReservePercent: 50 } },
      { origin: 'USER', actorUserId: userId, idempotencyKey: 'no-token-store-001' },
      { repo, teslaClient: client, clock },
    );

    expect(result.success).toBe(false);
    expect(result.command.state).toBe('FAILED');
    expect(result.command.errorCode).toBe('TOKEN_UNAVAILABLE');
    expect(dispatches).toBe(0);
  });

  it('replays identical result when exact same idempotency key is submitted', async () => {
    const { repo, teslaClient, tokenStore, clock } = await setup();

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
      { repo, teslaClient, tokenStore, clock },
    );

    const second = await executeDeviceCommand(
      siteId,
      request,
      {
        origin: 'USER',
        actorUserId: userId,
        idempotencyKey: 'idemp-replay-key',
      },
      { repo, teslaClient, tokenStore, clock },
    );

    expect(second.replayed).toBe(true);
    expect(second.command.id).toBe(first.command.id);
    expect(second.command.state).toBe('CONFIRMED');
  });

  it('throws ConflictError (409) when idempotency key is reused with different parameters', async () => {
    const { repo, teslaClient, tokenStore, clock } = await setup();

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
      { repo, teslaClient, tokenStore, clock },
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
        { repo, teslaClient, tokenStore, clock },
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('blocks commands originating from AUTOMATION when household automation is paused', async () => {
    const { repo, teslaClient, tokenStore, clock } = await setup();

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
        { repo, teslaClient, tokenStore, clock },
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
      { repo, teslaClient, tokenStore, clock },
    );
    expect(userResult.success).toBe(true);
  });

  it('rejects unsupported or unverified command types (stop condition)', async () => {
    const { repo, teslaClient, tokenStore, clock } = await setup();

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
        { repo, teslaClient, tokenStore, clock },
      ),
    ).rejects.toThrow(CapabilityNotSupportedError);
  });

  it('rejects invalid backup reserve percentages with SafetyLimitError', async () => {
    const { repo, teslaClient, tokenStore, clock } = await setup();

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
        { repo, teslaClient, tokenStore, clock },
      ),
    ).rejects.toThrow(SafetyLimitError);
  });

  it('handles provider 4xx client errors by marking state FAILED without retries', async () => {
    const { repo, tokenStore, clock } = await setup();

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
      { repo, teslaClient: new Client4xxError(), tokenStore, clock },
    );

    expect(res.success).toBe(false);
    expect(res.command.state).toBe('FAILED');
    expect(res.command.phase).toBe('DONE');
    expect(res.command.errorCode).toBe('PROVIDER_ERROR_4XX');
  });

  it('handles provider timeout by marking state as UNKNOWN', async () => {
    const { repo, tokenStore, clock } = await setup();

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
      { repo, teslaClient: new HangingTeslaClient(), tokenStore, clock },
    );

    expect(res.success).toBe(false);
    expect(res.command.state).toBe('UNKNOWN');
    expect(res.command.phase).toBe('DONE');
    expect(res.command.errorCode).toBe('PROVIDER_TIMEOUT');
  });
});
