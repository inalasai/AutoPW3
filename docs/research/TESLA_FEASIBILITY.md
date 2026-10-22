# Tesla Fleet API — Feasibility Findings (TASK-00)

Status: **DRAFT for owner review.** Research only. No code, no live calls to any Tesla endpoint were made.
Date accessed (all sources): **2026-10-22**.
Method: pages fetched from `developer.tesla.com` and Tesla's OAuth metadata document. Statements are paraphrased, not quoted. Where a page did not state something, it is marked `UNVERIFIED`; nothing was filled in from memory.

## Sources consulted

| ID | Page | URL |
|---|---|---|
| S1 | What is Fleet API (onboarding steps) | https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api |
| S2 | Authentication overview (token types, scopes) | https://developer.tesla.com/docs/fleet-api/authentication/overview |
| S3 | Third-party tokens (OAuth code flow, refresh) | https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens |
| S4 | Partner tokens | https://developer.tesla.com/docs/fleet-api/authentication/partner-tokens |
| S5 | Third-party business tokens | https://developer.tesla.com/docs/fleet-api/authentication/third-party-business-tokens |
| S6 | Energy endpoints | https://developer.tesla.com/docs/fleet-api/endpoints/energy |
| S7 | Partner endpoints (register, public key) | https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints |
| S8 | User endpoints (region) | https://developer.tesla.com/docs/fleet-api/endpoints/user-endpoints |
| S9 | Vehicle endpoints (Fleet Telemetry config; vehicle-only) | https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints |
| S10 | Billing and Limits | https://developer.tesla.com/docs/fleet-api/billing-and-limits |
| S11 | Developer home (pricing table) | https://developer.tesla.com/ |
| S12 | Best Practices | https://developer.tesla.com/docs/fleet-api/getting-started/best-practices |
| S13 | Fleet Telemetry overview | https://developer.tesla.com/docs/fleet-api/fleet-telemetry |
| S14 | Virtual keys overview | https://developer.tesla.com/docs/fleet-api/virtual-keys/overview |
| S15 | Virtual keys developer guide | https://developer.tesla.com/docs/fleet-api/virtual-keys/developer-guide |
| S16 | OAuth server metadata (OpenID configuration) | https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/thirdparty/.well-known/openid-configuration |

Pages that returned 404 or no content (guessed paths, not used): regions/base-URL page, error-codes page, announcements, terms pages, sitemap, `llms.txt`. The pages S12 and S1 refer to a regions list and the Fleet API agreement, but the linked targets could not be reached. These gaps drive several `UNVERIFIED` entries below.

Confidence levels: **High** = stated plainly on an official page. **Medium** = stated, but with ambiguity or an internal inconsistency. **Low** = inferred or only partly stated. **None** = not found (`UNVERIFIED`).

---

## Q1. Developer account and application registration

**Finding (High on process, Medium on eligibility).**
- A Tesla account with verified email and multi-factor authentication is needed (S1).
- The owner then submits an application request on developer.tesla.com giving legal business details, application name, description and purpose, and selects scopes (S1). Names that already exist can be auto-rejected (S1).
- There is an approval step: credentials (client ID and secret) are generated "once approved" (S11).
- Whether a **personal, single-user, non-business** app is permitted: the developer home page advertises "no costs for personal use" via a monthly discount (S11), and the authentication overview names "a hobbyist building an integration with their own Tesla product" as a third-party-token use case (S2). However the application form asks for **legal business details** (S1). Whether an individual can complete it, and what approval criteria apply, is **`UNVERIFIED`** → owner question O1.
- Fees: no registration fee was found. Usage is billed (see Q9).

Sources: S1, S2, S11. Confidence: Medium.

## Q2. Regional endpoints and registration (Ireland/EU)

**Finding (Medium on process, None on the EU base URL).**
- Registration with the `register` endpoint must be done **in each region of operation** (S1), and Tesla recommends registering in all regions so out-of-region users work (S12).
- Fleet API base URL must be used as the token `audience`. The only base URL shown in the docs I could reach is `https://fleet-api.prd.na.vn.cloud.tesla.com` (North America) (S3, S4, S5).
- The **EU base URL is `UNVERIFIED`**: the regions page was unreachable, and it must not be inferred from the NA pattern. Documented workaround: `GET /api/1/users/region` returns "a user's region and appropriate fleet-api base URL" for the token's subject (S8). Task 15 should discover the base URL at runtime and store it per user, not hard-code it.
- Partner registration steps: generate a P-256 (`prime256v1`) key pair; host the public key at `https://<domain>/.well-known/appspecific/com.tesla.3p.public-key.pem`; obtain a partner token (client credentials); call `POST /api/1/partner_accounts` (S1, S7, S15).
- The domain given to `register` must match the root domain of the `allowed_origins` configured on developer.tesla.com (S7). The key must **remain** hosted after registration (S7, S13).
- The data-residency note: Fleet API is localised by region for CCPA/GDPR/PIPL, and the developer remains responsible for compliance (S12).

Sources: S1, S3, S7, S8, S12, S15. Confidence: Medium. Open: O2, O3.

## Q3. OAuth flow

**Finding (High).**
- Token type for this product: **third-party token** (authorization-code grant, on behalf of the owner) (S2, S3).
- Authorisation URL: `https://auth.tesla.com/oauth2/v3/authorize`. Required parameters: `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`. Optional: `nonce`, `prompt_missing_scopes`, `require_requested_scopes`, `show_keypair_step` (S3).
- Scopes needed for energy: `energy_device_data` (live status, site info, backup history, energy history, charge history) and `energy_cmds` (backup reserve, operation mode, storm mode). Also `openid` and `offline_access` to obtain a refresh token (S2, S3).
- Token exchange: `POST https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token`, form-encoded, with `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `audience` (a Fleet API base URL), `redirect_uri` (S3). The docs insist `/token` calls use the `fleet-auth.prd.vn.cloud.tesla.com` host (S3). Authentication endpoints are not billed (S3, S4, S5).
- Refresh: `grant_type=refresh_token` with `client_id` and `refresh_token` (S3). **The refresh token is single-use and expires after 3 months** (S3). Each exchange returns a new refresh token that must be saved. To tolerate a failed save, the most recently used refresh token stays valid for up to 24 hours (S3).
- Refresh failure modes: `401 login_required` if the token is expired or superseded, or if the user reset their password (S3). An `invalid_auth_code` response likely means an expired code (S3).
- Revocation / scope change: user-facing consent page `https://auth.tesla.com/user/revoke/consent?revoke_client_id=$CLIENT_ID&back_url=$RETURN_URL` (S3). A programmatic revocation endpoint was **not found** (`UNVERIFIED`). Scope additions: send the user a new authorize link with `prompt_missing_scopes=true` (S3).
- Access-token lifetime: **`UNVERIFIED`** (not stated on pages reached). S12 says tokens are JWTs and should be renewed within one minute of expiry, so the `exp` claim is the source of truth at runtime.
- PKCE: the OAuth metadata lists `S256` under supported code challenge methods (S16), but the token-exchange docs still require `client_secret` (S3). Whether PKCE is mandatory or optional is `UNVERIFIED`.
- Refresh/auth request-rate guidance: no more than 20 requests/second per application or account (S12).
- Design implication: because refresh tokens rotate and are single-use, concurrent refreshes from multiple Worker invocations can invalidate each other. Task 15 must serialise refresh per site (lock) and persist the new token before use. This is an inference from S3, not a documented Tesla recommendation.

Sources: S2, S3, S12, S16. Confidence: High (except where marked).

## Q4. Energy-site discovery

**Finding (High on endpoint, None on response schema).**
- `GET /api/1/products` returns "products mapped to user" (S6). Energy sites are then addressed by `{energy_site_id}`.
- `GET /api/1/energy_sites/{energy_site_id}/site_info` returns assets (e.g. has solar), settings (e.g. backup reserve) and features (e.g. `storm_mode_capable`); power in watts, energy in Wh; `default_real_mode` is `autonomous` or `self_consumption` (S6).
- The exact **field list and types** of `products` and `site_info` responses were not on the pages reached → **`UNVERIFIED`**. Task 15 must build the Tesla types from a recorded real response (owner-run read-only call) or keep them mock-only.

Sources: S6. Confidence: Medium (endpoints) / None (schemas).

## Q5. Live status, units and sign conventions

**Finding (High on endpoint, None on signs).**
- `GET /api/1/energy_sites/{energy_site_id}/live_status` returns "power, state of energy, grid status, storm mode". Power values in **watts**, energy values in **Wh** (S6).
- Field names, native **sign conventions** for solar, battery, grid and load, the battery-percentage field, and update cadence are **not documented on the pages reached → `UNVERIFIED`**. See `SIGN_CONVENTION_FINDING.md`.
- Rate limit that applies: "Realtime Data" 60 requests/minute per device per account (S10). Whether `live_status` is classed as Realtime Data / Data for billing is `UNVERIFIED` (S10 says the category is shown per endpoint in an expandable section the fetch did not return).

Sources: S6, S10. Confidence: None for signs and cadence.

## Q6. Historical energy data

**Finding (Medium).**
- `GET /api/1/energy_sites/{energy_site_id}/calendar_history?kind=energy&start_date=…&end_date=…&period=…&time_zone=…` returns energy measurements "aggregated to the requested period", in Wh (S6).
- `kind=backup` on the same path returns backup (off-grid) event history as durations in seconds (S6).
- `GET …/telemetry_history?kind=charge&start_date=…&end_date=…&time_zone=…` returns wall-connector charging history in Wh (S6).
- A `time_zone` parameter exists on all three, so timezone handling is requested by the caller. The accepted format (IANA name vs offset), allowed `period` values, date format, maximum range, the timestamp semantics of returned buckets (start vs end, UTC vs local) and **data retention** are **`UNVERIFIED`**.
- Consequence for rule 9 (resolution honesty): the finest resolution cannot be asserted until `period` values are verified. The UI must show whatever resolution the response actually has.

Sources: S6. Confidence: Medium on endpoints, None on resolutions and retention.

## Q7. Site configuration, operation mode, backup reserve, grid settings

**Finding (High on existence, partial on payloads).**

| Endpoint | Documented behaviour | Payload schema | Hardware/firmware restrictions | Signing |
|---|---|---|---|---|
| `POST …/backup` | Adjust backup reserve (S6) | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` |
| `POST …/operation` | Set site mode: `autonomous` = time-based control, `self_consumption` = self-powered (S6) | `UNVERIFIED` (key names beyond the mode values not shown) | `UNVERIFIED` | `UNVERIFIED` |
| `POST …/grid_import_export` | Allow/disallow charging from grid and exporting to grid (S6) | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` |
| `POST …/storm_mode` | Update storm-watch participation (S6) | `UNVERIFIED` | `site_info` exposes `storm_mode_capable` (S6) | `UNVERIFIED` |
| `POST …/off_grid_vehicle_charging_reserve` | Adjust off-grid vehicle charging reserve (S6) | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` |
| `POST …/time_of_use_settings` | Update the site's time-of-use tariff; payload is `tou_settings.tariff_content_v2` (S6) | Partly documented: seasons, tariff periods, `energy_charges`, `demand_charges`, `ALL` price key, currency strings `USD`/`EUR`/`GBP`, labels, validation rules (S6) and an example JSON linked from S6 (not fetched) | `UNVERIFIED` | `UNVERIFIED` |

- All of these need scope `energy_cmds` (S2). Scope name for TOU is not stated on the endpoint list; assumed `energy_cmds` as it modifies settings, but this is **`UNVERIFIED`**.
- **Signing:** the virtual-key / signed-command material (S9, S14, S15) is written only about **vehicles**. Whether energy-product commands need signing is **`UNVERIFIED`**; nothing in the energy endpoint list mentions it.
- TOU tariff validation rules stated by Tesla (S6): no overlaps or gaps in periods or seasons; every priced period has times and vice versa; negative prices are rounded to zero; buy price must be ≥ sell price or buy is set equal to sell. Labels shown by the Tesla mobile app are limited to `ON_PEAK`, `OFF_PEAK`, `PARTIAL_PEAK`, `SUPER_OFF_PEAK`.
- Honest-status note (rule 4): none of the docs reached describe a command-result or confirmation mechanism for energy commands. A command's HTTP success must not be treated as `CONFIRMED`; confirmation must come from reading back `site_info`/`live_status`. This is a design inference.

Sources: S2, S6. Confidence: Medium on existence, None on payloads.

## Q8. Rate limits, error codes, retries, billing/quotas

**Finding (Medium).**
- Limits are per device, per account, and shared across an account's developer apps: **Realtime Data 60 req/min; Wakes 3 req/min; Device Commands 30 req/min** (S10). Which bucket each energy endpoint falls into is `UNVERIFIED`.
- Billing: every request returning status below 500 is billable; 500 and above is not billed (S10). Therefore error responses (4xx) still cost money; retry loops are a cost risk.
- Auth endpoints are not billed (S3–S5) and should stay under 20 req/s (S12).
- Error codes in the pages reached: `401 login_required`, `invalid_auth_code` (S3); `408` vehicle unavailable (vehicle-specific) (S12); `403 location access not granted` (vehicle-specific) (S9, S13). A **complete error-code list for energy endpoints is `UNVERIFIED`**.
- Retry guidance: commands are mostly stateful and safe to retry, but timeouts leave the state uncertain and the developer must verify the resulting state (S12, written for vehicles). For energy this maps to rule 4: after a timeout, read state back and report `UNKNOWN` or `PENDING` until confirmed.
- Tesla emails breaking changes to Admin/App Developer contacts (S12).

Sources: S3–S5, S9, S10, S12. Confidence: Medium.

## Q9. Is Fleet API free for this use? (Subscription-free goal)

**Finding: usage-based billing, not free by default. Subscription-free goal is AT RISK, conditional on polling cadence.**

Documented facts (S10, S11):
- Pay-per-use pricing (no subscription). Rates on the developer home page: Streaming signals 150,000 per $1; Commands 1,000 requests per $1; **Data 500 requests per $1** (i.e. $0.002 each); Wakes 50 per $1.
- Each account gets a **$10 monthly discount** intended for individual developers and small apps (S10, S11).
- Billing cycles are monthly. Apps with **no payment method configured, or that exceed the billing limit, are automatically disabled** (S10). The default billing limit is 0 until a payment method is added (S10). So a payment method is required even if actual usage stays within the $10 discount.
- Charges are rounded to the nearest $0.01 (S10).

Illustrative arithmetic. **Assumption (UNVERIFIED): `live_status` and `calendar_history` are billed in the "Data" category.** Under that assumption, for a 30-day month (43,200 minutes):

| Polling cadence | Requests/month | Gross cost at $0.002 | After $10 discount |
|---|---|---|---|
| Every 60 s | 43,200 | $86.40 | $76.40 |
| Every 5 min | 8,640 | $17.28 | $7.28 |
| Every 8.64 min (break-even) | 5,000 | $10.00 | $0.00 |
| Every 10 min | 4,320 | $8.64 | $0.00 |

Conclusions:
- **A "live" energy-flow view driven by polling `live_status` every few seconds is not free**: it would cost far more than the discount. Even 60-second polling around the clock is roughly $76/month under the stated assumption.
- Staying inside the $10 discount allows on the order of one Data request every ~9 minutes around the clock, shared with history calls and commands. A viable approach is demand-driven polling (only while a user has the live view open) plus coarse background sync, with a server-side budget guard.
- Whether Powerwall data can be **streamed** (cheaper per signal) is `UNVERIFIED` (see Q11).
- The discount is per account, and the prices or discount could change; the docs show a payment-transition date of Feb 1, 2024 that is now past (S10).
- Verdict recorded in `GO_NO_GO.md`: subscription-free is **AT RISK** (no Tesla subscription fee, but per-request charges with a $10/month allowance and mandatory payment method).

Sources: S10, S11. Confidence: High on rates and discount, Low on endpoint billing category.

## Q10. Forced charging, forced export, solar bypass, islanding

**Finding: not documented → NOT_SUPPORTED by default (rule 3).**
- The energy endpoints listed in S6 contain: backup reserve, operation mode (`autonomous` / `self_consumption`), grid import/export permission, storm mode, off-grid vehicle charging reserve and TOU tariff. There is **no** endpoint for forcing battery charge from grid, forcing export, solar bypass, or manual islanding/grid disconnect.
- `grid_import_export` allows or disallows charging from the grid and exporting; this is a permission, not a force command (S6).
- Indirect influence is possible via mode, reserve and TOU tariff, but the effect on dispatch is not specified in the docs → treat any "force" behaviour as `NOT_SUPPORTED`; any automation that relies on indirect effects must be labelled as such and kept mock-only until verified.
- "Backup history" reports off-grid events; it does not command them (S6).

Sources: S6. Confidence: High that nothing is documented; status `NOT_SUPPORTED`.

## Q11. Webhooks and streaming

**Finding (Medium; energy applicability `UNVERIFIED`).**
- No webhook mechanism was found in the pages reached.
- **Fleet Telemetry** streams data from vehicles to a server the developer hosts (S13). All prerequisites, firmware versions, configuration endpoints and field lists in the pages reached relate to **vehicles** (S9, S13). Whether Powerwall/energy sites can stream through Fleet Telemetry is **`UNVERIFIED`**; do not assume it.
- If telemetry were applicable it would need: a publicly reachable telemetry server, a hosted public key, paired virtual key (vehicle), and an HTTP proxy to sign configuration (S13). That is out of scope for a small Cloudflare Worker app until verified.
- Inconsistency noted (Confidence: Medium): S13 states a vehicle can stream to five applications, while S9 (config get) says a vehicle allows 3 configurations. Not relevant to energy but recorded.

Sources: S9, S13. Confidence: None for energy streaming.

## Q12. Terms-of-service constraints for a self-hosted personal app

**Finding: `UNVERIFIED`.**
- S10 refers to "the Fleet API agreement" (disable-after-30-days-non-payment clause), and S1 asks for legal business details, but the agreement text itself was not reachable.
- Constraints visible on other pages: the developer is responsible for local privacy-law compliance (S12); the registered domain and key are shown to users during key pairing (S7); `register` requires a hosted public key that must remain available (S7); users can revoke consent at any time and configurations are then removed (S3, S9).
- Owner must read and accept the Fleet API agreement and confirm that a personal self-hosted use case, multi-household use, and any redistribution are allowed → owner questions O1, O4.

Sources: S1, S3, S7, S9, S10, S12. Confidence: None on agreement content.

---

## Open questions for the owner (listed separately, per acceptance criteria)

| ID | Question | Why it matters |
|---|---|---|
| O1 | Can an individual (no legal entity) get an application approved, and which "legal business details" are required on the form? Read the Fleet API agreement. | Gates all live use. |
| O2 | Which Fleet API base URL does the owner's Ireland account resolve to? (Run `GET /api/1/users/region` once, read-only, after OAuth.) | EU base URL is `UNVERIFIED`; needed for token `audience` and registration. |
| O3 | Which domain will host the public key (and the app)? Must support `/.well-known/appspecific/com.tesla.3p.public-key.pem` and match `allowed_origins`. | Registration requirement. |
| O4 | Will the app ever serve more than the owner's own household? | Affects approval type, billing responsibility, GDPR role. |
| O5 | Is the owner willing to attach a payment method and set a billing limit (default limit is 0 and the app is disabled without a payment method)? | Mandatory per billing page. |
| O6 | Owner to run (or authorise) one **read-only** `live_status` and `site_info` call and share a **redacted** response, to settle signs, field names, cadence and billing category. | Closes the main `UNVERIFIED` items. |
| O7 | Does the owner's Powerwall hardware/firmware support the controls wanted (mode, reserve, grid import/export, TOU)? Check `site_info` features. | Hardware restrictions are undocumented. |

## What was not done
- No live Tesla call was made, so nothing here is `VERIFIED` by execution. Documentation-based findings are labelled by confidence only.
- Linked pages not fetched: the example TOU tariff JSON (S6 link), Fleet Telemetry "Available Data", the pricing estimator.
