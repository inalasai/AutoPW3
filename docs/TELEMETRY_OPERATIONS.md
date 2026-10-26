# Telemetry Operations Guide

This document describes the operational architecture, sync mechanics, rollups, retention, and failure handling for AutoPW3 telemetry ingestion.

## 1. Architectural Overview

Telemetry ingestion in AutoPW3 is partitioned into independent pipelines to prevent failures in one stream from stalling others:

```
                  ┌──────────────────────┐
                  │ Cloudflare Scheduled │
                  │  Worker Dispatcher   │
                  └──────────┬───────────┘
                             │
     ┌───────────────────────┼────────────────────────┐
     │                       │                        │
     ▼                       ▼                        ▼
┌──────────────┐     ┌──────────────┐         ┌──────────────┐
│  Live Status │     │  Historical  │         │  Rollups &   │
│   Fetcher    │     │  Sync Engine │         │  Retention   │
│  (30-60s)    │     │  (15m cron)  │         │  (Hourly/1d) │
└──────┬───────┘     └──────┬───────┘         └──────┬───────┘
       │                    │                        │
       ▼                    ▼                        ▼
┌──────────────┐     ┌──────────────┐         ┌──────────────┐
│  powerwall_  │     │   energy_    │         │ hourly/daily │
│ metrics_log  │     │  intervals   │         │ rollups & gc │
└──────────────┘     └──────────────┘         └──────────────┘
```

1. **Live Status Fetcher**:
   - Polled every 30–60 seconds for active connected sites.
   - Calls Tesla Fleet API `/live_status`.
   - Normalises units and sign conventions via `ITeslaClient.normaliseLiveStatus`.
   - Evaluates data freshness (`FRESH`, `STALE`, `UNAVAILABLE`) against configurable threshold (default 3600s; 300s for tight monitoring).
   - Updates `sites.connection_state` (`LIVE`, `STALE`, or `ERROR`).
   - Persists instantaneous power readings to `powerwall_metrics_log`.

2. **Historical Sync Engine**:
   - Triggered periodically (e.g. every 15 minutes) or on-demand.
   - Queries Tesla Fleet API `/calendar_history` with `kind=energy`.
   - Uses a resumable cursor `lastCompletedIntervalEnd` stored in `telemetry_sync_state`.
   - Persists interval records into `energy_intervals`.
   - Isolates failures per site so an outage or rate limit on one household does not block others.

3. **Rollup & Aggregation Pipeline**:
   - **Hourly rollups**: Aggregates intervals falling strictly within UTC hour boundaries `[HH:00:00Z, (HH+1):00:00Z)`. Computes completeness, energy sums (Wh), and min/max resolution.
   - **Daily rollups**: Aggregates intervals over the site-local calendar day (from local midnight to next local midnight). Automatically adapts to DST transitions (23h, 24h, or 25h local days).
   - Supports idempotency and late-data recomputation when earlier intervals are backfilled.

4. **Retention & Housekeeping**:
   - Purges raw power samples older than 90 days.
   - Purges completed or dead scheduled job execution records older than 30 days.
   - Supports `dryRun: true` mode for operational auditing prior to actual deletion.

---

## 2. Sign Conventions and Unit Normalisation (D-006)

All persisted records conform strictly to Decision D-006:
- **Solar Power**: Always non-negative (`solarPowerW >= 0`).
- **Battery Power**: Positive indicates discharge (`batteryPowerW > 0`); negative indicates charge (`batteryPowerW < 0`).
- **Grid Power**: Positive indicates import from grid (`gridPowerW > 0`); negative indicates export to grid (`gridPowerW < 0`).
- **Units**: Field names explicitly embed units: `...W` (watts) for power samples, `...Wh` (watt-hours) for energy intervals.

### Zero Tolerance for Demo Source in Live Tables
Any attempt to insert records with `source = 'DEMO'` into `powerwall_metrics_log` or `energy_intervals` is rejected with an invariant error. Demo simulation data remains strictly isolated in memory or ephemeral browser state.

---

## 3. Resumable Historical Sync Mechanics

Sync state is tracked per site and sync type in `telemetry_sync_state`:
- `site_id`: UUID of the energy site.
- `sync_type`: `'LIVE'` or `'HISTORY'`.
- `last_cursor`: ISO timestamp representing `lastCompletedIntervalEnd`.
- `last_status`: `'IDLE'`, `'RUNNING'`, `'SUCCESS'`, `'PARTIAL'`, or `'FAILED'`.
- `last_error_code`: Error classification (e.g. `'RATE_LIMITED'`, `'UNAUTHORIZED'`, `'NETWORK'`).
- `consecutive_failures`: Failure counter used for exponential backoff.

### Resume Algorithm:
1. When a history sync job starts for a site, it reads `telemetry_sync_state` for `sync_type = 'HISTORY'`.
2. If `last_cursor` is present, `startDate` begins at `last_cursor`.
3. If no cursor exists, it defaults to the initial backfill horizon (e.g. 30 days ago).
4. As interval batches are received and committed to `energy_intervals`, `last_cursor` is advanced to the latest completed interval end timestamp.
5. If an API call fails mid-backfill, progress up to the last committed batch is preserved. Next run resumes directly from `last_cursor`.

---

## 4. Rollup Computation & DST Handling

### Hourly Rollups
- Grouping: UTC timestamp floored to hour: `floor(intervalStart to UTC hour)`.
- Intervals spanning across an hour boundary are split proportionally to boundary fractions.
- Completeness ratio: `sum(intervalDurationSeconds) / 3600`.

### Daily Rollups
- Grouping: Site's configured IANA timezone (`sites.timezone`, e.g. `'Europe/London'`).
- Local day boundaries: Local midnight `00:00:00` to next local midnight `00:00:00`.
  - Standard day: 86,400 seconds (24h).
  - DST Spring forward: 82,800 seconds (23h).
  - DST Autumn fall back: 90,000 seconds (25h).
- Completeness: `sum(intervalDurationSeconds) / expectedLocalDaySeconds`.

---

## 5. Stale Detection & Connection State Machine

Sites transition through explicit connection states:

```
[DEMO] (Unconnected / Default)
   │
   │ (OAuth PKCE completed)
   ▼
[CONNECTING]
   │
   ├─── Live sample received within threshold ───► [LIVE]
   │                                                 │
   ├─── Live sample older than threshold ─────────► [STALE]
   │                                                 ▲
   └─── Auth expired or persistent errors ───────► [ERROR]
```

- **Threshold**: Configurable via `staleAfterSeconds` (default: 3600 seconds).
- **Skew Tolerance**: Readings timestamped more than 120 seconds into the future are flagged as `UNAVAILABLE` and logged as clock skew anomalies.

---

## 6. Retention and Cleanup Job

The retention job runs daily via Cloudflare Cron trigger:
```ts
const result = await purgeExpiredTelemetry(repo, {
  rawSampleRetentionDays: 90,
  jobLogRetentionDays: 30,
  dryRun: false,
});
```

To run dry-run verification:
```bash
# Execute worker maintenance dry-run
curl -X POST https://api.autopw3.com/api/v1/admin/maintenance/retention?dryRun=true
```
