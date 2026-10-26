import { describe, expect, it } from 'vitest';
import { InMemoryTariffRepository } from './repository';
import type { CreateTariffRequest } from '@autopw3/shared';

describe('InMemoryTariffRepository', () => {
  it('loads with initial seed tariffs', async () => {
    const repo = new InMemoryTariffRepository();
    const list = await repo.listTariffs();
    expect(list.length).toBeGreaterThanOrEqual(5);
  });

  it('saves a new tariff with version 1 and unique keys', async () => {
    const repo = new InMemoryTariffRepository([]);
    const request: CreateTariffRequest = {
      siteId: null,
      name: 'Test Tariff',
      direction: 'IMPORT',
      priceMode: 'FLAT',
      currency: 'EUR',
      timezone: 'Europe/Dublin',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      taxMode: 'NONE',
      vatRatePercent: null,
      flatRatePerKwh: '0.300000',
      standingChargePerDay: '0.600000',
      exportPaymentModel: null,
      slots: [],
      seasons: [],
      overrides: [],
      levies: [],
    };

    const saved = await repo.saveTariff(request, 'READ_WRITE');
    expect(saved.version).toBe(1);
    expect(saved.id).toBeDefined();
    expect(saved.tariffKey).toBeDefined();

    const list = await repo.listTariffs();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(saved.id);
  });

  it('preserves older versions when creating a new version of an existing tariff', async () => {
    const repo = new InMemoryTariffRepository([]);
    const baseRequest: CreateTariffRequest = {
      siteId: null,
      name: 'Versioned Tariff',
      direction: 'IMPORT',
      priceMode: 'FLAT',
      currency: 'EUR',
      timezone: 'Europe/Dublin',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      taxMode: 'NONE',
      vatRatePercent: null,
      flatRatePerKwh: '0.300000',
      standingChargePerDay: '0.600000',
      exportPaymentModel: null,
      slots: [],
      seasons: [],
      overrides: [],
      levies: [],
    };

    const v1 = await repo.saveTariff(baseRequest, 'ADMIN');
    expect(v1.version).toBe(1);
    expect(v1.effectiveTo).toBeNull();

    // Create version 2 effective 2026-06-01
    const v2Request: CreateTariffRequest = {
      ...baseRequest,
      tariffKey: v1.tariffKey,
      effectiveFrom: '2026-06-01',
      flatRatePerKwh: '0.350000',
    };

    const v2 = await repo.saveTariff(v2Request, 'ADMIN');
    expect(v2.version).toBe(2);
    expect(v2.tariffKey).toBe(v1.tariffKey);
    expect(v2.id).not.toBe(v1.id);

    // Verify all versions are preserved in store
    const list = await repo.listTariffs();
    expect(list).toHaveLength(2);

    const reloadedV1 = await repo.getTariff(v1.id);
    const reloadedV2 = await repo.getTariff(v2.id);

    expect(reloadedV1).toBeDefined();
    expect(reloadedV2).toBeDefined();
    expect(reloadedV1?.version).toBe(1);
    expect(reloadedV2?.version).toBe(2);
    // V1's effectiveTo was automatically closed at v2's start to avoid date overlap
    expect(reloadedV1?.effectiveTo).toBe('2026-06-01');
  });

  it('strictly refuses persistence when role is READ_ONLY (data layer enforcement)', async () => {
    const repo = new InMemoryTariffRepository();
    const request: CreateTariffRequest = {
      siteId: null,
      name: 'Unauthorised Attempt',
      direction: 'IMPORT',
      priceMode: 'FLAT',
      currency: 'EUR',
      timezone: 'Europe/Dublin',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      taxMode: 'NONE',
      vatRatePercent: null,
      flatRatePerKwh: '0.300000',
      standingChargePerDay: '0.600000',
      exportPaymentModel: null,
      slots: [],
      seasons: [],
      overrides: [],
      levies: [],
    };

    await expect(repo.saveTariff(request, 'READ_ONLY')).rejects.toThrow(
      'READ_ONLY role cannot persist tariffs',
    );

    const list = await repo.listTariffs();
    const first = list[0];
    if (first !== undefined) {
      await expect(repo.endTariff(first.id, '2026-12-31', 'READ_ONLY')).rejects.toThrow(
        'READ_ONLY role cannot persist tariffs',
      );
    }
  });

  it('archives a tariff by setting effectiveTo', async () => {
    const repo = new InMemoryTariffRepository([]);
    const saved = await repo.saveTariff(
      {
        siteId: null,
        name: 'Tariff to archive',
        direction: 'IMPORT',
        priceMode: 'FLAT',
        currency: 'EUR',
        timezone: 'Europe/Dublin',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        taxMode: 'NONE',
        vatRatePercent: null,
        flatRatePerKwh: '0.300000',
        standingChargePerDay: '0.600000',
        exportPaymentModel: null,
        slots: [],
        seasons: [],
        overrides: [],
        levies: [],
      },
      'READ_WRITE',
    );

    expect(saved.effectiveTo).toBeNull();
    const ended = await repo.endTariff(saved.id, '2026-10-26', 'READ_WRITE');
    expect(ended.effectiveTo).toBe('2026-10-26');

    const reloaded = await repo.getTariff(saved.id);
    expect(reloaded?.effectiveTo).toBe('2026-10-26');
  });
});
