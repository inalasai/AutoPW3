# AutoPW3 - Task Handoff Report

## Task completed
Number and name: TASK-07 Authentication and permission-aware UI
Branch / commit: `Raj-AutoPW3` (owner chose this branch instead of `task-07-<slug>`); commits prefixed `task-07:`. Not pushed. No PR opened.
Date: 2026-10-24

**Status: complete for what could be run locally.** The sign-in code that talks to Supabase has never run against a real Supabase project (`AWAITING_CREDENTIALS`, L-057): the live adapter is tested only against a faked client, and every browser-level flow ran against the development-only mock identity provider. Also not done: GitHub CI and PR (nothing pushed, `NOT_EXECUTED`), `npm run dev:worker` with the new routes (L-055), a browser axe pass (axe runs in jsdom only, L-063). The acceptance criteria are met at the level the mock can prove; the owner checklist in `docs/AUTHENTICATION_SETUP.md` closes the rest.

## Summary
People can now register, confirm their email, sign in, sign out, reset a password and accept an invitation. The web app asks `AuthClient` who the person is, then reads their profile and household membership through RLS-protected queries; the role in the interface comes from that response and from nothing stored in the browser. Routes are guarded (signed-out visitors go to sign in and come back; `/admin` below ADMIN shows a "Not authorised" page; a person with no household sees "Waiting for an invitation"), navigation follows the role, and READ_ONLY people see disabled controls with a visible reason. Demo mode still works with no Supabase and no sign-in. A dev-only mock identity provider lets component tests and a Playwright smoke test run with no credentials. Editing `localStorage`/`sessionStorage` or forging the mock session token does not change what a person can open (tests demonstrate it).

## Files created
| Path | Purpose |
|---|---|
| `apps/web/src/features/auth/types.ts` | `AuthClient` interface, `AuthState`, `Account`, `AuthFailure`, `PASSWORD_MIN_LENGTH` |
| `apps/web/src/features/auth/state.ts` | membership choice, state from account or failure, `roleOf`, `permissionsOf` |
| `apps/web/src/features/auth/supabase-client.ts` | live adapter over `@supabase/supabase-js` (PKCE, persisted session, RLS queries, `accept_invitation` RPC, error mapping) |
| `apps/web/src/features/auth/mock/mock-client.ts` | in-memory adapter for tests and `VITE_AUTH_MODE=mock` (development only) |
| `apps/web/src/features/auth/create-client.ts` | picks the adapter from config; lazy imports; mock only under `import.meta.env.DEV` |
| `apps/web/src/features/auth/AuthProvider.tsx` | provider and hooks: `useAuth`, `useOptionalAuth`, `usePermissions` |
| `apps/web/src/features/auth/guards.tsx` | `RequireSession`, `RequireRole`, `PublicOnly` |
| `apps/web/src/features/auth/permissions.tsx` | `ReadOnlyNotice`, `WriteButton` |
| `apps/web/src/features/auth/AccountControls.tsx` | header bar and mobile drawer account controls |
| `apps/web/src/features/auth/{messages,invitation,redirect}.ts` | failure wording, invitation token parsing, safe return path |
| `apps/web/src/features/auth/components/AuthCard.tsx` | card layout and the demo-mode notice |
| `apps/web/src/features/auth/pages/{AuthPages,AccessPages,InvitePage}.tsx` | login, register, forgot/reset password, callback, waiting-for-invitation, unauthorised, invitation acceptance |
| `apps/web/src/features/auth/index.ts` | public API of the feature |
| `apps/web/src/features/auth/{state,redirect,supabase-client,auth}.test.ts(x)`, `mock/mock-client.test.ts` | unit and component tests (140 tests) |
| `apps/web/src/app/StartupError.tsx` | screen shown when configuration makes sign-in impossible |
| `apps/web/src/lib/csp.ts`, `csp.test.ts` | `withConnectSrc` and its tests (reads `public/_headers`) |
| `playwright.config.ts`, `e2e/auth.spec.ts`, `e2e/tsconfig.json` | Playwright smoke test (10 tests at 1280 px and 360 px = 20 runs) |
| `docs/AUTHENTICATION_SETUP.md` | Supabase Auth settings the owner must configure, env vars, mock mode, owner checklist |
| `docs/handoffs/TASK-07.md` | this report |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/web/src/lib/config.ts`, `config.test.ts` | `AppConfig { demoMode, auth }` with validation; refuses privileged keys, bad URLs, placeholders, mock outside dev (D-051) |
| `apps/web/vite.config.ts` | `cspConnectSrc` plugin adds the Supabase origin to `dist/_headers` (D-050) |
| `apps/web/src/main.tsx` | builds config and auth client, renders `StartupError` on failure |
| `apps/web/src/app/App.tsx` | `AppFrame({ config, authClient, initialEffects })`; guarded routes; nav from `useAuth()`; **the `role` prop is removed** (documented change to TASK-06 code, D-047) |
| `apps/web/src/app/routes.ts` | public routes `forgot-password`, `reset-password`, `auth-callback`; task labels |
| `apps/web/src/app/pages/AppPages.tsx` | login/register/invite placeholders removed; `ReadOnlyNotice` and `WriteButton` added to Tariffs, Controls, Automation, Settings |
| `apps/web/src/app/shell/{AppShell,Header,MobileNav}.tsx` | account controls; focus after every navigation (D-052); `signedIn` prop removed |
| `apps/web/src/app/App.test.tsx`, `src/test/render.tsx` | tests use `account: Role \| 'NO_HOUSEHOLD' \| null` instead of a `role` prop |
| `apps/web/package.json`, `package.json`, `package-lock.json` | `@supabase/supabase-js` 2.118.0 (MIT); `@playwright/test` 1.64.1 (Apache-2.0, dev); scripts `test:e2e`, `typecheck:e2e`; `typecheck` also checks `e2e/` |
| `.env.example`, `AGENTS.md`, `apps/web/README.md`, `e2e/README.md`, `docs/{DESIGN_SYSTEM,DEVELOPMENT_SETUP,TESTING,README}.md` | env var, commands, routes, status lines |
| `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | D-046 to D-053, L-057 to L-067 appended |
| `docs/ai-build-kit/00-README.md` | TASK-07 ticked |

## Decisions
D-046 `AuthClient` with live and dev-only adapters; D-047 role only from the database response (supersedes the `role` prop of D-042); D-048 invitation acceptance via the `accept_invitation` RPC for now; D-049 no account enumeration; D-050 Supabase origin added to CSP at build time; D-051 config refuses privileged keys; D-052 focus after redirects; D-053 Playwright adopted. All in `docs/DECISIONS.md`.

## Database changes
None. The app reads `user_profiles` and `household_members` (embedded `households`) and calls `accept_invitation(p_token)`, all from TASK-03/04, as the signed-in person.

## API changes
None to the Worker. The browser now calls Supabase Auth and PostgREST directly with the publishable key and the person's session, relying on RLS (TASK-04). `connect-src` gains the Supabase origin at build time.

## Checks executed
| Exact command | Executed? | Result | Relevant output |
|---|---|---|---|
| `npm run check` (typecheck incl. `e2e/`, lint with architecture rules and Prettier, tests, build, secrets scan) | yes | exit 0 | tests: shared 226, domain 3, web 321 (14 files), worker 4; lint-rule checks and Prettier pass; web build and `wrangler deploy --dry-run` pass |
| `npx vitest run --root apps/web src/features/auth src/lib` | yes | 166 passed in 8 files | `auth.test.tsx` 80, `supabase-client.test.ts` 28, `config.test.ts` 15, `mock-client.test.ts` 14, `state.test.ts` 11, `redirect.test.ts` 7, `csp.test.ts` 6, `api-contract.test.ts` 5 |
| `npm run test:e2e` | yes (after `npx playwright install chromium`) | 20 passed (10 tests x desktop and 360 px), 13.2 s | an earlier run had 1 failure on mobile (sign out lives in the drawer); the test was fixed, not skipped |
| `npm run build` with `VITE_DEMO_MODE=false VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co` and a fake publishable key, output to a temporary folder | yes | built | `dist/_headers` had `connect-src 'self' https://abcdefghijklmnop.supabase.co`; the temporary folders were deleted |
| same with `VITE_AUTH_MODE=mock` | yes | built | `connect-src 'self'`; start-up would refuse the mock (covered by `create-client` and config tests) |
| search of `apps/web/dist/assets/*.js` for `mock-password`, `example.test`, `__AUTOPW3_MOCK_AUTH__`, `autopw3.mock-session`, `DEV_MOCK`, and "Component catalogue" | yes | 0 files each | the mock and the catalogue are absent from production bundles |
| `npm run db:test`, `npm run db:verify`, `npm run db:types -- --check` | no | `NOT_EXECUTED` | TASK-07 changed no database object. Commands: as listed |
| Real Supabase sign-up, confirmation, reset, refresh | no | `AWAITING_CREDENTIALS` | owner checklist in `docs/AUTHENTICATION_SETUP.md` |
| GitHub CI, PR | no | `NOT_EXECUTED` | nothing pushed |

## Manual verification
Ran the app in mock mode (`VITE_DEMO_MODE=false VITE_AUTH_MODE=mock`) and took screenshots with Playwright's Chromium at 1280 x 800 and 360 x 740: sign-in page, `/tariffs` as `readonly@example.test` (disabled "New tariff" button with "Read-only access: you cannot make changes.", an explanatory notice, no horizontal scroll of the page), and `/admin` as READ_ONLY ("Not authorised" with the email, "Read only" label and Sign out in the header, no Admin entry in the sidebar). Contrast, spacing and focus were not re-measured here. Not checked by hand: real Tab traversal and a screen reader (L-049), a real Supabase project.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| A user can register and log in | MOCK_ONLY | `auth.test.tsx` "registration" and "login and logout"; `e2e/auth.spec.ts`. Real Supabase: `AWAITING_CREDENTIALS` |
| A user cannot grant themselves permission by editing browser state | VERIFIED (in tests) | `auth.test.tsx` "browser state cannot grant permission" (edits `role`-like keys in both storages, forges the mock token, role change on the server shown after a visibility change); `e2e` "browser state cannot grant permission" |
| Registration test | MOCK_ONLY | `auth.test.tsx` (confirmation needed, existing address looks the same, new account lands on waiting page, weak/mismatched password) |
| Login and logout test | MOCK_ONLY | `auth.test.tsx`, `e2e` |
| Session restoration test | MOCK_ONLY | `auth.test.tsx` "session restoration"; `e2e` reload |
| Protected-route redirect test | MOCK_ONLY | `auth.test.tsx` "protected routes"; `e2e` returns to the requested page after sign-in |
| READ_ONLY navigation test | MOCK_ONLY | `auth.test.tsx` "role-aware navigation"; `e2e` |
| ADMIN navigation test | MOCK_ONLY | same |
| Unauthorised direct access test | MOCK_ONLY | `/admin` as READ_ONLY and READ_WRITE shows "Not authorised" with no redirect |
| Expired session test | MOCK_ONLY | `auth.test.tsx` "expired session" (expiry, failed refresh, failure while loading); `e2e` via `__AUTOPW3_MOCK_AUTH__.expireSession()` |
| Tampered localStorage role has no effect | VERIFIED (in tests) | see above |
| No hardcoded admin or privileged credentials | VERIFIED | mock accounts exist only in the development-only mock (absent from `dist`); `npm run secrets:scan` passes; config refuses `service_role` and `sb_secret_` keys |
| Demo mode works without Supabase and is labelled | VERIFIED | `auth.test.tsx` "demo mode"; `App.test.tsx`; demo banner unchanged |
| READ_ONLY controls disabled with an explanation | VERIFIED | `WriteButton`, `ReadOnlyNotice`; screenshot above |
| No-household screen and accept-invitation entry point | MOCK_ONLY | `auth.test.tsx` "no household and invitations" |
| `docs/AUTHENTICATION_SETUP.md` | done | Supabase settings are `UNVERIFIED` until a project exists |

## Verification status register
- Supabase adapter against a faked client: `MOCK_ONLY`. Against a real project: `AWAITING_CREDENTIALS` (L-057).
- Supabase Auth dashboard settings (confirmations, redirect URLs, password length 12, rate limits): `UNVERIFIED` (L-062).
- Email-confirmation link opened in another browser: `UNVERIFIED` (L-061).
- `accept_invitation` called from the browser: function tested in TASK-04 SQL tests; browser path `UNVERIFIED` (L-059).
- Worker authorises every action: not exercised here; the Worker has no endpoint that needs it yet (TASK-14).

## Outstanding issues
- Run the owner checklist once a Supabase project exists, then update L-057, L-061, L-062.
- CI does not run Playwright (L-063); add a job with `npx playwright install --with-deps chromium` when CI is next touched.
- Entry chunk grew to 436 kB (137 kB gzip) because Zod is now in it (L-067).
- `npm audit` advisories in dev tooling predate this task (L-064).
- Branch name and missing PR (L-065).
- Question for the owner: should `test:e2e` join `npm run check` once CI can install a browser?

## Environment variables
Names only. All are public build-time values for the web app: `VITE_DEMO_MODE` (default demo; only `false` turns it off), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key; privileged keys are refused), `VITE_AUTH_MODE` (`mock`, development only), `VITE_API_BASE_URL` (unchanged). Set in `apps/web/.env.local` locally and in the deployment's build environment. `VITE_SUPABASE_URL` must also be present at build time so the CSP plugin can allow it.

## Auth module API (`apps/web/src/features/auth`, import from `index.ts`)
- `createAuthClient(auth: AuthConfig): Promise<AuthClient | null>`; `AuthClient` methods: `getUser`, `loadAccount`, `signUp`, `signIn`, `signOut`, `requestPasswordReset`, `updatePassword`, `acceptInvitation`, `subscribe`.
- `AuthProvider`, `useAuth()` returns `{ state, permissions, signIn, signUp, signOut, requestPasswordReset, updatePassword, acceptInvitation, retry, markExpired }`; `usePermissions()` returns `{ role, canWrite, canAdmin }`; `useOptionalAuth()` is `null` in demo mode.
- `state.status` is `loading | unauthenticated | expired | error | no-household | authorised`; only `authorised` has `role`.
- Guards: `RequireSession`, `RequireRole minimum="ADMIN"`, `PublicOnly`. UI hints: `WriteButton`, `ReadOnlyNotice`, `AccountControls`.

## Instructions for the next task
- TASK-08 (telemetry and demo provider) does not touch auth. Do not change `AuthState`, the guards or `AppFrame`'s props.
- Feature pages must wrap write controls in `WriteButton` (or check `usePermissions().canWrite`) and add `ReadOnlyNotice`; the Worker must still refuse the action.
- The API client (TASK-14) must call `markExpired()` from `useAuth()` on a 401 and must send the Supabase access token as the bearer token. Move `acceptInvitation` behind the Worker in TASK-14 or TASK-19 by changing that one method in `supabase-client.ts`.
- Tests use `renderApp({ account })`; add a seeded account to `DEV_MOCK_USERS` only if a new role scenario is needed.
- Do not import `features/auth/mock` or `supabase-client.ts` outside `create-client.ts` and tests.
- Run `npm run test:e2e` before handing off any task that changes the browser app.

## Next task
TASK-08 Telemetry model and demo provider. No prerequisite is open except the owner's decision on this task's local-branch and no-PR handling.
