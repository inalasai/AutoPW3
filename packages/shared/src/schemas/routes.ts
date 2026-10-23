import { z } from 'zod';
import { CostsQuerySchema, CostsResponseSchema } from './accounting';
import {
  AuditListResponseSchema,
  AuditQuerySchema,
  DeleteAccountRequestSchema,
  DeleteHouseholdRequestSchema,
  HouseholdExportResponseSchema,
  MeExportResponseSchema,
} from './api';
import {
  AutomationRuleSchema,
  CreateRuleRequestSchema,
  ExecutionListResponseSchema,
  RuleListResponseSchema,
  UpdateRuleRequestSchema,
} from './automation';
import {
  CommandAcceptedSchema,
  CommandDetailSchema,
  CommandListResponseSchema,
  CommandRequestSchema,
} from './commands';
import { HealthResponseSchema } from './health';
import {
  AcceptInvitationRequestSchema,
  AcceptInvitationResponseSchema,
  AutomationPauseStateSchema,
  ChangeMemberRoleRequestSchema,
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  HouseholdMemberSchema,
  HouseholdSchema,
  HouseholdSettingsViewSchema,
  InvitationListResponseSchema,
  MeResponseSchema,
  MemberListResponseSchema,
  UpdateHouseholdRequestSchema,
  UpdateHouseholdSettingsRequestSchema,
} from './identity';
import { PaginationQuerySchema } from './primitives';
import {
  CapabilitiesResponseSchema,
  ConnectTeslaRequestSchema,
  ConnectTeslaResponseSchema,
  CreateSiteRequestSchema,
  DiscoveredSitesResponseSchema,
  EnergySiteSchema,
  SiteListResponseSchema,
  TeslaLinkStatusSchema,
  UpdateSiteRequestSchema,
} from './sites';
import {
  CreateTariffRequestSchema,
  EndTariffRequestSchema,
  PutPricePointsRequestSchema,
  PutPricePointsResponseSchema,
  TariffListQuerySchema,
  TariffListResponseSchema,
  TariffSchema,
  ValidateTariffResponseSchema,
} from './tariffs';
import {
  DemoEnergySeriesResponseSchema,
  DemoLiveReadingSchema,
  EnergyQuerySchema,
  EnergySeriesResponseSchema,
  LiveReadingSchema,
  PowerQuerySchema,
  PowerSeriesResponseSchema,
} from './telemetry';
import { UuidSchema } from './primitives';
import type { Role } from '../constants/roles';

/**
 * The route table of docs/API_CONTRACT.md section 2 as data: one entry per endpoint with its minimum role, the
 * success status and the request and response schemas. TASK-14 wires handlers to it and derives the
 * route-by-role authorisation tests from it; `routes.test.ts` compares it with the contract document so the two
 * cannot drift. Paths exclude the `/api/v1` base.
 *
 * Access: `public` (no token), `any` (any signed-in user), `member` (READ_ONLY or more), `RW` (READ_WRITE or more),
 * `ADMIN`. The database re-checks every role (RLS and audited functions); this table does not authorise anything.
 */

export const ROUTE_ACCESS = ['public', 'any', 'member', 'RW', 'ADMIN'] as const;
export type RouteAccess = (typeof ROUTE_ACCESS)[number];

/** The lowest household role each access level needs; `null` when no household role applies. */
export const ACCESS_MIN_ROLE: Readonly<Record<RouteAccess, Role | null>> = {
  public: null,
  any: null,
  member: 'READ_ONLY',
  RW: 'READ_WRITE',
  ADMIN: 'ADMIN',
};

export interface RouteSpec {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly access: RouteAccess;
  /** Task that implements the real handler (stubs answer 501 NOT_IMPLEMENTED before). */
  readonly task: string;
  /** Success status code. */
  readonly status: 200 | 201 | 202 | 204 | 302;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  /** `null` = no response body (204 or a redirect). */
  readonly response: z.ZodType | null;
  /** True when the `Idempotency-Key` header is required (commands, invitations). */
  readonly idempotencyKeyRequired?: true;
}

/** Identity helper that checks the shape but keeps each entry's exact schema types (used by 	ypes/routes.ts). */
const route = <const S extends RouteSpec>(spec: S): S => spec;

export const ROUTES = {
  // 2.1 platform and identity
  health: route({
    method: 'GET',
    path: '/health',
    access: 'public',
    task: '14',
    status: 200,
    response: HealthResponseSchema,
  }),
  getMe: route({
    method: 'GET',
    path: '/me',
    access: 'any',
    task: '14',
    status: 200,
    response: MeResponseSchema,
  }),
  leaveHousehold: route({
    method: 'DELETE',
    path: '/me/memberships/{householdId}',
    access: 'any',
    task: '19',
    status: 204,
    response: null,
  }),
  exportMe: route({
    method: 'POST',
    path: '/me/export',
    access: 'any',
    task: '19',
    status: 200,
    response: MeExportResponseSchema,
  }),
  deleteMe: route({
    method: 'DELETE',
    path: '/me',
    access: 'any',
    task: '19',
    status: 204,
    body: DeleteAccountRequestSchema,
    response: null,
  }),

  // 2.2 households, members, invitations, settings
  getHousehold: route({
    method: 'GET',
    path: '/households/{hid}',
    access: 'member',
    task: '14',
    status: 200,
    response: HouseholdSchema,
  }),
  updateHousehold: route({
    method: 'PATCH',
    path: '/households/{hid}',
    access: 'ADMIN',
    task: '19',
    status: 200,
    body: UpdateHouseholdRequestSchema,
    response: HouseholdSchema,
  }),
  listMembers: route({
    method: 'GET',
    path: '/households/{hid}/members',
    access: 'ADMIN',
    task: '14/19',
    status: 200,
    query: PaginationQuerySchema,
    response: MemberListResponseSchema,
  }),
  changeMemberRole: route({
    method: 'PATCH',
    path: '/households/{hid}/members/{userId}',
    access: 'ADMIN',
    task: '14/19',
    status: 200,
    body: ChangeMemberRoleRequestSchema,
    response: HouseholdMemberSchema,
  }),
  removeMember: route({
    method: 'DELETE',
    path: '/households/{hid}/members/{userId}',
    access: 'ADMIN',
    task: '19',
    status: 204,
    response: null,
  }),
  createInvitation: route({
    method: 'POST',
    path: '/households/{hid}/invitations',
    access: 'ADMIN',
    task: '14/19',
    status: 201,
    body: CreateInvitationRequestSchema,
    response: CreateInvitationResponseSchema,
    idempotencyKeyRequired: true,
  }),
  listInvitations: route({
    method: 'GET',
    path: '/households/{hid}/invitations',
    access: 'ADMIN',
    task: '14/19',
    status: 200,
    query: PaginationQuerySchema,
    response: InvitationListResponseSchema,
  }),
  revokeInvitation: route({
    method: 'DELETE',
    path: '/households/{hid}/invitations/{id}',
    access: 'ADMIN',
    task: '14/19',
    status: 204,
    response: null,
  }),
  acceptInvitation: route({
    method: 'POST',
    path: '/invitations/accept',
    access: 'any',
    task: '14/19',
    status: 200,
    body: AcceptInvitationRequestSchema,
    response: AcceptInvitationResponseSchema,
  }),
  getSettings: route({
    method: 'GET',
    path: '/households/{hid}/settings',
    access: 'member',
    task: '14',
    status: 200,
    response: HouseholdSettingsViewSchema,
  }),
  updateSettings: route({
    method: 'PATCH',
    path: '/households/{hid}/settings',
    access: 'ADMIN',
    task: '19',
    status: 200,
    body: UpdateHouseholdSettingsRequestSchema,
    response: HouseholdSettingsViewSchema,
  }),
  pauseAutomation: route({
    method: 'POST',
    path: '/households/{hid}/automation/pause',
    access: 'RW',
    task: '18',
    status: 200,
    response: AutomationPauseStateSchema,
  }),
  resumeAutomation: route({
    method: 'POST',
    path: '/households/{hid}/automation/resume',
    access: 'ADMIN',
    task: '18',
    status: 200,
    response: AutomationPauseStateSchema,
  }),

  // 2.3 sites and Tesla connection
  listSites: route({
    method: 'GET',
    path: '/households/{hid}/sites',
    access: 'member',
    task: '14',
    status: 200,
    query: PaginationQuerySchema,
    response: SiteListResponseSchema,
  }),
  getSite: route({
    method: 'GET',
    path: '/sites/{siteId}',
    access: 'member',
    task: '14',
    status: 200,
    response: EnergySiteSchema,
  }),
  updateSite: route({
    method: 'PATCH',
    path: '/sites/{siteId}',
    access: 'ADMIN',
    task: '19',
    status: 200,
    body: UpdateSiteRequestSchema,
    response: EnergySiteSchema,
  }),
  connectTesla: route({
    method: 'POST',
    path: '/households/{hid}/provider/tesla/connect',
    access: 'ADMIN',
    task: '15',
    status: 200,
    body: ConnectTeslaRequestSchema,
    response: ConnectTeslaResponseSchema,
  }),
  teslaCallback: route({
    method: 'GET',
    path: '/provider/tesla/callback',
    access: 'public',
    task: '15',
    status: 302,
    query: z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(512) }),
    response: null,
  }),
  getTeslaLink: route({
    method: 'GET',
    path: '/households/{hid}/provider/tesla',
    access: 'member',
    task: '15',
    status: 200,
    response: TeslaLinkStatusSchema,
  }),
  listDiscoveredSites: route({
    method: 'GET',
    path: '/households/{hid}/provider/tesla/discovered-sites',
    access: 'ADMIN',
    task: '15',
    status: 200,
    response: DiscoveredSitesResponseSchema,
  }),
  createSite: route({
    method: 'POST',
    path: '/households/{hid}/sites',
    access: 'ADMIN',
    task: '15',
    status: 201,
    body: CreateSiteRequestSchema,
    response: EnergySiteSchema,
  }),
  disconnectTesla: route({
    method: 'DELETE',
    path: '/households/{hid}/provider/tesla',
    access: 'ADMIN',
    task: '15',
    status: 204,
    response: null,
  }),

  // 2.4 telemetry and analytics
  getLive: route({
    method: 'GET',
    path: '/sites/{siteId}/live',
    access: 'member',
    task: '14/16',
    status: 200,
    response: LiveReadingSchema,
  }),
  getPower: route({
    method: 'GET',
    path: '/sites/{siteId}/power',
    access: 'member',
    task: '16',
    status: 200,
    query: PowerQuerySchema,
    response: PowerSeriesResponseSchema,
  }),
  getEnergy: route({
    method: 'GET',
    path: '/sites/{siteId}/energy',
    access: 'member',
    task: '16/13',
    status: 200,
    query: EnergyQuerySchema,
    response: EnergySeriesResponseSchema,
  }),
  getCosts: route({
    method: 'GET',
    path: '/sites/{siteId}/costs',
    access: 'member',
    task: '13/16',
    status: 200,
    query: CostsQuerySchema,
    response: CostsResponseSchema,
  }),
  getDemoLive: route({
    method: 'GET',
    path: '/households/{hid}/demo/live',
    access: 'member',
    task: '14',
    status: 200,
    response: DemoLiveReadingSchema,
  }),
  getDemoEnergy: route({
    method: 'GET',
    path: '/households/{hid}/demo/energy',
    access: 'member',
    task: '14',
    status: 200,
    query: EnergyQuerySchema,
    response: DemoEnergySeriesResponseSchema,
  }),

  // 2.5 tariffs
  listTariffs: route({
    method: 'GET',
    path: '/households/{hid}/tariffs',
    access: 'member',
    task: '14',
    status: 200,
    query: TariffListQuerySchema,
    response: TariffListResponseSchema,
  }),
  getTariff: route({
    method: 'GET',
    path: '/tariffs/{tariffId}',
    access: 'member',
    task: '14',
    status: 200,
    response: TariffSchema,
  }),
  createTariff: route({
    method: 'POST',
    path: '/households/{hid}/tariffs',
    access: 'RW',
    task: '14',
    status: 201,
    body: CreateTariffRequestSchema,
    response: TariffSchema,
  }),
  validateTariff: route({
    method: 'POST',
    path: '/tariffs/{tariffId}/validate',
    access: 'RW',
    task: '14',
    status: 200,
    response: ValidateTariffResponseSchema,
  }),
  endTariff: route({
    method: 'PATCH',
    path: '/tariffs/{tariffId}',
    access: 'RW',
    task: '14',
    status: 200,
    body: EndTariffRequestSchema,
    response: TariffSchema,
  }),
  deleteTariff: route({
    method: 'DELETE',
    path: '/tariffs/{tariffId}',
    access: 'RW',
    task: '14',
    status: 204,
    response: null,
  }),
  putPricePoints: route({
    method: 'PUT',
    path: '/tariffs/{tariffId}/price-points',
    access: 'RW',
    task: '14',
    status: 200,
    body: PutPricePointsRequestSchema,
    response: PutPricePointsResponseSchema,
  }),

  // 2.6 capabilities and commands
  getCapabilities: route({
    method: 'GET',
    path: '/sites/{siteId}/capabilities',
    access: 'member',
    task: '14/15',
    status: 200,
    response: CapabilitiesResponseSchema,
  }),
  createCommand: route({
    method: 'POST',
    path: '/sites/{siteId}/commands',
    access: 'RW',
    task: '14 stub / 17',
    status: 202,
    body: CommandRequestSchema,
    response: CommandAcceptedSchema,
    idempotencyKeyRequired: true,
  }),
  listCommands: route({
    method: 'GET',
    path: '/sites/{siteId}/commands',
    access: 'member',
    task: '14/17',
    status: 200,
    query: PaginationQuerySchema,
    response: CommandListResponseSchema,
  }),
  getCommand: route({
    method: 'GET',
    path: '/commands/{commandId}',
    access: 'member',
    task: '17',
    status: 200,
    response: CommandDetailSchema,
  }),

  // 2.7 automation
  listRules: route({
    method: 'GET',
    path: '/sites/{siteId}/automation/rules',
    access: 'member',
    task: '14/18',
    status: 200,
    query: PaginationQuerySchema,
    response: RuleListResponseSchema,
  }),
  createRule: route({
    method: 'POST',
    path: '/sites/{siteId}/automation/rules',
    access: 'RW',
    task: '14/18',
    status: 201,
    body: CreateRuleRequestSchema,
    response: AutomationRuleSchema,
  }),
  updateRule: route({
    method: 'PATCH',
    path: '/automation/rules/{ruleId}',
    access: 'RW',
    task: '14/18',
    status: 200,
    body: UpdateRuleRequestSchema,
    response: AutomationRuleSchema,
  }),
  activateRule: route({
    method: 'POST',
    path: '/automation/rules/{ruleId}/activate',
    access: 'ADMIN',
    task: '18',
    status: 200,
    response: AutomationRuleSchema,
  }),
  deleteRule: route({
    method: 'DELETE',
    path: '/automation/rules/{ruleId}',
    access: 'RW',
    task: '18',
    status: 204,
    response: null,
  }),
  listExecutions: route({
    method: 'GET',
    path: '/sites/{siteId}/automation/executions',
    access: 'member',
    task: '18',
    status: 200,
    query: PaginationQuerySchema,
    response: ExecutionListResponseSchema,
  }),

  // 2.8 administration, audit, privacy
  listAudit: route({
    method: 'GET',
    path: '/households/{hid}/audit',
    access: 'ADMIN',
    task: '19',
    status: 200,
    query: AuditQuerySchema,
    response: AuditListResponseSchema,
  }),
  exportHousehold: route({
    method: 'POST',
    path: '/households/{hid}/export',
    access: 'ADMIN',
    task: '19',
    status: 200,
    response: HouseholdExportResponseSchema,
  }),
  deleteHousehold: route({
    method: 'DELETE',
    path: '/households/{hid}',
    access: 'ADMIN',
    task: '19',
    status: 204,
    body: DeleteHouseholdRequestSchema,
    response: null,
  }),
} as const satisfies Record<string, RouteSpec>;

export type RouteName = keyof typeof ROUTES;

/** Names in `{braces}` in a route path, in order. */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1] as string);
}

/** Schema for a route's path parameters: every placeholder is a UUID (ids select the resource; never authorise). */
export function pathParamsSchema(path: string) {
  const shape: Record<string, typeof UuidSchema> = {};
  for (const name of pathParamNames(path)) shape[name] = UuidSchema;
  return z.strictObject(shape);
}
