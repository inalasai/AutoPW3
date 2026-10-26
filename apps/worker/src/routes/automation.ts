import type { Repository } from '../db/repository';
import { errorResponse, jsonResponse } from '../lib/errors';
import type { CreateRuleRequest, UpdateRuleRequest } from '@autopw3/shared';

export async function handleListRules(
  siteId: string,
  query: { limit?: number; cursor?: string },
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Site not found', requestId);
  }
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const result = await repo.listRules(siteId, limit, query.cursor);
  return jsonResponse(result, 200, requestId);
}

export async function handleCreateRule(
  siteId: string,
  body: CreateRuleRequest,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Site not found', requestId);
  }

  // Safety rule: mode defaults to DISABLED; only DISABLED or DRY_RUN accepted at creation
  if ((body.mode as string) === 'ACTIVE') {
    return errorResponse(
      'VALIDATION_FAILED',
      'Rules cannot be created directly in ACTIVE mode; create in DRY_RUN and activate separately',
      requestId,
      [{ path: 'mode', issue: 'invalid_mode' }],
    );
  }

  const rule = await repo.createRule(siteId, body);
  return jsonResponse(rule, 201, requestId);
}

export async function handleUpdateRule(
  ruleId: string,
  body: UpdateRuleRequest,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  if ((body.mode as string) === 'ACTIVE') {
    return errorResponse(
      'VALIDATION_FAILED',
      'Rules cannot be set to ACTIVE via standard update; use the dedicated activate endpoint',
      requestId,
      [{ path: 'mode', issue: 'invalid_mode' }],
    );
  }

  const result = await repo.updateRule(ruleId, body);
  if (result.error === 'NOT_FOUND') {
    return errorResponse('NOT_FOUND', 'Rule not found', requestId);
  }
  return jsonResponse(result.rule, 200, requestId);
}

export async function handleCreateCommand(
  siteId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Site not found', requestId);
  }

  // Per contract section 2.6 and TASK-14: Command submission stub returns 501 NOT_IMPLEMENTED until Task 17
  return errorResponse(
    'NOT_IMPLEMENTED',
    'Device command dispatch will be implemented in Task 17',
    requestId,
  );
}

export async function handleListCommands(
  siteId: string,
  query: { limit?: number; cursor?: string },
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Site not found', requestId);
  }
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const result = await repo.listCommands(siteId, limit, query.cursor);
  return jsonResponse(result, 200, requestId);
}
