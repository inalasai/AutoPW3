import { dayTypeOf, localDateAndMinute } from '@autopw3/domain';
import type {
  AutomationRule,
  CommandKind,
  Comparator,
  Decimal,
  RuleCondition,
} from '@autopw3/shared';
import { Decimal as DecimalLib } from '@autopw3/shared';
import type { EvaluationContext, RuleEvaluationResult } from './types';

function compareNumber(actual: number, comp: Comparator, target: number): boolean {
  switch (comp) {
    case 'LT':
      return actual < target;
    case 'LTE':
      return actual <= target;
    case 'GT':
      return actual > target;
    case 'GTE':
      return actual >= target;
  }
}

function compareDecimal(actual: Decimal, comp: Comparator, target: Decimal): boolean {
  switch (comp) {
    case 'LT':
      return actual.lt(target);
    case 'LTE':
      return actual.lte(target);
    case 'GT':
      return actual.gt(target);
    case 'GTE':
      return actual.gte(target);
  }
}

export function isCommandKindSupported(
  kind: CommandKind,
  context: EvaluationContext,
): { supported: boolean; reason?: string } {
  // Hard safety prohibition per D-003
  if (kind === 'SET_OFF_GRID_VEHICLE_CHARGING_RESERVE' || kind === 'SET_TIME_OF_USE_SETTINGS') {
    return {
      supported: false,
      reason: `Control ${kind} is unverified or unsupported per safety rules`,
    };
  }

  if (kind === 'SET_BACKUP_RESERVE') {
    return { supported: true };
  }
  if (kind === 'SET_OPERATION_MODE') {
    return { supported: true };
  }
  if (kind === 'SET_GRID_IMPORT_EXPORT') {
    return { supported: true };
  }
  if (kind === 'SET_STORM_MODE') {
    const stormCap = context.capabilities.find((c) => c.capability === 'storm_mode');
    if (!stormCap || stormCap.status !== 'SUPPORTED') {
      return { supported: false, reason: 'Site is not storm mode capable' };
    }
    return { supported: true };
  }

  return { supported: false, reason: `Unknown command kind ${kind}` };
}

export function evaluateCondition(
  condition: RuleCondition,
  context: EvaluationContext,
): { satisfied: boolean; detail: string } {
  switch (condition.type) {
    case 'TIME_WINDOW': {
      const { localDate, localMinute } = localDateAndMinute(
        context.now.getTime(),
        context.timezone,
      );
      const dayType = dayTypeOf(localDate);

      if (condition.dayType !== 'ALL' && condition.dayType !== dayType) {
        return {
          satisfied: false,
          detail: `Local day ${dayType} does not match required ${condition.dayType}`,
        };
      }

      const inWindow = localMinute >= condition.startMinute && localMinute < condition.endMinute;
      return {
        satisfied: inWindow,
        detail: `Local minute ${localMinute} is ${inWindow ? 'within' : 'outside'} [${condition.startMinute}, ${condition.endMinute})`,
      };
    }

    case 'BATTERY_SOC': {
      if (context.batterySocPercent === null) {
        return {
          satisfied: false,
          detail: 'Battery SOC is unavailable',
        };
      }
      const satisfied = compareNumber(
        context.batterySocPercent,
        condition.comparator,
        condition.valuePercent,
      );
      return {
        satisfied,
        detail: `Battery SOC ${context.batterySocPercent}% ${satisfied ? 'satisfies' : 'does not satisfy'} ${condition.comparator} ${condition.valuePercent}%`,
      };
    }

    case 'IMPORT_RATE': {
      if (context.currentImportRate === null) {
        return {
          satisfied: false,
          detail: 'Current import rate is unavailable',
        };
      }
      const target = DecimalLib(condition.ratePerKwh);
      const satisfied = compareDecimal(context.currentImportRate, condition.comparator, target);
      return {
        satisfied,
        detail: `Import rate ${context.currentImportRate.toString()} ${satisfied ? 'satisfies' : 'does not satisfy'} ${condition.comparator} ${condition.ratePerKwh}`,
      };
    }
  }
}

/**
 * Evaluates all rules for a given site context, handling conflict detection by priority.
 * Rules are evaluated in descending priority order (higher priority wins).
 */
export function evaluateRulesForContext(
  rules: readonly AutomationRule[],
  context: EvaluationContext,
): readonly RuleEvaluationResult[] {
  // Sort descending by priority, tie-breaking by created_at / id for determinism
  const sortedRules = [...rules].sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return a.id.localeCompare(b.id);
  });

  const results: RuleEvaluationResult[] = [];
  let winningRuleId: string | null = null;
  let winningRuleName: string | null = null;
  let winningRulePriority: number | null = null;

  for (const rule of sortedRules) {
    // 1. Disabled rules
    if (rule.mode === 'DISABLED') {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        mode: 'DISABLED',
        matchesConditions: false,
        decision: 'NO_ACTION',
        reason: 'Rule is disabled',
        actions: rule.definition.actions,
      });
      continue;
    }

    // 2. Global / Household automation pause
    if (context.isAutomationPaused) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        mode: rule.mode,
        matchesConditions: false,
        decision: 'SKIPPED_PAUSED',
        reason: 'Emergency automation pause is active for household',
        actions: rule.definition.actions,
      });
      continue;
    }

    // 3. Stale telemetry check
    if (context.telemetryFreshness !== 'FRESH') {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        mode: rule.mode,
        matchesConditions: false,
        decision: 'SKIPPED_STALE',
        reason: `Telemetry is ${context.telemetryFreshness.toLowerCase()}; fresh readings required for automation`,
        actions: rule.definition.actions,
      });
      continue;
    }

    // 4. Site capability check for all rule actions
    let unsupportedReason: string | null = null;
    for (const action of rule.definition.actions) {
      const check = isCommandKindSupported(action.kind, context);
      if (!check.supported) {
        unsupportedReason = check.reason ?? `Action ${action.kind} unsupported`;
        break;
      }
    }
    if (unsupportedReason) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        mode: rule.mode,
        matchesConditions: false,
        decision: 'SKIPPED_CAPABILITY',
        reason: unsupportedReason,
        actions: rule.definition.actions,
      });
      continue;
    }

    // 5. Evaluate conditions (AND logic)
    const conditionDetails: string[] = [];
    let allSatisfied = true;

    for (const condition of rule.definition.conditions) {
      const evalResult = evaluateCondition(condition, context);
      conditionDetails.push(evalResult.detail);
      if (!evalResult.satisfied) {
        allSatisfied = false;
        break;
      }
    }

    if (!allSatisfied) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        mode: rule.mode,
        matchesConditions: false,
        decision: 'NO_ACTION',
        reason: conditionDetails.join('; '),
        actions: rule.definition.actions,
      });
      continue;
    }

    // 6. Conflict detection: if a higher-priority rule already matched in this slot
    if (winningRuleId !== null) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        mode: rule.mode,
        matchesConditions: true,
        decision: 'SKIPPED_CONFLICT',
        reason: `Superseded by higher priority rule "${winningRuleName}" (priority ${winningRulePriority})`,
        actions: rule.definition.actions,
      });
      continue;
    }

    // This rule is the winner for this slot
    winningRuleId = rule.id;
    winningRuleName = rule.name;
    winningRulePriority = rule.priority;

    if (rule.mode === 'DRY_RUN') {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        mode: 'DRY_RUN',
        matchesConditions: true,
        decision: 'WOULD_ACT',
        reason: `Conditions satisfied (${conditionDetails.join('; ')}). Mode is DRY_RUN; no device command dispatched.`,
        actions: rule.definition.actions,
      });
    } else {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        mode: 'ACTIVE',
        matchesConditions: true,
        decision: 'ACTED',
        reason: `Conditions satisfied (${conditionDetails.join('; ')}). Dispatching command.`,
        actions: rule.definition.actions,
      });
    }
  }

  return results;
}
