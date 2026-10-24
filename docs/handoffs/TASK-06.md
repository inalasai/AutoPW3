# AutoPW3 - Task Handoff Report

## Task completed
Number and name: TASK-06 Design system and application shell
Branch / commit: `Raj-AutoPW3` (owner chose this branch instead of `task-06-design-system`); commits prefixed `task-06:`. Not pushed. No PR opened.
Date: 2026-10-23

**Status: complete for what could be run locally.** Not done: GitHub CI and PR (nothing pushed, `NOT_EXECUTED`), real Tab-key traversal in a browser and a screen-reader pass (L-049), `npm run dev:worker` with the new routes (L-055).

## Summary
The web app now has a design system and a responsive application shell. Tokens (colour, type, radii, layout, four glow levels) live in one CSS file with a single effects switch that turns glow, blur and animation off. There is a set of accessible components (see `docs/DESIGN_SYSTEM.md`), a shell (skip link, demo banner, sticky header, sidebar, mobile drawer), routing with structured placeholder pages for all routes in the task plus a not-found page, and a dev-only catalogue at `/dev/components`. No data fetching, authentication, charts or energy calculations were added.

## Files created
| Path | Purpose |
|---|---|
| `apps/web/src/styles/tokens.css`, `base.css` | tokens, effects switch, base styles, focus ring, reduced motion |
| `apps/web/src/styles/contrast.test.ts` | WCAG contrast computed from the tokens (39 tests) |
| `apps/web/src/lib/cx.ts` | class name helper |
| `apps/web/src/components/ui/*` (`Button`, `fields`, `Tabs`, `feedback`, `display`, `overlays`, `toast`, `icons`, `useFocusTrap`, `index`) | design system components |
| `apps/web/src/components/ui/{controls,feedback,display,overlays}.test.tsx` | component tests including axe |
| `apps/web/src/app/{effects.tsx,routes.ts}` | effects provider and storage; route inventory as data and nav visibility rule |
| `apps/web/src/app/shell/{AppShell,Header,MobileNav,NavList}.tsx` | application shell |
| `apps/web/src/app/pages/{Page,AppPages}.tsx` | placeholder pages and not-found |
| `apps/web/src/app/dev/ComponentCatalogue.tsx` | dev-only component catalogue |
| `apps/web/src/test/{axe.ts,render.tsx}` | axe helper and `renderApp` for tests |
| `docs/DESIGN_SYSTEM.md` | design system documentation |
| `docs/handoffs/TASK-06.md` | this report |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/web/src/app/App.tsx` | `AppFrame` (providers and routes) and `App` (adds `BrowserRouter`); lazy dev-only catalogue |
| `apps/web/src/app/App.test.tsx` | replaced the skeleton test with shell, routing, nav and demo tests |
| `apps/web/src/main.tsx` | apply stored or default effects before first render |
| `apps/web/src/styles/index.css` | imports Tailwind, tokens and base |
| `apps/web/package.json`, `package-lock.json` | `react-router` 8.5.0; dev: `axe-core` 4.14.0, `@testing-library/user-event` 14.6.8 (all owner-approved) |
| `packages/shared/package.json` | `"sideEffects": false` (bundle 433 kB to 290 kB) |
| `apps/web/README.md`, `docs/README.md`, `docs/ai-build-kit/00-README.md` | status, structure, rules, tracker |
| `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | appended D-040 to D-045 and L-046 to L-056 |
| Deleted: `.gitkeep` in `app`, `components/ui`, `lib`, `styles` | folders now hold files |

## Decisions
D-040 tokens and single effects switch; D-041 react-router and routes as data (`/invite/:token` added); D-042 nav visibility is a hint (demo shows all, otherwise by role prop); D-043 accessibility approach and axe-core dev dependency; D-044 demo indicator design and no-zero-default; D-045 `sideEffects: false`. Details in `docs/DECISIONS.md`.

## Database changes
None.

## API changes
None.

## Checks executed
| Exact command | Executed? | Result | Relevant output/failure |
|---|---|---|---|
| `npm run check` (typecheck, lint, test, build, secrets:scan) | yes | exit 0 | shared 226, domain 3, web 158 (8 files), worker 4 tests passed; ESLint, lint rules and Prettier clean; web and worker build passed; secretlint clean |
| `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` / `npm run secrets:scan` | yes (as steps of `npm run check`) | pass | see above |
| `npm run build` (alone) | yes | exit 0 | `wrangler deploy --dry-run` Total Upload 845.97 KiB, gzip 140.53 KiB |
| `npm run db:verify`, `db:test`, `db:types -- --check` | no | NOT_EXECUTED | No database or type changes. Commands: `npm run db:verify`, `npm run db:test`, `npm run db:types -- --check` |
| Clean clone of `Raj-AutoPW3` into a temp folder, then `npm ci` and `npm run check` | yes | exit 0 for both | same test counts as above (226 / 3 / 158 / 4) |
| GitHub CI | no | NOT_EXECUTED | nothing pushed |

Transient failure (recorded as L-056): during one earlier `npm run check`, the Worker `wrangler deploy --dry-run` step crashed with exit code -1073740791. `npm run build` then passed, and a full `npm run check` afterwards passed, so the failure was not reproduced and its cause is not known.

Production bundle check: `/dev/components` code is absent from `apps/web/dist` (searched for catalogue strings; none found).

## Manual verification
Done in the embedded browser against `npm run dev` (demo mode):
- **360 px width:** every route (the 10 in the route table, not-found and the dev catalogue: 12) checked for horizontal page scroll; none. Header fits; the menu button opens the drawer, Escape closes it, focus returns to the menu button, the app root is `inert` while open and restored after.
- **Desktop 1280 px:** sidebar, sticky header and DEMO pill visible; the sidebar is fully visible with the banner above the header (fixed after finding it clipped).
- **Effects:** switch on and off checked via computed styles (glow `none`, opaque panels, no blur, no animation). With `prefers-reduced-motion: reduce` emulated, effects default to off and animation stops.
- **Focus:** the focus ring computed style (2 px select colour) confirmed on controls.
- **axe-core in the real browser:** 0 violations on all 12 routes with effects on and with effects off; `color-contrast` was evaluated on 110 nodes.
- **Not demonstrated:** real Tab-key traversal. Tool-issued Tab presses did not move focus in the embedded browser, so keyboard behaviour is evidenced by `user-event` tests in jsdom only (L-049). No screen reader was used.
- Not checked: any real device, Safari, Firefox, or touch input.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Design tokens (colours, spacing, type, radii, glow levels) with a single glow-off switch | VERIFIED | `tokens.css`; effects tests; computed styles in browser |
| Components listed in the task (shell, header, nav, title+status, glass cards, buttons, inputs, selects, tabs/segmented, skeletons, empty states, error banners, confirmation dialogs, tooltips, toasts, accessible tables, connection/freshness, demo banner) | VERIFIED | component tests and `/dev/components` |
| Routes with structured placeholders `/login /register /live /analytics /tariffs /automation /controls /admin /settings` and not-found | VERIFIED | `App.test.tsx`, browser inspection |
| Keyboard operation, focus rings, ARIA | VERIFIED in jsdom; real Tab traversal NOT_EXECUTED | `user-event` tests; browser focus-ring style; L-049 |
| WCAG AA contrast | VERIFIED | `contrast.test.ts` (39) and real-browser axe (110 nodes) |
| `prefers-reduced-motion` respected | VERIFIED | emulated in browser; forced-off CSS |
| No horizontal page scroll at 360 px | VERIFIED | browser check on all routes |
| Monospace telemetry; no energy logic in components | VERIFIED | `TelemetryValue`; components take strings; `components/ui` imports no `@autopw3/domain` code (only two `@autopw3/shared` types in `display.tsx`) |
| Component tests and axe tests | VERIFIED | 158 web tests passing |
| `docs/DESIGN_SYSTEM.md` and dev-only `/dev/components` | VERIFIED | file exists; route absent from `dist` |
| Branch `task-06-...` and PR | NOT_EXECUTED | owner chose to work on `Raj-AutoPW3`; nothing pushed |

## Verification status register
- Design system, shell, routes, contrast, accessibility tests: VERIFIED (local).
- Real keyboard Tab traversal, screen readers, other browsers and devices: NOT_EXECUTED.
- `dev:worker` with new routes: NOT_EXECUTED.
- No Tesla endpoint or capability was used or claimed. The `/controls` capability table is a placeholder ("Not checked"): UNVERIFIED.

## Outstanding issues
- L-046 to L-056 in `docs/KNOWN_LIMITATIONS.md`, in particular: `react-router` 8.5.0 engines `>=22.22.0` (L-046), `axe-core` MPL-2.0 dev-only (L-047), jsdom cannot test contrast (L-048), no real Tab test (L-049), `/invite/:token` added (L-050).
- Question for owner: keep `/invite/:token` as the invitation route name?
- The pre-existing mojibake in `docs/README.md` ("14?"19" in the Operations row) was not touched.
- `docs/HowToBuild.docx` is still untracked and not committed.

## Environment variables
No new variables. Existing: `VITE_DEMO_MODE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL` (local `.env`, Cloudflare build variables).

## Instructions for the next task
TASK-07 (auth) should reuse, not rewrite:
- `AppFrame` in `apps/web/src/app/App.tsx`: pass the server-derived `role` to it (the `role` prop already drives `visibleNavRoutes`). Do not read roles from storage.
- `apps/web/src/app/routes.ts`: replace the `/login`, `/register` and `/invite/:token` page components in `pages/AppPages.tsx`; keep the route table. Add route guards around `AppShell` routes, not inside components.
- `components/ui` (`TextField`, `Button`, `ErrorBanner`, `useToast`, `ConfirmDialog`) for the forms.
- Tests: `renderApp` and the axe helper in `src/test/`. Add an axe check for every new page.
- Effects: never hard-code glow; use tokens and `data-effects`.
- Do not change: token values without running `contrast.test.ts`; the `data-effects` switch; the focus-to-`h1#page-title` behaviour.
- Commands: `npm run dev` (demo, no credentials), `npm test -w @autopw3/web`, `npm run check`.

## Next task
TASK-07 Authentication and household membership (see `docs/ai-build-kit/tasks/`). Prerequisite: this task accepted by the owner; real Supabase credentials are not needed for the demo path (see `docs/CREDENTIALS.md`).
