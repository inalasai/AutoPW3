/** Credential-bearing Supabase requests must work in Workers and never follow redirects. */
export async function supabaseFetch(
  fetcher: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
): Promise<Response> {
  // Stored global fetch requires the global receiver in workerd. Injected mocks remain supported.
  const response = await fetcher.call(globalThis, input, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    throw new Error('Supabase redirects are not permitted');
  }
  return response;
}
