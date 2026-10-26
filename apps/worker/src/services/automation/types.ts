import type {
  CommandRequest,
  Decimal,
  ExecutionDecision,
  Freshness,
  RuleMode,
} from '@autopw3/shared';
import type { EvaluatedCapability } from '../../providers/tesla/capabilities';

export interface EvaluationContext {
  readonly siteId: string;
  readonly householdId: string;
  readonly timezone: string;
  readonly now: Date;
  readonly scheduledSlot: Date;
  readonly batterySocPercent: number | null;
  readonly telemetryFreshness: Freshness;
  readonly currentImportRate: Decimal | null;
  readonly capabilities: readonly EvaluatedCapability[];
  readonly isAutomationPaused: boolean;
}

export interface RuleEvaluationResult {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly priority: number;
  readonly mode: RuleMode;
  readonly matchesConditions: boolean;
  readonly decision: ExecutionDecision;
  readonly reason: string | null;
  readonly actions: readonly CommandRequest[];
}

export interface EvaluationRunnerOptions {
  readonly maxMissedMinutes?: number;
}
