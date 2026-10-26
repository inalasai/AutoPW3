import { ROUTES, type RouteName, type RouteSpec } from '@autopw3/shared';

export interface RouteMatch {
  readonly routeName: RouteName;
  readonly spec: RouteSpec;
  readonly pathParams: Record<string, string>;
}

interface CompiledRoute {
  readonly routeName: RouteName;
  readonly spec: RouteSpec;
  readonly regex: RegExp;
  readonly paramNames: readonly string[];
}

const compiledRoutes: CompiledRoute[] = Object.entries(ROUTES).map(([name, spec]) => {
  const paramNames: string[] = [];
  const regexStr = spec.path.replace(/\{([A-Za-z]+)\}/g, (_match, paramName) => {
    paramNames.push(paramName);
    return '([^/]+)';
  });
  return {
    routeName: name as RouteName,
    spec,
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
  };
});

/**
 * Matches an incoming request method and pathname (relative to /api/v1) against the ROUTES table.
 * Returns:
 * - { match: RouteMatch } if found.
 * - { methodNotAllowed: true } if path matches another HTTP method.
 * - null if path does not match any route.
 */
export function matchRoute(
  method: string,
  pathname: string,
): { match?: RouteMatch; methodNotAllowed?: boolean } | null {
  const matchingPaths = compiledRoutes.filter((r) => r.regex.test(pathname));

  if (matchingPaths.length === 0) {
    return null;
  }

  const exactMethodMatch = matchingPaths.find((r) => r.spec.method === method);
  if (!exactMethodMatch) {
    return { methodNotAllowed: true };
  }

  const execResult = exactMethodMatch.regex.exec(pathname);
  const pathParams: Record<string, string> = {};
  if (execResult) {
    exactMethodMatch.paramNames.forEach((name, i) => {
      pathParams[name] = execResult[i + 1]!;
    });
  }

  return {
    match: {
      routeName: exactMethodMatch.routeName,
      spec: exactMethodMatch.spec,
      pathParams,
    },
  };
}
