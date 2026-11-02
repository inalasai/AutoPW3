# Tesla provider

**Status:** The staging-only OAuth gate reuses `oauth.ts` and `TeslaClient.getRegion` with `http.ts` bounded requests and `region.ts` approved NA/EU origins. Scope requests are read-only; granted token scopes must match. Regional discovery failures never fall back. The OAuth gate enables no telemetry, commands, refresh or scheduled processing. A separate manual live-status gate is described below.

Other existing client methods and refresh code remain for explicit local/test workflows. Their live behavior and transport hardening must be reviewed before exposing them. No credentials or provider bodies may be logged. See the [Phase 2 handoff](../../../../../docs/handoffs/PHASE-2-DURABLE-TESLA-OAUTH.md) for exact gates and prerequisites.

**Fetch compatibility:** All Tesla outbound paths use `http.ts`'s `teslaFetch`: it invokes injected/global
fetch with the global receiver, uses Workers-supported `manual` redirects, and rejects every 3xx
response without forwarding credentials or retaining redirect bodies. Each caller keeps its existing
timeouts and non-redirect error handling. `workerd.test.ts` bundles the actual client/OAuth modules and
tests reads, code exchange, refresh and redirect rejection entirely against local fixture Workers.
No deployment gate or feature flag is enabled by this transport fix.

**Product discovery status:** `TeslaClient.listProducts` now uses the same bounded JSON transport
and approved regional origins as the manual read slice. It accepts at most 200 products, ignores
vehicles, validates positive decimal energy-site IDs, preserves string precision, rejects unsafe
numeric values/duplicates, and returns null for missing or unsafe names instead of inventing labels.
All failures reaching the new staging handler are sanitized. Its only Tesla operation is GET products.

**Phase 3 status:** `TeslaClient.getLiveStatus` now uses the existing bounded HTTP helper, exact approved regional origins and validated decimal energy-site IDs. It rejects missing response envelopes and retains sanitized typed HTTP/network failures. `live-status.ts` validates and projects only the five measurements and optional timestamp; values/signs are preserved, never normalized, clamped or persisted. The existing `normaliseLiveStatus` is intentionally not used by this diagnostic slice: its sign assumptions remain outside the verified read path. Shared HTTP errors now carry bounded status/retry metadata without provider bodies. Other data/control methods and refresh retain their previous deployment restrictions. Live Tesla behavior is still UNVERIFIED.


**Status: refresh exchange hardened locally.** Authorization and refresh share validated token/scp
normalization. Refresh uses the existing fixed token endpoint with a ten-second transport/body bound,
64 KiB body limit and no redirect/retry. Only a bounded 401 login_required classification is retained;
provider error text is discarded. Discovery independently enforces exact read-only scopes and region.
Tests intercept provider calls or use local workerd fixtures; no live verification is claimed.
