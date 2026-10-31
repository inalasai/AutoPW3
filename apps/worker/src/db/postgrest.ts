/** Request-scoped authenticated PostgREST transport. Construct only after JWT verification. */
export class SupabasePostgrestError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly code: string | null,
    readonly tag: string | null = null,
  ) {
    super(`Supabase database request failed (${operation}, HTTP ${status})`);
    this.name = 'SupabasePostgrestError';
  }
}

const SAFE_DATABASE_TAGS = new Set([
  'already_member',
  'invalid_argument',
  'invalid_invitation',
  'last_admin_protected',
  'member_not_found',
  'not_authorised',
  'self_change_not_allowed',
]);

export class AuthenticatedPostgrestClient {
  private readonly restUrl: string;
  private readonly headers: HeadersInit;

  constructor(
    supabaseUrl: string,
    anonKey: string,
    userJwt: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const parsed = new URL(supabaseUrl);
    if (
      (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !['', '/'].includes(parsed.pathname)
    )
      throw new Error('Supabase URL must be a clean HTTPS project origin');
    if (!anonKey.trim() || !userJwt.trim())
      throw new Error('Authenticated database credentials are required');
    this.restUrl = `${parsed.toString().replace(/\/$/, '')}/rest/v1/`;
    this.headers = {
      apikey: anonKey,
      authorization: `Bearer ${userJwt}`,
      accept: 'application/json',
      'content-type': 'application/json',
    };
  }

  select<T>(table: string, params: URLSearchParams): Promise<T> {
    return this.request<T>(`${table}?${params.toString()}`, 'GET');
  }

  patch<T>(table: string, params: URLSearchParams, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(`${table}?${params.toString()}`, 'PATCH', body, true);
  }

  rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(`rpc/${name}`, 'POST', body);
  }

  private async request<T>(
    path: string,
    method: 'GET' | 'PATCH' | 'POST',
    body?: Record<string, unknown>,
    returnRepresentation = false,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const headers = new Headers(this.headers);
    if (returnRepresentation) headers.set('prefer', 'return=representation');
    try {
      const response = await this.fetcher(`${this.restUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let code: string | null = null;
        let tag: string | null = null;
        try {
          const payload = (await response.json()) as { code?: unknown; message?: unknown };
          if (typeof payload.code === 'string' && /^[A-Z0-9]{5}$/.test(payload.code))
            code = payload.code;
          if (typeof payload.message === 'string' && SAFE_DATABASE_TAGS.has(payload.message))
            tag = payload.message;
        } catch {
          /* response details are intentionally discarded */
        }
        throw new SupabasePostgrestError(path.split('?')[0]!, response.status, code, tag);
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SupabasePostgrestError) throw error;
      throw new SupabasePostgrestError(
        path.split('?')[0]!,
        controller.signal.aborted ? 408 : 0,
        null,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
