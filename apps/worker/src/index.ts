import { buildErrorResponse, httpStatusFor } from '@autopw3/shared';
import type { ErrorCode, HealthResponse } from '@autopw3/shared';
import type { Env } from './env';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const;

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, 'x-request-id': requestId },
  });
}

/** Error response in the contract's envelope and status, built from the shared definitions. No internals. */
function errorResponse(code: ErrorCode, message: string, requestId: string): Response {
  return jsonResponse(
    buildErrorResponse({ code, message, requestId }),
    httpStatusFor(code),
    requestId,
  );
}

/**
 * TASK-02 stub: only `GET /api/v1/health`. Authentication, roles, validation and the real routes
 * arrive in TASK-14 (docs/API_CONTRACT.md; the route table is `ROUTES` in @autopw3/shared).
 */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();

  if (url.pathname === '/api/v1/health') {
    if (request.method !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed', requestId);
    }
    const body: HealthResponse = { status: 'ok' };
    return jsonResponse(body, 200, requestId);
  }

  if (url.pathname.startsWith('/api/')) {
    return errorResponse('NOT_FOUND', 'Not found', requestId);
  }

  // Everything else is the single-page app, served from static assets.
  return env.ASSETS.fetch(request);
}

export default {
  fetch: handleRequest,

  // TASK-16/18 add the job dispatcher. Until then the cron trigger does nothing and logs nothing.
  scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): void {
    return;
  },
} satisfies ExportedHandler<Env>;
