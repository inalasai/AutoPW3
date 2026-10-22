# Sign Convention Finding (TASK-00)

Date accessed: **2026-10-22**.

## Result
**The provider's native sign convention for Powerwall `live_status` is `UNVERIFIED`.** The official pages reached state only that the endpoint returns "power, state of energy, grid status, storm mode", that power values are in **watts** and energy values are in **watt-hours** (source S6: https://developer.tesla.com/docs/fleet-api/endpoints/energy). They do not give field names, which direction is positive for battery or grid, whether solar is always non-negative, how load is derived, the name of the battery-percentage field, its range, or the update cadence.

Per rule 3 this document does not state native signs from memory or from third-party sources. Third-party descriptions exist but are not an acceptable source for this project.

## Proposed AutoPW3 convention (from `02-PROJECT-CONTEXT.md`, rule 6)

| Quantity | Field | Sign / range |
|---|---|---|
| Solar generation | `solarPowerW` | ≥ 0 |
| Battery | `batteryPowerW` | > 0 discharging, < 0 charging |
| Grid | `gridPowerW` | > 0 importing, < 0 exporting |
| Load | `loadPowerW` | ≥ 0 |
| Battery level | `batterySocPercent` | 0–100 |
| Energy | `...Wh` | watt-hours |

Balance check: `loadPowerW ≈ solarPowerW + batteryPowerW + gridPowerW`.

## Units
- Power: provider = watts (S6) → matches `...W`. No conversion expected. **Confidence: High** (stated), though "watts" for every field in the response is only stated generally.
- Energy: provider = watt-hours (S6) → matches `...Wh`. **Confidence: High.**
- Battery percentage: provider field and range `UNVERIFIED`. May be reported as a percentage or as a fraction; do not assume.
- History durations (backup events) are in seconds (S6); convert to the project's duration representation at the adapter boundary.

## Normalisation required (to be completed in Task 15)
Normalisation happens **only** in `apps/worker/src/providers/tesla` (rule 6, import rules in `04-REPO-STRUCTURE.md`). The mapping table below has to be filled from a recorded, redacted real response and then covered by tests:

| Provider field | Provider sign/units | AutoPW3 field | Transform |
|---|---|---|---|
| (solar power) `UNVERIFIED` | `UNVERIFIED` | `solarPowerW` | `UNVERIFIED`; clamp or flag negative values as quality issue |
| (battery power) `UNVERIFIED` | `UNVERIFIED` | `batteryPowerW` | `UNVERIFIED`; maybe identity, maybe negate |
| (grid power) `UNVERIFIED` | `UNVERIFIED` | `gridPowerW` | `UNVERIFIED`; maybe identity, maybe negate |
| (load power) `UNVERIFIED` | `UNVERIFIED` | `loadPowerW` | `UNVERIFIED` |
| (battery percentage) `UNVERIFIED` | `UNVERIFIED` | `batterySocPercent` | `UNVERIFIED` |

## How to settle it safely
1. Owner supplies a redacted read-only `live_status` response (open question O6). No control calls.
2. Capture a few responses in different real situations (sun and no load; evening discharge; grid charging, if any; export) and compare against the Tesla mobile app's displayed flows.
3. Use the balance check above after transformation as a test oracle; record tolerance and any systematic residual in the handoff.
4. Until then: the Tesla adapter must stay `MOCK_ONLY` for sign handling, and ingestion must refuse to write live telemetry from the Tesla adapter if the balance check fails by more than the agreed tolerance (quality flag, not silent correction).

## Risk
If signs are inverted and un-noticed, cost and savings analytics would be wrong in a way that looks plausible. Treat this as a blocking verification item before Task 16 (ingestion) writes live data.
