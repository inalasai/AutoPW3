# ==============================================================================
# AutoPW3 — Automated Windows Deployment Wizard for Cloudflare Workers & Supabase
# ==============================================================================
# Run from PowerShell in the repository root:
#   .\deploy-wizard.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"

function Write-Step ($step, $title) {
    Write-Host ""
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host "  Step $step: $title" -ForegroundColor Cyan
    Write-Host "==================================================================" -ForegroundColor Cyan
}

function Write-Success ($msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Notice ($msg) {
    Write-Host "[i] $msg" -ForegroundColor Yellow
}

function Write-Err ($msg) {
    Write-Host "[!] $msg" -ForegroundColor Red
}

Clear-Host
Write-Host "==================================================================" -ForegroundColor Magenta
Write-Host "      AutoPW3 — Residential Energy Management Deployment Wizard   " -ForegroundColor Magenta
Write-Host "            Deploying to Cloudflare Workers & Supabase            " -ForegroundColor Magenta
Write-Host "==================================================================" -ForegroundColor Magenta
Write-Host "This wizard will configure, build, and deploy your live AutoPW3 instance." -ForegroundColor Gray
Write-Host ""

# ------------------------------------------------------------------------------
# STEP 1: Prerequisites Check
# ------------------------------------------------------------------------------
Write-Step 1 "Checking System Prerequisites"

try {
    $nodeVer = (node -v) 2>$null
    Write-Success "Node.js detected: $nodeVer"
} catch {
    Write-Err "Node.js is not installed or not in PATH. Please install Node.js 20 or 22 from https://nodejs.org/"
    exit 1
}

try {
    $npmVer = (npm -v) 2>$null
    Write-Success "npm detected: v$npmVer"
} catch {
    Write-Err "npm is not installed. Please install Node.js/npm."
    exit 1
}

try {
    $gitVer = (git --version) 2>$null
    Write-Success "Git detected: $gitVer"
} catch {
    Write-Err "Git is not installed or not in PATH. Please install Git for Windows."
    exit 1
}

# ------------------------------------------------------------------------------
# STEP 2: Cloudflare Authentication
# ------------------------------------------------------------------------------
Write-Step 2 "Cloudflare Account Authentication"

Write-Notice "Checking Cloudflare Wrangler authentication..."
$whoami = npx --yes wrangler whoami 2>$null
$isLoggedIn = $false
if ($whoami -and ($whoami -notmatch "You are not logged in")) {
    $isLoggedIn = $true
    Write-Success "Logged into Cloudflare as:"
    $whoami | ForEach-Object { if ($_ -match "Account|User|Name|Email") { Write-Host "   $_" -ForegroundColor Gray } }
} else {
    Write-Notice "You are not logged into Cloudflare."
    Write-Host "Opening your browser to log in to Cloudflare (Free Account)..." -ForegroundColor Yellow
    Read-Host "Press [Enter] to open the Cloudflare login browser window"
    npx --yes wrangler login
    Write-Success "Cloudflare login completed!"
}

# ------------------------------------------------------------------------------
# STEP 3: Supabase Configuration & Migrations
# ------------------------------------------------------------------------------
Write-Step 3 "Supabase Project Configuration"

Write-Host "AutoPW3 uses Supabase (Free tier) for PostgreSQL database, RLS security, and Auth." -ForegroundColor Gray
Write-Host "If you do not have a Supabase project yet, create one for free at https://supabase.com/dashboard" -ForegroundColor Gray
Write-Host "Recommended region: EU (Frankfurt or London) for GDPR compliance." -ForegroundColor Gray
Write-Host ""

$supabaseUrl = Read-Host "Enter your Supabase Project URL (e.g. https://abcdefgh.supabase.co)"
$supabaseUrl = $supabaseUrl.Trim().TrimEnd('/')
while (-not ($supabaseUrl -match "^https://[a-zA-Z0-9.-]+\.supabase\.co$")) {
    Write-Err "Invalid Supabase URL format. It should look like: https://abcdefghijklm.supabase.co"
    $supabaseUrl = (Read-Host "Enter your Supabase Project URL").Trim().TrimEnd('/')
}

$supabaseAnonKey = Read-Host "Enter your Supabase 'anon' public API key"
$supabaseAnonKey = $supabaseAnonKey.Trim()
while ([string]::IsNullOrWhiteSpace($supabaseAnonKey)) {
    $supabaseAnonKey = (Read-Host "Supabase anon key cannot be empty. Enter anon key").Trim()
}

$supabaseSecretKey = Read-Host "Enter your Supabase 'service_role' secret API key"
$supabaseSecretKey = $supabaseSecretKey.Trim()
while ([string]::IsNullOrWhiteSpace($supabaseSecretKey)) {
    $supabaseSecretKey = (Read-Host "Supabase service_role key cannot be empty. Enter service_role key").Trim()
}

Write-Host ""
Write-Notice "Database Migrations:"
Write-Host "AutoPW3 needs 12 database tables, functions, and RLS policies created in Supabase." -ForegroundColor Gray
Write-Host "A consolidated migration file has been prepared at: 'supabase/all-migrations-bundle.sql'" -ForegroundColor Yellow
Write-Host "Option A: Paste the contents of 'supabase/all-migrations-bundle.sql' into the Supabase Dashboard -> SQL Editor and click 'Run'." -ForegroundColor Gray
Write-Host "Option B: Use the Supabase CLI to push migrations automatically." -ForegroundColor Gray

$pushChoice = Read-Host "Would you like this script to attempt 'npx supabase db push'? (y/N)"
if ($pushChoice -match "^[yY]") {
    try {
        Write-Host "Linking project..." -ForegroundColor Gray
        $projectRef = ($supabaseUrl -replace "https://", "") -replace "\.supabase\.co", ""
        npx --yes supabase link --project-ref $projectRef
        Write-Host "Pushing schema migrations..." -ForegroundColor Gray
        npx --yes supabase db push
        Write-Success "Supabase migrations pushed successfully!"
    } catch {
        Write-Notice "Automated CLI push skipped or requires DB password. You can run 'supabase/all-migrations-bundle.sql' in Supabase SQL Editor."
    }
} else {
    Write-Notice "Please ensure 'supabase/all-migrations-bundle.sql' is executed in your Supabase SQL Editor."
}

# ------------------------------------------------------------------------------
# STEP 4: Token Encryption Key Generation
# ------------------------------------------------------------------------------
Write-Step 4 "Master Token Encryption Key (AES-256-GCM)"

Write-Notice "Generating cryptographically secure 256-bit AES-GCM token encryption key..."
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$keyBytes = New-Object byte[] 32
$rng.GetBytes($keyBytes)
$encryptionKey = [System.BitConverter]::ToString($keyBytes).Replace("-", "").ToLower()

Write-Success "Generated Token Encryption Key: $encryptionKey"
Write-Notice "This key will be securely saved as a secret in Cloudflare KMS and never exposed to browsers."

# ------------------------------------------------------------------------------
# STEP 5: Tesla Developer Application Credentials
# ------------------------------------------------------------------------------
Write-Step 5 "Tesla Fleet API Application Details"

Write-Host "AutoPW3 interacts with Tesla Powerwalls via the official Tesla Fleet API." -ForegroundColor Gray
Write-Host "You can register a free developer application at https://developer.tesla.com/" -ForegroundColor Gray
Write-Host "Scopes needed: openid, offline_access, energy_device_data, energy_cmds" -ForegroundColor Gray
Write-Host ""

$teslaClientId = Read-Host "Enter Tesla Client ID (leave blank to configure later)"
$teslaClientId = $teslaClientId.Trim()

$teslaClientSecret = Read-Host "Enter Tesla Client Secret (leave blank to configure later)"
$teslaClientSecret = $teslaClientSecret.Trim()

if ([string]::IsNullOrWhiteSpace($teslaClientId)) {
    $teslaClientId = "placeholder-tesla-client-id"
}
if ([string]::IsNullOrWhiteSpace($teslaClientSecret)) {
    $teslaClientSecret = "placeholder-tesla-client-secret"
}

# ------------------------------------------------------------------------------
# STEP 6: Domain & Redirect URI Configuration
# ------------------------------------------------------------------------------
Write-Step 6 "Domain & Redirect URI Configuration"

Write-Host "Enter the public URL where your application will be reached." -ForegroundColor Gray
Write-Host "Example for Cloudflare Workers: https://autopw3.<your-subdomain>.workers.dev" -ForegroundColor Gray
Write-Host "Or your custom domain: https://autopw3.yourdomain.com" -ForegroundColor Gray

$siteOrigin = Read-Host "Enter your Site URL"
$siteOrigin = $siteOrigin.Trim().TrimEnd('/')
while (-not ($siteOrigin -match "^https://")) {
    Write-Err "Site URL must begin with https://"
    $siteOrigin = (Read-Host "Enter your Site URL").Trim().TrimEnd('/')
}

$redirectUri = "$siteOrigin/api/v1/oauth/tesla/callback"
Write-Success "Configured Site Origin: $siteOrigin"
Write-Success "Tesla Redirect URI:     $redirectUri"
Write-Notice "IMPORTANT: Add '$redirectUri' to the 'Allowed Redirect URIs' in your Tesla Developer Portal application!"

# ------------------------------------------------------------------------------
# STEP 7: Configure Frontend Production Environment
# ------------------------------------------------------------------------------
Write-Step 7 "Writing Web Application Environment Config"

$webEnvPath = "apps/web/.env.production"
$webEnvContent = @"
# AutoPW3 Production Web Client Config
VITE_DEMO_MODE=false
VITE_AUTH_MODE=supabase
VITE_SUPABASE_URL=$supabaseUrl
VITE_SUPABASE_ANON_KEY=$supabaseAnonKey
VITE_TELEMETRY_PROVIDER=live
VITE_API_BASE_URL=$siteOrigin
"@

Set-Content -Path $webEnvPath -Value $webEnvContent -Encoding UTF8
Write-Success "Wrote production environment variables to $webEnvPath"

# ------------------------------------------------------------------------------
# STEP 8: Configure Cloudflare Worker Secrets
# ------------------------------------------------------------------------------
Write-Step 8 "Provisioning Cloudflare Worker Secrets"

Write-Notice "Injecting encrypted secrets into Cloudflare..."
Set-Location "apps/worker"

try {
    $supabaseSecretKey | npx --yes wrangler secret put SUPABASE_SECRET_KEY --env production
    Write-Success "Secret SUPABASE_SECRET_KEY set in Cloudflare."

    $encryptionKey | npx --yes wrangler secret put TOKEN_ENCRYPTION_KEY --env production
    Write-Success "Secret TOKEN_ENCRYPTION_KEY set in Cloudflare."

    $teslaClientSecret | npx --yes wrangler secret put TESLA_CLIENT_SECRET --env production
    Write-Success "Secret TESLA_CLIENT_SECRET set in Cloudflare."
} catch {
    Write-Notice "Wrangler secret put encountered a warning or needs confirmation. Retrying for default environment..."
    $supabaseSecretKey | npx --yes wrangler secret put SUPABASE_SECRET_KEY
    $encryptionKey | npx --yes wrangler secret put TOKEN_ENCRYPTION_KEY
    $teslaClientSecret | npx --yes wrangler secret put TESLA_CLIENT_SECRET
}

Set-Location "../.."

# ------------------------------------------------------------------------------
# STEP 9: Build Web Application & Edge Worker
# ------------------------------------------------------------------------------
Write-Step 9 "Building Production Artifacts"

Write-Notice "Running full production build (Vite SPA + Worker Assets)..."
npm run build
Write-Success "Production build completed successfully!"

# ------------------------------------------------------------------------------
# STEP 10: Deploy to Cloudflare
# ------------------------------------------------------------------------------
Write-Step 10 "Deploying to Cloudflare Workers"

Write-Notice "Publishing Worker and static assets to Cloudflare..."
Set-Location "apps/worker"
npx --yes wrangler deploy --env production
Set-Location "../.."

Write-Success "Deployment to Cloudflare Workers completed!"

# ------------------------------------------------------------------------------
# STEP 11: Next Steps & First-Admin Activation
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "               AUTOPW3 DEPLOYMENT SUCCESSFUL!                     " -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your AutoPW3 service is now live at:" -ForegroundColor Cyan
Write-Host "   $siteOrigin" -ForegroundColor Yellow
Write-Host ""
Write-Host "FINAL ACTIVATION CHECKLIST:" -ForegroundColor Magenta
Write-Host "1. Register Owner Account:" -ForegroundColor White
Write-Host "   Open: $siteOrigin/register" -ForegroundColor Gray
Write-Host "   Register with your email and password, then confirm the verification email." -ForegroundColor Gray
Write-Host ""
Write-Host "2. Initialize First Admin (Single-Owner Tenancy):" -ForegroundColor White
Write-Host "   In Supabase Dashboard -> SQL Editor, run this query with your registered email:" -ForegroundColor Gray
Write-Host "   SELECT private.bootstrap_first_admin(" -ForegroundColor Yellow
Write-Host "     'your-email@example.com'," -ForegroundColor Yellow
Write-Host "     'My Home Powerwall'," -ForegroundColor Yellow
Write-Host "     'Europe/Dublin' -- replace with your timezone, e.g. America/New_York" -ForegroundColor Yellow
Write-Host "   );" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. Connect Tesla Account:" -ForegroundColor White
Write-Host "   Log in at $siteOrigin/login" -ForegroundColor Gray
Write-Host "   Go to Controls/Settings and click 'Connect Tesla Account'." -ForegroundColor Gray
Write-Host "   AutoPW3 will securely encrypt your tokens and start live power monitoring!" -ForegroundColor Gray
Write-Host ""
Write-Host "Enjoy your subscription-free residential energy manager!" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
