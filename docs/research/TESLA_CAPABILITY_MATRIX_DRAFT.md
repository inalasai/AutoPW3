# Tesla Capability Matrix (DRAFT, TASK-00)

Date accessed: **2026-10-22**. Source IDs (S1…S16) are defined in `TESLA_FEASIBILITY.md`.

Status values: `DOCUMENTED` (endpoint and purpose stated on an official page; payload and response fields may still be `UNVERIFIED`), `UNVERIFIED` (not found in official pages reached), `NOT_SUPPORTED` (not documented, so treated as unsupported under rule 3).

Important: `DOCUMENTED` here means documented, **not** tested. Nothing in this table is `VERIFIED` by execution. "Payload schema" and "Hardware restrictions" are `UNVERIFIED` unless a value is written.

Base path for all site endpoints: `/api/1/energy_sites/{energy_site_id}/…` on the regional Fleet API base URL. EU base URL: `UNVERIFIED` (discover with `GET /api/1/users/region`).

| Capability | Endpoint | Method | Scope/permission | Payload schema | Hardware restrictions | Doc reference | Status |
|---|---|---|---|---|---|---|---|
| List products / discover energy sites | `/api/1/products` | GET | `energy_device_data` (scope for this endpoint `UNVERIFIED`) | n/a (response fields `UNVERIFIED`) | `UNVERIFIED` | S6 | DOCUMENTED |
| Site info (assets, settings, features) | `/api/1/energy_sites/{id}/site_info` | GET | `energy_device_data` | n/a (response fields `UNVERIFIED`; known to include assets, settings such as backup reserve, features such as `storm_mode_capable`, `default_real_mode` ∈ {`autonomous`,`self_consumption`}) | `UNVERIFIED` | S6, S2 | DOCUMENTED |
| Live status (power, energy state, grid status, storm mode) | `/api/1/energy_sites/{id}/live_status` | GET | `energy_device_data` | n/a (response fields, signs, cadence `UNVERIFIED`; power in W, energy in Wh) | `UNVERIFIED` | S6, S2 | DOCUMENTED |
| Energy history | `/api/1/energy_sites/{id}/calendar_history?kind=energy&start_date&end_date&period&time_zone` | GET | `energy_device_data` | query params named; allowed `period` values, date and time-zone formats `UNVERIFIED`; energy in Wh | `UNVERIFIED` | S6, S2 | DOCUMENTED |
| Backup (off-grid) event history | `/api/1/energy_sites/{id}/calendar_history?kind=backup&…` | GET | `energy_device_data` | same params; values are durations in seconds | `UNVERIFIED` | S6, S2 | DOCUMENTED |
| Wall connector charge history | `/api/1/energy_sites/{id}/telemetry_history?kind=charge&start_date&end_date&time_zone` | GET | `energy_device_data` | response `UNVERIFIED`; energy in Wh | requires a wall connector, otherwise `UNVERIFIED` | S6, S2 | DOCUMENTED |
| Set backup reserve | `/api/1/energy_sites/{id}/backup` | POST | `energy_cmds` | `UNVERIFIED` | `UNVERIFIED` | S6, S2 | DOCUMENTED |
| Set operation mode (`autonomous` time-based, `self_consumption` self-powered) | `/api/1/energy_sites/{id}/operation` | POST | `energy_cmds` | `UNVERIFIED` (mode values documented, key names not) | `UNVERIFIED` | S6, S2 | DOCUMENTED |
| Allow/disallow grid charging and export | `/api/1/energy_sites/{id}/grid_import_export` | POST | `energy_cmds` (assumed, `UNVERIFIED`) | `UNVERIFIED` | `UNVERIFIED` | S6 | DOCUMENTED |
| Storm mode (storm-watch participation) | `/api/1/energy_sites/{id}/storm_mode` | POST | `energy_cmds` | `UNVERIFIED` | feature flag `storm_mode_capable` in `site_info` | S6, S2 | DOCUMENTED |
| Off-grid vehicle charging reserve | `/api/1/energy_sites/{id}/off_grid_vehicle_charging_reserve` | POST | `energy_cmds` (assumed, `UNVERIFIED`) | `UNVERIFIED` | `UNVERIFIED` | S6 | DOCUMENTED |
| Update time-of-use tariff on the site | `/api/1/energy_sites/{id}/time_of_use_settings` | POST | `energy_cmds` (assumed, `UNVERIFIED`) | `tou_settings.tariff_content_v2` = tariff structure with seasons, tariff periods, `energy_charges`/`demand_charges`, `ALL` key, currency in {`USD`,`EUR`,`GBP`}, labels; partly documented (S6), full schema `UNVERIFIED` | `UNVERIFIED` | S6 | DOCUMENTED |
| Region and base URL for a user | `/api/1/users/region` | GET | user token (scope `UNVERIFIED`) | no parameters | n/a | S8 | DOCUMENTED |
| Partner registration (per region) | `/api/1/partner_accounts` | POST | partner token | domain must match `allowed_origins` root; public key hosted at `/.well-known/appspecific/com.tesla.3p.public-key.pem` | n/a | S7, S1 | DOCUMENTED |
| Check registered public key | `/api/1/partner_accounts/public_key?domain=` | GET | partner token | query `domain` | n/a | S7 | DOCUMENTED |
| OAuth authorise | `https://auth.tesla.com/oauth2/v3/authorize` | GET (browser redirect) | user consent | `response_type`, `client_id`, `redirect_uri`, `scope`, `state` (+ optional) | n/a | S3 | DOCUMENTED |
| OAuth token exchange / refresh | `https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token` | POST | client credentials + code/refresh token | form-encoded; fields in S3 | n/a | S3 | DOCUMENTED |
| Programmatic token revocation | none found | n/a | n/a | n/a | n/a | S3 (consent page only) | UNVERIFIED |
| Command-result confirmation / status polling for energy commands | none found | n/a | n/a | n/a | n/a | S6 | UNVERIFIED |
| Energy-command signing (virtual key / command proxy) | none found for energy | n/a | n/a | n/a | n/a | S14, S15 are vehicle-only | UNVERIFIED |
| Streaming/telemetry for energy sites | none found | n/a | n/a | n/a | n/a | S13 is vehicle-only | UNVERIFIED |
| Webhooks | none found | n/a | n/a | n/a | n/a | — | UNVERIFIED |
| Force charge battery from grid | none | n/a | n/a | n/a | n/a | S6 (absent) | NOT_SUPPORTED |
| Force export to grid | none | n/a | n/a | n/a | n/a | S6 (absent); `grid_import_export` is a permission, not a force | NOT_SUPPORTED |
| Solar bypass | none | n/a | n/a | n/a | n/a | S6 (absent) | NOT_SUPPORTED |
| Manual islanding / disconnect from grid | none | n/a | n/a | n/a | n/a | S6 (absent) | NOT_SUPPORTED |
| Direct per-device/per-circuit control, inverter-level control | none | n/a | n/a | n/a | n/a | S6 (absent) | NOT_SUPPORTED |

## Rules for later tasks
- Only rows marked `DOCUMENTED` may become real adapter calls, and then only after payloads are verified from a recorded real response or from documentation. Task 15 must keep a mock for every row until that happens.
- Rows marked `UNVERIFIED` or `NOT_SUPPORTED` must be reported as such in the capability registry and the UI.
- Billing category for each endpoint is `UNVERIFIED` (see `TESLA_FEASIBILITY.md` Q9). Do not assume cheap or free.
