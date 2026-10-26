import type { Repository } from '../db/repository';
import { errorResponse, jsonResponse } from '../lib/errors';
import type { VerifiedUser } from '../lib/jwt';
import type { Role } from '@autopw3/shared';

export async function handleGetMe(
  user: VerifiedUser,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const memberships = await repo.getHouseholdMemberships(user.userId);
  return jsonResponse(
    {
      profile: {
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
  repo: Repository,
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
  repo: Repository,
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
  repo: Repository,
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
  repo: Repository,
  requestId: string,
): Promise<Response> {
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
  return jsonResponse(
    {
      invitation: result.invitation,
      token: result.token,
      link: result.link,
    },
    201,
    requestId,
  );
}

export async function handleListInvitations(
  householdId: string,
  query: { limit?: number; cursor?: string },
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const result = await repo.listInvitations(householdId, limit, query.cursor);
  return jsonResponse(result, 200, requestId);
}

export async function handleRevokeInvitation(
  householdId: string,
  invitationId: string,
  repo: Repository,
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
  repo: Repository,
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
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const settings = await repo.getSettings(householdId);
  if (!settings) {
    return errorResponse('NOT_FOUND', 'Household not found', requestId);
  }
  return jsonResponse(settings, 200, requestId);
}
