import type {
  AutomationPauseState,
  CommandAccepted,
  CommandRequest,
  CreateRuleRequest,
  UpdateRuleRequest,
} from '@autopw3/shared';
import type { Repository } from '../db/repository';
import { errorResponse, jsonResponse } from '../lib/errors';
import type { ITeslaClient } from '../providers/tesla/client';
import { MockTeslaClient } from '../providers/tesla/mock-adapter';
import {
  AutomationPausedError,
  CapabilityNotSupportedError,
  ConflictError,
  SafetyLimitError,
  executeDeviceCommand,
} from '../services/commands/executor';
import type { TokenStore } from '../services/tokens/store';

const fallbackTeslaClient = new MockTeslaClient();

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
  body: CommandRequest,
  idempotencyKey: string,
  callerUserId: string | null,
  repo: Repository,
  requestId: string,
  tokenStore?: TokenStore,
  teslaClient?: ITeslaClient,
): Promise<Response> {
  const site = await repo.getSite(siteId);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Site not found', requestId);
  }

  try {
    const result = await executeDeviceCommand(
      siteId,
      body,
      {
        origin: 'USER',
        actorUserId: callerUserId,
        idempotencyKey,
      },
      {
        repo,
        teslaClient: teslaClient ?? fallbackTeslaClient,
        tokenStore,
      },
    );

    const accepted: CommandAccepted = {
      id: result.command.id,
      state: 'PENDING',
      phase: result.command.phase,
    };

    // 202 Accepted on intent creation / dispatch
    return jsonResponse(accepted, 202, requestId);
  } catch (err) {
    if (err instanceof ConflictError) {
      return errorResponse('CONFLICT', err.message, requestId);
    }
    if (err instanceof CapabilityNotSupportedError) {
      return errorResponse('VALIDATION_FAILED', err.message, requestId);
    }
    if (err instanceof SafetyLimitError) {
      return errorResponse('VALIDATION_FAILED', err.message, requestId);
    }
    if (err instanceof AutomationPausedError) {
      return errorResponse('FORBIDDEN', err.message, requestId);
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse('INTERNAL', message, requestId);
  }
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

export async function handleGetCommand(
  commandId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const detail = await repo.getCommandById(commandId);
  if (!detail) {
    return errorResponse('NOT_FOUND', 'Command not found', requestId);
  }
  return jsonResponse(detail, 200, requestId);
}

export async function handlePauseAutomation(
  householdId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const state: AutomationPauseState = await repo.setAutomationPaused(householdId, true);
  return jsonResponse(state, 200, requestId);
}

export async function handleResumeAutomation(
  householdId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const state: AutomationPauseState = await repo.setAutomationPaused(householdId, false);
  return jsonResponse(state, 200, requestId);
}
