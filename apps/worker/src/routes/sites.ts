import type { Repository } from '../db/repository';
import { errorResponse, jsonResponse } from '../lib/errors';
import { defaultDemoProvider } from '../providers/demo';
import { toDemoLiveReading, toLiveReading } from '@autopw3/domain';
import type { EnergyResolution } from '@autopw3/shared';

export async function handleListSites(
  householdId: string,
  query: { limit?: number; cursor?: string },
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const result = await repo.listSites(householdId, limit, query.cursor);
  return jsonResponse(result, 200, requestId);
}

export async function handleGetSite(
  siteId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Energy site not found', requestId);
  }
  return jsonResponse(site, 200, requestId);
}

export async function handleGetCapabilities(
  siteId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Energy site not found', requestId);
  }
  const capabilities = await repo.getSiteCapabilities(siteId);
  return jsonResponse({ items: capabilities }, 200, requestId);
}

export async function handleGetLive(
  siteId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Energy site not found', requestId);
  }

  // In demo/mock mode or until Tesla live provider is configured (Task 15/16),
  // return the demo provider's live reading converted to LiveReading
  const snapshot = await defaultDemoProvider.getLiveSnapshot({ siteId });
  const reading = toLiveReading(snapshot.sample, new Date());
  return jsonResponse(reading, 200, requestId);
}

export async function handleGetDemoLive(
  householdId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const hh = await repo.getHousehold(householdId);
  if (!hh) {
    return errorResponse('NOT_FOUND', 'Household not found', requestId);
  }

  const snapshot = await defaultDemoProvider.getLiveSnapshot({ siteId: 'demo-site' });
  const reading = toDemoLiveReading(snapshot.sample, new Date());
  return jsonResponse(reading, 200, requestId);
}

export async function handleGetDemoEnergy(
  householdId: string,
  query: { from: string; to: string; resolution: EnergyResolution },
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const hh = await repo.getHousehold(householdId);
  if (!hh) {
    return errorResponse('NOT_FOUND', 'Household not found', requestId);
  }

  const result = await defaultDemoProvider.getEnergySeries({
    siteId: 'demo-site',
    from: query.from,
    to: query.to,
    resolution: query.resolution,
    timezone: hh.timezone,
  });

  return jsonResponse(
    {
      resolution: result.resolution,
      items: result.items,
    },
    200,
    requestId,
  );
}
