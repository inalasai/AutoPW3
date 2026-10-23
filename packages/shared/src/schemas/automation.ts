import { z } from 'zod';
import {
  COMPARATORS,
  EXECUTION_DECISIONS,
  RULE_MODES,
  RULE_REQUEST_MODES,
} from '../constants/enums';
import { RULE_LIMITS, TEXT_LIMITS } from '../constants/limits';
import { CommandRequestSchema } from './commands';
import { RateStringSchema } from './decimal';
import {
  EndMinuteSchema,
  InstantUtcSchema,
  PercentSchema,
  StartMinuteSchema,
  UuidSchema,
  boundedText,
  pageOf,
} from './primitives';
import { DayTypeSchema } from './tariffs';

/**
 * Automation rules (API contract section 2.7, rule 10). Safe by default: a rule is created DISABLED or DRY_RUN; only
 * the ADMIN activate route sets ACTIVE (and the database refuses anyone else). DRY_RUN records what WOULD happen and
 * never reaches a control endpoint. Missing or stale data means no action.
 *
 * `definition` is stored as jsonb with its own `definitionVersion`. Version 1 (below) is the minimal shape
 * TASK-05 fixes so the API and database agree; TASK-18 may add condition and action types under a higher
 * `definitionVersion` (a documented, additive change). Actions reuse the command request model, so a rule can only
 * ask for what a manual command could ask for.
 */

export const RuleModeSchema = z.enum(RULE_MODES);
export const RuleRequestModeSchema = z.enum(RULE_REQUEST_MODES);
export const ComparatorSchema = z.enum(COMPARATORS);
export const ExecutionDecisionSchema = z.enum(EXECUTION_DECISIONS);

/** Local wall-clock window on certain day types, in the SITE's timezone (never a UTC offset). */
const timeWindowCondition = z
  .strictObject({
    type: z.literal('TIME_WINDOW'),
    dayType: DayTypeSchema,
    startMinute: StartMinuteSchema,
    endMinute: EndMinuteSchema,
  })
  .refine((c) => c.endMinute > c.startMinute, {
    message: 'endMinute must be greater than startMinute',
    path: ['endMinute'],
  });

const batterySocCondition = z.strictObject({
  type: z.literal('BATTERY_SOC'),
  comparator: ComparatorSchema,
  valuePercent: PercentSchema,
});

/** Compares the import rate in force now with a threshold (decimal string; rate resolved by the tariff engine). */
const importRateCondition = z.strictObject({
  type: z.literal('IMPORT_RATE'),
  comparator: ComparatorSchema,
  ratePerKwh: RateStringSchema,
});

export const RuleConditionSchema = z.discriminatedUnion('type', [
  timeWindowCondition,
  batterySocCondition,
  importRateCondition,
]);
export type RuleCondition = z.infer<typeof RuleConditionSchema>;

/** Version 1 of `automation_rules.definition`: every condition must hold (AND), then every action is requested. */
export const RuleDefinitionV1Schema = z.strictObject({
  conditions: z.array(RuleConditionSchema).min(1).max(RULE_LIMITS.maxConditions),
  actions: z.array(CommandRequestSchema).min(1).max(RULE_LIMITS.maxActions),
});
export type RuleDefinitionV1 = z.infer<typeof RuleDefinitionV1Schema>;

/** The definition version this build writes. */
export const CURRENT_RULE_DEFINITION_VERSION = 1;

const priority = z.int().min(0).max(RULE_LIMITS.maxPriority);

/** POST /sites/{siteId}/automation/rules. `mode` defaults DISABLED and can never be ACTIVE here. */
export const CreateRuleRequestSchema = z.strictObject({
  name: boundedText(TEXT_LIMITS.name),
  priority: priority.default(100),
  mode: RuleRequestModeSchema.default('DISABLED'),
  definition: RuleDefinitionV1Schema,
});
export type CreateRuleRequest = z.infer<typeof CreateRuleRequestSchema>;

/**
 * PATCH /automation/rules/{ruleId}. `version` is the optimistic-concurrency token: a mismatch is 409. `mode` may
 * only be DISABLED or DRY_RUN (ACTIVE goes through the activate route).
 */
export const UpdateRuleRequestSchema = z
  .strictObject({
    version: z.int().min(1),
    name: boundedText(TEXT_LIMITS.name).optional(),
    priority: priority.optional(),
    mode: RuleRequestModeSchema.optional(),
    definition: RuleDefinitionV1Schema.optional(),
  })
  .refine(
    (r) =>
      r.name !== undefined ||
      r.priority !== undefined ||
      r.mode !== undefined ||
      r.definition !== undefined,
    { message: 'at least one field to change is required' },
  );
export type UpdateRuleRequest = z.infer<typeof UpdateRuleRequestSchema>;

/** A stored rule. `definition` is validated as V1 when `definitionVersion` is 1. */
export const AutomationRuleSchema = z.strictObject({
  id: UuidSchema,
  siteId: UuidSchema,
  name: z.string().min(1).max(TEXT_LIMITS.name),
  mode: RuleModeSchema,
  priority,
  definitionVersion: z.int().min(1),
  definition: RuleDefinitionV1Schema,
  version: z.int().min(1),
  createdAt: InstantUtcSchema,
  updatedAt: InstantUtcSchema,
});
export type AutomationRule = z.infer<typeof AutomationRuleSchema>;

export const RuleListResponseSchema = pageOf(AutomationRuleSchema);

/** A recorded evaluation. A rule that is not ACTIVE can never have ACTED or a linked command (database CHECKs). */
export const AutomationExecutionSchema = z
  .strictObject({
    id: UuidSchema,
    ruleId: UuidSchema,
    siteId: UuidSchema,
    scheduledSlot: InstantUtcSchema,
    evaluatedAt: InstantUtcSchema,
    modeAtEvaluation: RuleModeSchema,
    decision: ExecutionDecisionSchema,
    reason: z.string().min(1).max(TEXT_LIMITS.reason).nullable(),
    commandId: UuidSchema.nullable(),
  })
  .superRefine((e, ctx) => {
    if (e.modeAtEvaluation !== 'ACTIVE' && e.decision === 'ACTED') {
      ctx.addIssue({
        code: 'custom',
        path: ['decision'],
        message: 'only an ACTIVE rule can have decision ACTED',
      });
    }
    if (e.modeAtEvaluation !== 'ACTIVE' && e.commandId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['commandId'],
        message: 'a rule that is not ACTIVE never links a command',
      });
    }
  });
export type AutomationExecution = z.infer<typeof AutomationExecutionSchema>;

export const ExecutionListResponseSchema = pageOf(AutomationExecutionSchema);
