import type { SiteCapabilityItem } from '../../db/repository';
import type { TeslaRawSiteInfo } from './raw-types';

export type CapabilityName =
  | 'storm_mode'
  | 'backup_reserve'
  | 'operational_mode'
  | 'grid_charging'
  | 'export_rule'
  | 'island_mode'
  | 'forced_charge'
  | 'forced_export'
  | 'solar_bypass'
  | 'off_grid_vehicle_charging_reserve';

export interface EvaluatedCapability {
  readonly capability: CapabilityName;
  readonly status: 'SUPPORTED' | 'UNVERIFIED' | 'NOT_SUPPORTED' | 'DISABLED_BY_SETTING';
  readonly reason: string | null;
  readonly docReference: string;
}

/**
 * Evaluates the full capability matrix for a Tesla Energy site given its `site_info` payload.
 *
 * Rules:
 * 1. Forced charging, forced export, solar bypass, and islanding are NOT_SUPPORTED per D-003.
 * 2. Storm mode is SUPPORTED only if `storm_mode_capable === true` in site_info.
 * 3. Default for unknown commands is NOT_SUPPORTED.
 */
export function evaluateSiteCapabilities(
  siteInfo?: TeslaRawSiteInfo,
): readonly EvaluatedCapability[] {
  const isStormCapable = siteInfo?.['storm_mode_capable'] === true;
  const isStormDisabled = siteInfo?.['storm_mode_capable'] === false;

  return [
    {
      capability: 'backup_reserve',
      status: 'SUPPORTED',
      reason: 'Controlled via POST /api/1/energy_sites/{id}/backup',
      docReference: 'developer.tesla.com/docs/fleet-api/endpoints/energy (S6)',
    },
    {
      capability: 'operational_mode',
      status: 'SUPPORTED',
      reason:
        'Controlled via POST /api/1/energy_sites/{id}/operation (autonomous, self_consumption)',
      docReference: 'developer.tesla.com/docs/fleet-api/endpoints/energy (S6)',
    },
    {
      capability: 'grid_charging',
      status: 'SUPPORTED',
      reason: 'Permission toggle controlled via POST /api/1/energy_sites/{id}/grid_import_export',
      docReference: 'developer.tesla.com/docs/fleet-api/endpoints/energy (S6)',
    },
    {
      capability: 'export_rule',
      status: 'SUPPORTED',
      reason: 'Permission toggle controlled via POST /api/1/energy_sites/{id}/grid_import_export',
      docReference: 'developer.tesla.com/docs/fleet-api/endpoints/energy (S6)',
    },
    {
      capability: 'storm_mode',
      status: isStormCapable ? 'SUPPORTED' : isStormDisabled ? 'DISABLED_BY_SETTING' : 'UNVERIFIED',
      reason: isStormCapable
        ? 'Storm watch participation supported (storm_mode_capable=true)'
        : isStormDisabled
          ? 'Hardware or regional utility setting disables storm watch (storm_mode_capable=false)'
          : 'Site features unconfirmed until site_info is fetched',
      docReference: 'developer.tesla.com/docs/fleet-api/endpoints/energy (S6, S2)',
    },
    {
      capability: 'off_grid_vehicle_charging_reserve',
      status: 'UNVERIFIED',
      reason: 'Requires Powerwall and paired Wall Connector; payload unverified',
      docReference: 'developer.tesla.com/docs/fleet-api/endpoints/energy (S6)',
    },
    {
      capability: 'island_mode',
      status: 'NOT_SUPPORTED',
      reason: 'Manual islanding/microgrid disconnect is not exposed in Fleet API',
      docReference: 'D-003; Fleet API Energy Endpoints (S6)',
    },
    {
      capability: 'forced_charge',
      status: 'NOT_SUPPORTED',
      reason: 'Forced grid charging command is not supported by Tesla Powerwall Fleet API',
      docReference: 'D-003; Fleet API Energy Endpoints (S6)',
    },
    {
      capability: 'forced_export',
      status: 'NOT_SUPPORTED',
      reason: 'Forced grid export command is not supported by Tesla Powerwall Fleet API',
      docReference: 'D-003; Fleet API Energy Endpoints (S6)',
    },
    {
      capability: 'solar_bypass',
      status: 'NOT_SUPPORTED',
      reason: 'Solar bypass is not supported by Tesla Powerwall Fleet API',
      docReference: 'D-003; Fleet API Energy Endpoints (S6)',
    },
  ];
}

/**
 * Converts evaluated capabilities to public SiteCapabilityItem schema subset.
 */
export function toSiteCapabilityItems(
  evaluated: readonly EvaluatedCapability[],
): readonly SiteCapabilityItem[] {
  const allowedKeys = new Set([
    'storm_mode',
    'backup_reserve',
    'operational_mode',
    'grid_charging',
    'export_rule',
    'island_mode',
  ]);

  return evaluated
    .filter((e) => allowedKeys.has(e.capability))
    .map((e) => ({
      capability: e.capability as SiteCapabilityItem['capability'],
      status: e.status,
      reason: e.reason,
    }));
}
