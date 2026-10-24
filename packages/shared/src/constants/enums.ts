/**
 * Closed value sets shared by the API, the Worker, the web app and the database CHECK constraints.
 * `packages/shared/src/db-contract.test.ts` compares the database-backed lists with the migration SQL, so a
 * change in one place without the other fails the tests. Add a value in a new migration AND here.
 */

// --- telemetry ------------------------------------------------------------------------------------------------

/** Where a reading came from. DEMO is synthetic and can never be persisted (rule 5, D-017). */
export const DATA_SOURCES = ['TESLA', 'DEMO'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

/** The only source the live tables accept (CHECK source = 'TESLA'). */
export const PERSISTED_SOURCES = ['TESLA'] as const;
export type PersistedSource = (typeof PERSISTED_SOURCES)[number];

/** Quality of a stored power snapshot (powerwall_metrics_log.quality). */
export const POWER_QUALITIES = ['OK', 'PARTIAL', 'SUSPECT'] as const;
export type PowerQuality = (typeof POWER_QUALITIES)[number];

/** Quality of a stored energy interval (energy_intervals.quality). DERIVED = integrated from power snapshots. */
export const INTERVAL_QUALITIES = ['OK', 'PARTIAL', 'SUSPECT', 'DERIVED'] as const;
export type IntervalQuality = (typeof INTERVAL_QUALITIES)[number];

/** Whether `sampledAt` came from the provider or is the time we received the reading. */
export const TIMESTAMP_ORIGINS = ['PROVIDER', 'RECEIVED'] as const;
export type TimestampOrigin = (typeof TIMESTAMP_ORIGINS)[number];

/** Age class of a reading for the user (API contract section 1). Computed, not stored. */
export const FRESHNESS_STATES = ['FRESH', 'STALE', 'UNAVAILABLE'] as const;
export type Freshness = (typeof FRESHNESS_STATES)[number];

export const ENERGY_RESOLUTIONS = ['interval', 'hourly', 'daily'] as const;
export type EnergyResolution = (typeof ENERGY_RESOLUTIONS)[number];

export const COST_GRANULARITIES = ['day', 'month'] as const;
export type CostGranularity = (typeof COST_GRANULARITIES)[number];

export const BUDGET_STATES = ['OK', 'LOW', 'EXHAUSTED'] as const;
export type BudgetState = (typeof BUDGET_STATES)[number];

// --- sites and provider ---------------------------------------------------------------------------------------

/** The only provider (energy_sites.provider). The Tesla mock adapter uses the same value locally. */
export const PROVIDERS = ['TESLA'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** energy_sites.connection_state */
export const SITE_CONNECTION_STATES = [
  'CONNECTING',
  'LIVE',
  'STALE',
  'ERROR',
  'DISCONNECTED',
] as const;
export type SiteConnectionState = (typeof SITE_CONNECTION_STATES)[number];

/** Household-level Tesla link state. NOT_CONNECTED means no tesla_credentials row; the rest mirror its status. */
export const TESLA_LINK_STATES = ['NOT_CONNECTED', 'ACTIVE', 'NEEDS_REAUTH', 'REVOKED'] as const;
export type TeslaLinkState = (typeof TESLA_LINK_STATES)[number];

/** tesla_credentials.status (no NOT_CONNECTED: that is the absence of a row). */
export const CREDENTIAL_STATUSES = ['ACTIVE', 'NEEDS_REAUTH', 'REVOKED'] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

/**
 * Capability status in the registry (API contract section 2.6). Never invented: UNVERIFIED and NOT_SUPPORTED
 * are first-class answers (rule 3).
 */
export const CAPABILITY_STATUSES = [
  'SUPPORTED',
  'UNVERIFIED',
  'NOT_SUPPORTED',
  'DISABLED_BY_SETTING',
] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

// --- tariffs --------------------------------------------------------------------------------------------------

export const TARIFF_DIRECTIONS = ['IMPORT', 'EXPORT'] as const;
export type TariffDirection = (typeof TARIFF_DIRECTIONS)[number];

export const PRICE_MODES = ['FLAT', 'TIME_OF_USE', 'DYNAMIC'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const TAX_MODES = ['INCLUSIVE', 'EXCLUSIVE', 'NONE'] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const DAY_TYPES = ['ALL', 'WEEKDAY', 'WEEKEND'] as const;
export type DayType = (typeof DAY_TYPES)[number];

export const LEVY_KINDS = ['PER_KWH', 'PER_DAY'] as const;
export type LevyKind = (typeof LEVY_KINDS)[number];

export const EXPORT_PAYMENT_MODELS = ['PER_KWH', 'NONE'] as const;
export type ExportPaymentModel = (typeof EXPORT_PAYMENT_MODELS)[number];

/**
 * Problems and gaps the tariff and accounting code reports instead of defaulting to zero (rule 8,
 * ENERGY_ACCOUNTING sections 5 and 6).
 */
export const PRICING_FLAGS = [
  'NO_TARIFF_FOR_DATE',
  'TARIFF_GAP',
  'NO_PRICE_POINT',
  'UNPRICEABLE_AT_RESOLUTION',
  'ESTIMATE',
] as const;
export type PricingFlag = (typeof PRICING_FLAGS)[number];

/**
 * Problems `validateTariff` (packages/domain, TASK-10) reports at save time and from POST /tariffs/{id}/validate.
 * A proposal made in TASK-05 so the API shape is stable; TASK-10 may add codes (additive).
 */
export const TARIFF_PROBLEM_CODES = [
  'SLOT_OVERLAP',
  'COVERAGE_GAP',
  'SEASON_OVERLAP',
  'SEASON_GAP',
  'OVERRIDE_PRIORITY_TIE',
  'EFFECTIVE_DATE_OVERLAP',
  'CURRENCY_MISMATCH',
  // Added by TASK-10 (additive, as the comment above allows).
  'TIMEZONE_UNKNOWN',
  'TIMEZONE_MISMATCH',
  'PRICE_POINT_OVERLAP',
  'LEVY_ON_EXPORT',
] as const;
export type TariffProblemCode = (typeof TARIFF_PROBLEM_CODES)[number];

// --- automation -----------------------------------------------------------------------------------------------

/** automation_rules.mode. New rules are DISABLED; only an ADMIN moves a rule to ACTIVE. */
export const RULE_MODES = ['DISABLED', 'DRY_RUN', 'ACTIVE'] as const;
export type RuleMode = (typeof RULE_MODES)[number];

/** Modes a create or edit request may carry. ACTIVE only through the ADMIN activate route. */
export const RULE_REQUEST_MODES = ['DISABLED', 'DRY_RUN'] as const;
export type RuleRequestMode = (typeof RULE_REQUEST_MODES)[number];

/** automation_executions.decision */
export const EXECUTION_DECISIONS = [
  'WOULD_ACT',
  'ACTED',
  'NO_ACTION',
  'SKIPPED_STALE',
  'SKIPPED_PAUSED',
  'SKIPPED_CAPABILITY',
  'SKIPPED_CONFLICT',
  'SKIPPED_MISSED',
  'ERROR',
] as const;
export type ExecutionDecision = (typeof EXECUTION_DECISIONS)[number];

export const COMPARATORS = ['LT', 'LTE', 'GT', 'GTE'] as const;
export type Comparator = (typeof COMPARATORS)[number];

// --- commands -------------------------------------------------------------------------------------------------

/**
 * device_command_log.kind: the six DOCUMENTED Tesla energy endpoints (TESLA_CAPABILITY_MATRIX_DRAFT). Payloads
 * are UNVERIFIED and the adapter is MOCK_ONLY (L-029). Forced charge, forced export, solar bypass and islanding
 * are NOT_SUPPORTED and have no kind.
 */
export const COMMAND_KINDS = [
  'SET_BACKUP_RESERVE',
  'SET_OPERATION_MODE',
  'SET_GRID_IMPORT_EXPORT',
  'SET_STORM_MODE',
  'SET_OFF_GRID_VEHICLE_CHARGING_RESERVE',
  'SET_TIME_OF_USE_SETTINGS',
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/** The honest outcome set (rule 4). HTTP 200 alone is never CONFIRMED. */
export const COMMAND_STATES = ['PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN'] as const;
export type CommandState = (typeof COMMAND_STATES)[number];

/** Progress inside PENDING and UNKNOWN (SYSTEM_ARCHITECTURE section 12). */
export const COMMAND_PHASES = [
  'RECORDED',
  'DISPATCHING',
  'DISPATCHED',
  'RECONCILING',
  'DONE',
] as const;
export type CommandPhase = (typeof COMMAND_PHASES)[number];

export const COMMAND_ORIGINS = ['USER', 'AUTOMATION'] as const;
export type CommandOrigin = (typeof COMMAND_ORIGINS)[number];

/** device_command_log.provider_mode. MOCK until the owner has verified live behaviour by hand (D-006, D-003). */
export const PROVIDER_MODES = ['MOCK', 'TESLA'] as const;
export type ProviderMode = (typeof PROVIDER_MODES)[number];

/** States after which nothing more happens. UNKNOWN is not terminal: reconciliation retries it. */
export const COMMAND_TERMINAL_STATES = [
  'CONFIRMED',
  'FAILED',
] as const satisfies readonly CommandState[];

/** Allowed state changes (SYSTEM_ARCHITECTURE section 12). A state never leaves CONFIRMED or FAILED. */
export const COMMAND_STATE_TRANSITIONS: Readonly<Record<CommandState, readonly CommandState[]>> = {
  PENDING: ['CONFIRMED', 'FAILED', 'UNKNOWN'],
  UNKNOWN: ['CONFIRMED', 'FAILED', 'UNKNOWN'],
  CONFIRMED: [],
  FAILED: [],
};

export function isTerminalCommandState(state: CommandState): boolean {
  return (COMMAND_TERMINAL_STATES as readonly CommandState[]).includes(state);
}

export function canTransitionCommandState(from: CommandState, to: CommandState): boolean {
  return COMMAND_STATE_TRANSITIONS[from].includes(to);
}

/** Operation modes documented for POST .../operation (values documented, key names UNVERIFIED). */
export const OPERATION_MODES = ['SELF_CONSUMPTION', 'AUTONOMOUS'] as const;
export type OperationMode = (typeof OPERATION_MODES)[number];

// --- audit ----------------------------------------------------------------------------------------------------

/** audit_log.action values the database writes (private.touch_audit allowlist). */
export const AUDIT_ACTIONS = [
  'member.added',
  'member.role_changed',
  'member.removed',
  'invitation.created',
  'invitation.accepted',
  'invitation.revoked',
  'bootstrap.completed',
  'rule.mode_changed',
  'automation.paused',
  'automation.resumed',
  'settings.changed',
  'command.requested',
  'tariff.version_created',
  'tariff.deleted',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTOR_TYPES = ['USER', 'SYSTEM'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
