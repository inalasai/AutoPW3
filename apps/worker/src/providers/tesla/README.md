# Tesla provider

**Status:** The staging-only OAuth gate reuses `oauth.ts` and `TeslaClient.getRegion` with `http.ts` bounded requests and `region.ts` approved NA/EU origins. Scope requests are read-only; granted token scopes must match. Regional discovery failures never fall back. No telemetry, commands, refresh or scheduled processing is enabled by this slice.

Other existing client methods and refresh code remain for explicit local/test workflows. Their live behavior and transport hardening must be reviewed before exposing them. No credentials or provider bodies may be logged. See the [Phase 2 handoff](../../../../../docs/handoffs/PHASE-2-DURABLE-TESLA-OAUTH.md) for exact gates and prerequisites.
