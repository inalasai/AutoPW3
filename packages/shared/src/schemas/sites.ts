import { z } from 'zod';
import { CAPABILITIES } from '../constants/capabilities';
import {
  CAPABILITY_STATUSES,
  PROVIDERS,
  SITE_CONNECTION_STATES,
  TESLA_LINK_STATES,
} from '../constants/enums';
import { TEXT_LIMITS } from '../constants/limits';
import {
  IanaTimezoneSchema,
  InstantUtcSchema,
  UuidSchema,
  boundedText,
  pageOf,
} from './primitives';

/** Energy sites, device capabilities and the Tesla link (API contract sections 2.3 and 2.6). */

export const ProviderSchema = z.enum(PROVIDERS);
export const SiteConnectionStateSchema = z.enum(SITE_CONNECTION_STATES);
export const CapabilityIdSchema = z.enum(CAPABILITIES);
export const CapabilityStatusSchema = z.enum(CAPABILITY_STATUSES);

/** One registry answer. `reason` says why a capability is not SUPPORTED; it is required then (never a bare no). */
export const CapabilityEntrySchema = z
  .strictObject({
    capability: CapabilityIdSchema,
    status: CapabilityStatusSchema,
    reason: z.string().min(1).max(TEXT_LIMITS.reason).nullable(),
  })
  .refine((c) => c.status === 'SUPPORTED' || c.reason !== null, {
    message: 'reason is required unless the capability is SUPPORTED',
    path: ['reason'],
  });
export type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;

export const CapabilitiesResponseSchema = z
  .strictObject({ items: z.array(CapabilityEntrySchema) })
  .refine((r) => new Set(r.items.map((i) => i.capability)).size === r.items.length, {
    message: 'each capability may appear once',
    path: ['items'],
  });
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

/** Counts only: the full registry is GET /sites/{id}/capabilities. */
export const CapabilitiesSummarySchema = z.strictObject({
  supported: z.int().min(0),
  unverified: z.int().min(0),
  notSupported: z.int().min(0),
  disabledBySetting: z.int().min(0),
});
export type CapabilitiesSummary = z.infer<typeof CapabilitiesSummarySchema>;

/** A site as the API returns it. The provider's own site id is not returned (contract section 2.3). */
export const EnergySiteSchema = z.strictObject({
  id: UuidSchema,
  name: z.string().min(1).max(TEXT_LIMITS.name).nullable(),
  timezone: IanaTimezoneSchema,
  connectionState: SiteConnectionStateSchema,
  provider: ProviderSchema,
  capabilitiesSummary: CapabilitiesSummarySchema,
});
export type EnergySite = z.infer<typeof EnergySiteSchema>;

export const SiteListResponseSchema = pageOf(EnergySiteSchema);

/**
 * POST /households/{hid}/sites. `timezone` is optional: when omitted the Worker uses the household timezone and
 * says so in the response (decision 1 of TASK-05, D-036), because energy_sites.timezone is NOT NULL.
 */
export const CreateSiteRequestSchema = z.strictObject({
  provider: ProviderSchema,
  providerSiteId: z.string().trim().min(1).max(TEXT_LIMITS.providerSiteId),
  name: boundedText(TEXT_LIMITS.name).optional(),
  timezone: IanaTimezoneSchema.optional(),
});
export type CreateSiteRequest = z.infer<typeof CreateSiteRequestSchema>;

/** PATCH /sites/{siteId}: `name` only (contract section 2.3). */
export const UpdateSiteRequestSchema = z.strictObject({ name: boundedText(TEXT_LIMITS.name) });
export type UpdateSiteRequest = z.infer<typeof UpdateSiteRequestSchema>;

// --- Tesla link ------------------------------------------------------------------------------------------------

export const TeslaLinkStateSchema = z.enum(TESLA_LINK_STATES);

/** GET /households/{hid}/provider/tesla. Never contains tokens, key ids or ciphertext. */
export const TeslaLinkStatusSchema = z.strictObject({
  state: TeslaLinkStateSchema,
  scopes: z.array(z.string().min(1).max(100)).max(50),
  lastRefreshAt: InstantUtcSchema.nullable(),
});
export type TeslaLinkStatus = z.infer<typeof TeslaLinkStatusSchema>;

export const ConnectTeslaRequestSchema = z.strictObject({
  enableControls: z.boolean().optional(),
});
export type ConnectTeslaRequest = z.infer<typeof ConnectTeslaRequestSchema>;

export const ConnectTeslaResponseSchema = z.strictObject({ authorizeUrl: z.url() });
export type ConnectTeslaResponse = z.infer<typeof ConnectTeslaResponseSchema>;

/** A site found on the Tesla account but not yet added. Id and name only (contract section 2.3). */
export const DiscoveredSiteSchema = z.strictObject({
  providerSiteId: z.string().min(1).max(TEXT_LIMITS.providerSiteId),
  name: z.string().min(1).max(TEXT_LIMITS.name).nullable(),
});
export type DiscoveredSite = z.infer<typeof DiscoveredSiteSchema>;

export const DiscoveredSitesResponseSchema = z.strictObject({
  items: z.array(DiscoveredSiteSchema),
});
export type DiscoveredSitesResponse = z.infer<typeof DiscoveredSitesResponseSchema>;
