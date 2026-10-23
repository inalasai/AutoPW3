import { describe, expect, it } from 'vitest';
import {
  AutomationExecutionSchema,
  AutomationRuleSchema,
  CreateRuleRequestSchema,
  RuleDefinitionV1Schema,
  UpdateRuleRequestSchema,
} from './automation';

const uuid = '3f8b1c2e-9a4d-4e7b-8c11-6d5f0a2b7e90';

const definition = {
  conditions: [
    { type: 'TIME_WINDOW', dayType: 'ALL', startMinute: 0, endMinute: 480 },
    { type: 'BATTERY_SOC', comparator: 'LT', valuePercent: 80 },
  ],
  actions: [{ kind: 'SET_OPERATION_MODE', params: { operationMode: 'SELF_CONSUMPTION' } }],
};

describe('RuleDefinitionV1Schema', () => {
  it('accepts conditions and actions', () => {
    expect(RuleDefinitionV1Schema.safeParse(definition).success).toBe(true);
  });

  it('needs at least one condition and one action', () => {
    expect(RuleDefinitionV1Schema.safeParse({ ...definition, conditions: [] }).success).toBe(false);
    expect(RuleDefinitionV1Schema.safeParse({ ...definition, actions: [] }).success).toBe(false);
  });

  it('rejects SOC 120, a negative window and a numeric rate threshold', () => {
    expect(
      RuleDefinitionV1Schema.safeParse({
        ...definition,
        conditions: [{ type: 'BATTERY_SOC', comparator: 'LT', valuePercent: 120 }],
      }).success,
    ).toBe(false);
    expect(
      RuleDefinitionV1Schema.safeParse({
        ...definition,
        conditions: [{ type: 'TIME_WINDOW', dayType: 'ALL', startMinute: 600, endMinute: 480 }],
      }).success,
    ).toBe(false);
    expect(
      RuleDefinitionV1Schema.safeParse({
        ...definition,
        conditions: [{ type: 'IMPORT_RATE', comparator: 'LT', ratePerKwh: 0.1 }],
      }).success,
    ).toBe(false);
    expect(
      RuleDefinitionV1Schema.safeParse({
        ...definition,
        conditions: [{ type: 'IMPORT_RATE', comparator: 'LT', ratePerKwh: '0.100000' }],
      }).success,
    ).toBe(true);
  });

  it('only lets a rule request what a manual command could request', () => {
    expect(
      RuleDefinitionV1Schema.safeParse({
        ...definition,
        actions: [{ kind: 'FORCE_GRID_CHARGE', params: {} }],
      }).success,
    ).toBe(false);
    expect(
      RuleDefinitionV1Schema.safeParse({
        ...definition,
        actions: [{ kind: 'SET_BACKUP_RESERVE', params: { backupReservePercent: 150 } }],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown condition types and unknown comparators', () => {
    expect(
      RuleDefinitionV1Schema.safeParse({ ...definition, conditions: [{ type: 'WEATHER' }] })
        .success,
    ).toBe(false);
    expect(
      RuleDefinitionV1Schema.safeParse({
        ...definition,
        conditions: [{ type: 'BATTERY_SOC', comparator: 'EQ', valuePercent: 50 }],
      }).success,
    ).toBe(false);
  });
});

describe('CreateRuleRequestSchema (safe by default)', () => {
  it('defaults to DISABLED with priority 100', () => {
    const r = CreateRuleRequestSchema.parse({ name: 'Night charge', definition });
    expect(r.mode).toBe('DISABLED');
    expect(r.priority).toBe(100);
  });

  it('accepts DRY_RUN but never ACTIVE', () => {
    expect(
      CreateRuleRequestSchema.safeParse({ name: 'x', mode: 'DRY_RUN', definition }).success,
    ).toBe(true);
    expect(
      CreateRuleRequestSchema.safeParse({ name: 'x', mode: 'ACTIVE', definition }).success,
    ).toBe(false);
    expect(
      CreateRuleRequestSchema.safeParse({ name: 'x', mode: 'ARMED', definition }).success,
    ).toBe(false);
  });

  it('rejects a blank name and a bad priority', () => {
    expect(CreateRuleRequestSchema.safeParse({ name: ' ', definition }).success).toBe(false);
    expect(CreateRuleRequestSchema.safeParse({ name: 'x', priority: -1, definition }).success).toBe(
      false,
    );
    expect(
      CreateRuleRequestSchema.safeParse({ name: 'x', priority: 1.5, definition }).success,
    ).toBe(false);
  });
});

describe('UpdateRuleRequestSchema (optimistic concurrency)', () => {
  it('requires the version token and at least one change', () => {
    expect(UpdateRuleRequestSchema.safeParse({ version: 3, name: 'New name' }).success).toBe(true);
    expect(UpdateRuleRequestSchema.safeParse({ name: 'New name' }).success).toBe(false);
    expect(UpdateRuleRequestSchema.safeParse({ version: 3 }).success).toBe(false);
  });

  it('cannot move a rule to ACTIVE through an edit', () => {
    expect(UpdateRuleRequestSchema.safeParse({ version: 3, mode: 'DRY_RUN' }).success).toBe(true);
    expect(UpdateRuleRequestSchema.safeParse({ version: 3, mode: 'ACTIVE' }).success).toBe(false);
  });
});

describe('AutomationRuleSchema', () => {
  it('describes a stored rule', () => {
    const rule = {
      id: uuid,
      siteId: uuid,
      name: 'Night charge',
      mode: 'DISABLED',
      priority: 100,
      definitionVersion: 1,
      definition,
      version: 1,
      createdAt: '2026-10-22T10:00:00Z',
      updatedAt: '2026-10-22T10:00:00Z',
    };
    expect(AutomationRuleSchema.safeParse(rule).success).toBe(true);
    expect(AutomationRuleSchema.safeParse({ ...rule, mode: 'ACTIVE' }).success).toBe(true);
    expect(AutomationRuleSchema.safeParse({ ...rule, mode: 'ON' }).success).toBe(false);
  });
});

describe('AutomationExecutionSchema (a dry run never acts)', () => {
  const exec = {
    id: uuid,
    ruleId: uuid,
    siteId: uuid,
    scheduledSlot: '2026-10-22T10:00:00Z',
    evaluatedAt: '2026-10-22T10:00:01Z',
    modeAtEvaluation: 'DRY_RUN',
    decision: 'WOULD_ACT',
    reason: 'SOC below 80 percent in the night window',
    commandId: null,
  };

  it('accepts WOULD_ACT for a dry run', () => {
    expect(AutomationExecutionSchema.safeParse(exec).success).toBe(true);
  });

  it('rejects ACTED or a linked command unless the rule was ACTIVE', () => {
    expect(AutomationExecutionSchema.safeParse({ ...exec, decision: 'ACTED' }).success).toBe(false);
    expect(AutomationExecutionSchema.safeParse({ ...exec, commandId: uuid }).success).toBe(false);
    expect(
      AutomationExecutionSchema.safeParse({
        ...exec,
        modeAtEvaluation: 'ACTIVE',
        decision: 'ACTED',
        commandId: uuid,
      }).success,
    ).toBe(true);
  });

  it('knows the skip reasons and rejects an invented decision', () => {
    for (const decision of [
      'SKIPPED_STALE',
      'SKIPPED_PAUSED',
      'SKIPPED_CAPABILITY',
      'NO_ACTION',
      'ERROR',
    ]) {
      expect(AutomationExecutionSchema.safeParse({ ...exec, decision }).success).toBe(true);
    }
    expect(AutomationExecutionSchema.safeParse({ ...exec, decision: 'DONE' }).success).toBe(false);
  });
});
