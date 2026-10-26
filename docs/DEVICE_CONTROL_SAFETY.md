# DEVICE_CONTROL_SAFETY.md — Safe Device Controls Protocol

**Status:** APPROVED (TASK-17)  
**Applies to:** Cloudflare Worker Command Modules, Tesla API Provider Adapter, ControlMatrix UI

---

## 1. Safety Philosophy & Invariants

AutoPW3 controls residential energy hardware that carries real electrical, thermal, and economic consequences. The software follows defensive principles designed to eliminate safety hazards and unintended dispatches:

1. **Rule D-003 Safety Restrictions:**
   - **No Forced Grid Charging:** AutoPW3 will never issue commands to force high-power charging from the grid outside of standard Tesla battery modes.
   - **No Forced Grid Export:** AutoPW3 will never command forced battery discharge into the utility grid.
   - **No Solar Bypass:** Solar inverter hardware paths cannot be bypassed.
   - **No Manual Islanding:** Grid disconnection / island mode commands are strictly prohibited.
2. **Rule D-015 Honest Command Lifecycle:**
   - Command states are strictly honest: `PENDING`, `CONFIRMED`, `FAILED`, `UNKNOWN`.
   - **HTTP 200 is never trusted alone.** The Tesla Fleet API accepting an HTTP request only indicates that the gateway received the command.
   - **Read-back reconciliation is mandatory for `CONFIRMED`.** The executor must re-read live site configuration from the provider (`/api/1/energy_sites/{site_id}/site_info`) and verify that the target parameter equals the read-back value.
   - **Physical Outcome Disclaimer:** `physicalOutcomeGuaranteed` is always `false`. Battery cell behaviour is governed by local BMS limits, cell balancing, thermal throttling, inverter capacity, and utility grid regulations.
3. **Intent Recording Before Dispatch:**
   - An intent row (`device_commands`) is written to the database in phase `RECORDED` before any network packet is dispatched to Tesla.
   - `(site_id, idempotency_key)` uniqueness and SHA-256 `params_hash` prevent duplicate execution under network retries.
4. **Emergency Automation Pause:**
   - Sites have an instantaneous pause switch (`automation_paused`). When paused, all automation-originated commands are blocked before dispatch.

---

## 2. Command State Machine

```
              ┌────────────────┐
              │  USER / RULE   │
              └───────┬────────┘
                      │ (POST /sites/{id}/commands)
                      ▼
              ┌────────────────┐
              │    RECORDED    │  (Intent row created, state: PENDING)
              └───────┬────────┘
                      │
                      ▼
              ┌────────────────┐
              │  DISPATCHING   │  (Idempotency lock acquired)
              └───────┬────────┘
                      │
         ┌────────────┴────────────┐
         ▼                         ▼
   [Dispatch Timeout]       [Dispatch OK]
         │                         │
         ▼                         ▼
  ┌──────────────┐         ┌───────────────┐
  │   UNKNOWN    │         │  DISPATCHED   │  (Provider accepted HTTP)
  └──────────────┘         └───────┬───────┘
                                   │
                                   ▼
                           ┌───────────────┐
                           │  RECONCILING  │  (Re-reading site configuration)
                           └───────┬───────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
            [Read-back Match]           [Read-back Mismatch]
                    │                             │
                    ▼                             ▼
            ┌───────────────┐             ┌───────────────┐
            │   CONFIRMED   │             │    FAILED     │
            │ (phase: DONE) │             │ (phase: DONE) │
            └───────────────┘             └───────────────┘
```

### State Transitions:
- `PENDING` (`RECORDED`): Intent persisted; authorization, capability checks, and safety bounds verified.
- `PENDING` (`DISPATCHING`): Network dispatch initiated with 15-second timeout.
- `PENDING` (`DISPATCHED`): Tesla API returned HTTP 200 OK.
- `PENDING` (`RECONCILING`): Fetching current site info to confirm actual setting change.
- `CONFIRMED` (`DONE`): Read-back matches requested setting.
- `FAILED` (`DONE`): API rejected request (4xx/5xx) or read-back failed.
- `UNKNOWN` (`DONE`): Network timeout, socket hangup, or ambiguous status. The user is alerted to inspect the physical system.

---

## 3. Supported vs Disabled Operations Matrix

| Operation | Registry Status | Backend Behavior | UI Representation |
| :--- | :--- | :--- | :--- |
| `SET_BACKUP_RESERVE` | `SUPPORTED` | Dispatches via `setBackupReserve`, reconciles `backup_reserve_percent` | Stepper / Slider (0–100%, 5% steps) with `ConfirmDialog` |
| `SET_OPERATION_MODE` | `SUPPORTED` | Dispatches via `setOperationMode`, reconciles `default_real_mode` | Mode radio group (`self_consumption`, `autonomous`, `backup`) |
| `SET_STORM_MODE` | `SUPPORTED` | Dispatches via `setStormMode`, reconciles `storm_mode_active` | Toggle switch with confirmation dialog |
| `SET_GRID_IMPORT_EXPORT` | `SUPPORTED` | Dispatches via `setGridImportExport` | Configuration switch |
| `SET_OFF_GRID_VEHICLE_CHARGING_RESERVE` | `UNVERIFIED` | Rejects with `VALIDATION_FAILED` (422) | Disabled with badge `UNVERIFIED` (pending hardware test) |
| `SET_TIME_OF_USE_SETTINGS` | `UNVERIFIED` | Rejects with `VALIDATION_FAILED` (422) | Disabled with badge `UNVERIFIED` (pending hardware test) |
| `FORCE_GRID_CHARGE` | `NOT_SUPPORTED` | Rejects with `VALIDATION_FAILED` (422) | Disabled with badge `NOT SUPPORTED` (D-003 safety restriction) |
| `FORCE_GRID_EXPORT` | `NOT_SUPPORTED` | Rejects with `VALIDATION_FAILED` (422) | Disabled with badge `NOT SUPPORTED` (D-003 safety restriction) |
| `SOLAR_BYPASS` | `NOT_SUPPORTED` | Rejects with `VALIDATION_FAILED` (422) | Disabled with badge `NOT SUPPORTED` (D-003 safety restriction) |
| `MANUAL_ISLANDING` | `NOT_SUPPORTED` | Rejects with `VALIDATION_FAILED` (422) | Disabled with badge `NOT SUPPORTED` (D-003 safety restriction) |

---

## 4. Owner Procedure: Cautious Real-Device Testing

When deploying AutoPW3 to a physical installation for the very first time, the site owner must follow this step-by-step verification procedure:

### Prerequisites:
1. Ensure the official **Tesla Mobile App** is installed on your phone and you are logged into the site owner account.
2. Confirm your Powerwall is online, healthy, and not in an active utility grid outage.
3. Note your current backup reserve percentage (e.g. 20%).

### Step 1: Baseline Verification
- Open AutoPW3 and navigate to `/controls`.
- Verify the active configuration displayed matches what is reported in the Tesla app.
- Check that the `Site Capability Registry` table shows `SUPPORTED` for standard operations and `UNVERIFIED` / `NOT_SUPPORTED` for restricted controls.

### Step 2: Emergency Automation Pause Test
- Click `Emergency Pause`.
- Confirm the dialog.
- Verify that the status banner updates to `AUTOMATION PAUSED` (amber badge).
- Click `Resume Automation` and confirm; verify status returns to `AUTOMATION ACTIVE` (emerald badge).

### Step 3: Low-Impact Manual Reserve Test
- Select a small 5% adjustment (e.g. adjust from 20% to 25%).
- Click `Apply Reserve`.
- In the confirmation dialog, review the target percentage and click `Dispatch Command`.
- Observe the command log:
  1. Status starts as `PENDING` (Phase: `RECORDED` → `DISPATCHED`).
  2. Status transitions to `CONFIRMED` upon read-back reconciliation.
- Open the official Tesla mobile app and refresh: verify the backup reserve slider in the Tesla app reflects 25%.

### Step 4: Revert to Original Configuration
- Return the reserve slider in AutoPW3 to your original baseline (e.g. 20%).
- Confirm and dispatch.
- Confirm that read-back reconciliation succeeds and the Tesla app shows the baseline value.
