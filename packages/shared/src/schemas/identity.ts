import { z } from 'zod';
import { ROLES } from '../constants/roles';
import { INVITATION, SETTINGS_BOUNDS, TEXT_LIMITS } from '../constants/limits';
import { BUDGET_STATES } from '../constants/enums';
import { SpendAmountStringSchema } from './decimal';
import {
  IanaTimezoneSchema,
  InstantUtcSchema,
  UuidSchema,
  boundedText,
  pageOf,
} from './primitives';

/** Users, households, membership, invitations and settings (API contract sections 2.1 and 2.2). */

export const RoleSchema = z.enum(ROLES);

/** Locale tag such as `en-IE` (user_profiles.locale CHECK). */
export const LocaleSchema = z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

export const UserProfileSchema = z.strictObject({
  userId: UuidSchema,
  displayName: z.string().min(1).max(TEXT_LIMITS.displayName).nullable(),
  locale: LocaleSchema.nullable(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UpdateProfileRequestSchema = z
  .strictObject({
    displayName: boundedText(TEXT_LIMITS.displayName).nullable().optional(),
    locale: LocaleSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const HouseholdSchema = z.strictObject({
  id: UuidSchema,
  name: z.string().min(1).max(TEXT_LIMITS.name),
  timezone: IanaTimezoneSchema,
});
export type Household = z.infer<typeof HouseholdSchema>;

export const UpdateHouseholdRequestSchema = z
  .strictObject({
    name: boundedText(TEXT_LIMITS.name).optional(),
    timezone: IanaTimezoneSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type UpdateHouseholdRequest = z.infer<typeof UpdateHouseholdRequestSchema>;

/** One membership of the caller: GET /me. Empty array for a new user (no household, no role). */
export const MembershipSummarySchema = z.strictObject({
  householdId: UuidSchema,
  name: z.string().min(1).max(TEXT_LIMITS.name),
  role: RoleSchema,
});
export type MembershipSummary = z.infer<typeof MembershipSummarySchema>;

export const MeResponseSchema = z.strictObject({
  profile: UserProfileSchema,
  memberships: z.array(MembershipSummarySchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** A member as an ADMIN sees them: GET /households/{hid}/members. */
export const HouseholdMemberSchema = z.strictObject({
  userId: UuidSchema,
  displayName: z.string().min(1).max(TEXT_LIMITS.displayName).nullable(),
  role: RoleSchema,
  createdAt: InstantUtcSchema,
});
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

export const MemberListResponseSchema = pageOf(HouseholdMemberSchema);

/** PATCH /households/{hid}/members/{userId}. Changing your own role is refused by the server (403). */
export const ChangeMemberRoleRequestSchema = z.strictObject({ role: RoleSchema });
export type ChangeMemberRoleRequest = z.infer<typeof ChangeMemberRoleRequestSchema>;

/** Invitation token: 256 random bits as 64 lowercase hex characters. Shown once, stored only as a hash. */
export const InvitationTokenSchema = z.string().regex(INVITATION.tokenPattern);

export const CreateInvitationRequestSchema = z.strictObject({
  email: z.email().max(254).optional(),
  role: RoleSchema.default('READ_ONLY'),
  expiresInDays: z
    .int()
    .min(1)
    .max(INVITATION.maxExpiresInDays)
    .default(INVITATION.defaultExpiresInDays),
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

/** A listed invitation. It never carries a token (the database does not even grant the hash). */
export const InvitationSchema = z.strictObject({
  id: UuidSchema,
  email: z.string().nullable(),
  role: RoleSchema,
  expiresAt: InstantUtcSchema,
  acceptedAt: InstantUtcSchema.nullable(),
  revokedAt: InstantUtcSchema.nullable(),
  createdAt: InstantUtcSchema,
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const InvitationListResponseSchema = pageOf(InvitationSchema);

/**
 * Response to POST /households/{hid}/invitations. The token and link appear only on the first response. An
 * idempotent replay (same key, same body) returns the invitation with `token` and `link` null, because the token
 * exists nowhere but in that first response (D-036, decision 2 of TASK-05).
 */
export const CreateInvitationResponseSchema = z.strictObject({
  invitation: InvitationSchema,
  token: InvitationTokenSchema.nullable(),
  link: z.url().nullable(),
});
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponseSchema>;

export const AcceptInvitationRequestSchema = z.strictObject({ token: InvitationTokenSchema });
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;

export const AcceptInvitationResponseSchema = z.strictObject({
  householdId: UuidSchema,
  role: RoleSchema,
});
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponseSchema>;

// --- settings -------------------------------------------------------------------------------------------------

/** Estimated monthly provider spend against the cap (never a bill). */
export const BudgetStatusSchema = z.strictObject({
  state: z.enum(BUDGET_STATES),
  spentUsd: SpendAmountStringSchema.nullable(),
  capUsd: SpendAmountStringSchema,
});
export type BudgetStatus = z.infer<typeof BudgetStatusSchema>;

/** GET /households/{hid}/settings: the non-sensitive subset every member may read. */
export const HouseholdSettingsViewSchema = z.strictObject({
  staleAfterSeconds: z.int().positive(),
  automationPaused: z.boolean(),
  controlsEnabled: z.boolean(),
  budget: BudgetStatusSchema,
});
export type HouseholdSettingsView = z.infer<typeof HouseholdSettingsViewSchema>;

/**
 * PATCH /households/{hid}/settings (ADMIN). `controlsEnabled: true` also needs re-consent for the `energy_cmds`
 * scope (D-006); that is enforced by the Worker. When both are present the same cross-field rule as the database
 * applies: staleAfterSeconds must exceed the background interval.
 */
export const UpdateHouseholdSettingsRequestSchema = z
  .strictObject({
    monthlySpendCapUsd: SpendAmountStringSchema.optional(),
    liveBackgroundIntervalMinutes: z
      .int()
      .min(SETTINGS_BOUNDS.liveBackgroundIntervalMinutesMin)
      .optional(),
    liveOnDemandMinIntervalSeconds: z
      .int()
      .min(SETTINGS_BOUNDS.liveOnDemandMinIntervalSecondsMin)
      .optional(),
    onDemandMonthlyAllowance: z.int().min(0).optional(),
    rawRetentionDays: z.int().min(SETTINGS_BOUNDS.rawRetentionDaysMin).optional(),
    staleAfterSeconds: z.int().positive().optional(),
    controlsEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' })
  .refine(
    (v) =>
      v.staleAfterSeconds === undefined ||
      v.liveBackgroundIntervalMinutes === undefined ||
      v.staleAfterSeconds > v.liveBackgroundIntervalMinutes * 60,
    {
      message: 'staleAfterSeconds must be greater than liveBackgroundIntervalMinutes * 60',
      path: ['staleAfterSeconds'],
    },
  );
export type UpdateHouseholdSettingsRequest = z.infer<typeof UpdateHouseholdSettingsRequestSchema>;

/** POST .../automation/pause and .../resume return the resulting state. */
export const AutomationPauseStateSchema = z.strictObject({
  automationPaused: z.boolean(),
  pausedAt: InstantUtcSchema.nullable(),
});
export type AutomationPauseState = z.infer<typeof AutomationPauseStateSchema>;
