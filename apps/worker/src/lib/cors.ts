import { errorResponse } from './errors';

export interface CorsConfig {
  readonly allowedOrigins: readonly string[];
}

export function parseCorsConfig(allowedOriginsStr?: string, environment?: string): CorsConfig {
  const isStrictEnv = environment === 'production' || environment === 'staging';
  if (!allowedOriginsStr) {
    return { allowedOrigins: isStrictEnv ? [] : ['http://localhost:5173'] };
  }
  const origins = allowedOriginsStr
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    allowedOrigins: origins.length > 0 ? origins : isStrictEnv ? [] : ['http://localhost:5173'],
  };
}

export function handleCorsPreflight(
  request: Request,
  config: CorsConfig,
  requestId: string,
): Response | null {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    // OPTIONS without Origin is just a method not allowed or simple 204
    return new Response(null, { status: 204 });
  }

  const normalizedOrigin = origin.trim().toLowerCase();
  if (!config.allowedOrigins.includes(normalizedOrigin)) {
    return errorResponse('FORBIDDEN', 'Origin not allowed by CORS policy', requestId);
  }

  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization, Idempotency-Key, X-Request-Id',
      'access-control-max-age': '86400',
      'x-request-id': requestId,
      vary: 'Origin',
    },
  });
}

export function applyCorsHeaders(
  response: Response,
  request: Request,
  config: CorsConfig,
): Response {
  const origin = request.headers.get('origin');
  if (!origin) {
    return response;
  }

  const normalizedOrigin = origin.trim().toLowerCase();
  if (!config.allowedOrigins.includes(normalizedOrigin)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.append('vary', 'Origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
