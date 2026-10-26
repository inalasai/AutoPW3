import type { Repository } from '../db/repository';
import { errorResponse, jsonResponse } from '../lib/errors';
import { validateTariff } from '@autopw3/domain';
import type { CreateTariffRequest, EndTariffRequest, PutPricePointsRequest } from '@autopw3/shared';

export async function handleListTariffs(
  householdId: string,
  query: { direction?: string; asOf?: string; limit?: number; cursor?: string },
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const filter: { direction?: string; asOf?: string } = {};
  if (query.direction !== undefined) filter.direction = query.direction;
  if (query.asOf !== undefined) filter.asOf = query.asOf;

  const result = await repo.listTariffs(householdId, filter, limit, query.cursor);
  return jsonResponse(result, 200, requestId);
}

export async function handleGetTariff(
  tariffId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const tariff = await repo.getTariff(tariffId);
  if (!tariff) {
    return errorResponse('NOT_FOUND', 'Tariff not found', requestId);
  }
  return jsonResponse(tariff, 200, requestId);
}

export async function handleCreateTariff(
  householdId: string,
  body: CreateTariffRequest,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  // Validate tariff definition using the domain engine validator
  const problems = validateTariff(body);
  if (problems.length > 0) {
    return errorResponse(
      'VALIDATION_FAILED',
      'Tariff validation failed',
      requestId,
      problems.map((p) => ({ path: p.path ?? 'tariff', issue: p.code })),
    );
  }

  const result = await repo.createTariff(householdId, body);
  if (!result.success) {
    if (result.error === 'OVERLAP') {
      return errorResponse(
        'CONFLICT',
        'Effective dates overlap with an existing tariff of the same direction and key',
        requestId,
      );
    }
    return errorResponse('VALIDATION_FAILED', 'Failed to create tariff', requestId);
  }

  return jsonResponse(result.tariff, 201, requestId);
}

export async function handleValidateTariff(
  tariffId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const tariff = await repo.getTariff(tariffId);
  if (!tariff) {
    return errorResponse('NOT_FOUND', 'Tariff not found', requestId);
  }
  const problems = validateTariff(tariff);
  return jsonResponse(
    {
      valid: problems.length === 0,
      problems: problems.map((p) => ({ code: p.code, message: p.message, path: p.path ?? null })),
    },
    200,
    requestId,
  );
}

export async function handleEndTariff(
  tariffId: string,
  body: EndTariffRequest,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const result = await repo.endTariff(tariffId, body.effectiveTo);
  if (!result.success) {
    return errorResponse('NOT_FOUND', 'Tariff not found', requestId);
  }
  return jsonResponse(result.tariff, 200, requestId);
}

export async function handleDeleteTariff(
  tariffId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const result = await repo.deleteTariff(tariffId);
  if (!result.success) {
    if (result.error === 'REFERENCED') {
      return errorResponse(
        'CONFLICT',
        'Cannot delete tariff referenced by historical cost records',
        requestId,
      );
    }
    return errorResponse('NOT_FOUND', 'Tariff not found', requestId);
  }
  return new Response(null, { status: 204, headers: { 'x-request-id': requestId } });
}

export async function handlePutPricePoints(
  tariffId: string,
  body: PutPricePointsRequest,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const tariff = await repo.getTariff(tariffId);
  if (!tariff) {
    return errorResponse('NOT_FOUND', 'Tariff not found', requestId);
  }

  const result = await repo.putPricePoints(tariffId, body.pricePoints);
  return jsonResponse(
    {
      inserted: result.count,
    },
    200,
    requestId,
  );
}
