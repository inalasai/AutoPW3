# Owner Setup Steps for Tesla Fleet API (TASK-00)

Date accessed: **2026-10-22**. Source IDs refer to `TESLA_FEASIBILITY.md`. These are manual actions for the owner; none have been performed. No secret value goes into the repo (see `docs/CREDENTIALS.md`).

Items marked **(UNVERIFIED)** could not be confirmed from the official pages reached; confirm them in the portal before relying on them.

1. **Read the Fleet API agreement and pricing.** Confirm a personal, self-hosted app is allowed, and that you accept per-request billing. The agreement text was not reachable during research. (S10, S11; open questions O1, O4)
2. **Create a Tesla account** with a verified email and **multi-factor authentication enabled**. (S1)
3. **Choose and control a domain** for the app. It must serve static files over HTTPS (needed for the public key and for the `allowed_origins` match). Decide the origin(s) now; changing later affects registration. (S1, S7; O3)
4. **Generate a P-256 key pair** on a trusted machine:
   - `openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem`
   - `openssl ec -in private-key.pem -pubout -out public-key.pem`
   - Keep `private-key.pem` secret: never commit it, never host it. Store it in a password manager or secret store. (S1, S15)
5. **Host the public key** at `https://<your-domain>/.well-known/appspecific/com.tesla.3p.public-key.pem`. It must remain hosted for as long as the app is registered. (S1, S7)
6. **Submit the application request** on developer.tesla.com: legal/business details as the form requires, unique application name, description, purpose of usage, `allowed_origins`, redirect URL(s). Select scopes: `openid`, `offline_access`, `energy_device_data`, `energy_cmds` (add `energy_cmds` only if you want control features; read-only needs just `energy_device_data`). Application names that already exist can be auto-rejected. (S1, S2)
7. **Wait for approval.** Duration and criteria **(UNVERIFIED)**. (S11)
8. **Record the Client ID and Client Secret** from the portal. Put them only in the Cloudflare Worker secrets and local `.env` (git-ignored). Variable names will be defined in `.env.example` by Task 02. (S11)
9. **Add a payment method and set a billing limit.** The default limit is 0 and apps without a payment method are disabled. The $10 monthly discount applies per account. Choose a limit you are comfortable with; Tesla sends emails at 80% and 100% of the limit. (S10)
10. **Register redirect URL(s)** for the OAuth callback (Worker or web route). Must match what is sent in the authorise request exactly. Exact portal field name **(UNVERIFIED)**. (S3)
11. **Generate a partner token** (client-credentials grant) with the client ID and secret. (S4)
12. **Call the register endpoint in each region you need** (at minimum the EU region for an Ireland account; Tesla recommends all regions). The EU base URL is **UNVERIFIED**; the region of your account can be discovered via `GET /api/1/users/region` once you have a user token, which creates a chicken-and-egg step for the very first registration. Settle this with the portal or support before Task 15. (S1, S4, S7, S8, S12; O2)
13. **Verify registration** with `GET /api/1/partner_accounts/public_key?domain=<your-domain>`. (S7)
14. **Authorise the app as the Tesla account owner** through the authorise URL, accepting the requested scopes. Save the refresh token securely (encrypted at rest on the server only). Remember: refresh tokens are single use and expire after 3 months. (S3)
15. **Run one read-only discovery call** (`products`, `site_info`, `live_status`) and share a **redacted** response with the project so signs, fields and billing category can be settled (open question O6). Do not run any control endpoint against real hardware as part of this task or the early build.
16. **Understand revoking access**: use `https://auth.tesla.com/user/revoke/consent?revoke_client_id=<CLIENT_ID>&back_url=<URL>` or the Tesla account security page. (S3, S14)
17. **Add contacts** as Admin/App Developer in the Tesla business portal so breaking-change emails reach you. (S12)
18. **Decide and record** (in `docs/DECISIONS.md` via Task 01) the polling budget that fits your billing limit, see `TESLA_FEASIBILITY.md` Q9.

## Not required for energy-only use (according to the pages reached)
- Pairing a virtual key to a vehicle and the vehicle-command proxy are documented for vehicles. Whether they apply to Powerwall commands is `UNVERIFIED`; do not set them up until confirmed. (S14, S15)
- Running a Fleet Telemetry server: documented for vehicles only. (S13)
