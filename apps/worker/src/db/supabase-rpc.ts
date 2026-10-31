export class SupabaseRpcError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`Supabase RPC ${operation} failed (HTTP ${status})`);
    this.name = 'SupabaseRpcError';
  }
}

/** Minimal service-role PostgREST client. Never reads or includes response bodies in errors. */
export class SupabaseRpcClient {
  private readonly rpcBaseUrl: string;
  private readonly headers: HeadersInit;

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      throw new Error('Supabase URL must use HTTPS');
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !['', '/'].includes(parsed.pathname)
    ) {
      throw new Error('Supabase URL must be a clean project origin');
    }
    if (serviceRoleKey.trim().length === 0)
      throw new Error('Supabase service role key is required');

    this.rpcBaseUrl = `${parsed.toString().replace(/\/$/, '')}/rest/v1/rpc/`;
    this.headers = {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    };
  }

  async call<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(`${this.rpcBaseUrl}${name}`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new SupabaseRpcError(name, response.status);
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SupabaseRpcError) throw error;
      if (controller.signal.aborted) throw new SupabaseRpcError(name, 408);
      throw new SupabaseRpcError(name, 0);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
