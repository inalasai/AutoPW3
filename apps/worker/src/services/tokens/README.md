# Token and OAuth state storage

`store.ts` and `oauth.ts` provide in-memory implementations for tests and explicitly local mock execution.
`supabase-store.ts` encrypts token and PKCE verifier envelopes before using service-role PostgREST RPCs;
the database stores ciphertext, nonce, key version, and bounded metadata only. Refresh coordination uses
the database lease RPCs. The durable adapters are tested with mocked RPCs but are not yet wired into the
Worker entry point; production and staging remain fail-closed until the durable application repository
and handlers are complete.
