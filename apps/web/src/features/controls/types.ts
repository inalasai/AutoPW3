import type {
  CapabilityEntry,
  CommandAccepted,
  CommandDetail,
  CommandRecord,
  CommandRequest,
  OperationMode,
} from '@autopw3/shared';

export interface SiteConfigurationState {
  backupReservePercent: number;
  operationMode: OperationMode;
  stormModeActive: boolean;
  allowGridCharging: boolean;
  allowGridExport: boolean;
  lastUpdatedUtc: string | null;
}

export interface ControlMatrixState {
  config: SiteConfigurationState;
  capabilities: CapabilityEntry[];
  commands: CommandRecord[];
  automationPaused: boolean;
  loading: boolean;
  error: string | null;
  dispatching: boolean;
}

export interface UseControlsReturn {
  config: SiteConfigurationState;
  capabilities: CapabilityEntry[];
  commands: CommandRecord[];
  automationPaused: boolean;
  loading: boolean;
  error: string | null;
  dispatching: boolean;
  selectedCommand: CommandDetail | null;
  loadCommandDetail: (commandId: string) => Promise<void>;
  clearSelectedCommand: () => void;
  dispatchCommand: (request: CommandRequest) => Promise<CommandAccepted | null>;
  toggleAutomationPause: () => Promise<void>;
  refresh: () => Promise<void>;
}
