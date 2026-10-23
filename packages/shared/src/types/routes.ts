import type { z } from 'zod';
import type { ROUTES, RouteName } from '../schemas/routes';

/**
 * Request and response types derived from the route table, so a handler and its caller can never disagree with the
 * schemas. `undefined` means the route has no such part (no body, no query, or no response body).
 */
type Part<
  N extends RouteName,
  K extends 'body' | 'query' | 'response',
> = (typeof ROUTES)[N] extends {
  readonly [P in K]: infer S;
}
  ? S extends z.ZodType
    ? z.infer<S>
    : undefined
  : undefined;

/** Parsed request body of a route (output of its schema, defaults applied). */
export type RouteBody<N extends RouteName> = Part<N, 'body'>;
/** Parsed query string of a route. */
export type RouteQuery<N extends RouteName> = Part<N, 'query'>;
/** Response body of a route on success. */
export type RouteResponse<N extends RouteName> = Part<N, 'response'>;
