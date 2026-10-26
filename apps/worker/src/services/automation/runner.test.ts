import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedClock } from '@autopw3/domain';
import type { PersistedPowerSample } from '@autopw3/shared';
import { InMemoryRepository } from '../../db/repository';
import { MockTeslaClient } from '../../providers/tesla/mock-adapter';
import { runAutomationForSite } from './runner';

function makeSample(sampledAt: string, batterySocPercent = 30): PersistedPowerSample {
  return {
    source: 'TESLA',
    sampledAt,
    receivedAt: sampledAt,
    timestampOrigin: 'RECEIVED',
    solarPowerW: 3000,
    batteryPowerW: 0,
    gridPowerW: 500,
    loadPowerW: 3500,
    batterySocPercent,
    gridStatus: 'SystemGridConnected',
    quality: 'OK',
  };
}

describe('runAutomationForSite', () => {
  const NOW = new Date('2026-06-21T14:30:00Z');
  const SITE_ID = '22222222-2222-4222-8222-222222222222';
  let repo: InMemoryRepository;
  let teslaClient: MockTeslaClient;

  beforeEach(() => {
    repo = new InMemoryRepository();
    teslaClient = new MockTeslaClient();
  });

  it('records WOULD_ACT for DRY_RUN rule and NEVER calls mock control endpoints', async () => {
    const setBackupReserveSpy = vi.spyOn(teslaClient, 'setBackupReserve');

    // Fresh telemetry with 30% battery SOC
    await repo.recordPowerSample(SITE_ID, makeSample('2026-06-21T14:28:00Z', 30));

    const report = await runAutomationForSite(SITE_ID, NOW, {
      repo,
      teslaClient,
      clock: new FixedClock(NOW),
    });

    expect(report.evaluatedCount).toBeGreaterThan(0);
    expect(report.wouldActCount).toBe(1);
    expect(report.actedCount).toBe(0);

    // Assert that mock control endpoint was NEVER called
    expect(setBackupReserveSpy).not.toHaveBeenCalled();

    // Verify execution was persisted in repository
    const executions = await repo.listAutomationExecutions(SITE_ID, 10);
    expect(executions.items.length).toBeGreaterThan(0);
    expect(executions.items[0]?.decision).toBe('WOULD_ACT');
    expect(executions.items[0]?.commandId).toBeNull();
  });

  it('records ACTED and calls control endpoint when rule is ACTIVE', async () => {
    const setBackupReserveSpy = vi.spyOn(teslaClient, 'setBackupReserve');

    // Make rule active
    const rulesPage = await repo.listRules(SITE_ID, 10);
    const rule = rulesPage.items[0]!;
    await repo.setRuleMode(rule.id, 'ACTIVE');

    // Fresh telemetry with 30% battery SOC (rule triggers when SOC < 50%)
    await repo.recordPowerSample(SITE_ID, makeSample('2026-06-21T14:28:00Z', 30));

    const report = await runAutomationForSite(SITE_ID, NOW, {
      repo,
      teslaClient,
      clock: new FixedClock(NOW),
    });

    expect(report.actedCount).toBe(1);
    expect(setBackupReserveSpy).toHaveBeenCalledWith(
      expect.any(String),
      SITE_ID,
      expect.any(String),
      100,
    );
  });

  it('ignores duplicate scheduled slot deliveries and avoids re-executing actions', async () => {
    const setBackupReserveSpy = vi.spyOn(teslaClient, 'setBackupReserve');

    const rulesPage = await repo.listRules(SITE_ID, 10);
    const rule = rulesPage.items[0]!;
    await repo.setRuleMode(rule.id, 'ACTIVE');

    await repo.recordPowerSample(SITE_ID, makeSample('2026-06-21T14:28:00Z', 30));

    // First delivery
    const report1 = await runAutomationForSite(SITE_ID, NOW, {
      repo,
      teslaClient,
      clock: new FixedClock(NOW),
    });
    expect(report1.actedCount).toBe(1);
    expect(setBackupReserveSpy).toHaveBeenCalledTimes(1);

    // Duplicate delivery for same slot
    const report2 = await runAutomationForSite(SITE_ID, NOW, {
      repo,
      teslaClient,
      clock: new FixedClock(NOW),
    });
    expect(report2.actedCount).toBe(0);
    // Control endpoint must NOT be called again
    expect(setBackupReserveSpy).toHaveBeenCalledTimes(1);
  });

  it('records SKIPPED_MISSED when cron delivery is delayed beyond catch-up window', async () => {
    // Scheduled slot 30 minutes in the past
    const oldSlot = new Date(NOW.getTime() - 30 * 60_000);

    const report = await runAutomationForSite(
      SITE_ID,
      oldSlot,
      {
        repo,
        teslaClient,
        clock: new FixedClock(NOW),
      },
      { maxMissedMinutes: 15 },
    );

    expect(report.skippedCount).toBe(1);
    expect(report.actedCount).toBe(0);
    expect(report.wouldActCount).toBe(0);

    const executions = await repo.listAutomationExecutions(SITE_ID, 10);
    expect(executions.items[0]?.decision).toBe('SKIPPED_MISSED');
    expect(executions.items[0]?.reason).toContain('delayed by 30m');
  });

  it('records SKIPPED_PAUSED when emergency automation pause is activated', async () => {
    await repo.setAutomationPaused('11111111-1111-4111-8111-111111111111', true);

    await repo.recordPowerSample(SITE_ID, makeSample('2026-06-21T14:28:00Z', 30));

    const report = await runAutomationForSite(SITE_ID, NOW, {
      repo,
      teslaClient,
      clock: new FixedClock(NOW),
    });

    expect(report.skippedCount).toBe(1);
    expect(report.wouldActCount).toBe(0);

    const executions = await repo.listAutomationExecutions(SITE_ID, 10);
    expect(executions.items[0]?.decision).toBe('SKIPPED_PAUSED');
  });

  it('records SKIPPED_STALE when telemetry is older than freshness threshold', async () => {
    // Telemetry sampled 2 hours ago
    await repo.recordPowerSample(
      SITE_ID,
      makeSample(new Date(NOW.getTime() - 2 * 3600_000).toISOString(), 30),
    );

    const report = await runAutomationForSite(SITE_ID, NOW, {
      repo,
      teslaClient,
      clock: new FixedClock(NOW),
    });

    expect(report.skippedCount).toBe(1);
    expect(report.wouldActCount).toBe(0);

    const executions = await repo.listAutomationExecutions(SITE_ID, 10);
    expect(executions.items[0]?.decision).toBe('SKIPPED_STALE');
  });
});
