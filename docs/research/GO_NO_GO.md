# Go / No-Go Summary (TASK-00)

Date: 2026-10-22. Basis: official Tesla developer documentation only; no live calls made. Details and sources in `TESLA_FEASIBILITY.md`.

## Verdict
**CONDITIONAL GO.** Build the product against a provider interface with the demo provider first. The Tesla adapter can be built, but must stay mock-only for payloads, signs and controls until the owner supplies a redacted real read-only response and approvals are confirmed.

## What the MVP can promise
- Read-only energy view for the owner's own site: live status, site info, energy history (documented endpoints, `DOCUMENTED`). Exact fields, resolutions and cadence are not yet verified.
- Tariff-aware analytics inside AutoPW3 using the owner's tariffs (no dependency on Tesla's tariff feature).
- Demo mode with clearly labelled synthetic data.
- Documented settings (backup reserve, operation mode, grid import/export permission, storm mode, TOU tariff) as **dry-run / mock-only** until payloads and hardware support are verified, and only after the owner explicitly enables a real call.

## What must be mock-only (for now)
- All control endpoints (payload schemas `UNVERIFIED`).
- Command confirmation (no documented status mechanism; must read back state).
- Any Tesla telemetry streaming or webhooks for energy (`UNVERIFIED`).
- Sign normalisation of `live_status` (`UNVERIFIED`).
- Historical resolution assumptions (`UNVERIFIED`).

## What must not be offered
- Forced charging, forced export, solar bypass, islanding: `NOT_SUPPORTED` (not documented).

## Risk to the "subscription-free" goal
**AT RISK.**
- No Tesla subscription fee was found, but Fleet API is pay-per-use: Data requests 500 per $1, commands 1,000 per $1, with a **$10 monthly discount per account** (S10, S11).
- A payment method is **mandatory**; the app is auto-disabled without one or when the billing limit (default 0) is exceeded (S10).
- Under the unverified assumption that `live_status` is a billable "Data" request, polling every 60 seconds costs about $76/month after the discount; staying inside the discount allows roughly one request per ~9 minutes around the clock (arithmetic in Feasibility Q9).
- Mitigations for Task 01/15/16: demand-driven polling (only while the live view is open), coarse background sync, a server-side monthly request budget with a hard stop below the billing limit, no retry storms on 4xx (those are billed), cache aggressively, show data age honestly in the UI.
- Task 01 must record the chosen polling budget in `docs/DECISIONS.md` and the product wording must not claim "free" without the caveat.

## Other blockers and risks
1. Approval of an individual/personal app is `UNVERIFIED` (form asks for legal business details). **Potential blocker for all live use.**
2. EU base URL is `UNVERIFIED`; first-time registration needs it. Resolve with the portal or Tesla before Task 15.
3. Refresh tokens are single-use and rotate; concurrent refresh in a serverless Worker can lock the owner out. Needs a per-site lock and persist-before-use design.
4. Refresh tokens expire after 3 months without use; a user re-consent path is required.
5. Fleet API agreement text not reviewed; personal self-hosted and multi-household use unconfirmed.

## Decisions Task 01 must not contradict
- Third-party OAuth (authorization-code) flow with `offline_access`; token calls go to `fleet-auth.prd.vn.cloud.tesla.com`.
- Tesla access is server-side only; tokens never reach the browser.
- Base URL is discovered per user, not hard-coded.
- Polling is budgeted; billing is per request including 4xx.
- All `UNVERIFIED` items stay mock-only and are surfaced as such.
