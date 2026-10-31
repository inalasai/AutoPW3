import type { Env } from './env';
import { assertValidEnvironment } from './env';
import { handleApiRequest } from './lib/app';
import { TeslaClient } from './providers/tesla/client';
import { MockTeslaClient } from './providers/tesla/mock-adapter';
import { dispatchScheduledCronJobs } from './services/ingestion/dispatcher';
import { createRepository, createTokenStore } from './db/factory';

export { handleApiRequest as handleRequest };

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleApiRequest(request, env);
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    assertValidEnvironment(env);
    const repo = createRepository(env);
    const tokenStore = createTokenStore(env);
    const teslaClient =
      env.PROVIDER_MODE !== 'mock' && env.TESLA_CLIENT_ID
        ? new TeslaClient()
        : new MockTeslaClient();

    ctx.waitUntil(
      dispatchScheduledCronJobs({
        repo,
        tokenStore,
        teslaClient,
        teslaAuth:
          env.TESLA_CLIENT_ID && env.TESLA_CLIENT_SECRET
            ? { clientId: env.TESLA_CLIENT_ID, clientSecret: env.TESLA_CLIENT_SECRET }
            : undefined,
      }).catch(() => {
        // Sanitised failure: no secrets logged
      }),
    );
  },
} satisfies ExportedHandler<Env>;
