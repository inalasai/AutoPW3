# Unresolved Questions and External Dependencies

Status: created by TASK-01 on 2026-10-22. Append-only: when answered, add a dated line to the row and a `DECISIONS.md` entry; do not delete rows. Each question has a **proposed default that the design already uses**, so the owner can accept it or override it. Nothing below was silently decided.

## 1. Questions for the owner

| ID | Question | Why it matters | Proposed default used in the design | Blocks | Source |
|---|---|---|---|---|---|
| Q-01 | Can an individual (no legal entity) get a Fleet API application approved, and what do the Fleet API agreement terms allow for personal, self-hosted and multi-person use? | Gates all live Tesla use | Proceed with the Tesla adapter mock-only (owner choice, 2026-10-22) | Live use after TASK-15 | TASK-00 O1, O4 |
| Q-02 | Which Fleet API base URL does the owner's Ireland account use (EU)? | Needed as OAuth `audience` and for partner registration; not found in the official pages reached | `TESLA_FLEET_API_BASE_URL` is a required owner-set config value; Worker verifies it with `GET /api/1/users/region` after the first token and refuses on mismatch | TASK-15 live | TASK-00 O2 |
| Q-03 | Which domain will host the app and the Tesla public key, and are its nameservers managed by Cloudflare? Does a `/.well-known/appspecific/…pem` file get served correctly as a Worker static asset (dot-directory handling is unverified)? | Workers custom domains need Cloudflare-managed nameservers; Tesla requires the key hosted on the registered domain | Use a Cloudflare-managed domain; TASK-02 adds a test fetching the well-known path from a local build; TASK-15 verifies it on the real domain | TASK-02, 15, 21 | TASK-00 O3; Cloudflare V2 |
| Q-04 | Will the owner add a payment method and set a Tesla billing limit? | Tesla disables apps without a payment method; default billing limit is 0 | Spend cap in app defaults to USD 9.00/month; owner sets Tesla's own limit separately | TASK-15 live | TASK-00 O5 |
| Q-05 | Is the Workers **Free** plan acceptable? Free has 10 ms CPU and 50 subrequests per invocation; the paid plan's price was not verified here and would affect "subscription-free". Cloudflare log retention for the plan is also unverified. | Architecture sizes work units for Free limits | Design for Free; measure CPU and subrequests in TASK-14/16; if insufficient, stop and ask the owner before choosing Paid | TASK-14, 16, 21 | `SYSTEM_ARCHITECTURE.md` §7 |
| Q-06 | Will the owner supply (or authorise) one **read-only** `live_status` and `site_info` call and share a redacted response? | Settles native signs, field names, cadence, billing category, available controls | Persist no unverified live data as `quality = OK`; adapter `MOCK_ONLY` for sign handling | TASK-15/16 live | TASK-00 O6 |
| Q-07 | Confirm retention defaults: raw snapshots 90 days, energy intervals and hourly rollups 800 days, daily and cost rollups until deletion, commands and audit 24 months. Also Supabase backup retention vs deletion requests. | Privacy and storage | As listed in `DATABASE_DESIGN.md` §4 | TASK-03, 16, 21 | `PRIVACY.md` |
| Q-08 | When provider interval resolution is coarser than tariff bands, should cost be `UNPRICEABLE_AT_RESOLUTION` (default) or opt-in `PRORATA_ESTIMATE`? | Resolution honesty versus completeness | Default unpriceable; pro-rata is opt-in and labelled `ESTIMATE` | TASK-10/11/13 | `ENERGY_ACCOUNTING.md` §5 |
| Q-09 | Real tariff details: VAT treatment of export credits, standing charge, levies the bill shows, day/night and any time-of-use or dynamic plan. | Cost correctness | Export tariff `tax_mode` default `NONE`; all Irish values are `ILLUSTRATIVE EXAMPLE` | TASK-10/12 fixtures | `ENERGY_ACCOUNTING.md` §6 |
| Q-10 | Lawful basis, privacy notice, DPA and transfer review for Supabase and Cloudflare; will anyone outside the owner's own household get an account in v1? | GDPR role | Treat as owner-only until answered; no onboarding of others | Before inviting others | `PRIVACY.md` |
| Q-11 | Does the owner's Powerwall hardware/firmware support the controls wanted (operation mode, backup reserve, grid import/export, storm mode, TOU)? | Hardware restrictions are undocumented | Controls disabled (`controls_enabled = false`), mock only | TASK-17 live | TASK-00 O7 |
| Q-12 | Sign-up policy: open sign-up creating zero-privilege users (default), or disable sign-up and create users only by invitation flow? Which email provider sends confirmation emails? | Abuse and onboarding | Open sign-up, zero privilege, email confirmation required; revisit after Supabase settings are verified in TASK-07 | TASK-07 | `SECURITY_MODEL.md` §3 |
| Q-13 | Supabase project settings: EU region, asymmetric JWT signing keys enabled (HS256 is refused by the Worker), email confirmation on. | Worker JWT verification | Worker health check fails and the app refuses protected routes if the project issues HS256 tokens | TASK-02/07/14 | Supabase V8, V9 |
| Q-14 | Do Powerwall energy commands need signing/virtual-key pairing, and can energy sites stream via Fleet Telemetry? (undocumented in the pages reached) | Command and ingestion design | Not used; polling and unsigned calls only if the docs/Tesla later confirm; otherwise stop | TASK-15/17 | TASK-00 Q7, Q11 |
| Q-15 | Is MFA required for ADMIN accounts in v1 (Supabase MFA availability and policy unverified)? | Account takeover risk | Recommended, not required; recorded as a known limitation | TASK-07/21 | `SECURITY_MODEL.md` §10 |

## 2. External dependencies and owner actions

| Dependency | Owner action | Needed by |
|---|---|---|
| Tesla developer application, approval, client id/secret | `docs/research/TESLA_SETUP_STEPS.md` | TASK-15 live |
| Domain on Cloudflare, public key hosted | same | TASK-15, 21 |
| Supabase project (EU region), asymmetric signing keys | create project; settings per Q-13 | TASK-03 onward (local Supabase via Docker needs no cloud project until deployment) |
| Cloudflare account, Wrangler login | create account; secrets set by the owner only | TASK-14, 21 |
| GitHub: protect `main`, required checks, private vulnerability reporting | Per `HowToBuild.docx` setup | TASK-02 |
| Local tools: Node LTS, Git, Docker, Supabase CLI, Wrangler | Per `HowToBuild.docx` | TASK-02 |
| Read-only Tesla sample (redacted) | Q-06 | TASK-15/16 live |
| Legal/privacy review | Q-10 | before inviting others |

## 3. Cross-references to unverified vendor facts

Collected here so none is forgotten: Workers paid price, Supabase plan limits, `aud` claim of Supabase JWTs, `supabase gen types` command syntax, `.well-known` static-asset handling, Supabase MFA availability, Cloudflare log retention, rate-limiting mechanism for Workers, tz library choice for DST handling, exact `decimal.js` and `zod` versions to pin.
