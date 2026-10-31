/** Non-China Fleet origins documented by Tesla. China requires separate onboarding/auth. */
export const TESLA_FLEET_ORIGINS = [
  'https://fleet-api.prd.na.vn.cloud.tesla.com',
  'https://fleet-api.prd.eu.vn.cloud.tesla.com',
] as const;

export function requireTeslaFleetOrigin(value: string): string {
  if (!(TESLA_FLEET_ORIGINS as readonly string[]).includes(value)) {
    throw new Error('Unsupported Tesla Fleet origin');
  }
  return value;
}
