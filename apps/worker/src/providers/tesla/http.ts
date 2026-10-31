export class TeslaHttpError extends Error {
  constructor(
    readonly kind: 'HTTP' | 'NETWORK' | 'TIMEOUT' | 'INVALID_RESPONSE',
    readonly status = 0,
    readonly retryAfterSeconds = 60,
  ) {
    super('Tesla request failed');
    this.name = 'TeslaHttpError';
  }
}

/** Credential-bearing reads: callers constrain hosts; bounded time/body, no redirects. */
export async function teslaJson(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<unknown> {
  const signal = AbortSignal.timeout(10_000);
  try {
    const response = await fetcher(url, {
      ...init,
      redirect: 'error',
      signal,
    });
    if (!response.ok || response.redirected || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      const retry = response.headers.get('retry-after') ?? '';
      const seconds = /^\d{1,6}$/.test(retry) ? Number(retry) : 60;
      throw new TeslaHttpError('HTTP', response.status, Math.max(1, Math.min(3600, seconds)));
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 65_536) {
        await reader.cancel();
        throw new TeslaHttpError('INVALID_RESPONSE');
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new TeslaHttpError('INVALID_RESPONSE');
    }
  } catch (error) {
    // Never retain upstream bodies, URLs, codes, tokens or underlying transport messages.
    if (error instanceof TeslaHttpError) throw error;
    throw new TeslaHttpError(signal.aborted ? 'TIMEOUT' : 'NETWORK');
  }
}
