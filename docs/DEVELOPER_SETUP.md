# AutoPW3 developer setup for Windows

Status: authoritative onboarding guide for the published Tesla integration. Local commands were
validated with Node 24.15.0, npm 11.12.1, Wrangler 4.152.0 and PostgreSQL 17.10. Supabase CLI is pinned
to 2.122.0. Account creation, Docker stack provisioning and deployments described below are optional
procedures, not operations performed by this publication task. Older task documents are historical;
use this guide for current setup and the [integration handoff](handoffs/TESLA-STAGING-INTEGRATION.md)
for the verified staging boundary.

## New developer checklist

- [ ] Install Git and the tested Node/npm versions; open a new PowerShell terminal.
- [ ] Get repository access through your own GitHub account and clone `Raj-AutoPW3`.
- [ ] Create your own feature branch and configure your GitHub-provided noreply email locally.
- [ ] Run `npm ci`, `npm run dev` and open `http://localhost:5173` in DEMO mode.
- [ ] Run typecheck, unit tests, database checks, build, lint and secret scan before a pull request.
- [ ] Use only your own local/hosted Supabase and Cloudflare resources when needed.
- [ ] Leave telemetry, polling, controls, automation and scheduled work disabled.
- [ ] Never request another developer's Tesla account, session, keys or infrastructure credentials.

The default path needs **no Tesla account/hardware, Docker, Supabase project or Cloudflare account**.
The optional hosted path creates resources in your accounts and requires your explicit authorization.
Nothing in this guide authorizes changes to another developer's services or the existing team staging.

## A. Prerequisites

Use Windows 11 x64 and PowerShell. Git and Node/npm are mandatory; an editor is recommended.
Docker/Supabase CLI are optional for a full local Auth stack. Wrangler comes from `npm ci`, and is
needed only for the local Worker/build or your own hosted Worker. GitHub CLI is optional.

Install Git and optionally VS Code using Windows Package Manager (App Installer supplies `winget`):

```powershell
winget --version
winget install --exact --id Git.Git
winget install --exact --id Microsoft.VisualStudioCode
```

For reproducible setup use **Node 24.15.0** and **npm 11.12.1**, the exact tested combination.
`package.json` declares Node `>=22`, and CI selects Node 22, but that is not a claim that every
Node 22 patch satisfies every dependency's engine range. Prefer the tested combination initially.
Download the x64 MSI from the [official Node archive](https://nodejs.org/dist/v24.15.0/):

```powershell
$NodeInstaller = Join-Path $env:TEMP 'node-v24.15.0-x64.msi'
Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/v24.15.0/node-v24.15.0-x64.msi' -OutFile $NodeInstaller
Get-AuthenticodeSignature -LiteralPath $NodeInstaller
# Continue only with a valid signature from the Node.js publisher.
Start-Process msiexec.exe -ArgumentList @('/i', $NodeInstaller) -Wait
# Open a NEW terminal after installation:
node --version
npm.cmd --version
npm.cmd install --global npm@11.12.1
git --version
```

Expected Node output is `v24.15.0`; npm output after installation is `11.12.1`.
Use `npm.cmd`/`npx.cmd` if Windows blocks the PowerShell shim; there is no need to weaken the
machine-wide execution policy. The commands below use `npm`/`npx` for readability.

Optional tools:

```powershell
winget install --exact --id Docker.DockerDesktop
winget install --exact --id GitHub.cli
# Open Docker Desktop, enable its WSL 2 backend and follow its reboot/virtualization prompts.
docker --version
docker info
gh --version
```

Docker's system requirements and licensing are separate from AutoPW3; review
[Docker's Windows installation guide](https://docs.docker.com/desktop/setup/install/windows-install/).
Do not install Supabase CLI globally through npm. From the cloned repo, use the pinned package:

```powershell
npx --yes supabase@2.122.0 --version
npx wrangler --version
```

The first Supabase invocation downloads its CLI; Wrangler is the lockfile dependency (4.152.0).
No Cloudflare login is needed for local mocks. Do not upgrade dependencies/CLIs during onboarding.

## B. GitHub account and repository workflow

1. Create your own account at [GitHub](https://github.com/signup), verify it and enable MFA.
2. Ask a repository maintainer to invite that account to `inalasai/AutoPW3`; accept the invitation.
   A maintainer grants repository access, not access to their cloud or Tesla accounts.
3. Authenticate using Git Credential Manager's browser flow during clone, or optional GitHub CLI:

```powershell
gh auth login --hostname github.com --git-protocol https --web
gh auth status
git clone --branch Raj-AutoPW3 https://github.com/inalasai/AutoPW3.git
Set-Location AutoPW3
git switch -c feature/your-handle-short-description
npm ci
```

Do not share a PAT or paste one into a clone URL. Copy your **actual** GitHub noreply address from
GitHub Settings → Emails, as described in [GitHub's commit-email guide](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address).
Configure only this repository; do not invent an address or copy another contributor's identity:

```powershell
git config --local user.name 'YOUR_GITHUB_LOGIN'
git config --local user.email 'YOUR_ACTUAL_GITHUB_NOREPLY_ADDRESS'
git remote -v
git branch -vv
```

Use your feature branch for all work. Do not push directly to another developer's branch, including
`Raj-AutoPW3`; the publication on that branch was an explicit one-time owner authorization.
Test, inspect the staged diff and push your branch, then open a PR:

```powershell
npm run typecheck
npm test
npm run secrets:scan
git diff --check
git add -- path/to/reviewed-file
git diff --cached --stat
git diff --cached
git commit -m 'feat: describe the reviewed change'
git push --set-upstream origin HEAD
gh pr create --base Raj-AutoPW3 --web
```

Update a clean feature branch without overwriting teammates:

```powershell
git status --short
git fetch origin
git merge origin/Raj-AutoPW3
```

Resolve conflicts locally, rerun checks and push normally. Keep unfinished work safe before merging;
never use destructive reset/clean or force-push a shared branch. Do not merge to `main` or publish a
release as part of setup. Browser-based PR creation is an alternative if `gh` is not installed.

## C. Cloudflare account and Worker setup

This section is optional. Create your own account at [Cloudflare](https://dash.cloudflare.com/sign-up),
verify email, enable MFA and open Workers & Pages. Enable Workers and choose your own workers.dev
subdomain. Review the plan/usage limits; do not join an operator's account to follow this guide.

After `npm ci`, authenticate Wrangler in a browser and verify that the selected account is yours:

```powershell
npx wrangler login
npx wrangler whoami
Copy-Item apps/worker/wrangler.developer.example.jsonc apps/worker/wrangler.developer.local.jsonc
code apps/worker/wrangler.developer.local.jsonc
```

The destination is ignored; the example is safe to commit. Replace the example Worker names with
unique names under your account, such as `autopw3-YOUR_HANDLE-dev`. Use a different Worker for each
developer. For hosted operation keep `env.staging.vars.ENVIRONMENT=staging`; the **name** can be unique
while the application's environment label remains `staging`. The Tesla handlers require that label.
Never use the existing team's `autopw3-staging` name. Committed configuration contains placeholders
and is not a deployment configuration. Do not deploy the root/default production environment.

All actual Worker variables are listed in section F. Put public non-secret variables in your private
config's `env.staging.vars`. Set URL, public key, app origin, allowed origin, Client ID, region and
exact callback for **your** services. Variables are not inherited automatically between Wrangler
environments; the example repeats the asset binding and complete staging vars intentionally.
`ASSETS` maps to `../web/dist`; no KV, D1, Queue or Durable Object binding is needed by this slice.
Supabase supplies durable storage. Do not add cron triggers.

Store these three privileged values through Cloudflare's encrypted Worker secrets, using prompts
rather than command-line values. These commands modify only your named environment and require your
authorization. If Wrangler offers to create a missing Worker, verify its name/account before accepting:

```powershell
$WorkerConfig = 'apps/worker/wrangler.developer.local.jsonc'
npx wrangler secret put SUPABASE_SECRET_KEY --config $WorkerConfig --env staging
npx wrangler secret put TESLA_CLIENT_SECRET --config $WorkerConfig --env staging
```

`secret list` lists names, not values. `SUPABASE_SECRET_KEY` must currently be your legacy service-role
JWT, not an opaque `sb_secret_` key; see D/F. For a brand-new credential store only, generate the
encryption key locally without printing it. For an existing store use its original backed-up key:

```powershell
New-Item -ItemType Directory -Force secrets | Out-Null
node --input-type=module -e "import {randomBytes} from 'node:crypto'; import {writeFileSync} from 'node:fs'; writeFileSync('secrets/token-encryption-key.txt', randomBytes(32).toString('hex')+'\n');"
Get-Content secrets/token-encryption-key.txt -Raw | npx wrangler secret put TOKEN_ENCRYPTION_KEY --config $WorkerConfig --env staging
npx wrangler secret list --config $WorkerConfig --env staging
```

Keep a secure password-manager backup of that key. Do not regenerate it after storing credentials;
changing it makes existing encrypted tokens unreadable. Runtime envelope version is currently 1;
there is no environment-variable-driven encryption-key rotation feature.

For local Worker development, `.dev.vars` supplies private values only to local Wrangler; it does not
upload secrets. Hosted secrets do not come from committing `.dev.vars`. Use section G for local
mock commands and section H for the authorized build/deploy sequence. The first deploy creates your
Worker; building alone never creates a Worker. Do not use `wrangler init` to replace this application.

For controlled diagnostics after deployment:

```powershell
npx wrangler deployments list --config $WorkerConfig --env staging
npx wrangler tail --config $WorkerConfig --env staging --format pretty
```

Collect only sanitized errors/request IDs. Raw event output can contain callback URLs, query codes
or request metadata: stop tail with Ctrl+C before Tesla OAuth, never export raw consent traffic,
headers/cookies, request bodies or provider responses. A rollback uses a recorded version of **your**
Worker, never another environment's version:

```powershell
$KnownGoodVersion = Read-Host 'Your own previously verified Worker version UUID'
npx wrangler rollback $KnownGoodVersion --config $WorkerConfig --env staging --message 'Revert failed developer deployment'
```

Verify login/assets and bindings again after rollback. Do not roll back databases, restore older
rotated tokens, delete refresh barriers or delete a linked site. Cloudflare changes/deployments in
this section were not executed by the publication task. See [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
and [secret management](https://developers.cloudflare.com/workers/configuration/secrets/).

## D. Supabase account, local stack and database

There are three distinct environments: your local Docker stack, your own hosted Supabase project,
and the owner's existing staging project. This guide uses only the first two. Never copy another
checkout's `supabase/.temp`, `.env`, sessions, credentials or database dumps.

### Local Supabase (optional)

Start Docker Desktop, verify `docker info`, then from the repo root:

```powershell
npx --yes supabase@2.122.0 start
npm run db:reset
```

The repo already has `supabase/config.toml`; do not run `supabase init --force`. The reset applies
all committed migrations and the local-only seed to your local stack and destroys prior **local**
data. Never add `--linked` to a reset. The CLI prints local URLs/keys: copy needed values privately,
not to chat, issues or logs. Studio is normally `http://127.0.0.1:54323`, API `http://127.0.0.1:54321`;
use the CLI's actual reported local mail-catcher URL for confirmation emails. Do not assume a port.
The committed local Auth config explicitly enables email confirmation, requires 12-character
passwords and allows the frontend's localhost callback/reset routes; it contains no hosted settings.

Configure `apps/web/.env.local` with your local API URL and public key, `VITE_DEMO_MODE=false` and
`VITE_TELEMETRY_PROVIDER=demo`; omit `VITE_AUTH_MODE=mock` for real local Auth. Sign up at `/register`,
confirm via local email, then sign in. New users have no household membership. Local Auth UI/RLS reads
do not by themselves activate Tesla endpoints: those require HTTPS and `ENVIRONMENT=staging`.
The Worker rejects HS256 user JWTs. A default local stack using HS256 therefore cannot authenticate
protected Worker calls; do not weaken verification. Use the mock browser tests or your independently
configured asymmetric hosted project for that path. The full Docker/Auth startup was NOT_EXECUTED
in this publication session; temporary PostgreSQL schema/security tests were executed.
See [Supabase local development](https://supabase.com/docs/guides/local-development/cli/getting-started).

### Your hosted project (optional, advanced)

1. Create your own account/organization at [Supabase](https://supabase.com/dashboard), then a new
   isolated project. Choose a region appropriate for your users/data residency; it does not replace
   Tesla's separate Fleet region. Save its strong database password in your password manager.
2. In the project's Connect/API settings obtain its HTTPS project URL and **publishable** key.
   Keep any server-privileged key out of frontend files. AutoPW3 currently needs the **legacy
   `service_role` JWT** for `SUPABASE_SECRET_KEY`, obtained from the project's legacy API keys section.
   The current RPC transport uses that key as a bearer JWT and rejects opaque `sb_secret_` keys.
   If your project does not offer the required compatible key, stop and arrange a reviewed transport
   update; do not substitute keys, use a user JWT as a service key, or relax grants.
3. Configure Auth's signing keys to issue asymmetric user JWTs supported by this Worker (ES256,
   RS256 or EdDSA) and confirm its JWKS endpoint works. HS256 user sessions are explicitly rejected.
   Signing keys and legacy server API keys are different credentials. Follow
   [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys).
4. Enable email/password sign-in, email confirmation and a minimum password length of 12. Disable
   anonymous sign-in. Set Auth Site URL to your exact HTTPS Worker origin. Allow exactly
   `<your-origin>/auth/callback` and `<your-origin>/reset-password`, plus legitimate localhost:5173
   versions for your local frontend. Do not add Tesla's callback as a Supabase Auth callback or use
   broad wildcard redirects. Supabase login and Tesla consent are separate flows.
5. Apply migrations only to your new project, with the safeguards below, then verify privileges.

### Safeguards for hosted migration commands

Use a fresh clone and your own CLI account. `supabase login` is optional for local-only development.
The following commands change your developer-owned hosted database; run them only when authorized.
Select the project reference from the dashboard you own, not a handoff or another developer's file:

```powershell
npx --yes supabase@2.122.0 login
npx --yes supabase@2.122.0 projects list
$MyProjectRef = Read-Host 'Reference of the NEW project you own'
if ($MyProjectRef -notmatch '^[a-z]{20}$') { throw 'Unexpected project reference format' }
npx --yes supabase@2.122.0 link --project-ref $MyProjectRef
if ($LASTEXITCODE -ne 0) { throw 'Link failed; stop' }
$LinkedRef = (Get-Content supabase/.temp/project-ref -Raw).Trim()
if ($LinkedRef -ne $MyProjectRef) { throw 'Wrong linked project; stop' }
$ConfirmProject = Read-Host 'Compare account/project in your dashboard; retype your NEW project reference'
if ($ConfirmProject -ne $MyProjectRef) { throw 'Project confirmation failed' }
npx --yes supabase@2.122.0 migration list --linked
npx --yes supabase@2.122.0 db push --linked --dry-run
# Inspect exact filenames/order; no unexpected remote-only or pending migrations.
# Continue only for the NEW project you own:
if ((Get-Content supabase/.temp/project-ref -Raw).Trim() -ne $MyProjectRef) { throw 'Project drift' }
npx --yes supabase@2.122.0 db push --linked
if ($LASTEXITCODE -ne 0) { throw 'Migration failed; stop without deploying' }
```

An identifier equality check alone does not prove ownership: inspect your dashboard/CLI account and
use a newly created isolated project. Never reuse an inherited `.temp` link. Never repair migration
history, reset a hosted database or apply `scripts/db/local-shim.sql` to Supabase to work around a
failure. A failed schema/privilege check stops later steps. This checkout has 22 ordered migrations;
use all of them on an empty project, including the five later OAuth/link/refresh/fencing migrations.
Refresh migrations install definitions and grants atomically as one DO statement each. They do not
need `auth` schema changes or permissive grants. See [Supabase migration workflow](https://supabase.com/docs/guides/deployment/database-migrations).

### Verify hosted schema, RPC access and RLS

On your own project's SQL editor, read metadata rather than credential rows:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
select n.nspname, c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by c.relname;
select p.proname,
  p.prosecdef, p.proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as user_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
  exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'tesla_discovery_refresh_context','begin_tesla_discovery_refresh',
  'finish_tesla_discovery_refresh','worker_stage_tesla_discovery_refresh',
  'link_discovered_tesla_site','worker_prepare_tesla_site_link');
select has_table_privilege('anon','public.tesla_credentials','SELECT') as anon_credentials,
       has_table_privilege('authenticated','public.tesla_credentials','SELECT') as user_credentials,
       has_table_privilege('authenticated','private.tesla_discovery_refresh_attempts','SELECT') as user_attempts;
```

All public tables must have RLS. The three credential/attempt SELECT results must be false.
User context/begin/finish/link functions are authenticated-only (no service/anon execution); server
stage/prepare functions are service-only (no user/anon execution). No PUBLIC execute grant is
permitted on these functions. Verify `pg_proc.proacl`/`aclexplode` if reviewing PUBLIC grants, and
keep the private schema unexposed. The test suites provide more exhaustive assertions than these
smoke queries. A missing RPC can require the operator's schema-cache refresh; never grant broader
access just to make it appear.

### Create a real test user, household and first ADMIN

Register and confirm your own test user using the app or your project's Auth dashboard. In your own
project's SQL editor, run the supported one-time provisioning function as the platform operator:

```sql
select private.bootstrap_first_admin('confirmed-user@example.test', 'Developer household', 'Europe/Dublin');
```

Replace the example email with your own confirmed user and choose your actual IANA timezone.
This audited function creates household, settings, ADMIN membership and the permanent bootstrap
marker in one transaction. It cannot run twice; no browser state can bootstrap authority. Sign out
and sign back in, then verify the household ADMIN membership from Auth/RLS and the UI. Do not insert
roles manually or weaken RLS. The local seed household has no members; bootstrap creates a separate
one and the seed refuses to run after bootstrap. See [ADMIN bootstrap](ADMIN_BOOTSTRAP.md).

Later members join by invitations created by a current ADMIN; authenticated `create_invitation`
and `change_member_role` RPCs enforce live household authority, no self-promotion and last-ADMIN
protection. `accept_invitation` is the app's signed-in invitation workflow. The broad hosted
administration API/UI is not fully wired in this staged slice, and generic Admin panels can display
demonstration fallbacks. Do not treat those displays as persisted membership or claim that the
hosted members-management UI is complete. Use the supported audited RPCs with an actual ADMIN
session when separately implementing/testing that workflow, not a service-role impersonation.

Run `npm run db:test`, `npm run db:verify` and `npm run db:types -- --check` locally after schema
changes. They use disposable PostgreSQL, not whichever hosted project your CLI is linked to.

## E. Tesla Developer application and Fleet API

**A Tesla Developer account does not automatically grant access to a Powerwall.** Real discovery
requires an authorized Tesla customer account with access to an eligible energy site. Developers
without hardware/site authorization use DEMO/mock mode and fixtures; do not borrow another person's
Tesla login or tokens. Tesla controls consent and can revoke access. Follow the
[official onboarding](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api).

1. Create your own verified Tesla account, enable MFA, then sign in at
   [Tesla Developer](https://developer.tesla.com/). Request/register a Fleet API application with
   truthful application/legal details, a unique name and your intended read-only use.
2. Set the application's allowed origin/domain to a domain you control. Register the exact callback
   `https://YOUR_APP_HOST/api/v1/provider/tesla/callback`, matching `TESLA_REDIRECT_URI` exactly.
   Do not use Supabase's `/auth/callback` or the app's `/tesla/oauth/complete` landing route here.
3. Obtain the application's Client ID and Client Secret from its access dashboard. The Client ID
   identifies the app and may be public; the secret stays in Worker secret bindings. Register only
   the permissions required by this workflow:

| Scope | Purpose |
| --- | --- |
| `openid` | Tesla sign-in/authorization identity flow |
| `offline_access` | Obtain refresh tokens without repeated interactive sign-in |
| `energy_device_data` | Read authorized energy-product information |

These exact names were verified against [Tesla's scope reference](https://developer.tesla.com/docs/fleet-api/authentication/overview).
Do not request `energy_cmds`, vehicle commands, charging commands, vehicle data or `user_data` for
this slice. The implementation validates the exact read-only scope set rather than accepting extras.

4. Generate your own EC prime256v1 key pair if completing Fleet partner onboarding. This Node command
   creates the same P-256 key type Tesla documents, keeps the private key in ignored `secrets/` and
   writes only the public key to the required web asset:

```powershell
New-Item -ItemType Directory -Force secrets | Out-Null
node --input-type=module -e "import {generateKeyPairSync} from 'node:crypto'; import {writeFileSync} from 'node:fs'; const k=generateKeyPairSync('ec',{namedCurve:'prime256v1',privateKeyEncoding:{type:'sec1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}); writeFileSync('secrets/tesla-private-key.pem',k.privateKey); writeFileSync('apps/web/public/.well-known/appspecific/com.tesla.3p.public-key.pem',k.publicKey);"
```

The committed asset is deliberately a placeholder. Before your approved deployment, replace it with
your application's **public** key and verify HTTPS serves it at
`/.well-known/appspecific/com.tesla.3p.public-key.pem`. Do not commit your private key or publish it
through assets. Keep account-specific public-key replacement out of a shared PR unless deliberately
reviewed as a public deployment asset. Key generation alone does not register an application/site.

5. Complete partner registration in each supported region you operate in. Following
   [partner-token documentation](https://developer.tesla.com/docs/fleet-api/authentication/partner-tokens),
   obtain a partner token through server-side `POST https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token`
   using `grant_type=client_credentials`, your Client ID/Secret and the regional Fleet audience.
   Partner `scope` is optional; do not copy broad vehicle-command example scopes into this workflow.
   Use that partner token for `POST /api/1/partner_accounts` with your domain per
   [Tesla's registration reference](https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints).
   Keep token/secret values in a secure server-side tool, never shell history or browser code. The
   allowed-origin/root-domain relationship and hosted public key must satisfy Tesla's registration
   rules. Verify registration with `GET /api/1/partner_accounts/public_key?domain=YOUR_DOMAIN`.
   These are explicit account-owner onboarding actions, not calls AutoPW3/tests perform automatically.
6. Select the correct region below; AutoPW3 accepts only these two exact Fleet origins. Do not guess
   a region, fall back to another origin or use China with this implementation:

| Site's Tesla region | `TESLA_FLEET_API_BASE_URL` |
| --- | --- |
| Europe, Middle East, Africa | `https://fleet-api.prd.eu.vn.cloud.tesla.com` |
| North America, Asia-Pacific excluding China | `https://fleet-api.prd.na.vn.cloud.tesla.com` |

See [Tesla regions](https://developer.tesla.com/docs/fleet-api/getting-started/regions-countries).
Partner registration is not a grant to a customer's Powerwall; customer consent is still required.

7. Review [Tesla billing and limits](https://developer.tesla.com/docs/fleet-api/billing-and-limits)
   before live use. Fleet API uses usage billing and application billing/rate limits; payment or
   access restrictions may disable requests. Consult the portal's current endpoint pricing and set
   a vendor billing limit. Do not assume every energy request is free. AutoPW3's subscription-free
   license does not pay external bills; its displayed household USD cap is not a guaranteed enforced
   pre-call monetary ledger. Rate-limited requests do not justify automatic retries/polling.
8. Configure your own staging Worker variables/secrets and frontend as in F/H. Build with
   `--mode staging`, real Supabase Auth and DEMO telemetry. Sign in to your household as ADMIN.
9. Open Settings → Household Settings → Tesla Energy Site. Expand **Connect or reconnect Tesla
   (manual)** and choose **Start read-only Tesla authorization** only when intentionally consenting.
   Supabase login stays separate. Tesla requests the three scopes above; sign in to the authorized
   Tesla account and consent. AutoPW3 uses PKCE, durable state, a browser cookie and the same live
   Supabase ADMIN session through its completion bridge. Do not switch accounts, copy callback URLs
   or replay consumed authorization codes. The UI must complete before proceeding.
10. Click **Find Tesla energy sites** once. The Worker performs a real Fleet `GET /api/1/products`,
    validates energy products, and returns only permitted metadata. Confirm the displayed site
    name/provider ID against your own Tesla account, then explicitly select **Link selected site**.
    Nothing should link automatically. Linking revalidates current products, token revision/session
    and freshness, then transactionally persists one natural-key site/audit/idempotent result.
11. Confirm the UI's persisted site ID/timezone and database row with section H's read-only query.
    `CONNECTING` confirms linkage metadata, not live measurements. Do not enable telemetry or controls.

Access tokens expire; refresh tokens rotate. AutoPW3 keeps Tesla tokens server-side in AES-256-GCM
encrypted envelopes. Discovery refreshes expired ACTIVE credentials only after authenticated ADMIN
preflight. A durable SENT barrier is committed before exchange; an encrypted READY result is staged
and activated atomically under actual-session, lease/deadline and revision checks. There is a bounded
25-second request budget and no unbounded retry loop. Successfully committed staged payloads are
cleared. Expired READY access becomes explicit REAUTH rather than another exchange/loop. An uncertain
SENT result stays fenced even after its lease expires; never reset/delete it to retry.

Tesla's [rotation rules](https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens)
require saving each rotated refresh token. AutoPW3 deliberately does not rely on the documented grace
period to replay an uncertain exchange. On recovery/reauthorization messages stop, preserve metadata
and follow [the recovery contract](TESLA_DISCOVERY_REFRESH.md); reconnection requires a new explicit
account-owner action. Session loss/revocation/new OAuth credentials cannot be bypassed. Automatic
cleanup of abandoned encrypted attempts is not implemented; no automatic deletion is a recovery step.

## F. Complete configuration reference

Vite reads `apps/web/.env.local`, `apps/web/.env.<mode>.local` and process environment at build/start;
root `.env.example` is only a reference. Restart Vite after edits; rebuild/redeploy assets after public
build-variable changes. Worker vars do not rewrite already compiled frontend variables.
Browser `VITE_` values are public. No Tesla secret/token, service-role JWT, encryption key or database
password belongs there. A Supabase public key identifies a client; a privileged key bypasses RLS; a
user JWT proves a particular signed-in user/session. They are not interchangeable. See
[Supabase's key reference](https://supabase.com/docs/guides/getting-started/api-keys).

### Frontend (all public)

| Exact name | Required/use | Purpose and format | Where obtained/set | Safe example |
| --- | --- | --- | --- | --- |
| `VITE_DEMO_MODE` | Optional; all builds | Only exact `false` enables Auth; default is DEMO | Your web local file/process env | `true` for default; `false` for Auth |
| `VITE_AUTH_MODE` | Optional; dev only for `mock` | `mock` selects in-memory identities only in Vite DEV; omit for Supabase | Your web local file/process env | `mock` for dev; unset for staging |
| `VITE_SUPABASE_URL` | Required when Auth is real | Project HTTPS origin; localhost HTTP allowed in browser | Your project Connect/API settings or local CLI | `https://YOUR_PROJECT_REF.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Required when Auth is real | Public `sb_publishable_…` or legacy anon JWT, never privileged key | Your project's API keys/local CLI | `YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY` |
| `VITE_TELEMETRY_PROVIDER` | Optional; explicit `demo` required for this staged workflow | `demo` or `live`; unset follows demoMode; real telemetry remains disabled | Your web local file/process env | `demo` |
| `MODE`, `DEV` | Vite built-ins, not manually supplied env variables | `MODE=staging` exposes the Tesla setup/callback behavior; DEV permits mock Auth | Vite `--mode staging` / dev command | Build with `--mode staging` |

There is **no consumed `VITE_API_BASE_URL` variable**: API requests use same-origin `/api/v1`.
`vite.config.ts` proxies `/api` to localhost:8787 during development. Older examples mentioned an API
base, encryption-key version/previous key and spend-cap variables; those are not runtime bindings.

### Worker (private config vars or local `.dev.vars`; secrets only where marked)

Required below means required for the indicated slice, not required for credential-free mock browsing.
Set non-secrets in your ignored Wrangler override's `vars`/`env.staging.vars`, or local `.dev.vars`.

| Exact name | Required / environment | Purpose / format | Secret? | Obtain from / safe example |
| --- | --- | --- | --- | --- |
| `ASSETS` | All Worker serving | Fetcher binding to built `../web/dist` | No; binding | Wrangler `assets.binding="ASSETS"`; not a string credential |
| `ENVIRONMENT` | All | App label; supported local/test/preview/staging/production, staged Tesla requires exact `staging` | No | Your config; `local` or `staging` |
| `LOCAL_MOCKS` | Local explicit opt-in; staging must be false | Exact `true` permits in-memory local mocks | No | Your config; `true` local, `false` hosted |
| `PROVIDER_MODE` | Set explicitly | `mock` for this workflow; `live` is not authorized; mode does not mock gated real OAuth/products | No | Your config; `mock` |
| `ALLOWED_ORIGINS` | Hosted slices; recommended local | Comma-separated exact origins; hosted values must be HTTPS | No | Your frontend origin; `http://localhost:5173` local |
| `APP_BASE_URL` | Hosted OAuth/sites; invitation-link construction | Exact app origin, no path/query/credentials; hosted requires HTTPS | No | Your Worker/custom domain; `https://YOUR_APP_HOST` |
| `SUPABASE_URL` | Real Auth/hosted slices | Project origin; staged config requires HTTPS | No | Your project URL; `https://YOUR_PROJECT_REF.supabase.co` |
| `SUPABASE_ANON_KEY` | Real Auth/hosted slices | Public publishable key or legacy anon JWT; same project as frontend | Public | Your project's API keys; `YOUR_PUBLIC_KEY` |
| `SUPABASE_SECRET_KEY` | Hosted identity/OAuth/sites | **Legacy service_role JWT**; opaque sb_secret keys currently unsupported | **Yes** | Your project's legacy API key; `YOUR_LEGACY_SERVICE_ROLE_JWT` |
| `TESLA_CLIENT_ID` | OAuth and expired-token discovery refresh | Your Fleet application identifier | Public identifier | Your Tesla developer dashboard; `YOUR_CLIENT_ID` |
| `TESLA_CLIENT_SECRET` | OAuth and refresh | Your application's secret; never frontend | **Yes** | Your Tesla developer dashboard; `YOUR_CLIENT_SECRET` |
| `TESLA_REDIRECT_URI` | OAuth | Exact HTTPS app origin + `/api/v1/provider/tesla/callback` | Public URL | Your registered redirect; `https://YOUR_APP_HOST/api/v1/provider/tesla/callback` |
| `TESLA_FLEET_API_BASE_URL` | OAuth; stored region used in discovery | Exact EU or NA origin from E, no trailing path/fallback | No | Tesla regional onboarding; use the correct E-table origin |
| `TOKEN_ENCRYPTION_KEY` | OAuth/credential reads/refresh; not mock browsing | Random 32 bytes, 64 hex chars or base64 encoding of 32 bytes | **Yes** | Generate locally as C; `YOUR_32_BYTE_KEY` |
| `STAGING_IDENTITY_READ_ENABLED` | Optional gate; staging only | Exact `true` enables durable `GET /api/v1/me` | No | Your approved config; `true` for hosted setup, false locally |
| `STAGING_TESLA_OAUTH_ENABLED` | Optional gate; staging only | Exact `true` enables connect/callback, no auto consent | No | Your approved config; `true` only for your integration |
| `STAGING_TESLA_SITES_ENABLED` | Optional gate; staging only | Exact `true` enables ADMIN real discovery/linking | No | Your approved config; `true` only for your integration |
| `STAGING_TESLA_LIVE_STATUS_ENABLED` | Optional gate; must stay disabled | Manual live snapshot opt-in; keep exact `false` | No | Your config; `false` |
| `JWT_ISSUER` | Optional; normally omit | Defaults to `<SUPABASE_URL>/auth/v1`; staged overrides must match that exact origin | No | Your own Auth issuer; omit |
| `JWT_JWKS_URL` | Optional; normally omit | Defaults to `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`; staged overrides cannot substitute another issuer | No | Your own JWKS URL; omit |

Names are verified against `apps/worker/src/env.ts`, `staging-config.ts`, the staged handlers and
`app.ts`. `TOKEN_ENCRYPTION_KEY_VERSION`, `TOKEN_ENCRYPTION_KEY_PREVIOUS` and
`TESLA_MONTHLY_SPEND_CAP_USD` are not read by this runtime. No separate Supabase password binding or
refresh-token environment variable exists. Tokens live only in encrypted database storage.

### CLI / CI only (not application bindings)

| Name | Use / format / source | Secret? | Where set |
| --- | --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID, optional local CLI selection | Private account config | Private process env/CI; `YOUR_ACCOUNT_ID` |
| `CLOUDFLARE_API_TOKEN` | Optional scoped deployment token from your account; browser Wrangler login is alternative | Yes | Secure CI environment; `YOUR_SCOPED_TOKEN` |
| `SUPABASE_ACCESS_TOKEN` | Optional Supabase CLI token from your account; CLI browser login is alternative | Yes | Secure CLI/CI only; `YOUR_CLI_TOKEN` |
| `SUPABASE_DB_PASSWORD` | Your hosted database password when required by CLI | Yes | Interactive prompt/secure process env; `YOUR_DB_PASSWORD` |
| `WRANGLER_SEND_METRICS` | CLI metrics preference | No | Process/CI; `false` |
| `CI` | Test/tool CI behavior | No | CI runner sets it; normally unset locally |
| `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY` | Existing deploy workflow's public staging build inputs | Public config stored in CI secrets | Your own CI environment only; project URL/public key placeholders |
| `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY` | Existing deploy workflow's public production inputs; outside this setup | Public config stored in CI secrets | Do not configure/use here |
| `AUTOPW3_DEPLOYMENT_ENABLED` | Repository-variable gate for legacy deploy workflow | No; authorization switch | Leave unset/false; do not enable as onboarding |

The existing deployment workflow is not an approved independent staging runbook: it is guarded and
its staging build step currently omits `--mode staging`. Do not enable/manual-dispatch it or use it
to deploy this workflow. Section H uses an explicit reviewed mode/config and your own accounts.
The CI-only names above must never be added to browser variables or committed `.env` files.

## G. Run and test locally (default, no accounts)

From the clone on your own feature branch:

```powershell
npm ci
npm run dev
```

Open `http://localhost:5173`; DEMO data is expected and labelled. No sign-in is needed in this mode.
To make configuration explicit, copy examples **without overwriting existing local files**:

```powershell
if (-not (Test-Path apps/web/.env.local)) { Copy-Item apps/web/.env.example apps/web/.env.local }
if (-not (Test-Path apps/worker/.dev.vars)) { Copy-Item apps/worker/.dev.vars.example apps/worker/.dev.vars }
git check-ignore apps/web/.env.local apps/worker/.dev.vars
```

For local API health/demo endpoints, build web assets, then start the Worker in a second terminal:

```powershell
npm run build --workspace @autopw3/web
$env:WRANGLER_SEND_METRICS = 'false'
npm run dev --workspace @autopw3/worker -- --local
```

The Worker listens on `http://localhost:8787`; `Invoke-RestMethod http://localhost:8787/api/v1/health`
returns `status: ok` in the local mock environment. Vite proxies `/api` there. Some protected routes
need real verifiable user sessions or test-injected dependencies: the mock Auth token is deliberately
not accepted as a Supabase JWT by the Worker. Demo/Admin fallbacks are not proof of hosted mutations.
The root `npm run dev:worker` shortcut also starts Wrangler's default local mode.
Do not invoke local scheduled handlers or add cron triggers for onboarding.

For development-only sign-in UI with no Supabase, run in a fresh frontend terminal:

```powershell
$env:VITE_DEMO_MODE = 'false'
$env:VITE_AUTH_MODE = 'mock'
$env:VITE_TELEMETRY_PROVIDER = 'demo'
npm run dev
```

Seeded synthetic accounts are `readonly@example.test`, `readwrite@example.test`, `admin@example.test`
and `nohome@example.test`; the **test-only** password is `mock-password-12`. These credentials are
fixtures, never valid Tesla/Supabase accounts. Mock state is in memory; mock Auth is refused outside
Vite development builds. Remove `VITE_AUTH_MODE` from the process when returning to a real build:

```powershell
Remove-Item Env:VITE_AUTH_MODE -ErrorAction SilentlyContinue
Remove-Item Env:VITE_DEMO_MODE -ErrorAction SilentlyContinue
Remove-Item Env:VITE_TELEMETRY_PROVIDER -ErrorAction SilentlyContinue
```

Run checks (sandboxed agents may need permission to spawn native PostgreSQL/Vite/Chromium processes):

```powershell
npm run typecheck
npm test
npm run db:verify
npm run db:test
npm run db:types -- --check
npm run build
npm run lint
npm run secrets:scan
git diff --check
npx playwright install chromium
npm run test:e2e
```

Database scripts use throwaway PostgreSQL 17, no hosted account/Docker or linked project. `db:test`
includes real multi-connection races and atomic migration failure injection. Do not replace generated
DB types manually. On restricted Windows agents, the existing per-workspace test form is:
`npm run test --workspace @autopw3/worker -- --configLoader native --pool threads --maxWorkers 1`
(repeat for shared/web/domain). Browser tests use mock identities/intercepted services.

The known local root ESLint failure is 349 errors exclusively in ignored generated
`apps/worker/.wrangler-tesla-check/index.js`; clean clones do not contain it. Do not edit the artifact
or weaken checks. Changed source must pass targeted `npx eslint <paths>` and
`npx prettier --check <paths>`; prose/SQL/generated types have existing formatting exclusions.
Build chunk-size/native-loader warnings are known and separate from failures.

Stop Vite and Wrangler with Ctrl+C in their terminals. Stop your optional local Supabase stack with
`npx --yes supabase@2.122.0 stop` (preserves data). Do not use `stop --no-backup` to stop normally.

## H. Independent hosted staging (optional, explicit authorization)

Complete your own Supabase project/migrations/bootstrap in D and Tesla registration in E first.
Do not reuse the operator's cloud account, Worker/project identifiers, tokens, keys or private scripts.
Real OAuth/discovery still reaches Tesla even though `PROVIDER_MODE=mock`; only the explicitly gated
read-only handlers bypass the generic provider path. No telemetry/polling/controls/automation is enabled.

1. Copy/edit `wrangler.developer.example.jsonc` to the ignored private override (C). Set your unique
   Worker name, account, app origin, allowed origin, project public config, Tesla Client ID/callback
   and region. Inspect the file before every hosted command. Keep all three secrets set as in C.
   Before its first deploy, determine your own workers.dev subdomain in the dashboard, or use your
   own custom domain, to register the exact HTTPS callback.
2. Create frontend configuration using the staging example:

```powershell
if (-not (Test-Path apps/web/.env.staging.local)) { Copy-Item apps/web/.env.staging.example apps/web/.env.staging.local }
code apps/web/.env.staging.local
```

Set `VITE_DEMO_MODE=false`, `VITE_TELEMETRY_PROVIDER=demo`, your project URL and public key, and omit
mock Auth. Keep values aligned with the Worker's public configuration. Never insert privileged keys.
PowerShell process variables override Vite files: inspect/remove stale VITE values before building.

3. Run all local checks, then build/verify the actual staging-mode assets and intercepted browser tests:

```powershell
npm run build --workspace @autopw3/web -- --mode staging
node scripts/verify-staging-build.mjs
npx playwright test --config playwright.staging.config.ts
$WorkerConfig = 'apps/worker/wrangler.developer.local.jsonc'
npx wrangler whoami
npx wrangler deploy --dry-run --config $WorkerConfig --env staging --outdir dist-developer
```

The build checker compares the compiled URL/key/CSP to your public build configuration without
printing keys. Require MODE=staging, real Supabase Auth, site setup present and DEMO telemetry.
Dry-run must show your Worker/config and no unexpected bindings. `dist-developer/` is local generated
output; keep it ignored. Record reviewed artifact hashes privately before an authorized deploy.

4. **Only after your explicit deployment authorization**, deploy that exact reviewed configuration/
   source/assets, preserving existing secret bindings:

```powershell
npx wrangler deploy --config $WorkerConfig --env staging --keep-vars
npx wrangler deployments list --config $WorkerConfig --env staging
npx wrangler secret list --config $WorkerConfig --env staging
```

Do not edit/rebuild between review and upload. `--keep-vars` preserves existing dashboard variables,
but this is not permission to skip comparing configuration: inspect the resulting bindings/flags in
your dashboard and require a single 100% active version. If existing dashboard values disagree, stop
and reconcile before deploying. The command uploads frontend assets and Worker together; no separate
Cloudflare Pages project is used. Check ENVIRONMENT=staging, LOCAL_MOCKS=false, PROVIDER_MODE=mock,
identity/OAuth/sites gates true, live-status false, all three secret names, assets binding and no cron.

5. Verify your `/login` returns HTTP 200 with project-scoped CSP and login works without a global
   DEMO MODE banner. On the staged Worker **generic `/api/v1/health` currently returns 502
   PROVIDER_UNAVAILABLE** because it is behind the generic fail-closed deployment guard; do not treat
   that as proof the staged Tesla routes are broken or enable generic mocks to change it. Verify
   `GET /api/v1/me` without a token returns 401, then confirm the real signed-in household membership.
   Health assessment is login/assets plus the exact protected staged routes and permission checks.
6. With your approved ADMIN/account, perform explicit OAuth and one discovery attempt as in E.
   Do not keep clicking Find after an uncertain refresh. Present the real site metadata to the site
   owner, then link only their confirmed selection. Reconcile a lost link response with the same
   UI retry/idempotency key; do not invent a new key or reauthorize as a diagnostic.
7. In your project's SQL editor verify persistence **without reading tokens/ciphertext**:

```sql
select s.id, s.household_id, s.provider, s.provider_site_id, s.name, s.timezone,
       s.connection_state, h.controls_enabled
from public.energy_sites s join public.household_settings h on h.household_id=s.household_id
where s.provider='TESLA';
select household_id, provider_site_id, count(*)
from public.energy_sites where provider='TESLA' group by household_id, provider_site_id;
select action, count(*) from public.audit_log
where action in ('tesla.connected','tesla.token_refreshed','tesla.site_linked','tesla.reauth_required')
group by action;
```

Keep returned personal site/household metadata private. Match the selected household/site and UI ID,
require one row for its natural key and one creation audit; controls must remain false. Check that
there are no ACTIVE automation rules or scheduled triggers and no live metrics written. The UI's
CONNECTING state does not mean live telemetry is enabled. Synthetic readings remain clearly DEMO.
8. Stop on any schema, grant, login, flag, deployment, refresh or discovery failure. Use your recorded
   known-good Worker version and C's rollback procedure when appropriate. Preserve migrated database,
   rotated credentials, durable barriers and audits. No production action is part of this guide.

## I. Troubleshooting actual AutoPW3 behavior

| Symptom | Diagnose / safe next action |
| --- | --- |
| Login fails or says not configured | Check web config file location, exact `VITE_DEMO_MODE=false`, project URL/public key, password/confirmation and network/CSP. Privileged keys are rejected. Browser login success alone does not prove Worker JWT compatibility. |
| Email/reset link goes to wrong origin | Check your Supabase Auth Site URL and exact `/auth/callback`/`/reset-password` allowlist; these differ from Tesla's callback. Rebuild if public config changed. Do not loosen wildcard redirects. |
| Incorrect global DEMO MODE | Demo defaults on unless value is exact `false`; check process variables, selected Vite mode and the actual served JS hashes. Worker vars do not change compiled frontend configuration. DEMO synthetic telemetry is still expected. |
| Missing Tesla setup | Requires a staging-mode build and an authenticated household ADMIN; backend additionally requires staging/sites gate. Mock dev/production mode will not expose the same real setup adapter. |
| `UNAUTHENTICATED` / 401 | Sign in again if session expired; verify asymmetric Auth/JWKS/project/issuer and live `session_id`. Do not use service keys as user bearer tokens or spoof session IDs. |
| `FORBIDDEN` / 403 | Confirm current household ADMIN membership/session and exact Origin/CORS; role displays/fallbacks cannot grant authority. ADMIN changes during a request are fenced. |
| `NOT_FOUND` / 404 during linking | Selected product is unavailable to the credential's household or access/site changed; verify authorized metadata. Cross-household requests must not reveal other households. |
| Tesla callback mismatch | Compare exact HTTPS APP_BASE_URL + `/api/v1/provider/tesla/callback` across Worker/Tesla dashboard. Use the same browser and live Supabase session; do not replay a code or copy the callback URL. |
| Discovery 502 `PROVIDER_UNAVAILABLE` | Generic mapping includes bad/missing configuration, expired/unusable credentials, invalid scopes/region/envelope, DB/provider/network/timeout failures; 502 alone does not identify Tesla. Retain sanitized request ID, inspect metadata/grants and flags, not token values. |
| Apparently empty 502 body | Error helpers intentionally return JSON envelopes with request IDs; an empty browser body is not the intentional contract. Check CORS, edge response, content type/headers and transport safely without replaying an uncertain token exchange. |
| 409 `CONFLICT` + `TESLA_REAUTHORIZATION_REQUIRED` | Revoked/expired staged credentials need explicit owner reauthorization; the UI stops rediscovery. No automatic reconnect; do not delete barriers. |
| 409 `CONFLICT` + `TESLA_RECOVERY_REQUIRED` | A prior refresh may have been sent; preserve durable attempt/session/revision metadata. No blind refresh retry, lease reset or row deletion. Escalate to an authorized operator. |
| Other 409 / link conflict | Credential revision, freshness, unique site or idempotency conflict; do not overwrite a newer OAuth credential or create duplicate site. Lost link response uses the existing key. |
| `RATE_LIMITED` / 429 | Respect Retry-After and investigate request frequency/provider billing; manual retry only after diagnosis. No polling loop. |
| `VALIDATION_FAILED` / 422 | Numeric providerSiteId/valid JSON and Idempotency-Key are required; use the setup UI rather than handwritten mutation requests. |
| Waiting for invitation / no ADMIN | New users intentionally have no household. Use your project's one-time bootstrap or an existing ADMIN's audited invitation; browser role/localStorage edits cannot grant access. |
| RPC missing / RLS denied | Check ordered migration history, exposed public schema, cache, exact signature and role grants; test the user's actual JWT. Keep private ledger/credentials inaccessible. Never grant PUBLIC/anon or disable RLS to fix access. |
| Migration fails | Stop before Worker deploy; verify your new project/ref, pending order, lock/error metadata and transaction state. Do not run history repair/reset or retry uncertain data mutations blindly. |
| Worker/project config mismatch | Compare frontend build URL/public key, Worker bindings, app/allowed origins, callback, region and required secret names. Opaque sb_secret keys are unsupported by current privileged RPC transport. |
| Worker `/health` fails in staging | Expected generic fail-closed guard; test protected staged routes/login instead. Local mock `/api/v1/health` should return 200. Do not enable hosted LOCAL_MOCKS. |
| Docker / local Supabase will not start | Confirm Docker Desktop/WSL2/virtualization, `docker info`, ports 54320–54323 and disk space; use pinned CLI. Preserve volumes/data, inspect local logs privately, and avoid `--no-backup`. Docker is optional for default mock/embedded-DB tests. |
| Build EPERM/native process error on Windows agent | Native compiler/browser/PostgreSQL startup may require sandbox approval. Retry with appropriate local process permission; do not change app authorization or hosted resources. |

The frontend maps bounded/allowlisted errors to fixed messages and does not expose raw Tesla/database
responses. Never paste JWTs, cookies, callback codes, client secrets, ciphertext or raw logs into a bug
report. Use route, HTTP/error code, sanitized request ID, timing and metadata state. Ordinary test
fixtures do not establish a new developer's hosted behavior; verify that separately in their accounts.

## J. Team development and migrations

Use `feature/<handle>-<description>` (or the repository task branch convention for a numbered task),
one scoped change at a time. Read AGENTS.md and security rules; user-approved integration branches
are exceptions, not shared scratch branches. Keep tests deterministic and intercept/mock all Tesla
requests. No test may contact real Tesla accounts or mutate a shared hosted database.

Create a new UTC timestamped forward migration rather than editing any already applied migration:

```powershell
npx --yes supabase@2.122.0 migration new describe_change
npm run db:verify
npm run db:test
npm run db:types -- --check
```

Coordinate filename/timestamp order in PR review; inspect upstream migrations before merging and
regenerate types through `npm run db:types` when needed. Include RLS/grants, SQL security tests and
real concurrency tests when changing privileged transactions. Do not reuse a migration number or
add temporary auth shims to real migrations. Privileged definitions and restricted grants must be
installed atomically. No PR grants permission to migrate someone else's database automatically.

Before committing: inspect explicit staged paths/diff, run relevant checks, secret scans and privacy
review. `.env`, `.env.*.local`, `.dev.vars`, ignored private Wrangler configs, `secrets/`, database
copies, runtime logs, generated bundles and caches must stay out. Safe `.example` files remain
trackable; tracked files are not automatically safe. Historical human Git attribution was explicitly
accepted for this branch; personal data in source/config/docs/fixtures/messages was not.

Submit PRs with behavior, security boundaries, migrations, exact checks/results and limits. Require
review for auth, encrypted token storage, RPC grants and control boundaries. Never share service-role
keys or account access with friends; use isolated accounts/projects. Merge main/deploy/migrate/
reconnect/refresh/discover/link only under the separately authorized workflow. No live Powerwall
telemetry, polling, automation or controls are enabled by onboarding or publication.

Publication verification and remaining limits are recorded in
[the secure publication handoff](handoffs/SECURE-GITHUB-PUBLICATION.md). The complete Docker setup and
new-account hosted provisioning are documented procedures, not claimed as executed tests.
