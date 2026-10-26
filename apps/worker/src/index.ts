import { handleApiRequest } from './lib/app';
import type { Env } from './env';

export { handleApiRequest as handleRequest };

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleApiRequest(request, env);
  },

  // TASK-16/18 add the job dispatcher. Until then the cron trigger does nothing and logs nothing.
  scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): void {
    return;
  },
} satisfies ExportedHandler<Env>;
