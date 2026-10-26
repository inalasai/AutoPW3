import type {
  AutomationExecution,
  AutomationRule,
  Comparator,
  CreateRuleRequest,
  DayType,
  RuleRequestMode,
} from '@autopw3/shared';

export interface AutomationRuleFormState {
  name: string;
  priority: number;
  mode: RuleRequestMode;
  conditionType: 'BATTERY_SOC' | 'TIME_WINDOW' | 'IMPORT_RATE';
  // Time window fields
  dayType: DayType;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  // Battery SOC fields
  socComparator: Comparator;
  socPercent: number;
  // Import rate fields
  rateComparator: Comparator;
  ratePerKwh: string;
  // Action fields
  actionKind:
    'SET_BACKUP_RESERVE' | 'SET_OPERATION_MODE' | 'SET_GRID_IMPORT_EXPORT' | 'SET_STORM_MODE';
  backupReservePercent: number;
  operationMode: 'SELF_CONSUMPTION' | 'AUTONOMOUS';
  stormModeEnabled: boolean;
}

export interface UseAutomationReturn {
  rules: readonly AutomationRule[];
  executions: readonly AutomationExecution[];
  automationPaused: boolean;
  loading: boolean;
  error: string | null;
  selectedRule: AutomationRule | null;
  isEditorOpen: boolean;
  openCreateEditor: () => void;
  openEditEditor: (rule: AutomationRule) => void;
  closeEditor: () => void;
  createRule: (rule: CreateRuleRequest) => Promise<boolean>;
  updateRule: (
    ruleId: string,
    rule: Partial<CreateRuleRequest>,
    version: number,
  ) => Promise<boolean>;
  deleteRule: (ruleId: string) => Promise<boolean>;
  setRuleActive: (ruleId: string, active: boolean) => Promise<boolean>;
  toggleAutomationPause: () => Promise<boolean>;
  refresh: () => Promise<void>;
}
