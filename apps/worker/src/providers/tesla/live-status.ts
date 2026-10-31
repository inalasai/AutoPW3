import { ProviderLiveStatusSchema, type ProviderLiveStatus } from '@autopw3/shared';
import { z } from 'zod';
import { TeslaHttpError } from './http';

/** Positive decimal identifier, kept as a string to avoid JavaScript integer rounding. */
export function requireTeslaEnergySiteId(value: string): string {
  if (typeof value !== 'string' || value !== value.trim() || !/^[1-9][0-9]{0,19}$/.test(value))
    throw new Error('Invalid stored Tesla energy site identifier');
  return value;
}

const rawStatus = z.object({
  percentage_charged: z.number().min(0).max(100).nullish(),
  solar_power: z.number().finite().nullish(),
  battery_power: z.number().finite().nullish(),
  grid_power: z.number().finite().nullish(),
  load_power: z.number().finite().nullish(),
  timestamp: z.string().datetime({ offset: true }).nullish(),
});

/** Tesla documents W; native flow signs remain unverified. Never clamp, invert or invent time. */
export function readTeslaLiveStatus(siteId: string, raw: unknown): ProviderLiveStatus {
  const result = rawStatus.safeParse(raw);
  if (!result.success) throw new TeslaHttpError('INVALID_RESPONSE');
  const value = result.data;
  if (
    [
      value.percentage_charged,
      value.solar_power,
      value.battery_power,
      value.grid_power,
      value.load_power,
    ].every((measurement) => measurement == null)
  )
    throw new TeslaHttpError('INVALID_RESPONSE');
  return ProviderLiveStatusSchema.parse({
    siteId,
    source: 'TESLA',
    signConvention: 'TESLA_NATIVE',
    batterySocPercent: value.percentage_charged ?? null,
    solarPowerW: value.solar_power ?? null,
    batteryPowerW: value.battery_power ?? null,
    gridPowerW: value.grid_power ?? null,
    loadPowerW: value.load_power ?? null,
    providerTimestamp: value.timestamp ?? null,
  });
}
