import type { PersistedPowerSample } from '@autopw3/shared';

/**
 * RAW TESLA PROVIDER SHAPES. These stay inside `providers/tesla` and never reach `@autopw3/shared`, the web app or the
 * database. They are deliberately loose: the real response fields, native signs and cadence are UNVERIFIED
 * (docs/research/SIGN_CONVENTION_FINDING.md, KNOWN_LIMITATIONS L-003 and L-005), so nothing here claims a field exists.
 * TASK-15 narrows them only from a recorded real read-only response or from documentation, and keeps a mock for every
 * endpoint until then.
 */
export type TeslaRawRecord = Readonly<Record<string, unknown>>;

/** `GET /api/1/energy_sites/{id}/live_status` response body. Power in W per Tesla's docs; native signs UNVERIFIED. */
export type TeslaRawLiveStatus = TeslaRawRecord;

/** `GET /api/1/energy_sites/{id}/site_info` response body (backup reserve, features such as `storm_mode_capable`). */
export type TeslaRawSiteInfo = TeslaRawRecord;

/** `GET /api/1/energy_sites/{id}/calendar_history` response body. Energy in Wh per Tesla's docs; fields UNVERIFIED. */
export type TeslaRawEnergyHistory = TeslaRawRecord;

/** `GET /api/1/products` response body. Used only to discover energy site ids. */
export type TeslaRawProducts = TeslaRawRecord;

/**
 * NORMALISATION BOUNDARY (docs/DOMAIN_TYPES.md section 4). The only way provider data becomes internal data: a pure
 * function from a raw live status plus the receive time (UTC ISO string) to the project's persisted sample, in the sign
 * convention of `@autopw3/shared` (battery > 0 discharging, grid > 0 importing). It sets `source: 'TESLA'` and
 * `quality`. Until the mapping is completed from a redacted real response (open question Q-06), its output must not be
 * persisted as `quality: 'OK'`. Implemented in TASK-08/15; declared here so the seam is fixed in types.
 */
export type NormaliseLiveStatus = (
  raw: TeslaRawLiveStatus,
  receivedAtUtc: string,
) => PersistedPowerSample;
