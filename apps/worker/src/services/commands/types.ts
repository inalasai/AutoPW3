import type { CommandOrigin, CommandRecord, OperationMode } from '@autopw3/shared';

export interface CommandExecutionOptions {
  readonly origin: CommandOrigin;
  readonly actorUserId: string | null;
  readonly idempotencyKey: string;
  readonly timeoutMs?: number;
}

export interface CommandDispatchResult {
  readonly success: boolean;
  readonly command: CommandRecord;
  readonly replayed: boolean;
  readonly error?: string;
  readonly conflict?: boolean;
}

export interface SiteConfiguration {
  readonly backupReservePercent: number;
  readonly operationMode: OperationMode;
  readonly stormModeCapable: boolean;
  readonly stormModeEnabled: boolean;
  readonly allowGridCharging: boolean;
  readonly allowGridExport: boolean;
  readonly lastUpdated: string;
}

export type StoredCommandRecord = CommandRecord & {
  readonly householdId: string;
  readonly paramsHash: string;
  readonly idempotencyKey: string;
  readonly requestedBy: string | null;
};
