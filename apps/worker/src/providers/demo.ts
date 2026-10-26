import { createDemoTelemetryProvider } from '@autopw3/domain';
import type { Clock } from '@autopw3/domain';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export const defaultDemoProvider = createDemoTelemetryProvider({
  clock: new SystemClock(),
});
