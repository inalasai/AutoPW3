import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE, HealthResponseSchema, ROLES } from './index';

describe('roles', () => {
  it('defines exactly the three household roles', () => {
    expect(ROLES).toEqual(['READ_ONLY', 'READ_WRITE', 'ADMIN']);
  });

  it('defaults to the least privileged role', () => {
    expect(DEFAULT_ROLE).toBe('READ_ONLY');
  });
});

describe('HealthResponseSchema', () => {
  it('accepts the minimal health body', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok' }).success).toBe(true);
  });

  it('rejects extra fields so config or versions cannot leak', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok', version: '1.2.3' }).success).toBe(false);
  });
});
