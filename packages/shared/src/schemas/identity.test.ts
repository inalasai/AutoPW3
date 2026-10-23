import { describe, expect, it } from 'vitest';
import {
  AcceptInvitationRequestSchema,
  ChangeMemberRoleRequestSchema,
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  HouseholdMemberSchema,
  HouseholdSchema,
  MeResponseSchema,
  RoleSchema,
  UpdateHouseholdRequestSchema,
  UpdateHouseholdSettingsRequestSchema,
} from './identity';

const uuid = '3f8b1c2e-9a4d-4e7b-8c11-6d5f0a2b7e90';
const token = 'a'.repeat(64);

describe('RoleSchema', () => {
  it('accepts exactly the three roles', () => {
    for (const r of ['READ_ONLY', 'READ_WRITE', 'ADMIN'])
      expect(RoleSchema.safeParse(r).success).toBe(true);
  });

  it('rejects a bad role', () => {
    for (const r of ['OWNER', 'admin', 'Admin', 'SUPERUSER', '', null, 3]) {
      expect(RoleSchema.safeParse(r).success).toBe(false);
    }
  });
});

describe('role change request', () => {
  it('requires a valid role and nothing else', () => {
    expect(ChangeMemberRoleRequestSchema.safeParse({ role: 'ADMIN' }).success).toBe(true);
    expect(ChangeMemberRoleRequestSchema.safeParse({ role: 'ROOT' }).success).toBe(false);
    expect(ChangeMemberRoleRequestSchema.safeParse({ role: 'ADMIN', userId: uuid }).success).toBe(
      false,
    );
    expect(ChangeMemberRoleRequestSchema.safeParse({}).success).toBe(false);
  });

  it('does not let a request body name a household or user to act as', () => {
    // Ids in bodies are never trusted for authorisation, so a body that carries one is rejected outright.
    expect(
      ChangeMemberRoleRequestSchema.safeParse({ role: 'READ_ONLY', householdId: uuid }).success,
    ).toBe(false);
  });
});

describe('invitation requests', () => {
  it('defaults to READ_ONLY and seven days', () => {
    expect(CreateInvitationRequestSchema.parse({})).toEqual({
      role: 'READ_ONLY',
      expiresInDays: 7,
    });
  });

  it('accepts an email, a higher role and up to 30 days', () => {
    const v = CreateInvitationRequestSchema.parse({
      email: 'a@example.com',
      role: 'READ_WRITE',
      expiresInDays: 30,
    });
    expect(v.role).toBe('READ_WRITE');
  });

  it('rejects 0 or 31 days, a fraction, a bad email and a bad role', () => {
    for (const body of [
      { expiresInDays: 0 },
      { expiresInDays: 31 },
      { expiresInDays: 1.5 },
      { email: 'not-an-email' },
      { role: 'OWNER' },
    ]) {
      expect(CreateInvitationRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it('accepts only a 64-character lowercase hex token', () => {
    expect(AcceptInvitationRequestSchema.safeParse({ token }).success).toBe(true);
    for (const t of ['short', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(65), '']) {
      expect(AcceptInvitationRequestSchema.safeParse({ token: t }).success).toBe(false);
    }
  });

  it('allows the token only on the first response; a replay returns it as null', () => {
    const invitation = {
      id: uuid,
      email: null,
      role: 'READ_ONLY',
      expiresAt: '2026-10-30T10:00:00Z',
      acceptedAt: null,
      revokedAt: null,
      createdAt: '2026-10-23T10:00:00Z',
    };
    expect(
      CreateInvitationResponseSchema.safeParse({
        invitation,
        token,
        link: 'https://app.example.com/join?t=x',
      }).success,
    ).toBe(true);
    expect(
      CreateInvitationResponseSchema.safeParse({ invitation, token: null, link: null }).success,
    ).toBe(true);
  });

  it('never lists a token or its hash on an invitation', () => {
    const response = {
      invitation: {
        id: uuid,
        email: null,
        role: 'READ_ONLY',
        expiresAt: '2026-10-30T10:00:00Z',
        acceptedAt: null,
        revokedAt: null,
        createdAt: '2026-10-23T10:00:00Z',
        tokenHash: 'deadbeef',
      },
      token: null,
      link: null,
    };
    expect(CreateInvitationResponseSchema.safeParse(response).success).toBe(false);
  });
});

describe('household and /me', () => {
  it('rejects a malformed timezone and a blank name', () => {
    expect(
      HouseholdSchema.safeParse({ id: uuid, name: 'Home', timezone: 'Europe/Dublin' }).success,
    ).toBe(true);
    expect(
      HouseholdSchema.safeParse({ id: uuid, name: 'Home', timezone: 'Europe/Dubln' }).success,
    ).toBe(false);
    expect(
      HouseholdSchema.safeParse({ id: uuid, name: '', timezone: 'Europe/Dublin' }).success,
    ).toBe(false);
    expect(UpdateHouseholdRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateHouseholdRequestSchema.safeParse({ timezone: '+01:00' }).success).toBe(false);
  });

  it('gives a new user an empty membership list', () => {
    const me = { profile: { userId: uuid, displayName: null, locale: null }, memberships: [] };
    expect(MeResponseSchema.safeParse(me).success).toBe(true);
  });

  it('rejects a membership with a bad role', () => {
    const me = {
      profile: { userId: uuid, displayName: 'A', locale: 'en-IE' },
      memberships: [{ householdId: uuid, name: 'Home', role: 'GOD' }],
    };
    expect(MeResponseSchema.safeParse(me).success).toBe(false);
  });

  it('describes a member with a role and a join time', () => {
    const m = {
      userId: uuid,
      displayName: null,
      role: 'READ_ONLY',
      createdAt: '2026-10-23T10:00:00Z',
    };
    expect(HouseholdMemberSchema.safeParse(m).success).toBe(true);
    expect(HouseholdMemberSchema.safeParse({ ...m, createdAt: '23 Oct' }).success).toBe(false);
  });
});

describe('settings update', () => {
  it('needs at least one field', () => {
    expect(UpdateHouseholdSettingsRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateHouseholdSettingsRequestSchema.safeParse({ controlsEnabled: true }).success).toBe(
      true,
    );
  });

  it('applies the database bounds', () => {
    for (const body of [
      { liveBackgroundIntervalMinutes: 4 },
      { liveOnDemandMinIntervalSeconds: 29 },
      { rawRetentionDays: 6 },
      { staleAfterSeconds: 0 },
      { onDemandMonthlyAllowance: -1 },
    ]) {
      expect(UpdateHouseholdSettingsRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it('requires the spend cap to be a two-decimal string, not a number', () => {
    expect(
      UpdateHouseholdSettingsRequestSchema.safeParse({ monthlySpendCapUsd: '9.00' }).success,
    ).toBe(true);
    expect(UpdateHouseholdSettingsRequestSchema.safeParse({ monthlySpendCapUsd: 9 }).success).toBe(
      false,
    );
  });

  it('keeps the stale threshold above the background interval when both are sent', () => {
    expect(
      UpdateHouseholdSettingsRequestSchema.safeParse({
        liveBackgroundIntervalMinutes: 30,
        staleAfterSeconds: 1800,
      }).success,
    ).toBe(false);
    expect(
      UpdateHouseholdSettingsRequestSchema.safeParse({
        liveBackgroundIntervalMinutes: 30,
        staleAfterSeconds: 3600,
      }).success,
    ).toBe(true);
  });
});
