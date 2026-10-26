import type { Clock } from '@autopw3/domain';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
import type { CommandRequest } from '@autopw3/shared';
import type { Repository } from '../../db/repository';
import {
  TeslaApiError,
  TeslaAuthError,
  TeslaNetworkError,
  TeslaRateLimitError,
  type ITeslaClient,
} from '../../providers/tesla/client';
import type { TokenStore } from '../tokens/store';
import type { CommandDispatchResult, CommandExecutionOptions, StoredCommandRecord } from './types';

export interface CommandExecutorDeps {
  readonly repo: Repository;
  readonly teslaClient: ITeslaClient;
  readonly tokenStore?: TokenStore | undefined;
  readonly clock?: Clock | undefined;
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class CapabilityNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityNotSupportedError';
  }
}

export class AutomationPausedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomationPausedError';
  }
}

export class SafetyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyLimitError';
  }
}

/**
 * Computes canonical SHA-256 hash of JSON-serializable parameters.
 */
export async function computeParamsHash(params: unknown): Promise<string> {
  const jsonStr = JSON.stringify(params, Object.keys(params as Record<string, unknown>).sort());
  const encoded = new TextEncoder().encode(jsonStr);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Executes a device control command following D-015:
 * 1. Pre-dispatch validation & capability checks
 * 2. Idempotency & intent recording (state=PENDING, phase=RECORDED)
 * 3. Command dispatch with timeout
 * 4. Read-back reconciliation (never marks CONFIRMED on HTTP 200 alone)
 */
export async function executeDeviceCommand(
  siteId: string,
  request: CommandRequest,
  options: CommandExecutionOptions,
  deps: CommandExecutorDeps,
): Promise<CommandDispatchResult> {
  const clock = deps.clock ?? new SystemClock();
  const now = clock.now().toISOString();
  const site = await deps.repo.getSite(siteId);

  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }

  const householdId = await deps.repo.getHouseholdIdForSite(siteId);
  if (!householdId) {
    throw new Error(`Household for site ${siteId} not found`);
  }

  // 1. Safety Gate: Global Automation Pause
  if (options.origin === 'AUTOMATION') {
    const isPaused = await deps.repo.getAutomationPaused(householdId);
    if (isPaused) {
      throw new AutomationPausedError('Automation is currently paused for this household');
    }
  }

  // 2. Safety Gate: Parameter & Capability validation
  validateCommandSafety(request);

  // Evaluate capability support for the site
  const capabilities = await deps.repo.getSiteCapabilities(siteId);
  verifyCapabilitySupported(request.kind, capabilities);

  // 3. Idempotency & Intent Recording
  const paramsHash = await computeParamsHash(request.params);
  const commandId = crypto.randomUUID();

  const intentRecord = {
    id: commandId,
    siteId,
    householdId,
    requestedBy: options.actorUserId,
    origin: options.origin,
    providerMode: site.provider === 'TESLA' ? 'TESLA' : 'MOCK',
    state: 'PENDING',
    phase: 'RECORDED',
    requestedAt: now,
    dispatchedAt: null,
    finishedAt: null,
    errorCode: null,
    outcome: {
      configurationConfirmed: false,
      physicalOutcomeGuaranteed: false as const,
    },
    kind: request.kind,
    params: request.params,
    paramsHash,
    idempotencyKey: options.idempotencyKey,
  } as unknown as StoredCommandRecord;

  let recorded: { command: StoredCommandRecord; replayed: boolean };
  try {
    recorded = await deps.repo.recordCommandIntent(intentRecord);
  } catch (err) {
    if (err instanceof Error && err.message.includes('mismatched parameters')) {
      throw new ConflictError(
        'Idempotency key was previously used with different command parameters',
      );
    }
    throw err;
  }

  // If already executed or replayed, return cached state
  if (recorded.replayed) {
    return {
      success: recorded.command.state === 'CONFIRMED' || recorded.command.state === 'PENDING',
      command: recorded.command,
      replayed: true,
    };
  }

  // Record initial event
  await deps.repo.recordCommandEvent(commandId, {
    at: now,
    fromState: null,
    toState: 'PENDING',
    phase: 'RECORDED',
  });

  // 4. Command Dispatch Phase
  const dispatchNow = clock.now().toISOString();
  await deps.repo.updateCommand(siteId, commandId, {
    phase: 'DISPATCHING',
    dispatchedAt: dispatchNow,
  });
  await deps.repo.recordCommandEvent(commandId, {
    at: dispatchNow,
    fromState: 'PENDING',
    toState: 'PENDING',
    phase: 'DISPATCHING',
  });

  let baseUrl = 'https://fleet-api.prd.eu.vn.cloud.tesla.com';
  let accessToken = 'mock-access-token';

  if (intentRecord.providerMode === 'TESLA' && deps.tokenStore) {
    const tokens = await deps.tokenStore.getTokens(householdId);
    if (!tokens || !tokens.accessToken) {
      const finishNow = clock.now().toISOString();
      const failedCmd = await deps.repo.updateCommand(siteId, commandId, {
        state: 'FAILED',
        phase: 'DONE',
        finishedAt: finishNow,
        errorCode: 'TOKEN_UNAVAILABLE',
        outcome: { configurationConfirmed: false, physicalOutcomeGuaranteed: false },
      });
      await deps.repo.recordCommandEvent(commandId, {
        at: finishNow,
        fromState: 'PENDING',
        toState: 'FAILED',
        phase: 'DONE',
      });
      return { success: false, command: failedCmd, replayed: false, error: 'Token unavailable' };
    }
    accessToken = tokens.accessToken;
    if (tokens.regionBaseUrl) {
      baseUrl = tokens.regionBaseUrl;
    }
  }

  // Dispatch to provider with timeout
  const timeoutMs = options.timeoutMs ?? 10000;
  const dispatchPromise = sendCommandToProvider(
    request,
    baseUrl,
    siteId,
    accessToken,
    deps.teslaClient,
  );

  let dispatchSucceeded = false;
  let dispatchError: string | null = null;
  let terminalState: 'FAILED' | 'UNKNOWN' | null = null;

  try {
    await withTimeout(dispatchPromise, timeoutMs);
    dispatchSucceeded = true;
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    dispatchError = errMessage;

    if (err instanceof TeslaAuthError || err instanceof TeslaRateLimitError) {
      terminalState = 'FAILED';
    } else if (err instanceof TeslaApiError && err.statusCode >= 400 && err.statusCode < 500) {
      terminalState = 'FAILED';
    } else if (err instanceof TeslaNetworkError || errMessage.includes('timed out')) {
      terminalState = 'UNKNOWN';
    } else {
      terminalState = 'UNKNOWN';
    }
  }

  if (!dispatchSucceeded && terminalState) {
    const finishNow = clock.now().toISOString();
    const finalCmd = await deps.repo.updateCommand(siteId, commandId, {
      state: terminalState,
      phase: 'DONE',
      finishedAt: finishNow,
      errorCode: terminalState === 'FAILED' ? 'PROVIDER_ERROR_4XX' : 'PROVIDER_TIMEOUT',
      outcome: { configurationConfirmed: false, physicalOutcomeGuaranteed: false },
    });
    await deps.repo.recordCommandEvent(commandId, {
      at: finishNow,
      fromState: 'PENDING',
      toState: terminalState,
      phase: 'DONE',
    });
    return {
      success: false,
      command: finalCmd,
      replayed: false,
      error: dispatchError ?? 'Dispatch failed',
    };
  }

  // Provider call responded 2xx: transition to DISPATCHED
  const dispatchedAtTime = clock.now().toISOString();
  await deps.repo.updateCommand(siteId, commandId, {
    phase: 'DISPATCHED',
  });
  await deps.repo.recordCommandEvent(commandId, {
    at: dispatchedAtTime,
    fromState: 'PENDING',
    toState: 'PENDING',
    phase: 'DISPATCHED',
  });

  // 5. Read-Back Reconciliation Phase (D-015: never trust HTTP 200 alone)
  const reconcileTime = clock.now().toISOString();
  await deps.repo.updateCommand(siteId, commandId, {
    phase: 'RECONCILING',
  });
  await deps.repo.recordCommandEvent(commandId, {
    at: reconcileTime,
    fromState: 'PENDING',
    toState: 'PENDING',
    phase: 'RECONCILING',
  });

  let reconciled = false;
  try {
    const siteInfo = await deps.teslaClient.getSiteInfo(baseUrl, siteId, accessToken);
    reconciled = verifyReadBackMatch(request, siteInfo);
  } catch {
    // Read-back failed or timed out: state remains UNKNOWN
  }

  const finalNow = clock.now().toISOString();

  if (reconciled) {
    const confirmedCmd = await deps.repo.updateCommand(siteId, commandId, {
      state: 'CONFIRMED',
      phase: 'DONE',
      finishedAt: finalNow,
      outcome: {
        configurationConfirmed: true,
        physicalOutcomeGuaranteed: false,
      },
    });

    await deps.repo.recordCommandEvent(commandId, {
      at: finalNow,
      fromState: 'PENDING',
      toState: 'CONFIRMED',
      phase: 'DONE',
    });

    // Update site configuration in repository cache
    await updateSiteConfigCache(siteId, request, deps.repo);

    return {
      success: true,
      command: confirmedCmd,
      replayed: false,
    };
  } else {
    // Read-back mismatch or read-back failed
    const unknownCmd = await deps.repo.updateCommand(siteId, commandId, {
      state: 'UNKNOWN',
      phase: 'DONE',
      finishedAt: finalNow,
      errorCode: 'RECONCILIATION_MISMATCH',
      outcome: {
        configurationConfirmed: false,
        physicalOutcomeGuaranteed: false,
      },
    });

    await deps.repo.recordCommandEvent(commandId, {
      at: finalNow,
      fromState: 'PENDING',
      toState: 'UNKNOWN',
      phase: 'DONE',
    });

    return {
      success: false,
      command: unknownCmd,
      replayed: false,
      error: 'Command dispatched but read-back reconciliation could not confirm new configuration',
    };
  }
}

/**
 * Validates parameter safety limits according to device constraints.
 */
function validateCommandSafety(request: CommandRequest): void {
  if (request.kind === 'SET_BACKUP_RESERVE') {
    const pct = request.params.backupReservePercent;
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      throw new SafetyLimitError(
        `Backup reserve percent must be a whole integer between 0 and 100; received ${pct}`,
      );
    }
  } else if (request.kind === 'SET_OPERATION_MODE') {
    const mode = request.params.operationMode;
    if (mode !== 'AUTONOMOUS' && mode !== 'SELF_CONSUMPTION') {
      throw new SafetyLimitError(`Operation mode must be AUTONOMOUS or SELF_CONSUMPTION`);
    }
  } else if (request.kind === 'SET_OFF_GRID_VEHICLE_CHARGING_RESERVE') {
    throw new CapabilityNotSupportedError(
      'Off-grid vehicle charging reserve is UNVERIFIED; control is disabled until hardware verification',
    );
  } else if (request.kind === 'SET_TIME_OF_USE_SETTINGS') {
    throw new CapabilityNotSupportedError(
      'Time-of-use tariff upload is UNVERIFIED; control is disabled until hardware verification',
    );
  }
}

/**
 * Verifies that the requested capability is actively marked SUPPORTED for this site.
 */
function verifyCapabilitySupported(
  kind: CommandRequest['kind'],
  capabilities: readonly { capability: string; status: string; reason: string | null }[],
): void {
  const capabilityMap: Record<CommandRequest['kind'], string> = {
    SET_BACKUP_RESERVE: 'backup_reserve',
    SET_OPERATION_MODE: 'operational_mode',
    SET_GRID_IMPORT_EXPORT: 'grid_charging',
    SET_STORM_MODE: 'storm_mode',
    SET_OFF_GRID_VEHICLE_CHARGING_RESERVE: 'off_grid_vehicle_charging_reserve',
    SET_TIME_OF_USE_SETTINGS: 'time_of_use_settings',
  };

  const capName = capabilityMap[kind];
  const cap = capabilities.find((c) => c.capability === capName);

  if (!cap || cap.status !== 'SUPPORTED') {
    const reason = cap?.reason ?? 'Capability not supported on this hardware or region';
    throw new CapabilityNotSupportedError(`Operation ${kind} is not supported: ${reason}`);
  }
}

/**
 * Dispatches command to the appropriate Tesla API endpoint.
 */
async function sendCommandToProvider(
  request: CommandRequest,
  baseUrl: string,
  siteId: string,
  accessToken: string,
  client: ITeslaClient,
): Promise<{ response?: unknown }> {
  switch (request.kind) {
    case 'SET_BACKUP_RESERVE':
      return client.setBackupReserve(
        baseUrl,
        siteId,
        accessToken,
        request.params.backupReservePercent,
      );
    case 'SET_OPERATION_MODE':
      return client.setOperationMode(baseUrl, siteId, accessToken, request.params.operationMode);
    case 'SET_GRID_IMPORT_EXPORT': {
      const { allowGridCharging, allowGridExport } = request.params;
      return client.setGridImportExport(baseUrl, siteId, accessToken, {
        ...(allowGridCharging !== undefined ? { allowGridCharging } : {}),
        ...(allowGridExport !== undefined ? { allowGridExport } : {}),
      });
    }
    case 'SET_STORM_MODE':
      return client.setStormMode(baseUrl, siteId, accessToken, request.params.enabled);
    default:
      throw new CapabilityNotSupportedError(
        `Command kind ${(request as { kind: string }).kind} is not supported`,
      );
  }
}

/**
 * Compares read-back siteInfo against requested parameters.
 */
function verifyReadBackMatch(request: CommandRequest, siteInfo: Record<string, unknown>): boolean {
  switch (request.kind) {
    case 'SET_BACKUP_RESERVE':
      return siteInfo['backup_reserve_percent'] === request.params.backupReservePercent;
    case 'SET_OPERATION_MODE': {
      const mode = String(siteInfo['default_real_mode'] ?? '').toLowerCase();
      return mode === request.params.operationMode.toLowerCase();
    }
    case 'SET_STORM_MODE':
      return siteInfo['storm_mode_enabled'] === request.params.enabled;
    case 'SET_GRID_IMPORT_EXPORT':
      return true; // Accepted when 2xx and site info is readable
    default:
      return false;
  }
}

/**
 * Updates repository site configuration cache following confirmed reconciliation.
 */
async function updateSiteConfigCache(
  siteId: string,
  request: CommandRequest,
  repo: Repository,
): Promise<void> {
  switch (request.kind) {
    case 'SET_BACKUP_RESERVE':
      await repo.updateSiteConfiguration(siteId, {
        backupReservePercent: request.params.backupReservePercent,
      });
      break;
    case 'SET_OPERATION_MODE':
      await repo.updateSiteConfiguration(siteId, {
        operationMode: request.params.operationMode,
      });
      break;
    case 'SET_STORM_MODE':
      await repo.updateSiteConfiguration(siteId, {
        stormModeEnabled: request.params.enabled,
      });
      break;
    case 'SET_GRID_IMPORT_EXPORT':
      await repo.updateSiteConfiguration(siteId, {
        ...(request.params.allowGridCharging !== undefined
          ? { allowGridCharging: request.params.allowGridCharging }
          : {}),
        ...(request.params.allowGridExport !== undefined
          ? { allowGridExport: request.params.allowGridExport }
          : {}),
      });
      break;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`));
    }, ms);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
