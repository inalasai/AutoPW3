# Known Limitations

Append-only register. Use the status vocabulary: VERIFIED, MOCK_ONLY, AWAITING_CREDENTIALS, AWAITING_PROVIDER_APPROVAL, UNSUPPORTED_BY_DEVICE, UNVERIFIED, NOT_EXECUTED.

| ID | Area | Limitation | Status | Added in |
|---|---|---|---|---|
| L-001 | Tesla integration | Live Fleet API behaviour not yet verified against an authorised site | UNVERIFIED | TASK-00 |
| L-002 | Scope | Native mobile app, multi-household UX, non-Tesla inverters, billing are out of v1 | — | kit |
| L-003 | Tesla integration | Native sign convention, field names and update cadence of live_status are not documented in the pages reached; Tesla adapter normalisation cannot be written yet | UNVERIFIED | TASK-00 |
| L-004 | Tesla integration | EU Fleet API base URL not found in official pages reached; discover via GET /api/1/users/region | UNVERIFIED | TASK-00 |
| L-005 | Tesla integration | Payload schemas for backup, operation, grid_import_export, storm_mode and off_grid_vehicle_charging_reserve are not documented in the pages reached; controls are mock-only | UNVERIFIED | TASK-00 |
| L-006 | Tesla integration | Whether energy commands need signing, and whether Powerwall supports Fleet Telemetry streaming, is not documented in the pages reached | UNVERIFIED | TASK-00 |
| L-007 | Tesla integration | Historical data allowed period values, time-zone format, resolution and retention not documented in the pages reached | UNVERIFIED | TASK-00 |
| L-008 | Cost | Fleet API is pay-per-use with a USD 10 monthly discount and a mandatory payment method; continuous polling is not free. Billing category of energy endpoints unverified | AWAITING_PROVIDER_APPROVAL | TASK-00 |
| L-009 | Tesla integration | Forced charging, forced export, solar bypass and islanding are not documented | UNSUPPORTED_BY_DEVICE | TASK-00 |
| L-010 | Access | Approval of an individual (non-business) developer application and the Fleet API agreement terms are unconfirmed | AWAITING_PROVIDER_APPROVAL | TASK-00 |
| L-011 | Security | Supabase session token is held in browser storage (XSS risk); mitigated by CSP and no third-party scripts | UNVERIFIED | TASK-01 |
| L-012 | Security | MFA for ADMIN is recommended, not enforced in v1; Supabase MFA availability unverified | UNVERIFIED | TASK-01 |
| L-013 | Platform | Workers Free limits (10 ms CPU, 50 subrequests) may be too tight; paid plan price unverified | UNVERIFIED | TASK-01 |
| L-014 | Platform | Cron Triggers give no exact-time guarantee; all jobs are idempotent and catch up; automation misses beyond the recovery window are skipped | UNVERIFIED | TASK-01 |
| L-015 | Data | Provider energy resolution and field availability unknown; costs may be reported unpriceable at coarse resolution | UNVERIFIED | TASK-01 |
| L-016 | Data | No table partitioning in v1; revisit above about 10 million rows per table | NOT_EXECUTED | TASK-01 |
| L-017 | Privacy | Lawful basis, DPA and transfer review not done; app treated as owner-only | UNVERIFIED | TASK-01 |
| L-018 | Privacy | Deleted data may persist in Supabase backups for their retention window | UNVERIFIED | TASK-01 |
| L-019 | UX | Invitations are shared by copying a link; no email delivery in v1 | NOT_EXECUTED | TASK-01 |
| L-020 | Hosting | `.well-known` public key file serving as a Worker static asset and Cloudflare-managed nameserver requirement not yet tested | UNVERIFIED | TASK-01 |
| L-021 | Quality | The float-money lint rule only forbids parseFloat and .toFixed(); other float arithmetic on money is not detected by tooling | NOT_EXECUTED | TASK-02 |
| L-022 | Testing | Worker tests run in Node with a fake ASSETS binding, not in workerd; real-runtime behaviour is checked only by manual wrangler dev | NOT_EXECUTED | TASK-02 |
| L-023 | CI | .github/workflows/ci.yml has not run on GitHub; Linux and Node 22 behaviour is unverified | NOT_EXECUTED | TASK-02 |
| L-024 | Security | The Content-Security-Policy in pps/web/public/_headers forbids inline styles and scripts; UI libraries that inject inline styles will need a reviewed policy change | NOT_EXECUTED | TASK-02 |
| L-025 | Tooling | 	ypescript is held at 6.0.3 because 	ypescript-eslint does not yet support TypeScript 7 (D-025) | UNVERIFIED | TASK-02 |