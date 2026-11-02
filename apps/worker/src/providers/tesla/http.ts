export class TeslaHttpError extends Error {
  constructor(
    readonly kind: 'HTTP' | 'NETWORK' | 'TIMEOUT' | 'INVALID_RESPONSE',
    readonly status = 0,
    readonly retryAfterSeconds = 60,
    readonly reauthorizationRequired = false,
  ) {
    super('Tesla request failed');
    this.name = 'TeslaHttpError';
  }
}

async function withinSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new TeslaHttpError('TIMEOUT'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** Workers-compatible fetch; callers retain their existing timeout and error policies. */
export async function teslaFetch(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<Response> {
  const response = await fetcher.call(globalThis, url, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel().catch(() => undefined);
    throw new TeslaHttpError('HTTP', response.status);
  }
  return response;
}

/** Credential-bearing requests: callers constrain hosts; bounded time/body, no redirects. */
export async function teslaJson(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
  inspectLoginRequired = false,
): Promise<unknown> {
  const signal = AbortSignal.timeout(10_000);
  try {
    const response = await withinSignal(
      teslaFetch(
        url,
        {
          ...init,
          signal,
        },
        fetcher,
      ),
      signal,
    );
    const inspectFailure = inspectLoginRequired && response.status === 401;
    if ((!response.ok && !inspectFailure) || response.redirected || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      const retry = response.headers.get('retry-after') ?? '';
      const seconds = /^\d{1,6}$/.test(retry) ? Number(retry) : 60;
      throw new TeslaHttpError('HTTP', response.status, Math.max(1, Math.min(3600, seconds)));
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await withinSignal(reader.read(), signal);
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 65_536) {
          void reader.cancel().catch(() => undefined);
          throw new TeslaHttpError('INVALID_RESPONSE');
        }
        chunks.push(chunk.value);
      }
    } catch (error) {
      void reader.cancel().catch(() => undefined);
      throw error;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let result: unknown;
    try {
      result = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new TeslaHttpError('INVALID_RESPONSE');
    }
    if (!response.ok) {
      const loginRequired =
        inspectFailure &&
        typeof result === 'object' &&
        result !== null &&
        'error' in result &&
        result.error === 'login_required';
      throw new TeslaHttpError('HTTP', response.status, 60, loginRequired);
    }
    return result;
  } catch (error) {
    // Never retain upstream bodies, URLs, codes, tokens or underlying transport messages.
    if (error instanceof TeslaHttpError) throw error;
    throw new TeslaHttpError(signal.aborted ? 'TIMEOUT' : 'NETWORK');
  }
}
