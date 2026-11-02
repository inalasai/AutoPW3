# Token and OAuth state storage

`store.ts` and `oauth.ts` provide in-memory implementations for tests and explicitly local mock execution.
`supabase-store.ts` encrypts token and PKCE verifier envelopes before using service-role PostgREST RPCs;
the database stores ciphertext, nonce, key version, and bounded metadata only. Refresh coordination uses
the database lease RPCs. The durable adapters are wired only into the disabled-by-default staging read-only OAuth slice.
Production, telemetry, commands and cron remain fail-closed. Refresh processing is not enabled.
Staging OAuth callbacks use `saveTokensForFencedOAuth`: current ADMIN, live Auth session and both
lease owners are checked and locked through the encrypted save and original-actor audit transaction.
The older `saveTokensForOAuth` and ordinary backend `saveTokens` remain separate and are never fallback
paths for staging completion. See `20261101160000_fence_staging_tesla_oauth.sql` (local only).


**Status: request-scoped staging discovery refresh implemented locally.** `discovery-refresh.ts`
coordinates authenticated preflight, the durable SENT barrier, encrypted staging and actual-user
activation. `supabase-store.ts` reuses the AES-GCM envelope and owner-matched token lease release;
it never activates a discovery rotation with a service-role save. SENT is not retried after a crash,
failed exchange or unstaged rotation. READY can be resumed by the same live actor/session without
another token exchange. No scheduled maintenance is enabled. See
[the security/recovery contract](../../../../../docs/TESLA_DISCOVERY_REFRESH.md).

**Status: expired READY lifecycle implemented locally.** Pending rotated tokens are never another
refresh input. Expired staged access terminalizes under authenticated fencing and requires explicit
reauthorization. Successfully activated generations receive independent revision-bound SENT barriers.
No automatic reconnect, ambiguous-exchange retry or pending-token exchange is introduced.
