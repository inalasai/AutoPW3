import { buildErrorResponse, httpStatusFor } from '@autopw3/shared';
import type { ErrorCode } from '@autopw3/shared';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const;

export function jsonResponse(
  body: unknown,
  status: number,
  requestId: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      'x-request-id': requestId,
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: readonly { readonly path: string; readonly issue: string }[] | undefined,
  extraHeaders?: Record<string, string>,
): Response {
  const status = httpStatusFor(code);
  const errorObj = buildErrorResponse({
    code,
    message,
    requestId,
    ...(details && details.length > 0 ? { details } : {}),
  });

  return jsonResponse(errorObj, status, requestId, extraHeaders);
}
