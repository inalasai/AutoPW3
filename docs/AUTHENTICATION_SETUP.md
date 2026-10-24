# Authentication Setup

**Status:** written in TASK-07. The web app signs people in with Supabase Auth through `apps/web/src/features/auth`. **No real Supabase project has been connected yet**, so every setting below is `UNVERIFIED` until the owner configures a project and runs the manual checklist at the end (`AWAITING_CREDENTIALS`).

Related: [`SECURITY_MODEL.md`](SECURITY_MODEL.md), [`RLS_POLICY_MATRIX.md`](RLS_POLICY_MATRIX.md), [`CREDENTIALS.md`](CREDENTIALS.md), [`DEVELOPMENT_SETUP.md`](DEVELOPMENT_SETUP.md).

## How sign-in works (short)

1. The browser signs up, signs in, resets passwords and confirms email through Supabase Auth, using the **public** project URL and the **publishable (anon)** key. Sessions use the PKCE flow and are kept by `supabase-js` in the browser.
2. The browser's session proves *who* the person is. It never decides *what they may do*. After sign-in the app reads `user_profiles` and `household_members` (embedded `households`) with the person's own session. Row Level Security returns only their own rows. The role shown in the interface comes from that response and from nothing stored in the browser.
3. The Worker and the database re-check every action. A READ_ONLY person who edits browser state still gets refused by the server. The UI hides or disables controls as a convenience only.
4. A new account has no household and no role. It sees a "waiting for an invitation" page until an invitation is accepted (the `accept_invitation` database function, see "Invitations"). The role of a new member is whatever the invitation carries; the database function, not the browser, applies it.

## Environment variables (web app)

All `VITE_` variables are public. Never put a secret, a `service_role` key or a `sb_secret_...` key in them. The app refuses to start if it detects one.

| Name | Where set | Meaning |
|---|---|---|
| `VITE_DEMO_MODE` | `.env.local`, build environment | Demo is the default. Only the exact value `false` turns it off. |
| `VITE_SUPABASE_URL` | `.env.local`, build environment | Project URL, `https://<ref>.supabase.co`. Plain `http` is accepted only for `localhost`, `127.0.0.1` and `[::1]`. |
| `VITE_SUPABASE_ANON_KEY` | `.env.local`, build environment | Publishable (anon) key. Placeholder values and privileged keys are refused. |
| `VITE_AUTH_MODE` | `.env.local` or the command line, development only | `mock` swaps Supabase for an in-memory identity provider (see "Development and tests"). Ignored and refused in a production build. |

With `VITE_DEMO_MODE=false` and no Supabase values, the app shows a start-up error naming the missing variable rather than running without sign-in.

## Supabase Auth settings the owner must configure

Set these in the Supabase dashboard under **Authentication**. Names of dashboard sections can change; the intent is what matters.

| Setting | Required value | Why |
|---|---|---|
| Email provider | Enabled | Registration and login use email and password. |
| Confirm email | **On** | An address must be proved before the account is used. The app handles both settings, but production must confirm. |
| Minimum password length | **12** | `PASSWORD_MIN_LENGTH` in the app is 12 and the form checks it. The server setting is the real rule; if the project allows fewer, the app form still insists on 12 but another client could create weaker passwords. |
| Password requirements | At least letters and digits (owner's choice) | Defence against trivial passwords. The app does not impose composition rules beyond length. |
| Leaked password protection | On, if the plan offers it | Rejects passwords found in breach lists. `UNVERIFIED` availability. |
| Site URL | The deployed web origin, for example `https://autopw3.example` | Base for links in emails. |
| Redirect URLs (allow list) | `<web origin>/auth/callback` and `<web origin>/reset-password`, plus `http://localhost:5173/auth/callback` and `http://localhost:5173/reset-password` for local work | The app passes exactly these as `emailRedirectTo` and `redirectTo`. Anything not on the list is refused by Supabase. Do not use wildcards for production. |
| Rate limits | Keep Supabase defaults or stricter | Limits sign-up, sign-in and reset emails per hour and per IP. The app reports a rate-limit as "Too many attempts. Wait a few minutes and try again." |
| Email templates | Keep the defaults until a sender domain exists | Custom SMTP is out of scope. Free-tier default email has low hourly limits (`UNVERIFIED`). |
| Allow new sign-ups | On while invitations are used to place people | Sign-up creates an account only; access still needs an invitation. |
| JWT expiry | Default (1 hour) or shorter | The client refreshes quietly. A refresh that fails ends the session and the app shows "Your session has ended". |
| Anonymous sign-ins | **Off** | The app has no anonymous mode. |
| Social / OAuth providers | Off | Not used in v1. |
| Multi-factor authentication | Not configured | Out of scope for v1 (recorded in `KNOWN_LIMITATIONS.md`). |

The `anon` key is safe in the browser **only because RLS is on for every table** (checked by `npm run db:test`). Do not weaken a policy to make a screen work.

## What the app does with each Supabase response

| Situation | What the person sees | Notes |
|---|---|---|
| Register, address new | "Check your email" (or straight in when confirmation is off) | |
| Register, address already used | The same "Check your email" message | No account enumeration. |
| Login, wrong email or wrong password | "The email or password is not correct." | One message for both. |
| Login, email not confirmed | "Confirm your email address first: use the link in the email we sent, then sign in." | Supabase reveals this only after a correct password, so it does not leak existence. |
| Password reset request | Same confirmation whatever the address | Only network and rate-limit problems are reported. |
| Reset link opened | Form to choose a new password | An invalid or used link shows "This reset link is not valid". |
| Session expired or refresh failed | Redirect to sign in with "Your session has ended" and a return path | The return path is checked by `safeReturnPath` (same-site paths only). |
| Account loaded but role unknown or row malformed | An error with a retry; no access | Fails closed. |
| Signed in, no membership | "Waiting for an invitation" with an invitation-code field | |

## Invitations

`/invite/<token>` accepts an invitation for the signed-in person by calling the database function `accept_invitation(p_token)` as that person (decision D-048). Failures show one message ("This invitation is not valid. It may have expired, been used already, or been withdrawn.") whatever the cause. The token is never written to the page, the console or an error. Creating invitations and managing members is TASK-19. In TASK-14/19 the call moves behind the Worker so it gets rate limiting and audit mapping.

## Content Security Policy

`apps/web/public/_headers` allows connections to `'self'` only. A Vite plugin adds the origin of `VITE_SUPABASE_URL` to `connect-src` in `dist/_headers` at build time, so the browser may reach Supabase and nothing else. Demo builds and mock-mode runs add nothing. Set `VITE_SUPABASE_URL` in the build environment of the deployment or sign-in will be blocked by the browser.

## Development and tests

- `npm run dev` runs in demo mode with no sign-in and no credentials.
- `npm run dev` with `VITE_DEMO_MODE=false VITE_AUTH_MODE=mock` uses the in-memory mock identity provider. Seeded accounts (password is the test value `mock-password-12`): `readonly@example.test` (READ_ONLY), `readwrite@example.test`, `admin@example.test`, `nohome@example.test` (no household). A registration is kept only until the page reloads. The mock keeps a signed session token in `localStorage` (`autopw3.mock-session`); roles are never stored there.
- The mock is loaded only by a development build. A production `npm run build` does not contain it (checked in the TASK-07 handoff); a production build with `VITE_AUTH_MODE=mock` fails to start.
- `npm test` covers the auth module with the mock and with a faked Supabase client. `npm run test:e2e` runs the Playwright smoke test against the dev server in mock mode (first run: `npx playwright install chromium`).

## Owner checklist once a Supabase project exists (all `NOT_EXECUTED`)

1. Apply the migrations (for a hosted project `supabase db push`; the owner runs this, nothing here has) and confirm RLS is on for every table.
2. Set the Auth settings above and the two redirect URLs.
3. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `apps/web/.env.local`, with `VITE_DEMO_MODE=false`.
4. Register an address, confirm it from the email, sign in: expect "Waiting for an invitation".
5. Use the procedure in `docs/ADMIN_BOOTSTRAP.md` (`private.bootstrap_first_admin`, which needs the confirmed email) to create the first household and ADMIN, then sign in again: expect the Live page and an Admin entry.
6. In the browser dev tools set `localStorage.role = 'ADMIN'` as a READ_ONLY member and reload: expect no change.
7. Open `/admin` as READ_ONLY: expect "Not authorised".
8. Request a password reset, open the link, choose a new password, sign in.
9. Record the outcome in `docs/KNOWN_LIMITATIONS.md` and change the matching `UNVERIFIED` entries.
