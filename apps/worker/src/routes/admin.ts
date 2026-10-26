import type {
  AuditQuery,
  DeleteAccountRequest,
  DeleteHouseholdRequest,
  UpdateHouseholdRequest,
  UpdateHouseholdSettingsRequest,
  UpdateSiteRequest,
} from '@autopw3/shared';
import type { Repository } from '../db/repository';
import { errorResponse, jsonResponse } from '../lib/errors';
import type { VerifiedUser } from '../lib/jwt';

export async function handleListAudit(
  householdId: string,
  query: AuditQuery,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const result = await repo.listAudit(householdId, query);
  return jsonResponse(result, 200, requestId);
}

export async function handleRemoveMember(
  householdId: string,
  targetUserId: string,
  caller: VerifiedUser,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const res = await repo.removeMember(householdId, caller.userId, targetUserId);
  if (!res.success) {
    if (res.error === 'SELF_MODIFICATION') {
      return errorResponse(
        'FORBIDDEN',
        'Cannot remove yourself via this endpoint; use leave household',
        requestId,
      );
    }
    if (res.error === 'LAST_ADMIN') {
      return errorResponse(
        'CONFLICT',
        'Cannot remove the last administrator of the household',
        requestId,
      );
    }
    return errorResponse('NOT_FOUND', 'Member not found', requestId);
  }

  await repo.recordAuditEvent(householdId, {
    action: 'member.removed',
    actorType: 'USER',
    actorUserId: caller.userId,
    targetType: 'user',
    targetId: targetUserId,
    metadata: {},
    requestId,
  });

  return new Response(null, { status: 204, headers: { 'x-request-id': requestId } });
}

export async function handleUpdateSettings(
  householdId: string,
  body: UpdateHouseholdSettingsRequest,
  caller: VerifiedUser,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const settings = await repo.updateSettings(householdId, body);
  if (!settings) {
    return errorResponse('NOT_FOUND', 'Household not found', requestId);
  }

  await repo.recordAuditEvent(householdId, {
    action: 'settings.changed',
    actorType: 'USER',
    actorUserId: caller.userId,
    targetType: 'household',
    targetId: householdId,
    metadata: { updatedFields: Object.keys(body) },
    requestId,
  });

  return jsonResponse(settings, 200, requestId);
}

export async function handleUpdateHousehold(
  householdId: string,
  body: UpdateHouseholdRequest,
  caller: VerifiedUser,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const hh = await repo.updateHousehold(householdId, body);
  if (!hh) {
    return errorResponse('NOT_FOUND', 'Household not found', requestId);
  }

  await repo.recordAuditEvent(householdId, {
    action: 'settings.changed',
    actorType: 'USER',
    actorUserId: caller.userId,
    targetType: 'household',
    targetId: householdId,
    metadata: { updatedFields: Object.keys(body) },
    requestId,
  });

  return jsonResponse(hh, 200, requestId);
}

export async function handleUpdateSite(
  siteId: string,
  body: UpdateSiteRequest,
  caller: VerifiedUser,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.updateSite(siteId, body);
  if (!site) {
    return errorResponse('NOT_FOUND', 'Site not found', requestId);
  }

  const householdId = await repo.getHouseholdIdForSite(siteId);
  if (householdId) {
    await repo.recordAuditEvent(householdId, {
      action: 'settings.changed',
      actorType: 'USER',
      actorUserId: caller.userId,
      targetType: 'site',
      targetId: siteId,
      metadata: { updatedFields: Object.keys(body) },
      requestId,
    });
  }

  return jsonResponse(site, 200, requestId);
}

export async function handleExportHousehold(
  householdId: string,
  _caller: VerifiedUser,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const exportData = await repo.exportHouseholdData(householdId);
  return jsonResponse(exportData, 200, requestId);
}

export async function handleDeleteHousehold(
  householdId: string,
  body: DeleteHouseholdRequest,
  _caller: VerifiedUser,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const res = await repo.deleteHousehold(householdId, body.confirmName);
  if (!res.success) {
    if (res.error === 'NAME_MISMATCH') {
      return errorResponse(
        'VALIDATION_FAILED',
        'Confirmation household name does not match',
        requestId,
        [{ path: 'confirmName', issue: 'custom' }],
      );
    }
    return errorResponse('NOT_FOUND', 'Household not found', requestId);
  }

  return new Response(null, { status: 204, headers: { 'x-request-id': requestId } });
}

export async function handleExportMe(
  caller: VerifiedUser,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const meExport = await repo.exportMe(caller.userId);
  return jsonResponse(meExport, 200, requestId);
}

export async function handleDeleteMe(
  _body: DeleteAccountRequest,
  caller: VerifiedUser,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const res = await repo.deleteAccount(caller.userId);
  if (!res.success) {
    if (res.error === 'LAST_ADMIN') {
      return errorResponse(
        'CONFLICT',
        'Cannot delete account while you are the last administrator of a household with other members',
        requestId,
      );
    }
    return errorResponse('VALIDATION_FAILED', 'Account deletion failed', requestId);
  }

  return new Response(null, { status: 204, headers: { 'x-request-id': requestId } });
}

export async function handleLeaveHousehold(
  householdId: string,
  caller: VerifiedUser,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const res = await repo.leaveHousehold(householdId, caller.userId);
  if (!res.success) {
    if (res.error === 'LAST_ADMIN') {
      return errorResponse(
        'CONFLICT',
        'Cannot leave household as the last administrator',
        requestId,
      );
    }
    return errorResponse('NOT_FOUND', 'Membership not found', requestId);
  }

  await repo.recordAuditEvent(householdId, {
    action: 'member.removed',
    actorType: 'USER',
    actorUserId: caller.userId,
    targetType: 'user',
    targetId: caller.userId,
    metadata: { reason: 'left_voluntarily' },
    requestId,
  });

  return new Response(null, { status: 204, headers: { 'x-request-id': requestId } });
}
