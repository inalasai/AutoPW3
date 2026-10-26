# Tesla Capability Matrix — AutoPW3

Authoritative capability matrix for residential Tesla Powerwall sites based on the Tesla Fleet API documentation (`developer.tesla.com`).

---

## 1. Classification Vocabulary

- **SUPPORTED**: Endpoint, parameters, and expected device behavior are documented in official vendor specifications and integrated into AutoPW3.
- **UNVERIFIED**: Documented in official endpoint lists, but exact request payload schemas, cadence, or hardware prerequisites are not confirmed by real hardware traces. Supported only via `MockTeslaClient` until verified against an authorized physical Powerwall site.
- **NOT_SUPPORTED**: Not offered by the Tesla Fleet API energy endpoints or prohibited by AutoPW3 safety rules (D-003). The system never invents or simulates these capabilities.
- **DISABLED_BY_SETTING**: Supported by the software, but disabled by site hardware feature flags or regional grid interconnect settings (e.g. `storm_mode_capable = false`).

---

## 2. Complete Capability Matrix

| Capability | Fleet API Endpoint | Method | Required Scope | Hardware / Feature Condition | Status | Documentation Reference |
|---|---|:---:|:---:|---|:---:|---|
| **Site Discovery** | `/api/1/products` | `GET` | `energy_device_data` | Must have energy site / battery mapped | **SUPPORTED** | developer.tesla.com S6 |
| **Site Information** | `/api/1/energy_sites/{id}/site_info` | `GET` | `energy_device_data` | Any Powerwall site | **SUPPORTED** | developer.tesla.com S6 |
| **Live Energy Status** | `/api/1/energy_sites/{id}/live_status` | `GET` | `energy_device_data` | Real-time telemetry feed | **SUPPORTED** | developer.tesla.com S6 |
| **Energy History** | `/api/1/energy_sites/{id}/calendar_history?kind=energy` | `GET` | `energy_device_data` | Query params: `start_date`, `end_date`, `period`, `time_zone` | **SUPPORTED** | developer.tesla.com S6 |
| **Backup Event History** | `/api/1/energy_sites/{id}/calendar_history?kind=backup` | `GET` | `energy_device_data` | Off-grid grid outage events | **SUPPORTED** | developer.tesla.com S6 |
| **Set Backup Reserve** | `/api/1/energy_sites/{id}/backup` | `POST` | `energy_cmds` | Powerwall battery installed | **SUPPORTED** | developer.tesla.com S6, S2 |
| **Set Operation Mode** | `/api/1/energy_sites/{id}/operation` | `POST` | `energy_cmds` | Modes: `autonomous`, `self_consumption` | **SUPPORTED** | developer.tesla.com S6, S2 |
| **Grid Charging Permission** | `/api/1/energy_sites/{id}/grid_import_export` | `POST` | `energy_cmds` | Permission toggle for grid charging | **SUPPORTED** | developer.tesla.com S6 |
| **Export Rule Permission** | `/api/1/energy_sites/{id}/grid_import_export` | `POST` | `energy_cmds` | Permission toggle for solar/battery export | **SUPPORTED** | developer.tesla.com S6 |
| **Storm Mode Participation** | `/api/1/energy_sites/{id}/storm_mode` | `POST` | `energy_cmds` | `storm_mode_capable === true` in `site_info` | **SUPPORTED** (Conditional) | developer.tesla.com S6, S2 |
| **Wall Connector History** | `/api/1/energy_sites/{id}/telemetry_history?kind=charge` | `GET` | `energy_device_data` | Paired Tesla Wall Connector required | **UNVERIFIED** | developer.tesla.com S6 |
| **Off-Grid EV Charging Reserve** | `/api/1/energy_sites/{id}/off_grid_vehicle_charging_reserve` | `POST` | `energy_cmds` | Paired Wall Connector & Powerwall | **UNVERIFIED** | developer.tesla.com S6 |
| **Time-of-Use Tariff Upload** | `/api/1/energy_sites/{id}/time_of_use_settings` | `POST` | `energy_cmds` | Time-of-use operational mode active | **UNVERIFIED** | developer.tesla.com S6 |
| **Regional Base URL Discovery** | `/api/1/users/region` | `GET` | User Access Token | Universal regional discovery | **SUPPORTED** | developer.tesla.com S8 |
| **Force Battery Charge** | None | — | — | Not exposed in official energy endpoints | **NOT_SUPPORTED** | D-003, Rule 3 |
| **Force Battery Export** | None | — | — | Not exposed in official energy endpoints | **NOT_SUPPORTED** | D-003, Rule 3 |
| **Solar Inverter Bypass** | None | — | — | Not exposed in official energy endpoints | **NOT_SUPPORTED** | D-003, Rule 3 |
| **Manual Islanding (Off-Grid)** | None | — | — | Not exposed in official energy endpoints | **NOT_SUPPORTED** | D-003, Rule 3 |
| **Inverter-Level Direct Control** | None | — | — | Not exposed in official energy endpoints | **NOT_SUPPORTED** | D-003, Rule 3 |

---

## 3. Operational Invariants & Safeguards

1. **Safety Enforced by Default**: Command execution defaults to `DRY_RUN` and `DISABLED`. Commands are never sent to live physical hardware without explicit user intervention.
2. **Read-Before-Write Verification**: Before issuing any command, the site's capability registry is evaluated against the latest `site_info`. If a capability is `UNVERIFIED` or `DISABLED_BY_SETTING`, dispatch is rejected.
3. **Idempotency Mandatory**: All mutating command endpoints require an `Idempotency-Key` header (8–128 chars) to prevent duplicate actuation during network retries.
