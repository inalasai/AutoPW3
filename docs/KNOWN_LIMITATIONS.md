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
