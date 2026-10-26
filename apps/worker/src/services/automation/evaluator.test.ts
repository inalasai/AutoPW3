import { describe, expect, it } from 'vitest';
import type { AutomationRule, CommandRequest } from '@autopw3/shared';
import { Decimal } from '@autopw3/shared';
import type { EvaluatedCapability } from '../../providers/tesla/capabilities';
import { evaluateRulesForContext } from './evaluator';
import type { EvaluationContext } from './types';

const MOCK_CAPABILITIES: readonly EvaluatedCapability[] = [
  {
    capability: 'backup_reserve',
    status: 'SUPPORTED',
    reason: null,
    docReference: 'docs',
  },
  {
    capability: 'operational_mode',
    status: 'SUPPORTED',
    reason: null,
    docReference: 'docs',
  },
  {
    capability: 'grid_charging',
    status: 'SUPPORTED',
    reason: null,
    docReference: 'docs',
  },
  {
    capability: 'storm_mode',
    status: 'SUPPORTED',
    reason: null,
    docReference: 'docs',
  },
];

const DEFAULT_CONTEXT: EvaluationContext = {
  siteId: 'site-1',
  householdId: 'house-1',
  timezone: 'UTC',
  now: new Date('2026-06-21T14:30:00Z'), // Sunday (WEEKEND), 14:30 = minute 870
  scheduledSlot: new Date('2026-06-21T14:30:00Z'),
  batterySocPercent: 45,
  telemetryFreshness: 'FRESH',
  currentImportRate: Decimal('0.150000'),
  capabilities: MOCK_CAPABILITIES,
  isAutomationPaused: false,
};

const DUMMY_ACTION: CommandRequest = {
  kind: 'SET_BACKUP_RESERVE',
  params: { backupReservePercent: 30 },
};

function createRule(overrides: Partial<AutomationRule>): AutomationRule {
  return {
    id: 'rule-1',
    siteId: 'site-1',
    name: 'Test Rule',
    mode: 'DRY_RUN',
    priority: 100,
    definitionVersion: 1,
    definition: {
      conditions: [
        {
          type: 'BATTERY_SOC',
          comparator: 'LT',
          valuePercent: 50,
        },
      ],
      actions: [DUMMY_ACTION],
    },
    version: 1,
    createdAt: '2026-06-21T12:00:00Z',
    updatedAt: '2026-06-21T12:00:00Z',
    ...overrides,
  };
}

describe('evaluateRulesForContext', () => {
  it('records WOULD_ACT for matching rule in DRY_RUN mode without dispatching', () => {
    const rule = createRule({ mode: 'DRY_RUN' });
    const results = evaluateRulesForContext([rule], DEFAULT_CONTEXT);

    expect(results).toHaveLength(1);
    expect(results[0]?.decision).toBe('WOULD_ACT');
    expect(results[0]?.matchesConditions).toBe(true);
    expect(results[0]?.reason).toContain('Mode is DRY_RUN');
  });

  it('records ACTED for matching rule in ACTIVE mode', () => {
    const rule = createRule({ mode: 'ACTIVE' });
    const results = evaluateRulesForContext([rule], DEFAULT_CONTEXT);

    expect(results).toHaveLength(1);
    expect(results[0]?.decision).toBe('ACTED');
    expect(results[0]?.matchesConditions).toBe(true);
    expect(results[0]?.reason).toContain('Dispatching command');
  });

  it('skips disabled rules with NO_ACTION', () => {
    const rule = createRule({ mode: 'DISABLED' });
    const results = evaluateRulesForContext([rule], DEFAULT_CONTEXT);

    expect(results).toHaveLength(1);
    expect(results[0]?.decision).toBe('NO_ACTION');
    expect(results[0]?.reason).toBe('Rule is disabled');
  });

  it('skips evaluation with SKIPPED_PAUSED when emergency automation pause is active', () => {
    const rule = createRule({ mode: 'ACTIVE' });
    const results = evaluateRulesForContext([rule], {
      ...DEFAULT_CONTEXT,
      isAutomationPaused: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.decision).toBe('SKIPPED_PAUSED');
    expect(results[0]?.reason).toContain('Emergency automation pause is active');
  });

  it('skips evaluation with SKIPPED_STALE when telemetry is stale or unavailable', () => {
    const rule = createRule({ mode: 'ACTIVE' });
    const results = evaluateRulesForContext([rule], {
      ...DEFAULT_CONTEXT,
      telemetryFreshness: 'STALE',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.decision).toBe('SKIPPED_STALE');
    expect(results[0]?.reason).toContain('fresh readings required');
  });

  it('skips rule with SKIPPED_CAPABILITY when action capability is unsupported', () => {
    const rule = createRule({
      mode: 'ACTIVE',
      definition: {
        conditions: [
          {
            type: 'BATTERY_SOC',
            comparator: 'LT',
            valuePercent: 50,
          },
        ],
        actions: [
          {
            kind: 'SET_OFF_GRID_VEHICLE_CHARGING_RESERVE',
            params: { reservePercent: 20 },
          },
        ],
      },
    });

    const results = evaluateRulesForContext([rule], DEFAULT_CONTEXT);
    expect(results).toHaveLength(1);
    expect(results[0]?.decision).toBe('SKIPPED_CAPABILITY');
    expect(results[0]?.reason).toContain('unverified or unsupported');
  });

  it('evaluates TIME_WINDOW condition with dayType and local time correctly', () => {
    // 2026-06-21 is Sunday (WEEKEND), 14:30 UTC = minute 870
    const matchingRule = createRule({
      id: 'rule-weekend',
      definition: {
        conditions: [
          {
            type: 'TIME_WINDOW',
            dayType: 'WEEKEND',
            startMinute: 800,
            endMinute: 900,
          },
        ],
        actions: [DUMMY_ACTION],
      },
    });

    const weekdayRule = createRule({
      id: 'rule-weekday',
      definition: {
        conditions: [
          {
            type: 'TIME_WINDOW',
            dayType: 'WEEKDAY',
            startMinute: 800,
            endMinute: 900,
          },
        ],
        actions: [DUMMY_ACTION],
      },
    });

    const resultsWeekend = evaluateRulesForContext([matchingRule], DEFAULT_CONTEXT);
    expect(resultsWeekend[0]?.matchesConditions).toBe(true);

    const resultsWeekday = evaluateRulesForContext([weekdayRule], DEFAULT_CONTEXT);
    expect(resultsWeekday[0]?.matchesConditions).toBe(false);
    expect(resultsWeekday[0]?.decision).toBe('NO_ACTION');
    expect(resultsWeekday[0]?.reason).toContain('WEEKEND does not match required WEEKDAY');
  });

  it('evaluates IMPORT_RATE condition against decimal threshold', () => {
    const cheapRateRule = createRule({
      definition: {
        conditions: [
          {
            type: 'IMPORT_RATE',
            comparator: 'LTE',
            ratePerKwh: '0.150000',
          },
        ],
        actions: [DUMMY_ACTION],
      },
    });

    const resultsMatch = evaluateRulesForContext([cheapRateRule], DEFAULT_CONTEXT);
    expect(resultsMatch[0]?.matchesConditions).toBe(true);

    const superCheapRule = createRule({
      definition: {
        conditions: [
          {
            type: 'IMPORT_RATE',
            comparator: 'LT',
            ratePerKwh: '0.100000',
          },
        ],
        actions: [DUMMY_ACTION],
      },
    });

    const resultsNoMatch = evaluateRulesForContext([superCheapRule], DEFAULT_CONTEXT);
    expect(resultsNoMatch[0]?.matchesConditions).toBe(false);
    expect(resultsNoMatch[0]?.decision).toBe('NO_ACTION');
  });

  it('resolves conflicts deterministically: higher priority rule wins; lower priority gets SKIPPED_CONFLICT', () => {
    const highPriorityRule = createRule({
      id: 'rule-high',
      name: 'High Priority Reserve',
      priority: 200,
      mode: 'ACTIVE',
    });

    const lowPriorityRule = createRule({
      id: 'rule-low',
      name: 'Low Priority Reserve',
      priority: 50,
      mode: 'ACTIVE',
    });

    const results = evaluateRulesForContext([lowPriorityRule, highPriorityRule], DEFAULT_CONTEXT);

    expect(results).toHaveLength(2);
    // Winner is high priority
    const highResult = results.find((r) => r.ruleId === 'rule-high');
    const lowResult = results.find((r) => r.ruleId === 'rule-low');

    expect(highResult?.decision).toBe('ACTED');
    expect(lowResult?.decision).toBe('SKIPPED_CONFLICT');
    expect(lowResult?.reason).toContain(
      'Superseded by higher priority rule "High Priority Reserve" (priority 200)',
    );
  });
});
