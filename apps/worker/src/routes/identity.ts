import type { IdentityRepository } from '../db/identity-repository';
import { errorResponse, jsonResponse } from '../lib/errors';
import type { VerifiedUser } from '../lib/jwt';
import type { Role } from '@autopw3/shared';

interface InvitationUrlConfig {
  appBaseUrl: string | undefined;
  allowedOrigins: string | undefined;
  environment: string;
}

function buildInvitationUrl(token: string, config: InvitationUrlConfig): string | null {
  const { appBaseUrl, allowedOrigins, environment } = config;

  if (!appBaseUrl || !allowedOrigins) {
    return null;
  }

  try {
    const baseUrl = new URL(appBaseUrl);

    if (
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.pathname !== '/' ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      return null;
    }

    if (environment !== 'local' && environment !== 'test' && baseUrl.protocol !== 'https:') {
      return null;
    }

    const permittedOrigins = allowedOrigins
      .split(',')
      .map((origin) => origin.trim().toLowerCase())
      .filter(Boolean);

    if (!permittedOrigins.includes(baseUrl.origin.toLowerCase())) {
      return null;
    }

    return `${baseUrl.origin}/invite?token=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

export async function handleGetMe(
  user: VerifiedUser,
  repo: IdentityRepository,
  requestId: string,
): Promise<Response> {
  const profile = await repo.getProfile(user.userId);
  const memberships = await repo.getHouseholdMemberships(user.userId);

  return jsonResponse(
    {
      profile: profile ?? {
        userId: user.userId,
        displayName: user.email ?? null,
        locale: 'en-IE',
      },
      memberships: memberships.map((m) => ({
        householdId: m.householdId,
        name: m.name,
        role: m.role,
      })),
    },
    200,
    requestId,
  );
}

export async function handleGetHousehold(
  householdId: string,
  repo: IdentityRepository,
  requestId: string,
): Promise<Response> {
  const hh = await repo.getHousehold(householdId);
  if (!hh) {
    return errorResponse('NOT_FOUND', 'Household not found', requestId);
  }
  return jsonResponse(hh, 200, requestId);
}

export async function handleListMembers(
  householdId: string,
  query: { limit?: number; cursor?: string },
  repo: IdentityRepository,
  requestId: string,
): Promise<Response> {
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const result = await repo.listMembers(householdId, limit, query.cursor);
  return jsonResponse(result, 200, requestId);
}

export async function handleChangeMemberRole(
  householdId: string,
  targetUserId: string,
  body: { role: Role },
  caller: VerifiedUser,
  repo: IdentityRepository,
  requestId: string,
): Promise<Response> {
  const res = await repo.updateMemberRole(householdId, caller.userId, targetUserId, body.role);
  if (!res.success) {
    if (res.error === 'SELF_MODIFICATION') {
      return errorResponse('FORBIDDEN', 'Cannot modify your own role', requestId);
    }
    if (res.error === 'LAST_ADMIN') {
      return errorResponse('CONFLICT', 'Cannot demote the last administrator', requestId);
    }
    return errorResponse('NOT_FOUND', 'Member not found', requestId);
  }
  return jsonResponse(res.member, 200, requestId);
}

export async function handleCreateInvitation(
  householdId: string,
  body: { email?: string; role?: Role; expiresInDays?: number },
  caller: VerifiedUser,
  repo: IdentityRepository,
  config: InvitationUrlConfig,
  requestId: string,
): Promise<Response> {
  // Fail closed before creating an invitation if its public URL cannot be trusted.
  if (!buildInvitationUrl('validation-token', config)) {
    return errorResponse(
      'PROVIDER_UNAVAILABLE',
      'Invitation URL configuration is missing or invalid',
      requestId,
    );
  }

  const expiresInDays = Math.min(Math.max(1, body.expiresInDays ?? 7), 30);
  const role = body.role ?? 'READ_ONLY';
  const email = body.email ?? null;

  const result = await repo.createInvitation(
    householdId,
    caller.userId,
    email,
    role,
    expiresInDays,
  );

  const link = buildInvitationUrl(result.token, config);
  if (!link) {
    return errorResponse(
      'PROVIDER_UNAVAILABLE',
      'Invitation URL configuration is missing or invalid',
      requestId,
    );
  }

  return jsonResponse(
    {
      invitation: result.invitation,
      token: result.token,
      link,
    },
    201,
    requestId,
  );
}

export async function handleListInvitations(
  householdId: string,
  query: { limit?: number; cursor?: string },
  repo: IdentityRepository,
  requestId: string,
): Promise<Response> {
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const result = await repo.listInvitations(householdId, limit, query.cursor);
  return jsonResponse(result, 200, requestId);
}

export async function handleRevokeInvitation(
  householdId: string,
  invitationId: string,
  repo: IdentityRepository,
  requestId: string,
): Promise<Response> {
  const ok = await repo.revokeInvitation(householdId, invitationId);
  if (!ok) {
    return errorResponse('NOT_FOUND', 'Invitation not found', requestId);
  }
  return new Response(null, { status: 204, headers: { 'x-request-id': requestId } });
}

export async function handleAcceptInvitation(
  body: { token: string },
  caller: VerifiedUser,
  repo: IdentityRepository,
  requestId: string,
): Promise<Response> {
  const res = await repo.acceptInvitation(caller.userId, caller.email, body.token);
  if (!res.success) {
    if (res.error === 'EXPIRED') {
      return errorResponse('VALIDATION_FAILED', 'Invitation has expired', requestId);
    }
    if (res.error === 'EMAIL_MISMATCH') {
      return errorResponse('FORBIDDEN', 'Invitation was addressed to a different email', requestId);
    }
    if (res.error === 'ALREADY_MEMBER') {
      return errorResponse('CONFLICT', 'Already a member of this household', requestId);
    }
    return errorResponse('NOT_FOUND', 'Invitation token is invalid or revoked', requestId);
  }
  return jsonResponse(
    {
      householdId: res.householdId,
      role: res.role,
    },
    200,
    requestId,
  );
}

export async function handleGetSettings(
  householdId: string,
  repo: IdentityRepository,
  requestId: string,
): Promise<Response> {
  const settings = await repo.getSettings(householdId);
  if (!settings) {
    return errorResponse('NOT_FOUND', 'Household not found', requestId);
  }
  return jsonResponse(settings, 200, requestId);
}
