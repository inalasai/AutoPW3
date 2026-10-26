# AutoPW3 — Disaster Recovery and Backup Guide

Operational recovery runbook for database restores, migration rollbacks, token encryption key rotation, and disaster response.

---

## 1. Backup Strategy and Policy

AutoPW3 manages high-value operational and analytical data: household configurations, member roles, historical energy intervals, tariff versions, and immutable audit trails.

### 1.1 Automated Cloud Backups (Supabase)
- **Point-In-Time Recovery (PITR):** On Pro tier and above, enable Supabase PITR with physical WAL archiving to restore to any second within the past 7 days.
- **Daily Logical Dumps:** Supabase automated daily backups run at 02:00 UTC and are retained for 30 days.

### 1.2 Independent Offsite Backups
For subscription-free or standard instances, an offsite logical backup should be scheduled weekly via `pg_dump`:
```bash
# Dump clean schema and data excluding ephemeral metrics
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --exclude-table=public.job_locks \
  --dbname="postgresql://postgres:<db-password>@db.<project-ref>.supabase.co:5432/postgres" \
  --file="autopw3_backup_$(date +%Y%m%d_%H%M%S).dump"
```
Store the dump file in an encrypted, offsite bucket (e.g. AWS S3 Glacier or Cloudflare R2) with an object lock / immutability policy.

---

## 2. Restore Drill and Procedure

To restore from a logical backup file into a recovery or staging database:

```bash
# 1. Connect to destination recovery database
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="postgresql://postgres:<recovery-db-password>@db.<recovery-project-ref>.supabase.co:5432/postgres" \
  "autopw3_backup_<timestamp>.dump"

# 2. Run schema verification script
npm run db:verify
```

**Verification Steps Post-Restore:**
1. Check that `system_bootstrap` contains exactly one row (`id = true`).
2. Verify that household memberships exist and retain their designated roles.
3. Test read queries on `energy_intervals` and `powerwall_metrics_log`.

---

## 3. Migration Rollbacks and Schema Fixes

AutoPW3 migrations (`supabase/migrations/`) are designed to be strictly backward-compatible and idempotent (`IF NOT EXISTS` / `OR REPLACE`).

### 3.1 Rollback Philosophy
- **Never perform destructive rollbacks on live tables** (e.g. dropping columns containing historical energy telemetry).
- If a migration introduces a bug, author a forward-fixing migration (e.g., `20261026000013_fix_attribute.sql`) rather than attempting to delete applied historical migrations.

### 3.2 Emergency Reversion
If an uncommitted or staging migration must be rolled back before widespread deployment:
1. Identify the previous stable migration timestamp.
2. In a transaction, revert the affected DDL statements (e.g., `ALTER TABLE ... DROP COLUMN ...`).
3. Delete the migration entry from `supabase_migrations.schema_migrations`.
4. Re-run `npm run db:verify` and `npm run db:test` to confirm schema integrity.

---

## 4. Encryption Key Rotation and Loss Recovery

Tesla OAuth credentials in `tesla_credentials` are encrypted at rest using AES-256-GCM. The active encryption key is held in Cloudflare Worker secret `TOKEN_ENCRYPTION_KEY`.

### 4.1 Scheduled Key Rotation Procedure
To rotate the encryption key without disrupting ongoing telemetry ingestion:
1. **Generate New Key:** Create a new 32-byte cryptographically random key:
   ```bash
   openssl rand -base64 32
   ```
2. **Set Staged Secret:** Set `TOKEN_ENCRYPTION_KEY_PREVIOUS` to the current active key:
   ```bash
   npx wrangler secret put TOKEN_ENCRYPTION_KEY_PREVIOUS
   # (Paste current key)
   ```
3. **Promote New Key:** Set `TOKEN_ENCRYPTION_KEY` to the newly generated key:
   ```bash
   npx wrangler secret put TOKEN_ENCRYPTION_KEY
   # (Paste new key)
   ```
4. **Run Re-encryption:** The Worker automatically uses `TOKEN_ENCRYPTION_KEY` for new writes, while successfully decrypting existing rows using `TOKEN_ENCRYPTION_KEY_PREVIOUS`. Scheduled background jobs re-encrypt all stored credentials under the new key.
5. **Retire Old Key:** Once all credential records are migrated to the new key ID, delete `TOKEN_ENCRYPTION_KEY_PREVIOUS`.

### 4.2 Disaster Scenario: Complete Key Loss
If `TOKEN_ENCRYPTION_KEY` is irrevocably lost or corrupted:
- **Impact:** Encrypted Tesla tokens cannot be decrypted. Telemetry ingestion and automated controls are suspended. **No telemetry history, tariffs, or accounts are lost.**
- **Recovery Procedure:**
  1. Generate a new `TOKEN_ENCRYPTION_KEY` and set it via `wrangler secret put TOKEN_ENCRYPTION_KEY`.
  2. The household administrator signs in, navigates to `/settings`, and clicks **Disconnect Tesla**.
  3. The administrator initiates a fresh Tesla OAuth authorization link.
  4. The newly received refresh token is encrypted under the new key and stored. Ingestion resumes automatically.

---

## 5. Service Disruption & Incident Runbook

| Incident | Immediate Action | Secondary Action |
|---|---|---|
| **Stale Telemetry (>300s)** | Check `/api/v1/health` and Cloudflare Worker cron invocation logs. Verify Tesla API status. | Check if monthly spend cap reached (`state: SPENT`). Refresh Tesla OAuth link if token expired. |
| **Erroneous Automation Dispatch** | Admin or member clicks **Emergency Pause** on `/controls` or `/automation` (`POST /automation/pause`). | Disables all dispatch immediately. Inspect `automation_executions` table for the matching rule and demote rule to `DRY_RUN`. |
| **Suspected Token Compromise** | Admin clicks **Disconnect Tesla** in `/settings` (`POST /provider/tesla/disconnect`). | Purges all credentials from `tesla_credentials`. Rotate `TOKEN_ENCRYPTION_KEY` in Cloudflare Worker secrets. Revoke application in Tesla account. |
| **Database Unreachable** | Check Supabase platform status. Verify connection pooler exhaustion. | Temporary Cloudflare Worker caching returns stale cached data with `stale: true` indicators rather than failing. |
