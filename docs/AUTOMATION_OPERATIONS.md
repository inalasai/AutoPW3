# AUTOMATION_OPERATIONS.md — Automation Engine Runbook & Safety Architecture

**Status:** APPROVED (TASK-18)  
**Applies to:** Cloudflare Worker Automation Engine, Scheduled Cron Dispatcher, AutomationManager UI

---

## 1. Safety Architecture & Core Invariants

AutoPW3 automates residential energy storage devices with real electrical and financial impacts. The automation engine is built around fail-safe defaults, transparent auditability, and defense-in-depth safety rules:

1. **Real Automation is Off by Default (Rule D-003 & Task 18 Requirement):**
   - Every rule is created in `DRY_RUN` or `DISABLED` mode.
   - In `DRY_RUN` mode, rule conditions are evaluated against live telemetry and active tariffs, and the outcome is recorded in `automation_executions` with decision `WOULD_ACT`.
   - **`DRY_RUN` evaluations never call device control endpoints or mutate physical hardware.**
   - Promoting a rule to `ACTIVE` requires explicit administrative action by an `ADMIN` user.
2. **Prohibited Control Invariants (Rule D-003):**
   - The engine strictly prohibits creating or executing rules for:
     - Forced grid charging (`FORCE_GRID_CHARGE`)
     - Forced grid export (`FORCE_GRID_EXPORT`)
     - Inverter solar bypass (`SOLAR_BYPASS`)
     - Manual grid islanding (`MANUAL_ISLANDING`)
   - Any rule requesting unverified capabilities (such as off-grid vehicle charging reserve or time-of-use schedule push) is aborted with decision `SKIPPED_CAPABILITY`.
3. **Task 17 Command Service Integration:**
   - Active automation rules never dispatch raw HTTP payloads or call vendor APIs directly.
   - All actions flow strictly through `executeDeviceCommand` with `origin: 'AUTOMATION'`.
   - Actions inherit the full Task 17 lifecycle: intent recording before dispatch, concurrency locking, and post-dispatch read-back reconciliation (`CONFIRMED`).
4. **Emergency Automation Pause Switch:**
   - Household accounts feature an authoritative `automation_paused` switch stored in the database.
   - When paused, all automated evaluations are aborted with decision `SKIPPED_PAUSED`. Manual commands remain available to authorized users.

---

## 2. Evaluation Engine & Condition Logic

The rule evaluator (`apps/worker/src/services/automation/evaluator.ts`) computes decisions deterministically during each scheduled execution slot:

### 2.1 Condition Types
A rule definition specifies a list of conditions joined by logical **AND** (all conditions must be satisfied):

- **`TIME_WINDOW`:**
  - Evaluates local site time using `localDateAndMinute(now, site.timezone)`.
  - Supports day types: `ALL`, `WEEKDAY` (Monday–Friday), and `WEEKEND` (Saturday–Sunday).
  - Matches if `localMinute >= startMinute` and `localMinute < endMinute`.
- **`BATTERY_SOC`:**
  - Compares the latest battery state of charge (`batterySocPercent`) against a target percentage using standard comparators (`LT`, `LTE`, `GT`, `GTE`).
- **`IMPORT_RATE`:**
  - Compares the active utility tariff import rate per kWh against a target rate using `decimal.js` arithmetic (no floats, per Rule D-014).

### 2.2 Decision Outcomes
Every evaluation produces a recorded row in `automation_executions` with one of the following decisions:

| Decision | Meaning | Actions Dispatched |
|---|---|---|
| `WOULD_ACT` | Rule matched all conditions in `DRY_RUN` mode | **None** (simulated action recorded) |
| `ACTED` | Rule matched all conditions in `ACTIVE` mode | Dispatched via `executeDeviceCommand` |
| `NO_ACTION` | One or more conditions did not match | None |
| `SKIPPED_CONFLICT` | Conditions matched, but superseded by higher priority rule | None |
| `SKIPPED_PAUSED` | Automation is globally paused for this household | None |
| `SKIPPED_STALE` | Telemetry is older than freshness threshold (stale/expired) | None |
| `SKIPPED_CAPABILITY` | Action requires unsupported or unverified capability | None |
| `SKIPPED_MISSED` | Execution slot delayed beyond `maxMissedMinutes` threshold | None |
| `ERROR` | Unexpected evaluation error occurred | None |

### 2.3 Priority Conflict Resolution
When multiple rules match during the same scheduled slot:
1. Rules are evaluated in descending order of their `priority` integer (higher priority evaluates first).
2. The highest-priority matching rule claims execution (`WOULD_ACT` or `ACTED`).
3. Lower-priority matching rules targeting the same control domain are marked `SKIPPED_CONFLICT` with an explanatory reason naming the winning rule.

---

## 3. Scheduled Cron Execution & Idempotency

Automated rule evaluations execute periodically (e.g., every 5 minutes) via Cloudflare Worker scheduled triggers (`apps/worker/src/services/ingestion/dispatcher.ts`):

```
 Scheduled Cron Trigger (e.g. */5 * * * *)
                    │
                    ▼
     [runAutomationForSite(siteId, slot)]
                    │
       ┌────────────┴────────────┐
       ▼                         ▼
 [Check Missed Slot]      [Check Freshness]
  (delay > 15m ->          (stale ->
   SKIPPED_MISSED)          SKIPPED_STALE)
       │                         │
       └────────────┬────────────┘
                    ▼
        [Evaluate Rule Hierarchy]
        (Sorted by Priority DESC)
                    │
                    ▼
       [Atomic Slot Idempotency Barrier]
   (ruleId, siteId, scheduledSlot) recorded
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
    [DRY_RUN]              [ACTIVE]
        │                      │
        ▼                      ▼
 Record WOULD_ACT       Dispatch Command
(Zero Dispatches)      (executeDeviceCommand)
```

### Slot Idempotency & Duplicate Prevention
To prevent duplicate actions under cron retries or delayed worker wakes:
- Execution slot keys are derived deterministically as `(ruleId, siteId, scheduledSlot)`.
- The database enforces uniqueness on `automation_executions(rule_id, site_id, scheduled_slot)`.
- If an execution was already recorded for that slot, subsequent attempts immediately return without dispatching duplicate commands.

---

## 4. Role-Based Permissions & Guardrails

| Action | READ_ONLY | READ_WRITE | ADMIN |
|---|:---:|:---:|:---:|
| View Rules & Execution History | Allowed | Allowed | Allowed |
| Create Rule (Defaults to DRY_RUN) | Blocked | Allowed | Allowed |
| Edit Rule Parameters | Blocked | Allowed | Allowed |
| Delete Rule | Blocked | Allowed | Allowed |
| Activate Rule (`mode: ACTIVE`) | Blocked | Blocked | **Allowed** |
| Toggle Emergency Automation Pause | Blocked | Allowed | Allowed |

The frontend UI enforces these restrictions defensively by disabling buttons and rendering context notices. The backend Worker API and database Row-Level Security (RLS) policies are authoritative and reject unauthorized attempts with HTTP 403 / 422.

---

## 5. Operational Runbook

### 5.1 Creating & Verifying an Automated Rule
1. Navigate to **Automation** (`/automation`).
2. Click **New rule**.
3. Configure conditions (e.g., Night Time Window from 02:00 to 05:00, or Import Rate $\le$ 0.15/kWh).
4. Select the target action (e.g., Set Backup Reserve to 80%).
5. Save the rule. It is created in **`DRY_RUN`** mode.
6. Monitor the **Automation Execution History** table over the next scheduled periods. Verify that the rule evaluates to `WOULD_ACT` during the intended window and `NO_ACTION` outside it.
7. An administrator can then click **Activate** and confirm in the dialog to begin live dispatches.

### 5.2 Emergency Pause Procedures
If unexpected battery behavior occurs or during high-volatility electrical grid events:
1. Navigate to **Automation** or **Controls**.
2. Click **Emergency Pause**.
3. In the alert dialog, review the warning and click **Emergency Pause Now**.
4. The system updates the household `automation_paused` setting to `true`.
5. All subsequent scheduled rule evaluations immediately record `SKIPPED_PAUSED` and dispatch no commands.
6. Manual device controls remain fully operable.
7. Once resolved, an administrator or write-permitted user clicks **Resume Automation** to re-enable automated rule execution.

### 5.3 Troubleshooting Guide

- **Rule Evaluates to `SKIPPED_STALE`:**
  - *Cause:* Powerwall live telemetry has not updated within the freshness threshold.
  - *Resolution:* Check the Tesla link connection under Settings. Ensure the Cloudflare live-status ingestion cron is operational.
- **Rule Evaluates to `SKIPPED_CONFLICT`:**
  - *Cause:* Another rule with higher numerical `priority` matched the same evaluation slot.
  - *Resolution:* Review rule priorities in the Rule List. Increase the target rule's priority integer if it should take precedence.
- **Rule Evaluates to `SKIPPED_MISSED`:**
  - *Cause:* Worker scheduled execution was delayed by more than 15 minutes due to platform outage or backlog.
  - *Resolution:* The engine intentionally skips outdated commands to prevent executing actions at stale times of day. Normal execution resumes on the next scheduled slot.
