/**
 * Stable API error codes (docs/API_CONTRACT.md section 1). Codes never change meaning; clients switch on them.
 * `METHOD_NOT_ALLOWED` (405) is an additive code introduced by TASK-05 (D-036): the TASK-02 Worker stub
 * already returned it and the contract did not list it.
 */
export const ERROR_HTTP_STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  NOT_IMPLEMENTED: 501,
  PROVIDER_UNAVAILABLE: 502,
  BUDGET_EXHAUSTED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export const ERROR_CODES = Object.keys(ERROR_HTTP_STATUS) as [ErrorCode, ...ErrorCode[]];

/**
 * Codes that may also be returned with another status. `PROVIDER_UNAVAILABLE` is 502 or 503 and
 * `BUDGET_EXHAUSTED` is 429 or 503 (contract section 1). The primary status is in ERROR_HTTP_STATUS.
 */
export const ERROR_ALTERNATE_HTTP_STATUS: Readonly<Partial<Record<ErrorCode, readonly number[]>>> =
  {
    PROVIDER_UNAVAILABLE: [502, 503],
    BUDGET_EXHAUSTED: [429, 503],
  };

/**
 * Fixed messages raised by the database functions and triggers (supabase/migrations 8 to 11) and the API error
 * each maps to. The Worker (TASK-14) must translate by these messages, never by forwarding database text.
 * Mapping choices that the contract does not state are proposals for TASK-14 to confirm.
 */
export const DB_ERROR_TO_API_ERROR = {
  not_authorised: 'FORBIDDEN',
  self_change_not_allowed: 'FORBIDDEN',
  last_admin_protected: 'CONFLICT',
  already_member: 'CONFLICT',
  immutable_key: 'VALIDATION_FAILED',
  tariff_version_immutable: 'CONFLICT',
  invalid_argument: 'VALIDATION_FAILED',
  invalid_invitation: 'NOT_FOUND',
  member_not_found: 'NOT_FOUND',
  not_found: 'NOT_FOUND',
  bootstrap_already_completed: 'CONFLICT',
  bootstrap_not_allowed: 'FORBIDDEN',
  bootstrap_user_not_found: 'NOT_FOUND',
} as const satisfies Readonly<Record<string, ErrorCode>>;

export type DbErrorMessage = keyof typeof DB_ERROR_TO_API_ERROR;
