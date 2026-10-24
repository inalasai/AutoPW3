# Design system and application shell

**Status:** built in TASK-06. Tokens, components, shell and placeholder pages exist and are tested. No feature behaviour: no data fetching, no authentication, no charts, no energy calculations.

Code: `apps/web/src/styles/` (tokens), `apps/web/src/components/ui/` (components), `apps/web/src/app/` (routes, shell, pages). Browse every component at `/dev/components` while running `npm run dev`.

## Principles
- **Dark, readable, honest.** A "space-black glass" look with a solar / battery / grid colour identity. Everything stays readable with all effects off, and status is never carried by colour or glow alone (icons and text labels accompany it).
- **No energy logic in components.** Components receive already-formatted strings from callers. They never compute, convert or default energy values. A missing value renders as a dash plus a screen-reader "No data"; it is never shown as zero.
- **Server is authoritative.** Hiding a nav entry is a courtesy. Roles are never read from the browser's storage.
- **Demo is always visible.** Demo mode shows a labelled banner above the header and a sticky `DEMO` pill in the header.
- **CSP friendly.** `public/_headers` sets `default-src 'self'; style-src 'self'`, so: system font stacks only, inline SVG icons, no inline `<style>` or scripts, no external assets.

## Tokens
Defined once in `src/styles/tokens.css` using Tailwind 4 `@theme`, so each token is also a utility class (`bg-space-950`, `text-ink-muted`, `border-line`, `h-header`, `w-sidebar`).

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `space-950` `#020617`, `space-900`, `panel`, `line`, `field-border` | page, cards, hairlines, form control borders |
| Text | `ink` `#e2e8f0`, `ink-muted` `#94a3b8` | primary and secondary text |
| Energy identity | `solar` `#f59e0b`, `battery` `#10b981`, `grid` `#6366f1`, `grid-ink` `#a5b4fc`, `select` `#06b6d4` | telemetry tone, flow hairline, focus/selection. `grid-ink` is the text-safe grid colour |
| Status | `danger`, `danger-solid`, `warning`, `success`, `info` | banners, toasts, destructive button |
| Type | `font-sans`, `font-mono` | system stacks. Telemetry values use mono |
| Radii | `control` 0.5rem, `card` 0.875rem, `pill` | |
| Layout | `header` 3.5rem, `sidebar` 15rem | |
| Glow | `--glow-solar`, `--glow-battery`, `--glow-grid`, `--glow-select` (four levels) | `GlassCard` tone shadows |

### Effects switch (one place to turn glow off)
`<html data-effects="on|off">`. When `off`: all glow variables are `none`, glass is opaque (`--glass-alpha: 1`), blur is `0`, the background aurora is `0`, and animation and transition are disabled. The same state is forced by `prefers-reduced-motion: reduce`, and visitors with that preference default to `off`. The user choice is stored in `localStorage` under `autopw3.effects` (a display preference only). `applyEffects(readInitialEffects())` runs in `main.tsx` before first render so there is no flash. Toggle with the header switch, or `useEffects()` in code.

## Components (`src/components/ui`)
| Component | Notes |
|---|---|
| `Button`, `IconButton`, `buttonClasses` | variants primary / secondary / ghost / danger; `loading` disables and announces; `IconButton` requires a `label` |
| `TextField`, `SelectField`, `Switch` | label, hint and error wired with `aria-describedby`; `Switch` is `role="switch"` |
| `Tabs` | WAI-ARIA tabs: arrow keys, Home/End, roving tabindex |
| `SegmentedControl` | native radios in a fieldset; keyboard and form friendly |
| `Skeleton`, `LoadingRegion` | placeholder shapes; region sets `aria-busy` |
| `EmptyState` | title, explanation, optional action; `headingLevel` prop keeps heading order valid |
| `ErrorBanner` | `role="alert"`; title, message, optional retry |
| `DemoBanner` | `role="status"`, inside a named `region` "Demo mode" |
| `GlassCard` | glass surface with optional glow tone (`solar`, `battery`, `grid`, `select`, none) |
| `PageHeader` | `h1#page-title` (focus target on navigation), optional status slot |
| `TelemetryValue` | mono value + unit + tone; `null` shows dash and sr-only "No data" |
| `ConnectionIndicator`, `FreshnessBadge` | icon + text states, never colour only; freshness is given as a prepared label |
| `DataTable` | semantic `<table>`, caption, `scope="col"`, focusable scroll region so it is keyboard-scrollable at 360px |
| `Modal`, `ConfirmDialog` | focus trap, Escape, focus return, `inert` on the app root; `ConfirmDialog` uses `role="alertdialog"` and a danger confirm for destructive actions |
| `Tooltip` | shown on hover and focus, `aria-describedby`, Escape dismisses |
| `ToastProvider`, `useToast` | polite live region; error toasts use `role="alert"` and persist until dismissed |
| icons | inline SVG, decorative by default (`aria-hidden`) |

### Adding a component
1. Put it in `components/ui/` using only tokens; no energy, Tesla or fetch code.
2. Export it (and its prop types) from `index.ts`.
3. Add a test next to it, including an axe check via `src/test/axe.ts` where it renders structure.
4. Add an example to `app/dev/ComponentCatalogue.tsx`.

## Routes and shell
Route inventory is data in `src/app/routes.ts` (from `PRODUCT_REQUIREMENTS.md` section 5). Feature tasks replace page components, not this table.

| Path | Page | Nav | Access hint | Real page built in |
|---|---|---|---|---|
| `/live` | Live | yes | READ_ONLY | 09 |
| `/analytics` | Analytics | yes | READ_ONLY | 13 |
| `/tariffs` | Tariffs | yes | READ_ONLY | 12 |
| `/controls` | Controls | yes | READ_ONLY | 17 |
| `/automation` | Automation | yes | READ_ONLY | 18 |
| `/settings` | Settings | yes | READ_ONLY | 15, 19 |
| `/admin` | Admin | yes | ADMIN | 19 |
| `/login`, `/register` | Sign in, Create account | Sign in link | public | 07 |
| `/invite/:token` | Accept invitation (added: the PRD describes invitations; not in the task's route list) | no | public | 07, 19 |
| `*` | Page not found | no | n/a | n/a |
| `/dev/components` | Component catalogue | no | **dev build only** | n/a |

`/` redirects to `/live`. The Worker serves `index.html` for unknown paths, so deep links work.

**Navigation visibility** (`visibleNavRoutes`): in demo mode every entry is shown (demo holds only synthetic data); with demo off only public entries are shown until a `role` is supplied, then entries up to that role (`roleAtLeast` from `@autopw3/shared`). TASK-07 passes the role from the server session through `AppFrame`'s `role` prop.

**Shell:** skip link; demo banner region; sticky header (menu button below `lg`, DEMO pill, effects switch, Sign in); sidebar from `lg`; mobile drawer (`Modal` behaviour: trapped focus, Escape, focus returns to the menu button). On each navigation focus moves to `h1#page-title` and the document title updates.

## Accessibility
- Keyboard: every control reachable and operable; visible 2 px `select` focus ring (computed style checked); no keyboard traps except intentional modal traps that release on close.
- Semantics: landmarks (`banner`, `navigation`, `main`, demo `region`), one `h1` per page, labelled forms, table captions, live regions for toasts.
- Contrast (WCAG AA): `styles/contrast.test.ts` parses `tokens.css`, computes the WCAG ratio for every text, control, border and focus pair that the components use, and fails if one drops below 4.5:1 (text) or 3:1 (non-text). jsdom cannot evaluate colour, so axe tests disable `color-contrast`; contrast was additionally checked with axe in a real browser (see the handoff).
- Reduced motion: `prefers-reduced-motion: reduce` forces effects off; transitions and animations stop.
- Responsive: no horizontal page scroll at 360 px width (checked on every route in a browser; tables scroll inside their own focusable region).

## Tests
`npm test -w @autopw3/web` runs component, shell, route and axe tests (jsdom, Testing Library, `user-event`). `src/test/render.tsx` provides `renderApp` (uses `AppFrame` in a `MemoryRouter`) for later tasks; `src/test/axe.ts` provides the axe helper. See [`TESTING.md`](TESTING.md).

## Dependencies added (TASK-06)
`react-router` 8.5.0 (MIT), `@testing-library/user-event` 14.6.8 (MIT, dev), `axe-core` 4.14.0 (MPL-2.0, dev and test only, not shipped in the bundle). Approved by the owner before installation.
