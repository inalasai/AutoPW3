import { z } from 'zod';

/** Response body of GET /api/v1/health. Deliberately contains nothing else (docs/API_CONTRACT.md). */
export const HealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
