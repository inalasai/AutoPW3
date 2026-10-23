import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_CODES, ERROR_HTTP_STATUS } from '../constants/errors';
import {
  AuditEntrySchema,
  DeleteAccountRequestSchema,
  DeleteHouseholdRequestSchema,
  ErrorResponseSchema,
  HouseholdExportResponseSchema,
  buildErrorResponse,
  httpStatusFor,
  validationDetails,
} from './api';
import { ChangeMemberRoleRequestSchema } from './identity';

describe('error envelope', () => {
  it('accepts a code, message and request id', () => {
    const body = buildErrorResponse({
      code: 'FORBIDDEN',
      message: 'Not allowed',
      requestId: 'req-1',
    });
    expect(ErrorResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      error: { code: 'FORBIDDEN', message: 'Not allowed', requestId: 'req-1' },
    });
  });

  it('allows details only with VALIDATION_FAILED', () => {
    const details = [{ path: 'role', issue: 'invalid_value' }];
    expect(
      ErrorResponseSchema.safeParse(
        buildErrorResponse({
          code: 'VALIDATION_FAILED',
          message: 'Invalid',
          requestId: 'r',
          details,
        }),
      ).success,
    ).toBe(true);
    expect(
      ErrorResponseSchema.safeParse(
        buildErrorResponse({ code: 'FORBIDDEN', message: 'No', requestId: 'r', details }),
      ).success,
    ).toBe(false);
  });

  it('rejects an unknown code and a missing request id', () => {
    expect(
      ErrorResponseSchema.safeParse({ error: { code: 'TEAPOT', message: 'x', requestId: 'r' } })
        .success,
    ).toBe(false);
    expect(
      ErrorResponseSchema.safeParse({ error: { code: 'INTERNAL', message: 'x' } }).success,
    ).toBe(false);
    expect(
      ErrorResponseSchema.safeParse({ code: 'INTERNAL', message: 'x', requestId: 'r' }).success,
    ).toBe(false);
  });

  it('maps every code to the contract HTTP status', () => {
    expect(httpStatusFor('UNAUTHENTICATED')).toBe(401);
    expect(httpStatusFor('FORBIDDEN')).toBe(403);
    expect(httpStatusFor('NOT_FOUND')).toBe(404);
    expect(httpStatusFor('CONFLICT')).toBe(409);
    expect(httpStatusFor('PAYLOAD_TOO_LARGE')).toBe(413);
    expect(httpStatusFor('VALIDATION_FAILED')).toBe(422);
    expect(httpStatusFor('RATE_LIMITED')).toBe(429);
    expect(httpStatusFor('NOT_IMPLEMENTED')).toBe(501);
    expect(httpStatusFor('INTERNAL')).toBe(500);
    expect(ERROR_CODES.length).toBe(Object.keys(ERROR_HTTP_STATUS).length);
  });
});

describe('validationDetails', () => {
  it('lists paths and issue codes and never echoes the submitted value', () => {
    const secret = 'super-secret-token-value';
    const result = ChangeMemberRoleRequestSchema.safeParse({ role: secret });
    expect(result.success).toBe(false);
    if (result.success) return;
    const details = validationDetails(result.error);
    expect(details).toEqual([{ path: 'role', issue: 'invalid_value' }]);
    expect(JSON.stringify(details)).not.toContain(secret);
  });

  it('uses dotted paths for nested and array fields', () => {
    const schema = z.strictObject({ items: z.array(z.strictObject({ n: z.number() })) });
    const result = schema.safeParse({ items: [{ n: 1 }, { n: 'x' }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(validationDetails(result.error)).toEqual([{ path: 'items.1.n', issue: 'invalid_type' }]);
  });
});

describe('audit rows', () => {
  const entry = {
    id: '42',
    action: 'member.role_changed',
    actorType: 'USER',
    actorUserId: '3f8b1c2e-9a4d-4e7b-8c11-6d5f0a2b7e90',
    targetType: 'user',
    targetId: 'x',
    metadata: { old_role: 'READ_ONLY', new_role: 'READ_WRITE' },
    requestId: null,
    createdAt: '2026-10-22T10:00:00Z',
  };

  it('accepts a known action and a string id', () => {
    expect(AuditEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('rejects an unknown action, a numeric id and a bad actor type', () => {
    expect(AuditEntrySchema.safeParse({ ...entry, action: 'member.exploded' }).success).toBe(false);
    expect(AuditEntrySchema.safeParse({ ...entry, id: 42 }).success).toBe(false);
    expect(AuditEntrySchema.safeParse({ ...entry, actorType: 'ROBOT' }).success).toBe(false);
  });
});

describe('confirmation bodies and exports', () => {
  it('requires an explicit confirmation to delete an account or a household', () => {
    expect(DeleteAccountRequestSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(DeleteAccountRequestSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(DeleteAccountRequestSchema.safeParse({}).success).toBe(false);
    expect(DeleteHouseholdRequestSchema.safeParse({ confirmName: 'Home' }).success).toBe(true);
    expect(DeleteHouseholdRequestSchema.safeParse({ confirmName: '' }).success).toBe(false);
  });

  it('carries export data exactly when it is ready', () => {
    const at = '2026-10-22T10:00:00Z';
    expect(
      HouseholdExportResponseSchema.safeParse({
        status: 'READY',
        requestedAt: at,
        data: { households: [] },
      }).success,
    ).toBe(true);
    expect(
      HouseholdExportResponseSchema.safeParse({ status: 'PENDING', requestedAt: at, data: null })
        .success,
    ).toBe(true);
    expect(
      HouseholdExportResponseSchema.safeParse({ status: 'PENDING', requestedAt: at, data: {} })
        .success,
    ).toBe(false);
    expect(
      HouseholdExportResponseSchema.safeParse({ status: 'READY', requestedAt: at, data: null })
        .success,
    ).toBe(false);
  });
});
