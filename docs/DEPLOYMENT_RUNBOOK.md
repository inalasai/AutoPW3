# AutoPW3 — Production Deployment Runbook

**Task:** TASK-21 Deployment and Release  
**Target Architecture:** Cloudflare Workers (Static Assets + API + Cron) + Supabase (PostgreSQL with RLS, Auth) + Tesla Fleet API  
**Security Invariant:** Never write or commit real credentials. Use Cloudflare Worker secrets and Supabase dashboard environment settings exclusively.

---

## 1. Prerequisites and Planning

### 1.1 Target Environments
- **Local Development:** Vite dev server on `http://localhost:5173` (demo mode, mock auth) or `http://localhost:8787` (local wrangler dev with `apps/worker/.dev.vars`).
- **Staging:** Cloudflare Workers environment (`staging`), dedicated Supabase project (EU region), sandbox/mock Tesla credentials.
- **Production:** Cloudflare Workers custom domain, production Supabase project (EU region: Frankfurt `eu-central-1` or London `eu-west-2` for GDPR compliance), registered Tesla Fleet API production app.

### 1.2 Deployment Ordering Principle
Always apply changes in this strict order:
1. **Database Schema:** Apply backward-compatible migrations first (`supabase db push` / migration runner).
2. **Secrets & Configurations:** Configure or rotate Worker secrets (`wrangler secret put`).
3. **Application Bundle:** Deploy frontend and Worker together as a single atomic unit (`npm run build && wrangler deploy`).
4. **Post-Deploy Health Checks:** Verify `/api/v1/health`, public CSP headers, and single-admin bootstrap.

---

## 2. Step 1: Supabase Setup (Database & Authentication)

### 2.1 Project Creation & Region
1. Create a new project in the [Supabase Dashboard](https://supabase.com/dashboard).
2. **Region Selection:** Select an EU region (e.g., `eu-central-1` Frankfurt or `eu-west-2` London) to guarantee GDPR residency for telemetry and accounting records.
3. Record the following credentials securely in your password manager:
   - **Project URL:** `https://<project-ref>.supabase.co`
   - **Anon Public Key:** `eyJhbGciOi...` (Safe for public client)
   - **Service Role Secret Key:** `eyJhbGciOi...` (Server-only Worker secret, bypasses RLS)
   - **Database Connection URI:** Available under *Project Settings -> Database -> Connection URI* in Supabase Dashboard.

### 2.2 Applying Migrations
Apply all 12 versioned migrations in `supabase/migrations/` in numerical sequence:
```bash
# Using Supabase CLI linked to your project
supabase link --project-ref <project-ref>
supabase db push
```
Verify that all 29 design tables and 52 RLS policies are active:
- Confirm RLS is enabled on all public tables: `households`, `household_members`, `sites`, `tariffs`, `powerwall_metrics_log`, `energy_intervals`, `automation_rules`, `device_commands`, `audit_log`.
- Confirm `tesla_credentials` has 0 policies and no privileges granted to `anon` or `authenticated`.

### 2.3 Authentication Configuration
In the Supabase Dashboard under **Authentication**:
1. **Email Provider:** Enable Email / Password signup. Enable **Confirm email** (`requireConfirmation = true`).
2. **Password Policy:** Minimum 12 characters; require at least one number and one symbol.
3. **Site URL:** Set to your production domain (e.g., `https://autopw3.example.com`).
4. **Redirect URLs:** Add:
   - `https://autopw3.example.com/auth/callback`
   - `https://autopw3.example.com/reset-password`
   - `https://autopw3.example.com/invite/*`

### 2.4 Executing the First-Admin Bootstrap
To establish initial ownership securely without race conditions:
1. Complete registration for the owner's email address in the web application (e.g., `admin@example.com`) and confirm the email.
2. Note the newly generated user UUID from the Supabase Auth dashboard (`<owner-user-id>`).
3. Connect with a trusted SQL console (Supabase SQL Editor or `psql` using `service_role`):
   ```sql
   SELECT private.bootstrap_first_admin(
     '<owner-user-id>'::uuid,
     'Primary Household',
     'UTC'
   );
   ```
4. Verify that `system_bootstrap` contains exactly one row (`id = true`). Attempting to re-run `bootstrap_first_admin` will fail with an exception, guaranteeing that no second admin can ever be bootstrapped.

---

## 3. Step 2: Tesla Fleet API Developer Configuration

### 3.1 Application Registration
1. In the [Tesla Developer Portal](https://developer.tesla.com/), create a new application for AutoPW3.
2. Configure OAuth 2.0 parameters:
   - **Application Type:** Web Application (Third-Party Authorization Code Flow with PKCE).
   - **Allowed Scopes:**
     - `openid`
     - `offline_access`
     - `energy_device_data` (Read-only Powerwall telemetry, live status, site details)
     - `energy_cmds` (Required ONLY if hardware controls and automations are enabled by the admin)
   - **Allowed Redirect URIs:**
     - Production: `https://autopw3.example.com/api/v1/oauth/tesla/callback`
     - Staging: `https://staging.autopw3.example.com/api/v1/oauth/tesla/callback`
3. Securely record:
   - `TESLA_CLIENT_ID`
   - `TESLA_CLIENT_SECRET` (Worker secret)

---

## 4. Step 3: Cloudflare Workers Deployment

### 4.1 Prerequisites & Installation
Ensure Wrangler is authenticated:
```bash
npx wrangler login
```

### 4.2 Setting Cloudflare Worker Secrets
Set all sensitive keys securely via `wrangler secret put` inside `apps/worker`:
```bash
cd apps/worker

# 1. Supabase Service Role Key (server-only, bypasses RLS)
npx wrangler secret put SUPABASE_SECRET_KEY

# 2. Master AES-256-GCM Token Encryption Key (generate 32 random bytes, base64-encoded)
# e.g., openssl rand -base64 32
npx wrangler secret put TOKEN_ENCRYPTION_KEY

# 3. Tesla Client Secret
npx wrangler secret put TESLA_CLIENT_SECRET
```

### 4.3 Environment Variables Configuration
In `apps/worker/wrangler.jsonc`, configure production variables:
```jsonc
{
  "name": "autopw3",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "triggers": {
    "crons": ["* * * * *"]
  },
  "vars": {
    "ENVIRONMENT": "production",
    "SUPABASE_URL": "https://<project-ref>.supabase.co",
    "SUPABASE_ANON_KEY": "<anon-public-key>",
    "TESLA_CLIENT_ID": "<tesla-client-id>",
    "TESLA_REDIRECT_URI": "https://autopw3.example.com/api/v1/oauth/tesla/callback",
    "ALLOWED_ORIGINS": "https://autopw3.example.com",
    "TESLA_MONTHLY_SPEND_CAP_USD": "9.00"
  }
}
```

### 4.4 Frontend Build Configuration
In `apps/web/.env.production`:
```ini
VITE_DEMO_MODE=false
VITE_AUTH_MODE=supabase
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
VITE_API_BASE_URL=https://autopw3.example.com
```

### 4.5 Production Build and Deployment
Run the root build and wrangler deploy command:
```bash
# 1. Build frontend and verify CSP injection
npm run build -w @autopw3/web

# 2. Deploy Worker (static web assets + API + cron loop)
cd apps/worker
npx wrangler deploy
```

---

## 5. Step 4: Post-Deployment Verification & Smoke Tests

Execute these verification checks immediately following deployment:
1. **Health Check:**
   ```bash
   curl -i https://autopw3.example.com/api/v1/health
   # Must return 200 OK with {"status": "ok", "environment": "production"}
   ```
2. **Security Headers & CSP Verification:**
   ```bash
   curl -I https://autopw3.example.com/
   # Verify presence of:
   # - Content-Security-Policy containing your Supabase origin in connect-src
   # - X-Frame-Options: DENY
   # - X-Content-Type-Options: nosniff
   # - Referrer-Policy: strict-origin-when-cross-origin
   ```
3. **Owner First-Run Verification:**
   - Sign in as the bootstrapped admin at `https://autopw3.example.com/login`.
   - Verify `/admin` loads with the sole owner member and `ADMIN` badge.
   - Navigate to `/settings` and review spend cap ($9.00 USD) and controls toggle (default disabled).
   - In `/settings`, initiate Tesla OAuth linking and verify redirect returns successfully.
   - Observe live status ingestion populating `/live`.
