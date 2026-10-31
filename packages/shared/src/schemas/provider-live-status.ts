import { z } from 'zod';
import { UuidSchema } from './primitives';

/** Read-only diagnostic snapshot, NOT a normalized/persistable internal power sample. */
export const ProviderLiveStatusSchema = z.strictObject({
  siteId: UuidSchema,
  source: z.literal('TESLA'),
  signConvention: z.literal('TESLA_NATIVE'),
  batterySocPercent: z.number().min(0).max(100).nullable(),
  solarPowerW: z.number().finite().nullable(),
  batteryPowerW: z.number().finite().nullable(),
  gridPowerW: z.number().finite().nullable(),
  loadPowerW: z.number().finite().nullable(),
  providerTimestamp: z.string().datetime({ offset: true }).nullable(),
});
export type ProviderLiveStatus = z.infer<typeof ProviderLiveStatusSchema>;
