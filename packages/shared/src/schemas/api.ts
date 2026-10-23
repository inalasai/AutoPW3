import { z } from 'zod';
import { AUDIT_ACTIONS, AUDIT_ACTOR_TYPES } from '../constants/enums';
import { ERROR_CODES, ERROR_HTTP_STATUS } from '../constants/errors';
import type { ErrorCode } from '../constants/errors';
import { TEXT_LIMITS } from '../constants/limits';
import { MembershipSummarySchema, UserProfileSchema } from './identity';
import { InstantUtcSchema, PaginationQuerySchema, UuidSchema, pageOf } from './primitives';

/** Cross-cutting API shapes: the standard error envelope, audit rows, export and confirmation bodies. */

export const ErrorCodeSchema = z.enum(ERROR_CODES);

/** One field problem. `issue` is a stable code (Zod's issue code), never the submitted value. */
export const ErrorDetailSchema = z.strictObject({
  path: z.string().max(200),
  issue: z.string().min(1).max(64),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

/**
 * The body of every non-2xx response (API contract section 1). `details` appears only for 422 VALIDATION_FAILED.
 * `message` is human-readable and contains no internals. `requestId` equals the `X-Request-Id` header.
 */
export const ErrorResponseSchema = z.strictObject({
  error: z
    .strictObject({
      code: ErrorCodeSchema,
      message: z.string().min(1).max(500),
      requestId: z.string().min(1).max(100),
      details: z.array(ErrorDetailSchema).optional(),
    })
    .refine((e) => e.details === undefined || e.code === 'VALIDATION_FAILED', {
      message: 'details are only allowed with VALIDATION_FAILED',
      path: ['details'],
    }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** Build a contract-shaped error body. */
export function buildErrorResponse(input: {
  code: ErrorCode;
  message: string;
  requestId: string;
  details?: readonly ErrorDetail[];
}): ErrorResponse {
  const base = { code: input.code, message: input.message, requestId: input.requestId };
  return {
    error: input.details === undefined ? base : { ...base, details: [...input.details] },
  };
}

/** HTTP status for an error code (primary status; see ERROR_ALTERNATE_HTTP_STATUS for 503 variants). */
export function httpStatusFor(code: ErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}

/**
 * Convert a Zod validation failure into contract `details`: dotted field path plus Zod's issue code. The submitted
 * value and the free-text message are never copied, so a secret in a rejected body cannot leak into the response.
 */
export function validationDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    issue: issue.code,
  }));
}

// --- audit -----------------------------------------------------------------------------------------------------

/** One audit row (ADMIN only). `metadata` is allowlisted by the database; keys are names, never tokens or telemetry. */
export const AuditEntrySchema = z.strictObject({
  /** bigint in the database, a decimal string in JSON. */
  id: z.string().regex(/^\d+$/),
  action: z.enum(AUDIT_ACTIONS),
  actorType: z.enum(AUDIT_ACTOR_TYPES),
  actorUserId: UuidSchema.nullable(),
  targetType: z.string().max(64).nullable(),
  targetId: z.string().max(200).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  requestId: z.string().max(100).nullable(),
  createdAt: InstantUtcSchema,
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditQuerySchema = z
  .strictObject({
    action: z.enum(AUDIT_ACTIONS).optional(),
    from: InstantUtcSchema.optional(),
    to: InstantUtcSchema.optional(),
    limit: PaginationQuerySchema.shape.limit,
    cursor: PaginationQuerySchema.shape.cursor,
  })
  .refine(
    (q) => q.from === undefined || q.to === undefined || Date.parse(q.to) > Date.parse(q.from),
    {
      message: 'to must be after from',
      path: ['to'],
    },
  );
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export const AuditListResponseSchema = pageOf(AuditEntrySchema);

// --- privacy and export ----------------------------------------------------------------------------------------

/** POST /me/export: the caller's own profile and memberships. Shape proposed in TASK-05 (D-036). */
export const MeExportResponseSchema = z.strictObject({
  exportedAt: InstantUtcSchema,
  profile: UserProfileSchema,
  memberships: z.array(MembershipSummarySchema),
});
export type MeExportResponse = z.infer<typeof MeExportResponseSchema>;

/**
 * POST /households/{hid}/export: bounded JSON, or an async job when large. Proposed in TASK-05; TASK-19 refines it.
 * `data` holds household data only (never tokens, key ids or ciphertext).
 */
export const HouseholdExportResponseSchema = z
  .strictObject({
    status: z.enum(['READY', 'PENDING']),
    requestedAt: InstantUtcSchema,
    data: z.record(z.string(), z.unknown()).nullable(),
  })
  .refine((r) => (r.status === 'READY') === (r.data !== null), {
    message: 'data is present exactly when status is READY',
    path: ['data'],
  });
export type HouseholdExportResponse = z.infer<typeof HouseholdExportResponseSchema>;

/** DELETE /me. Shape proposed in TASK-05: an explicit boolean so a stray request cannot delete an account. */
export const DeleteAccountRequestSchema = z.strictObject({ confirm: z.literal(true) });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequestSchema>;

/** DELETE /households/{hid}: the caller must type the household name (contract section 2.8). */
export const DeleteHouseholdRequestSchema = z.strictObject({
  confirmName: z.string().min(1).max(TEXT_LIMITS.name),
});
export type DeleteHouseholdRequest = z.infer<typeof DeleteHouseholdRequestSchema>;
