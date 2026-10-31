/** Credential-bearing OAuth/region requests: fixed hosts, bounded time/body, no redirects. */
export async function teslaJson(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || response.redirected || !response.body) {
      await response.body?.cancel();
      throw new Error('Rejected response');
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
        throw new Error('Response too large');
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    // Never retain upstream bodies, URLs, codes, tokens or underlying transport messages.
    throw new Error('Tesla authorization service unavailable');
  }
}
