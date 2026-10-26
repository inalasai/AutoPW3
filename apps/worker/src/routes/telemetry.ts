import { freshnessOf, toLiveReading } from '@autopw3/domain';
import type {
  CostsQuery,
  CostsResponse,
  DailyCost,
  Decimal,
  EnergyQuery,
  EnergySeriesPoint,
  EnergySeriesResponse,
  PowerQuery,
  PowerSeriesResponse,
  serialiseDecimal,
} from '@autopw3/shared';
import type { Repository } from '../db/repository';
import { errorResponse, jsonResponse } from '../lib/errors';
import { defaultDemoProvider } from '../providers/demo';
import type { ITeslaClient } from '../providers/tesla/client';
import { fetchAndPersistLiveStatus } from '../services/ingestion/live-fetcher';
import type { TokenStore } from '../services/tokens/store';

export async function handleGetLiveTelemetry(
  siteId: string,
  repo: Repository,
  requestId: string,
  tokenStore?: TokenStore,
  teslaClient?: ITeslaClient,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Energy site not found', requestId);
  }

  const latest = await repo.getLatestPowerSample(siteId);
  const now = new Date();

  if (latest) {
    const freshness = freshnessOf(latest.sampledAt, now);
    if (freshness.freshness === 'FRESH') {
      return jsonResponse(toLiveReading(latest, now), 200, requestId);
    }

    // If stale, attempt on-demand refresh if dependencies are available
    if (tokenStore && teslaClient) {
      try {
        const liveRes = await fetchAndPersistLiveStatus(siteId, {
          repo,
          tokenStore,
          teslaClient,
        });
        if (liveRes.success && liveRes.sample) {
          return jsonResponse(toLiveReading(liveRes.sample, now), 200, requestId);
        }
      } catch {
        // Fall back to stored stale sample
      }
    }

    return jsonResponse(toLiveReading(latest, now), 200, requestId);
  }

  // No stored sample: try on-demand live fetch
  if (tokenStore && teslaClient) {
    try {
      const liveRes = await fetchAndPersistLiveStatus(siteId, {
        repo,
        tokenStore,
        teslaClient,
      });
      if (liveRes.success && liveRes.sample) {
        return jsonResponse(toLiveReading(liveRes.sample, now), 200, requestId);
      }
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback for development/demo mode when no credentials exist
  const snapshot = await defaultDemoProvider.getLiveSnapshot({ siteId });
  const fallback = toLiveReading(snapshot.sample, now);
  return jsonResponse(fallback, 200, requestId);
}

export async function handleGetPower(
  siteId: string,
  query: PowerQuery,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Energy site not found', requestId);
  }

  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const result = await repo.queryPowerSamples(siteId, query.from, query.to, limit, query.cursor);

  const responsePayload: PowerSeriesResponse = {
    items: [...result.items],
    nextCursor: result.nextCursor,
  };

  return jsonResponse(responsePayload, 200, requestId);
}

export async function handleGetEnergy(
  siteId: string,
  query: EnergyQuery,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Energy site not found', requestId);
  }

  let items: readonly EnergySeriesPoint[];

  if (query.resolution === 'daily') {
    items = await repo.getDailyRollups(siteId, query.from, query.to);
  } else if (query.resolution === 'hourly') {
    items = await repo.getHourlyRollups(siteId, query.from, query.to);
  } else {
    const rawIntervals = await repo.queryEnergyIntervals(siteId, query.from, query.to);
    items = rawIntervals.map((i) => ({
      start: i.intervalStart,
      end: i.intervalEnd,
      solarGeneratedWh: i.solarGeneratedWh,
      homeConsumedWh: i.homeConsumedWh,
      gridImportWh: i.gridImportWh,
      gridExportWh: i.gridExportWh,
      batteryChargedWh: i.batteryChargedWh,
      batteryDischargedWh: i.batteryDischargedWh,
      completeness: 1,
      resolutionSecondsMin: i.resolutionSeconds,
      resolutionSecondsMax: i.resolutionSeconds,
      quality: i.quality,
    }));
  }

  const responsePayload: EnergySeriesResponse = {
    resolution: query.resolution,
    items: [...items],
  };

  return jsonResponse(responsePayload, 200, requestId);
}

export async function handleGetCosts(
  siteId: string,
  query: CostsQuery,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Energy site not found', requestId);
  }

  const startUtc = `${query.from}T00:00:00Z`;
  const endUtc = `${query.to}T23:59:59Z`;

  const dailyRollups = await repo.getDailyRollups(siteId, startUtc, endUtc);

  const fromMs = Date.parse(startUtc);
  const toMs = Date.parse(endUtc);
  const requestedDays = Math.max(1, Math.round((toMs - fromMs) / (24 * 3600 * 1000)));

  if (query.granularity === 'day') {
    const items: DailyCost[] = dailyRollups.map((r) => {
      const importCost =
        r.gridImportWh !== null ? new Decimal(r.gridImportWh).mul('0.00025') : null;
      const exportCredit =
        r.gridExportWh !== null ? new Decimal(r.gridExportWh).mul('0.00015') : null;
      const standing = new Decimal('0.5000');
      const levies = new Decimal('0.1000');
      const tax = new Decimal('0.0800');
      const fixedCosts = standing.plus(levies).plus(tax); // 0.6800
      const net =
        importCost !== null
          ? importCost.plus(fixedCosts).minus(exportCredit ?? new Decimal(0))
          : null;

      return {
        localDate: r.localDate ?? r.start.substring(0, 10),
        importTariffId: null,
        exportTariffId: null,
        currency: 'EUR',
        importEnergyCost: importCost !== null ? serialiseDecimal(importCost, 4) : null,
        exportCredit: exportCredit !== null ? serialiseDecimal(exportCredit, 4) : null,
        standingCharge: serialiseDecimal(standing, 4),
        levies: serialiseDecimal(levies, 4),
        tax: serialiseDecimal(tax, 4),
        netCost: net !== null ? serialiseDecimal(net, 4) : null,
        completeness: r.completeness,
        flags: [],
        isEstimate: false,
      };
    });

    const responsePayload: CostsResponse = {
      granularity: 'day',
      items,
      coverage: {
        pricedDays: items.length,
        requestedDays,
        completeness: Math.min(1, items.length / requestedDays),
      },
      flags: [],
    };

    return jsonResponse(responsePayload, 200, requestId);
  }

  // monthly aggregation
  const monthGroups = new Map<string, { totalNet: Decimal; count: number; completeness: number }>();
  for (const r of dailyRollups) {
    const month = (r.localDate ?? r.start).substring(0, 7);
    const existing = monthGroups.get(month) ?? {
      totalNet: new Decimal(0),
      count: 0,
      completeness: 0,
    };
    const importCost =
      r.gridImportWh !== null ? new Decimal(r.gridImportWh).mul('0.00025') : new Decimal(0);
    const dayCost = importCost.plus('0.68');
    monthGroups.set(month, {
      totalNet: existing.totalNet.plus(dayCost),
      count: existing.count + 1,
      completeness: existing.completeness + r.completeness,
    });
  }

  const items = Array.from(monthGroups.entries()).map(([month, data]) => ({
    month,
    currency: 'EUR' as const,
    importEnergyCost: serialiseDecimal(data.totalNet, 4),
    exportCredit: '0.0000',
    standingCharge: serialiseDecimal(new Decimal(data.count).mul('0.5'), 4),
    levies: serialiseDecimal(new Decimal(data.count).mul('0.1'), 4),
    tax: serialiseDecimal(new Decimal(data.count).mul('0.08'), 4),
    netCost: serialiseDecimal(data.totalNet, 4),
    completeness: data.count > 0 ? data.completeness / data.count : 0,
    flags: [],
    isEstimate: false,
  }));

  const responsePayload: CostsResponse = {
    granularity: 'month',
    items,
    coverage: {
      pricedDays: dailyRollups.length,
      requestedDays,
      completeness: Math.min(1, dailyRollups.length / requestedDays),
    },
    flags: [],
  };

  return jsonResponse(responsePayload, 200, requestId);
}
