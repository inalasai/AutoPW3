import { ROUTES, pathParamsSchema } from '@autopw3/shared';
import type { RouteName, RouteResponse } from '@autopw3/shared';

/**
 * The web app's only view of the API contract: it takes paths and response schemas from `ROUTES` in `@autopw3/shared`,
 * so the browser and the Worker cannot disagree. No endpoint, path or response type is written out here. The real
 * API client (auth header, request id, error handling) is built on this in TASK-06 and TASK-07.
 */

const API_BASE = '/api/v1';

/**
 * Build the URL path for a route, validating every path id as a UUID and encoding it. Throws on a missing or malformed id.
 * Ids only select a resource: the server authorises from the verified token and database membership, never from them.
 */
export function routePath(name: RouteName, params: Readonly<Record<string, string>> = {}): string {
  const spec = ROUTES[name];
  const ids = pathParamsSchema(spec.path).parse(params);
  return `${API_BASE}${spec.path.replace(/\{([A-Za-z]+)\}/g, (_match, key: string) => encodeURIComponent(ids[key] ?? ''))}`;
}

/**
 * Validate a decoded JSON response body against the route's response schema. Throws if the server sent something the
 * contract does not allow, so an unexpected shape fails loudly instead of rendering wrong numbers.
 */
export function parseRouteResponse<N extends RouteName>(name: N, json: unknown): RouteResponse<N> {
  const schema = ROUTES[name].response;
  if (schema === null) {
    throw new Error(`route ${name} has no response body`);
  }
  // The schema is the one `RouteResponse<N>` is derived from; TypeScript cannot follow that through a dynamic lookup.
  const parsed: unknown = schema.parse(json);
  return parsed as RouteResponse<N>;
}
