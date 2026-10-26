import type { CreateTariffRequest, Role, Tariff } from '@autopw3/shared';
import { TARIFF_EXAMPLES } from '@autopw3/domain';
import type { TariffRepository } from './types';

function createUuid(): string {
  // RFC 4122 v4 UUID generator safe in modern browsers and node test environments
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * In-memory repository for demo mode, local development, and tests.
 * Enforces role restrictions: READ_ONLY cannot persist.
 */
export class InMemoryTariffRepository implements TariffRepository {
  private tariffs: Tariff[] = [];

  constructor(initialTariffs?: readonly Tariff[]) {
    if (initialTariffs !== undefined) {
      this.tariffs = [...initialTariffs];
    } else {
      // Seed with initial example fixtures
      this.tariffs = [
        TARIFF_EXAMPLES.FLAT_IMPORT,
        TARIFF_EXAMPLES.DAY_NIGHT_IMPORT,
        TARIFF_EXAMPLES.DAY_NIGHT_PEAK_IMPORT,
        TARIFF_EXAMPLES.SEASONAL_WEEKDAY_WEEKEND_IMPORT,
        TARIFF_EXAMPLES.EXPORT_PER_KWH,
      ];
    }
  }

  reset(): void {
    this.tariffs = [
      TARIFF_EXAMPLES.FLAT_IMPORT,
      TARIFF_EXAMPLES.DAY_NIGHT_IMPORT,
      TARIFF_EXAMPLES.DAY_NIGHT_PEAK_IMPORT,
      TARIFF_EXAMPLES.SEASONAL_WEEKDAY_WEEKEND_IMPORT,
      TARIFF_EXAMPLES.EXPORT_PER_KWH,
    ];
  }

  async listTariffs(siteId?: string | null): Promise<Tariff[]> {
    return this.tariffs
      .filter((t) => (siteId === undefined ? true : t.siteId === siteId || t.siteId === null))
      .sort((a, b) => {
        if (a.direction !== b.direction) return a.direction.localeCompare(b.direction);
        if (a.effectiveFrom !== b.effectiveFrom) {
          return b.effectiveFrom.localeCompare(a.effectiveFrom);
        }
        return b.version - a.version;
      });
  }

  async getTariff(id: string): Promise<Tariff | null> {
    const found = this.tariffs.find((t) => t.id === id);
    return found ?? null;
  }

  async saveTariff(request: CreateTariffRequest, currentRole: Role | null): Promise<Tariff> {
    // Hard rule: READ_ONLY users cannot persist changes
    if (currentRole === 'READ_ONLY') {
      throw new Error('READ_ONLY role cannot persist tariffs');
    }

    const newId = createUuid();
    const nowIso = new Date().toISOString();

    if (request.tariffKey !== undefined) {
      // Editing an existing tariff: creates a NEW VERSION, preserving older versions
      const existingVersions = this.tariffs.filter((t) => t.tariffKey === request.tariffKey);
      const maxVersion = existingVersions.reduce((acc, v) => Math.max(acc, v.version), 0);
      const nextVersion = maxVersion + 1;

      // Adjust previous open-ended version's effectiveTo to avoid date overlap
      this.tariffs = this.tariffs.map((t) => {
        if (
          t.tariffKey === request.tariffKey &&
          (t.effectiveTo === null || t.effectiveTo > request.effectiveFrom)
        ) {
          return { ...t, effectiveTo: request.effectiveFrom };
        }
        return t;
      });

      const newTariff: Tariff = {
        ...request,
        id: newId,
        tariffKey: request.tariffKey,
        version: nextVersion,
        createdAt: nowIso,
      };

      this.tariffs.push(newTariff);
      return newTariff;
    }

    // New profile
    const tariffKey = createUuid();
    const newTariff: Tariff = {
      ...request,
      id: newId,
      tariffKey,
      version: 1,
      createdAt: nowIso,
    };

    this.tariffs.push(newTariff);
    return newTariff;
  }

  async endTariff(id: string, effectiveTo: string, currentRole: Role | null): Promise<Tariff> {
    if (currentRole === 'READ_ONLY') {
      throw new Error('READ_ONLY role cannot persist tariffs');
    }

    const index = this.tariffs.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new Error(`Tariff ${id} not found`);
    }

    const current = this.tariffs[index];
    if (current === undefined) throw new Error(`Tariff ${id} not found`);

    const updated: Tariff = { ...current, effectiveTo };
    this.tariffs[index] = updated;
    return updated;
  }
}

/** Global default in-memory repository instance for demo mode. */
export const defaultInMemoryTariffRepository = new InMemoryTariffRepository();
