# AutoPW3 — Beginner's Step-by-Step Deployment Guide

Welcome to the **AutoPW3 Layman & Beginner Installation Guide**! This guide walks you through deploying your own live AutoPW3 energy management service to **Cloudflare** (100% free tier) and **Supabase** (100% free tier), and connecting your Tesla Powerwall.

No advanced programming knowledge is needed. An interactive **Windows Deployment Wizard** is included to do the heavy lifting for you!

---

## 1. What You Need Before You Start (All Free Accounts)

Before running the wizard, make sure you have:

1. **A Free Cloudflare Account:**
   - Sign up at [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
   - This hosts your website and runs the background energy sync service.
2. **A Free Supabase Account:**
   - Sign up at [https://supabase.com/dashboard](https://supabase.com/dashboard).
   - Create a project (we recommend choosing an EU region like Frankfurt or London).
3. **A Free Tesla Developer Account:**
   - Sign up at [https://developer.tesla.com/](https://developer.tesla.com/) using the same Tesla email account linked to your Powerwall.
   - Create a Web Application to get your **Client ID** and **Client Secret**.
4. **A Windows PC with Node.js installed:**
   - Download and install Node.js 22 (LTS) from [https://nodejs.org/](https://nodejs.org/).

---

## 2. Where to Find Your Supabase Keys

When you create your project on Supabase, navigate to **Project Settings -> API**:

![Supabase API Keys Dashboard](file:///d:/AI_Apps/AutoPW3/AutoPW3/docs/assets/supabase_setup_guide.jpg)

You will need three pieces of information from this screen:
1. **Project URL:** Looks like `https://abcdefghijklm.supabase.co`. Click the green copy button next to it.
2. **anon (public key):** Under *Project API Keys*. Safe for web browsers. Click the green copy button.
3. **service_role (secret key):** Under *Project API Keys*. This is your private admin key for Cloudflare. Click the red copy button.

---

## 3. Creating Your Tesla Fleet API Application

To connect your Tesla Powerwall, you need a free application registration on the Tesla Developer Portal:

1. Sign in to the [Tesla Developer Portal](https://developer.tesla.com/) using the **same Tesla email account** that has access to your Powerwall.
2. Click **Create Application**.
3. Under **Step 1 (Registration)** & **Step 2 (Application Details)**: Enter an application name (e.g., `AutoPW3 Energy Management`) and description.
4. Under **Step 3 (Client Details)**:

![Tesla Fleet API Client Details Setup](file:///d:/AI_Apps/AutoPW3/AutoPW3/docs/assets/tesla_developer_portal_setup.png)

Fill out the fields as shown below:

| Field | Value to Enter | Why |
| :--- | :--- | :--- |
| **OAuth Grant Type** | 🔘 **Authorisation Code and Machine-to-Machine** *(default)* | Allows household members to securely sign in and authorize Powerwall access. |
| **Allowed Origin URL(s)** | `https://autopw3.<your-subdomain>.workers.dev`<br>*(or `https://yourdomain.com` if using a custom domain)* | Your deployed website domain **without a trailing slash**. Click `+` to add `http://localhost:5173` if developing locally. |
| **Allowed Redirect URI(s)** | `https://autopw3.<your-subdomain>.workers.dev/api/v1/oauth/tesla/callback`<br>*(or `https://yourdomain.com/api/v1/oauth/tesla/callback`)* | The exact URL where Tesla redirects back after you click "Allow". *(AutoPW3 also supports `/api/v1/provider/tesla/callback`).* |
| **Allowed Returned URL(s)** | *(Leave blank / empty)* | This field is optional. |

5. Under **Step 4 (API & Scopes)**:
Select the following permissions required by AutoPW3:
- ✅ **`openid`**
- ✅ **`offline_access`** *(essential for 24/7 background telemetry sync & token refreshing)*
- ✅ **`user_data`**
- ✅ **`energy_device_data`** *(required to read live solar generation, battery SOC %, and grid flow)*
- ✅ **`energy_cmds`** *(required to change backup reserve %, operational mode, or storm mode)*

6. Finish creating the application. Tesla will display your **Client ID** and **Client Secret**. Keep these handy for the next step!

---

## 4. Running the Windows Deployment Wizard

Open **PowerShell** on your Windows PC, navigate to your AutoPW3 folder, and run:

```powershell
npm run deploy:wizard
```

*(Alternatively: right-click `deploy-wizard.ps1` and select "Run with PowerShell")*

### What the Wizard Looks Like:

![AutoPW3 Windows Deployment Wizard](file:///d:/AI_Apps/AutoPW3/AutoPW3/docs/assets/wizard_terminal_guide.jpg)

### What to Enter at Each Prompt:

| Wizard Step | What the Wizard Asks | What You Enter / Do |
| :--- | :--- | :--- |
| **Step 1: Check Prerequisites** | Checks Node.js, npm, and Git | Automatic. Just watch for the green `[OK]` marks. |
| **Step 2: Cloudflare Login** | Asks you to log in | Press **Enter**. A browser window will open. Click **Allow** to let Wrangler log in. |
| **Step 3: Supabase URL** | `Enter your Supabase Project URL` | Paste your Supabase Project URL (e.g. `https://abcdefg.supabase.co`). |
| **Step 3: Supabase Anon Key** | `Enter your Supabase 'anon' public API key` | Paste your `anon` key from the Supabase dashboard. |
| **Step 3: Supabase Service Key** | `Enter your Supabase 'service_role' secret API key` | Paste your `service_role` key from the Supabase dashboard. |
| **Step 3: Database Migrations** | `Would you like this script to attempt 'npx supabase db push'?` | Type `n` (No), unless you already use the Supabase CLI. *(See Step 5 below for the easy 1-click database setup)*. |
| **Step 4: Encryption Key** | Generates AES-256-GCM encryption key | Automatic. Generates a secure random 64-character key to protect your Tesla tokens. |
| **Step 5: Tesla Client ID** | `Enter Tesla Client ID` | Paste the Client ID from developer.tesla.com (or press Enter if waiting for approval). |
| **Step 5: Tesla Client Secret** | `Enter Tesla Client Secret` | Paste the Client Secret from developer.tesla.com (or press Enter if waiting for approval). |
| **Step 6: Site URL** | `Enter your Site URL` | Enter your target website address, for example: `https://autopw3.<your-name>.workers.dev` or your custom domain. |
| **Step 7–10: Build & Deploy** | Injects secrets, builds frontend, deploys worker | Automatic. Cloudflare will bundle your app and print your live website URL! |

---

## 5. Easy 1-Click Database Setup in Supabase

AutoPW3 requires 12 database tables to store energy readings, users, and tariffs safely. We have combined all 12 into a single file for you!

1. In your [Supabase Dashboard](https://supabase.com/dashboard), click **SQL Editor** on the left menu.
2. Click **New Query**.
3. Open the file [`supabase/all-migrations-bundle.sql`](file:///d:/AI_Apps/AutoPW3/AutoPW3/supabase/all-migrations-bundle.sql) on your computer, copy all its text, and paste it into the Supabase SQL editor.
4. Click the green **Run** button.
5. In 5 seconds, all tables, security policies, and functions are created!

---

## 6. Registering and Activating Your Service

Once deployed, your service is live on the internet! Here is how you register and link your Powerwall:

![AutoPW3 Registration and Tesla Connect Screen](file:///d:/AI_Apps/AutoPW3/AutoPW3/docs/assets/tesla_connect_flow.jpg)

### Step A: Register Your Account
1. Open your live site URL in your browser (e.g. `https://autopw3.<your-subdomain>.workers.dev/register`).
2. Type in your **Email Address** and a **Password** (must be 12+ characters with numbers/symbols).
3. Click **Register**.
4. Check your email inbox for a verification email from Supabase and click the confirmation link.

### Step B: Make Yourself the First Admin (Owner)
To prevent strangers from taking control of your Powerwall, AutoPW3 has a protected one-time setup command:
1. In the **Supabase Dashboard**, open the **SQL Editor**.
2. Type this single line (replace with your real registered email address):
   ```sql
   SELECT private.bootstrap_first_admin(
     'your-email@example.com',
     'My Home Powerwall',
     'Europe/Dublin' -- Change to your timezone, e.g. 'America/New_York' or 'Europe/London'
   );
   ```
3. Click **Run**. You are now officially recognized as the household `ADMIN`!

### Step C: Connect Your Tesla Account
1. Go back to your website at `/login` and sign in.
2. Navigate to **Controls** (or **Settings**).
3. Click the vibrant green button: **"Connect Tesla Account"**.
4. You will be redirected to Tesla’s official sign-in page. Log in with your Tesla credentials and authorize access to energy data.
5. Tesla redirects you back to AutoPW3.

**That's it!** AutoPW3 will encrypt your tokens, discover your Powerwall system, and automatically start displaying your live solar, battery, grid, and home energy flows with 0 subscription fees.
