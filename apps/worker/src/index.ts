import { InMemoryRepository } from './db/repository';
import type { Env } from './env';
import { handleApiRequest } from './lib/app';
import { TeslaClient } from './providers/tesla/client';
import { MockTeslaClient } from './providers/tesla/mock-adapter';
import { dispatchScheduledCronJobs } from './services/ingestion/dispatcher';
import { InMemoryTokenStore } from './services/tokens/store';

export { handleApiRequest as handleRequest };

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleApiRequest(request, env);
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    if (env.ENVIRONMENT !== 'local' && env.ENVIRONMENT !== 'test') {
      // Durable queue RPCs exist, but domain repositories, encrypted token storage and job handlers
      // are not connected; do not run scheduled work against fresh process-local stores.
      throw new Error('Scheduled jobs are disabled until durable storage is configured');
    }
    if (env.LOCAL_MOCKS !== 'true') {
      throw new Error('Scheduled local mocks require LOCAL_MOCKS=true');
    }
    if (!env.TOKEN_ENCRYPTION_KEY) {
      throw new Error('Scheduled jobs require TOKEN_ENCRYPTION_KEY');
    }

    const repo = new InMemoryRepository();
    const tokenStore = new InMemoryTokenStore(env.TOKEN_ENCRYPTION_KEY);
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
