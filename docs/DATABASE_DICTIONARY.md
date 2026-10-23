# Database Data Dictionary

Status: **generated** by `npm run db:dictionary` from the applied migrations (PostgreSQL 17.10). Do not edit by hand: change the migration comments and regenerate.

Units and signs are also stated once in `docs/ENERGY_ACCOUNTING.md` section 2. Column names carry units (`_w` watts, `_wh` watt-hours, `_percent`, `_per_kwh`, `_seconds`). Power sign convention: solar >= 0; battery > 0 discharging, < 0 charging; grid > 0 importing, < 0 exporting; load >= 0. A NULL energy value means the provider did not supply it; it is never zero.

## audit_log

Append-only. metadata is written through a per-action allowlist and never contains tokens, JWTs or telemetry. Deleting a user nulls actor_user_id; the row stays.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | bigint | no |  |  |
| `household_id` | uuid | yes |  |  |
| `actor_type` | text | no |  |  |
| `actor_user_id` | uuid | yes |  |  |
| `action` | text | no |  |  |
| `target_type` | text | yes |  |  |
| `target_id` | text | yes |  |  |
| `metadata` | jsonb | no | `'{}'::jsonb` |  |
| `request_id` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

## automation_executions

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `rule_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `scheduled_slot` | timestamp with time zone | no |  | UTC slot this evaluation is for. With rule_id it is the idempotency key. |
| `evaluated_at` | timestamp with time zone | no | `now()` |  |
| `mode_at_evaluation` | text | no |  |  |
| `decision` | text | no |  |  |
| `reason` | text | yes |  |  |
| `command_id` | uuid | yes |  |  |

## automation_rules

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `household_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `mode` | text | no | `'DISABLED'::text` |  |
| `priority` | integer | no | `100` |  |
| `definition` | jsonb | no |  |  |
| `definition_version` | integer | no | `1` |  |
| `version` | bigint | no | `1` | Optimistic-concurrency counter, incremented by the API on every change. |
| `created_by` | uuid | yes |  |  |
| `updated_by` | uuid | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

## cost_rollups_daily

Derived cache, unrounded (scale 8); rounding happens once per displayed line in the money formatter (D-014). Safe to delete and rebuild.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `site_id` | uuid | no |  |  |
| `local_date` | date | no |  |  |
| `import_tariff_id` | uuid | yes |  |  |
| `export_tariff_id` | uuid | yes |  |  |
| `currency` | character(3) | no |  |  |
| `import_energy_cost` | numeric(18,8) | yes |  |  |
| `export_credit` | numeric(18,8) | yes |  |  |
| `standing_charge` | numeric(18,8) | yes |  |  |
| `levies` | numeric(18,8) | yes |  |  |
| `tax` | numeric(18,8) | yes |  |  |
| `net_cost` | numeric(18,8) | yes |  | Positive = cost to the household, negative = net credit. NULL when not fully priceable. |
| `completeness` | numeric(5,4) | no |  |  |
| `computed_at` | timestamp with time zone | no | `now()` |  |

## device_command_events

Append-only history of command state changes. UPDATE and direct DELETE are rejected by trigger.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | bigint | no |  |  |
| `command_id` | uuid | no |  |  |
| `at` | timestamp with time zone | no | `now()` |  |
| `from_state` | text | yes |  |  |
| `to_state` | text | no |  |  |
| `phase` | text | yes |  |  |
| `detail` | jsonb | yes |  |  |

## device_command_log

Intent row inserted user-scoped BEFORE any dispatch (D-015). HTTP 200 is never trusted: CONFIRMED requires read-back reconciliation.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `household_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `requested_by` | uuid | yes |  |  |
| `origin` | text | no |  |  |
| `automation_execution_id` | uuid | yes |  |  |
| `kind` | text | no |  |  |
| `params` | jsonb | no |  |  |
| `params_hash` | bytea | no |  | SHA-256 of the canonical params. Same key with a different hash is a conflict (409). |
| `idempotency_key` | text | no |  |  |
| `provider_mode` | text | no |  |  |
| `state` | text | no | `'PENDING'::text` | PENDING, CONFIRMED, FAILED or UNKNOWN. UNKNOWN is retried by reconciliation, never reported as success. |
| `phase` | text | no | `'RECORDED'::text` |  |
| `requested_at` | timestamp with time zone | no | `now()` |  |
| `dispatched_at` | timestamp with time zone | yes |  |  |
| `finished_at` | timestamp with time zone | yes |  |  |
| `error_code` | text | yes |  |  |
| `provider_http_status` | integer | yes |  |  |
| `result` | jsonb | yes |  |  |

## energy_intervals

Provider energy per interval [interval_start, interval_end), Wh. NULL means the provider did not supply the field.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `site_id` | uuid | no |  |  |
| `interval_start` | timestamp with time zone | no |  |  |
| `interval_end` | timestamp with time zone | no |  |  |
| `resolution_seconds` | integer | no |  |  |
| `solar_generated_wh` | numeric(14,3) | yes |  | Solar energy generated, Wh, >= 0. |
| `home_consumed_wh` | numeric(14,3) | yes |  | Energy consumed by the site load, Wh, >= 0. |
| `grid_import_wh` | numeric(14,3) | yes |  | Energy imported from the grid, Wh, >= 0. |
| `grid_export_wh` | numeric(14,3) | yes |  | Energy exported to the grid, Wh, >= 0. |
| `battery_charged_wh` | numeric(14,3) | yes |  | Energy into the battery, Wh, >= 0. |
| `battery_discharged_wh` | numeric(14,3) | yes |  | Energy out of the battery, Wh, >= 0. |
| `source` | text | no |  |  |
| `quality` | text | no | `'OK'::text` | DERIVED = integrated from power snapshots (lower confidence than provider energy). |
| `ingested_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

## energy_sites

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `household_id` | uuid | no |  |  |
| `provider` | text | no |  | Always TESLA. The Tesla mock adapter shares this value in local/test; it can never write DEMO data here (D-017). |
| `provider_site_id` | text | no |  |  |
| `name` | text | yes |  |  |
| `timezone` | text | no |  | IANA timezone of the site. Defines the local calendar day for rollups and tariffs. |
| `connection_state` | text | no | `'CONNECTING'::text` |  |
| `capabilities_snapshot` | jsonb | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

## household_invitations

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `household_id` | uuid | no |  |  |
| `email` | citext | yes |  |  |
| `role` | role_enum | no | `'READ_ONLY'::role_enum` |  |
| `token_hash` | bytea | no |  | SHA-256 (32 bytes) of the invitation token. The token itself is never stored. |
| `expires_at` | timestamp with time zone | no |  |  |
| `accepted_at` | timestamp with time zone | yes |  |  |
| `accepted_by` | uuid | yes |  |  |
| `revoked_at` | timestamp with time zone | yes |  |  |
| `created_by` | uuid | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

## household_members

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `household_id` | uuid | no |  |  |
| `user_id` | uuid | no |  |  |
| `role` | role_enum | no |  | The only place a role is stored. No default: new members are READ_ONLY by policy (TASK-04), never ADMIN by default. |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | uuid | yes |  |  |

## household_settings

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `household_id` | uuid | no |  |  |
| `monthly_spend_cap_usd` | numeric(8,2) | no | `9.00` | Estimated monthly Tesla spend cap in USD (D-023). Not a household tariff currency. |
| `live_background_interval_minutes` | integer | no | `30` |  |
| `live_on_demand_min_interval_seconds` | integer | no | `30` |  |
| `on_demand_monthly_allowance` | integer | no | `2000` |  |
| `raw_retention_days` | integer | no | `90` |  |
| `stale_after_seconds` | integer | no | `3600` |  |
| `automation_paused` | boolean | no | `false` |  |
| `paused_by` | uuid | yes |  |  |
| `paused_at` | timestamp with time zone | yes |  |  |
| `controls_enabled` | boolean | no | `false` | Device controls are off until an ADMIN enables them (D-006, D-015). |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `updated_by` | uuid | yes |  |  |

## households

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `name` | text | no |  |  |
| `timezone` | text | no |  | IANA timezone name, validated by trigger against pg_timezone_names. |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | uuid | yes |  |  |

## job_locks

Named short leases (for example token:<household>, fetch:live:<site>). Server-only.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `key` | text | no |  |  |
| `owner` | text | no |  |  |
| `lease_expires_at` | timestamp with time zone | no |  |  |

## oauth_states

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `state_hash` | bytea | no |  |  |
| `household_id` | uuid | no |  |  |
| `user_id` | uuid | no |  |  |
| `pkce_verifier_ciphertext` | bytea | no |  |  |
| `pkce_nonce` | bytea | no |  |  |
| `expires_at` | timestamp with time zone | no |  |  |
| `consumed_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

## powerwall_metrics_log

Raw power snapshots, normalised to the project sign convention. No raw provider payload is stored.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | bigint | no |  |  |
| `site_id` | uuid | no |  |  |
| `sampled_at` | timestamp with time zone | no |  | UTC instant of the sample: provider timestamp if given, else received_at (see timestamp_origin). |
| `received_at` | timestamp with time zone | no | `now()` |  |
| `timestamp_origin` | text | no |  |  |
| `solar_power_w` | numeric(12,2) | yes |  | Solar generation in W. >= 0. |
| `battery_power_w` | numeric(12,2) | yes |  | Battery power in W. > 0 discharging (supplying the site), < 0 charging. |
| `grid_power_w` | numeric(12,2) | yes |  | Grid power in W. > 0 importing from the grid, < 0 exporting to the grid. |
| `load_power_w` | numeric(12,2) | yes |  | Site load in W. >= 0. |
| `battery_soc_percent` | numeric(5,2) | yes |  | Battery state of charge, percent, 0 to 100. |
| `grid_status` | text | yes |  |  |
| `source` | text | no |  | Always TESLA. DEMO is rejected by CHECK (D-017). |
| `quality` | text | no | `'OK'::text` | OK, PARTIAL (a field missing) or SUSPECT (energy balance check failed; excluded from accounting). |

## provider_usage_daily

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `household_id` | uuid | no |  |  |
| `usage_day` | date | no |  | UTC date. The billing category of each endpoint is UNVERIFIED (D-023). |
| `category` | text | no |  |  |
| `request_count` | integer | no | `0` |  |
| `error_count` | integer | no | `0` |  |

## scheduled_jobs

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `kind` | text | no |  |  |
| `household_id` | uuid | yes |  |  |
| `site_id` | uuid | yes |  |  |
| `dedupe_key` | text | no |  | kind + scope + slot. Makes duplicate cron delivery enqueue one job. |
| `run_at` | timestamp with time zone | no |  |  |
| `state` | text | no | `'QUEUED'::text` |  |
| `attempts` | integer | no | `0` |  |
| `max_attempts` | integer | no | `5` |  |
| `lease_expires_at` | timestamp with time zone | yes |  |  |
| `locked_by` | text | yes |  |  |
| `payload` | jsonb | no | `'{}'::jsonb` | Job parameters. Never contains secrets, tokens or telemetry. |
| `last_error` | text | yes |  | Sanitised error text only (no tokens, no provider payloads). |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `finished_at` | timestamp with time zone | yes |  |  |

## system_bootstrap

At most one row (id is always true). Written once by the bootstrap function (TASK-04).

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | boolean | no | `true` |  |
| `completed_at` | timestamp with time zone | no | `now()` |  |
| `household_id` | uuid | yes |  |  |
| `bootstrap_by_email_hash` | bytea | yes |  |  |

## tariff_levies

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `tariff_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `kind` | text | no |  |  |
| `amount` | numeric(12,6) | no |  | Per kWh or per local day (see kind) in the tariff currency, scale 6. |
| `taxable` | boolean | no |  |  |

## tariff_overrides

Date-range replacement of the normal schedule [date_from, date_to), site-local dates. Higher priority wins; equal-priority overlaps are rejected.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `tariff_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `date_from` | date | no |  |  |
| `date_to` | date | no |  |  |
| `priority` | smallint | no | `0` |  |

## tariff_price_points

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `tariff_id` | uuid | no |  |  |
| `interval_start` | timestamp with time zone | no |  |  |
| `interval_end` | timestamp with time zone | no |  |  |
| `rate_per_kwh` | numeric(12,6) | no |  |  |

## tariff_seasons

Inclusive month/day ranges within a tariff; may wrap the year-end. Absence of seasons means all year. Overlap and gaps are validated by the tariff engine.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `tariff_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `start_month` | smallint | no |  |  |
| `start_day` | smallint | no |  |  |
| `end_month` | smallint | no |  |  |
| `end_day` | smallint | no |  |  |

## tariff_slots

Rate per local wall-clock time window. Local minutes, never UTC offsets, so schedules stay correct across DST (rule 7).

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `tariff_id` | uuid | no |  |  |
| `season_id` | uuid | yes |  |  |
| `override_id` | uuid | yes |  |  |
| `day_type` | text | no | `'ALL'::text` |  |
| `start_minute` | smallint | no |  | Minutes after local midnight, 0 to 1439, inclusive start. |
| `end_minute` | smallint | no |  | Minutes after local midnight, 1 to 1440, exclusive end (1440 = end of day). |
| `rate_per_kwh` | numeric(12,6) | no |  | Rate per kWh in the tariff currency, scale 6. |
| `label` | text | yes |  |  |

## telemetry_rollups_daily

Energy per site-local calendar day in Wh. day_end_utc - day_start_utc stores the real day length (DST).

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `site_id` | uuid | no |  |  |
| `local_date` | date | no |  | Calendar date in the site timezone. |
| `timezone` | text | no |  |  |
| `day_start_utc` | timestamp with time zone | no |  |  |
| `day_end_utc` | timestamp with time zone | no |  |  |
| `solar_generated_wh` | numeric(14,3) | yes |  | Solar energy generated in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `home_consumed_wh` | numeric(14,3) | yes |  | Energy consumed by the site load in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `grid_import_wh` | numeric(14,3) | yes |  | Energy imported from the grid in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `grid_export_wh` | numeric(14,3) | yes |  | Energy exported to the grid in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `battery_charged_wh` | numeric(14,3) | yes |  | Energy into the battery in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `battery_discharged_wh` | numeric(14,3) | yes |  | Energy out of the battery in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `completeness` | numeric(5,4) | no |  |  |
| `resolution_seconds_min` | integer | yes |  |  |
| `resolution_seconds_max` | integer | yes |  |  |
| `computed_at` | timestamp with time zone | no | `now()` |  |

## telemetry_rollups_hourly

Energy per UTC hour in Wh. completeness is covered time / bucket time; real min/max resolution is recorded.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `site_id` | uuid | no |  |  |
| `bucket_start` | timestamp with time zone | no |  |  |
| `solar_generated_wh` | numeric(14,3) | yes |  | Solar energy generated in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `home_consumed_wh` | numeric(14,3) | yes |  | Energy consumed by the site load in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `grid_import_wh` | numeric(14,3) | yes |  | Energy imported from the grid in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `grid_export_wh` | numeric(14,3) | yes |  | Energy exported to the grid in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `battery_charged_wh` | numeric(14,3) | yes |  | Energy into the battery in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `battery_discharged_wh` | numeric(14,3) | yes |  | Energy out of the battery in the bucket, Wh, >= 0. NULL = not available from the provider, never zero. |
| `sample_count` | integer | no | `0` |  |
| `covered_seconds` | integer | no | `0` |  |
| `completeness` | numeric(5,4) | no |  | Fraction of the bucket covered by data, 0 to 1. Never rounded up to hide gaps. |
| `resolution_seconds_min` | integer | yes |  |  |
| `resolution_seconds_max` | integer | yes |  |  |
| `computed_at` | timestamp with time zone | no | `now()` |  |

## telemetry_sync_state

Per-site ingestion cursors and health. HISTORY cursor = last completed interval end.

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `site_id` | uuid | no |  |  |
| `stream` | text | no |  |  |
| `last_attempt_at` | timestamp with time zone | yes |  |  |
| `last_success_at` | timestamp with time zone | yes |  |  |
| `last_status` | text | yes |  |  |
| `last_error_code` | text | yes |  |  |
| `cursor` | jsonb | yes |  |  |
| `latest_sample_at` | timestamp with time zone | yes |  |  |
| `consecutive_failures` | integer | no | `0` |  |

## tesla_credentials

Encrypted Tesla OAuth tokens. No access for anon or authenticated; only the Worker secret key reads it (docs/SECURITY_MODEL.md S1).

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `household_id` | uuid | no |  |  |
| `key_id` | text | no |  |  |
| `nonce` | bytea | no |  |  |
| `ciphertext` | bytea | no |  | AES-256-GCM ciphertext of {access_token, refresh_token}. Plaintext tokens are never stored. |
| `version` | integer | no | `1` |  |
| `scopes` | text[] | yes |  |  |
| `fleet_api_base_url` | text | no |  | Regional Fleet API base URL discovered per user. The EU value is UNVERIFIED (Q-02). |
| `status` | text | no | `'ACTIVE'::text` |  |
| `access_expires_at` | timestamp with time zone | yes |  |  |
| `refresh_issued_at` | timestamp with time zone | yes |  |  |
| `last_refresh_at` | timestamp with time zone | yes |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

## user_profiles

One row per auth user. Holds no role: roles live only in household_members (D-004).

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `user_id` | uuid | no |  |  |
| `display_name` | text | yes |  |  |
| `locale` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

## utility_tariffs

One row per tariff version per direction. Effective dates are site-local calendar dates in `timezone`, half-open [effective_from, effective_to).

| Column | Type | Null | Default | Meaning, unit, sign |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `household_id` | uuid | no |  |  |
| `site_id` | uuid | yes |  | NULL = household default tariff; otherwise applies to that site only. |
| `tariff_key` | uuid | no | `gen_random_uuid()` |  |
| `version` | integer | no | `1` |  |
| `name` | text | no |  |  |
| `direction` | text | no |  |  |
| `price_mode` | text | no |  |  |
| `currency` | character(3) | no |  | ISO 4217 code. Every money value derived from this tariff carries this currency. |
| `timezone` | text | no |  |  |
| `effective_from` | date | no |  |  |
| `effective_to` | date | yes |  |  |
| `tax_mode` | text | no | `'NONE'::text` |  |
| `vat_rate` | numeric(7,4) | yes |  | VAT/tax rate in percent (for example 23.0000 means 23 percent), 0 to 100. |
| `flat_rate_per_kwh` | numeric(12,6) | yes |  | Rate per kWh in the tariff currency, scale 6. Money is never a float (D-014). |
| `standing_charge_per_day` | numeric(12,6) | yes |  | Fixed charge per local day in the tariff currency. IMPORT tariffs only. |
| `export_payment_model` | text | yes |  | EXPORT tariffs only: PER_KWH pays for exported energy, NONE pays nothing. |
| `created_by` | uuid | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
