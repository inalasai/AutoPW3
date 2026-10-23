/**
 * Numeric limits from docs/API_CONTRACT.md section 1 and the database CHECK constraints. One place, so the Worker,
 * the web app and the tests agree.
 */

export const PAGINATION = { defaultLimit: 50, maxLimit: 200, maxCursorLength: 512 } as const;

/** Request body caps in bytes (413 above). */
export const BODY_LIMITS_BYTES = {
  default: 64 * 1024,
  priceUpload: 1024 * 1024,
} as const;

/** Maximum range per resolution in days (contract section 1). Ranges are half-open [from, to). */
export const MAX_RANGE_DAYS = {
  power: 7,
  interval: 31,
  hourly: 92,
  daily: 1100,
  costsDay: 1100,
  costsMonth: 1100,
} as const;

export const MAX_PRICE_POINTS_PER_CALL = 5000;

/** `Idempotency-Key` header: 8 to 128 characters of [A-Za-z0-9_-] (also a database CHECK). */
export const IDEMPOTENCY_KEY = {
  minLength: 8,
  maxLength: 128,
  pattern: /^[A-Za-z0-9_-]{8,128}$/,
} as const;

export const INVITATION = {
  defaultExpiresInDays: 7,
  maxExpiresInDays: 30,
  /** Token is 256 random bits as 64 lowercase hex characters (D-033). */
  tokenPattern: /^[0-9a-f]{64}$/,
} as const;

export const TEXT_LIMITS = {
  name: 100,
  displayName: 100,
  label: 100,
  providerSiteId: 100,
  reason: 500,
} as const;

/** Household settings bounds (household_settings CHECK constraints). */
export const SETTINGS_BOUNDS = {
  liveBackgroundIntervalMinutesMin: 5,
  liveOnDemandMinIntervalSecondsMin: 30,
  rawRetentionDaysMin: 7,
} as const;

/** Limits on a tariff payload so one request cannot be unbounded. Proposals, tunable. */
export const TARIFF_LIMITS = {
  maxSeasons: 12,
  maxOverrides: 50,
  maxSlotsPerSchedule: 48,
  maxLevies: 20,
} as const;

/** Limits on an automation rule definition. Proposals, tunable by TASK-18. */
export const RULE_LIMITS = { maxConditions: 10, maxActions: 5, maxPriority: 10000 } as const;

export const MINUTES_PER_DAY = 1440;
