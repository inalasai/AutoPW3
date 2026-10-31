# Token and OAuth state storage

`store.ts` and `oauth.ts` provide in-memory implementations for tests and explicitly local mock execution.
`supabase-store.ts` encrypts token and PKCE verifier envelopes before using service-role PostgREST RPCs;
the database stores ciphertext, nonce, key version, and bounded metadata only. Refresh coordination uses
the database lease RPCs. The durable adapters are wired only into the disabled-by-default staging read-only OAuth slice.
Production, telemetry, commands and cron remain fail-closed. Refresh processing is not enabled.
OAuth callbacks use `saveTokensForOAuth`, which checks current ADMIN authority transactionally and
records the original actor; ordinary backend `saveTokens` remains separate.
