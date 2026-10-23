import { z } from 'zod';
import {
  COMMAND_ORIGINS,
  COMMAND_PHASES,
  COMMAND_STATES,
  OPERATION_MODES,
  PROVIDER_MODES,
} from '../constants/enums';
import {
  PercentSchema,
  IdempotencyKeySchema,
  InstantUtcSchema,
  UuidSchema,
  pageOf,
} from './primitives';

/**
 * Device commands (API contract section 2.6, SYSTEM_ARCHITECTURE section 12, rule 4).
 *
 * A command is a CONFIGURATION CHANGE REQUEST. State is honest: PENDING, CONFIRMED, FAILED or UNKNOWN. CONFIRMED
 * means the provider's read-back shows the requested configuration; `physicalOutcomeGuaranteed` is therefore always
 * false. The parameter shapes below are OUR normalised request model; how each maps to Tesla's payload is
 * UNVERIFIED (TESLA_CAPABILITY_MATRIX_DRAFT, L-005) and happens only in the adapter, behind the mock until a real
 * site is tested by hand. No kind exists for forced charge, forced export, solar bypass or islanding.
 */

export const CommandStateSchema = z.enum(COMMAND_STATES);
export const CommandPhaseSchema = z.enum(COMMAND_PHASES);
export const CommandOriginSchema = z.enum(COMMAND_ORIGINS);
export const ProviderModeSchema = z.enum(PROVIDER_MODES);

/** Backup reserve and off-grid vehicle reserve are whole percentages 0 to 100. Safety step limits live in the Worker. */
const ReservePercentSchema = PercentSchema.refine(Number.isInteger, {
  message: 'must be a whole number',
});

const backupReserve = z.strictObject({
  kind: z.literal('SET_BACKUP_RESERVE'),
  params: z.strictObject({ backupReservePercent: ReservePercentSchema }),
});

const operationMode = z.strictObject({
  kind: z.literal('SET_OPERATION_MODE'),
  params: z.strictObject({ operationMode: z.enum(OPERATION_MODES) }),
});

const gridImportExport = z.strictObject({
  kind: z.literal('SET_GRID_IMPORT_EXPORT'),
  params: z
    .strictObject({
      allowGridCharging: z.boolean().optional(),
      allowGridExport: z.boolean().optional(),
    })
    .refine((p) => p.allowGridCharging !== undefined || p.allowGridExport !== undefined, {
      message: 'at least one of allowGridCharging and allowGridExport is required',
    }),
});

const stormMode = z.strictObject({
  kind: z.literal('SET_STORM_MODE'),
  params: z.strictObject({ enabled: z.boolean() }),
});

const offGridReserve = z.strictObject({
  kind: z.literal('SET_OFF_GRID_VEHICLE_CHARGING_RESERVE'),
  params: z.strictObject({ reservePercent: ReservePercentSchema }),
});

/** Pushes a stored tariff to the site. The tariff is referenced by id: the Tesla payload is built by the adapter. */
const timeOfUse = z.strictObject({
  kind: z.literal('SET_TIME_OF_USE_SETTINGS'),
  params: z.strictObject({ tariffId: UuidSchema }),
});

/** Body of POST /sites/{siteId}/commands (header `Idempotency-Key` required). Also the shape of a rule action. */
export const CommandRequestSchema = z.discriminatedUnion('kind', [
  backupReserve,
  operationMode,
  gridImportExport,
  stormMode,
  offGridReserve,
  timeOfUse,
]);
export type CommandRequest = z.infer<typeof CommandRequestSchema>;

/** The `Idempotency-Key` request header, lower-cased as HTTP libraries expose it. */
export const IdempotencyHeaderSchema = z.object({ 'idempotency-key': IdempotencyKeySchema });
export type IdempotencyHeader = z.infer<typeof IdempotencyHeaderSchema>;

/** 202 response to a command request: the intent row exists and dispatch has not been confirmed. */
export const CommandAcceptedSchema = z.strictObject({
  id: UuidSchema,
  state: z.literal('PENDING'),
  phase: CommandPhaseSchema,
});
export type CommandAccepted = z.infer<typeof CommandAcceptedSchema>;

/** Wording the UI must use: the configuration was or was not confirmed; the physical result is never promised. */
export const CommandOutcomeSchema = z.strictObject({
  configurationConfirmed: z.boolean(),
  physicalOutcomeGuaranteed: z.literal(false),
});

const recordMeta = {
  id: UuidSchema,
  siteId: UuidSchema,
  origin: CommandOriginSchema,
  providerMode: ProviderModeSchema,
  state: CommandStateSchema,
  phase: CommandPhaseSchema,
  requestedAt: InstantUtcSchema,
  dispatchedAt: InstantUtcSchema.nullable(),
  finishedAt: InstantUtcSchema.nullable(),
  /** Stable machine code for a failure; never raw provider text. */
  errorCode: z.string().min(1).max(64).nullable(),
  outcome: CommandOutcomeSchema,
};

/** A stored command as GET /commands/{id} and the history list return it. */
export const CommandRecordSchema = z
  .discriminatedUnion('kind', [
    backupReserve.extend(recordMeta),
    operationMode.extend(recordMeta),
    gridImportExport.extend(recordMeta),
    stormMode.extend(recordMeta),
    offGridReserve.extend(recordMeta),
    timeOfUse.extend(recordMeta),
  ])
  .superRefine((c, ctx) => {
    if (c.outcome.configurationConfirmed !== (c.state === 'CONFIRMED')) {
      ctx.addIssue({
        code: 'custom',
        path: ['outcome', 'configurationConfirmed'],
        message: 'configurationConfirmed must be true exactly when state is CONFIRMED',
      });
    }
    const terminal = c.state === 'CONFIRMED' || c.state === 'FAILED';
    if (terminal !== (c.finishedAt !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'finishedAt is set exactly when the state is CONFIRMED or FAILED',
      });
    }
  });
export type CommandRecord = z.infer<typeof CommandRecordSchema>;

export const CommandListResponseSchema = pageOf(CommandRecordSchema);

/** One state change in a command's history (device_command_events). */
export const CommandEventSchema = z.strictObject({
  at: InstantUtcSchema,
  fromState: CommandStateSchema.nullable(),
  toState: CommandStateSchema,
  phase: CommandPhaseSchema.nullable(),
});
export type CommandEvent = z.infer<typeof CommandEventSchema>;

/** GET /commands/{id}: the record plus its append-only event history. */
export const CommandDetailSchema = z.strictObject({
  command: CommandRecordSchema,
  events: z.array(CommandEventSchema),
});
export type CommandDetail = z.infer<typeof CommandDetailSchema>;
