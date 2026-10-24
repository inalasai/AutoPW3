# AutoPW3 - Task Handoff Report

## Task completed
Number and name: TASK-09 Animated Live View
Branch / commit: `Raj-AutoPW3` (owner chose this branch instead of `task-09-live-view`); commits prefixed `task-09:`. Not pushed. No PR opened (L-076, as L-075).
Date: 2026-10-24

**Status: complete for what could be run locally.** Both acceptance criteria are met and proven by tests. Not done: real devices, Safari, screen readers, keyboard-only use, a Playwright test, CPU and battery measurement, GitHub CI and the pull request (all `NOT_EXECUTED`, L-080, L-083, L-085). Every visual and timing threshold is a proposal that no real Tesla data has checked (`UNVERIFIED`, L-077). There is no live provider yet, so with demo mode off the page shows an empty state (`MOCK_ONLY`, L-079).

## Summary
The Live page now shows a Core Hub with Solar, Grid, Home and Battery spokes on a canvas, with kW numbers and direction words in real text next to it, a vertical battery gauge, and a status bar with the source, the age of the reading, a freshness badge and a DEMO badge. Particles move only for fresh data and only when effects are on, motion is allowed and the tab is visible; stale or suspect data keeps its numbers and arrowheads on dotted lines. Unknown values are shown as a dash, never as zero. The data source is chosen by `VITE_TELEMETRY_PROVIDER`; the demo provider from TASK-08 feeds it today. A screen-reader summary is a polite live region, throttled.

## Files created
All under `apps/web/src/features/live/` unless stated.
| Path | Purpose |
|---|---|
| `flow-model.ts` | pure model: per-spoke direction, magnitude, idle and unknown, data state `LIVE / STALE / SUSPECT / NONE`, battery state, summary sentence |
| `format.ts` | kW, percent (rounds down) and age formatting; no `toFixed` |
| `layout.ts`, `particles.ts` | node positions and particle count, speed and positions with hard bounds |
| `create-provider.ts` | `chooseProvider(config, clock, scenario?)`: the only mapping from configuration to a provider |
| `use-live-reading.ts` | polling hook (one request in flight, hidden-tab pause, keeps the last reading on error) |
| `use-time.ts`, `use-reduced-motion.ts` | clock tick, throttled text, `prefers-reduced-motion` |
| `renderer.ts` | canvas drawing only; reads colours from the design tokens with fallbacks |
| `FlowCanvas.tsx` | `requestAnimationFrame` loop with cleanup, resize and pixel-ratio handling, reduced motion |
| `BatteryGauge.tsx`, `StatusBar.tsx`, `FlowReadouts.tsx` | gauge, status and banners, kW cards |
| `LiveView.tsx`, `index.ts` | the page body; demo-only scenario select |
| `fake-canvas.ts` | recording fake 2D context for tests |
| `*.test.ts(x)` (11 files) | tests for the model, format, layout and particles, provider selection, polling, time hooks, renderer, canvas, gauge, status bar, page |
| `apps/web/src/app/pages/LivePage.tsx` | route component that wires the config, clock and effects switch to `LiveView` |
| `docs/LIVE_VIEW.md` | architecture, flow rules, canvas rules, accessibility, configuration, tests, what is unverified |
| `docs/handoffs/TASK-09.md` | this report |

## Files modified
| Path | What changed and why |
|---|---|
| `apps/web/src/lib/config.ts`, `config.test.ts` | `TelemetryConfig` and `readTelemetry` for `VITE_TELEMETRY_PROVIDER` (unset, `demo`, `live`, invalid; `live` with demo mode is invalid). Outside the named paths |
| `apps/web/src/lib/clock.ts` | `systemClock`. Outside the named paths |
| `apps/web/src/app/App.tsx`, `App.test.tsx`, `pages/AppPages.tsx` | the placeholder Live page replaced by `LivePage`; unused imports removed; test updated |
| `apps/web/src/test-setup.ts` | stubs `HTMLCanvasElement.getContext` to null (jsdom has no canvas) and restores mocks after each test |
| `apps/web/src/test/render.tsx`, `features/auth/auth.test.tsx` | the config object now carries `telemetry` |
| `.env.example` | commented `VITE_TELEMETRY_PROVIDER` with explanation |
| `apps/web/README.md`, `docs/README.md`, `docs/DESIGN_SYSTEM.md`, `docs/TESTING.md` | status, link, canvas-and-tokens rules, how canvas and animation are tested |
| `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | D-061 to D-067 and L-076 to L-085 appended |
| `docs/ai-build-kit/00-README.md` | TASK-09 ticked with caveats |
| removed | `apps/web/src/features/live/.gitkeep` |

`docs/HowToBuild.docx` is untracked and was not committed.

## Decisions
D-061 pure model, drawing-only renderer, animation state outside React; D-062 unknown is never zero, only live data moves; D-063 provider chosen by `VITE_TELEMETRY_PROVIDER`, live never falls back to demo; D-064 thresholds are proposals (`UNVERIFIED`); D-065 battery percent rounds down; D-066 polling rules; D-067 accessibility approach. All in `docs/DECISIONS.md`.

## Database changes
None.

## API changes
None. The Worker is untouched. The Live View calls the `TelemetryProvider` interface from TASK-08; the Worker's `/live` route (TASK-14) will sit behind a future live provider with the same interface.

## Checks executed
| Exact command | Executed? | Result | Relevant output |
|---|---|---|---|
| `npm run check` (typecheck incl. `e2e/`, lint with architecture rules and Prettier, tests, build, secrets scan), run after the last documentation commit | yes | exit 0 | tests: shared 226 (15 files), domain 226 (11 files), web 462 (25 files), worker 4 (1 file); lint-rule checks and Prettier pass; web build and `wrangler deploy --dry-run` pass; Secretlint clean; no `act` warnings |
| Clean clone of the branch into a temporary folder, `npm ci`, `npm run check` (run on the final code and documentation commit, before the handoff-only commit) | yes | `npm ci` exit 0; `npm run check` exit 0 | clone of commit `306b82e`: shared 226, domain 226, web 462, worker 4; lint-rule checks, Prettier, wrangler dry-run and Secretlint pass |
| `npm run test:e2e` | no | `NOT_EXECUTED` | no Playwright test covers the Live View (L-085). Command: `npm run test:e2e` |
| `npm run db:test`, `npm run db:verify`, `npm run db:types -- --check` | no | `NOT_EXECUTED` | no database object changed |
| GitHub CI, PR | no | `NOT_EXECUTED` | nothing pushed |

Vitest does not type-check, so `npm run typecheck` caught three things the tests did not: unused imports in `AppPages.tsx`, a `glow` prop that `exactOptionalPropertyTypes` rejects, and a provider error code that does not exist (`UPSTREAM_ERROR`, now `UNAVAILABLE`). All were fixed. Two test-hang causes were found and fixed too: a provider object created on every render restarted the polling effect (now a documented rule that the provider must be stable), and a clock returning a new `Date` on every call made the clock hook loop (it now keeps the old value when the time is equal).

Bundle: the web entry chunk is 478 kB (152 kB gzip), up from 436 kB (137 kB gzip) after TASK-07 (L-082).

## Manual verification
Done by hand in the embedded browser against the demo provider, once; not repeated on real devices.
- Phone: a 479 px window and a 360 px emulation (pixel ratio 3). The layout was right and nothing overflowed sideways. At 360 px the canvas was about 294 by 323 CSS px.
- Desktop: 1280 px at pixel ratio 2. Measured only: canvas 919 by 515 CSS px, bitmap 1838 by 1030, no horizontal overflow. The screenshot was cropped by the viewer panel, so I did not see the whole desktop page (L-080).
- Solar surplus: arrowheads pointed the right way. Stale: dotted lines with arrowheads, no particles, a warning banner.
- Effects off: 0 animation-frame requests in 500 ms. Effects on: about 31 in 500 ms.
- The browser's synthetic click on the Effects switch did not toggle it, while calling the React handler did. I believe this is a quirk of the embedded browser, not a defect, but I have not proven that on a real browser.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Swapping a fixture reverses the flow and updates the battery | VERIFIED | `LiveView.test.tsx` "reverses the battery flow, its words and its level when the reading changes" and "reverses the grid flow between import and export"; `flow-model.test.ts` for the direction rules |
| Numbers are readable without animation | VERIFIED | `LiveView.test.tsx` "never animates with effects off, and the numbers and arrows are all still there", the same for reduced motion and for stale data; the kW values are text in `FlowReadouts`, not canvas |
| All tests pass | VERIFIED | 462 web tests in 25 files, and the rest of `npm run check` |
| Core Hub, Solar, Battery, Home, Grid nodes with kW and direction always visible | VERIFIED | `FlowReadouts` and `renderer.test.ts` |
| Vertical battery widget: green normal, amber below 15%, distinct critical, unknown or stale | VERIFIED | `BatteryGauge.test.tsx` (words, hatching for stale and unknown), `format.test.ts` (boundaries) |
| `requestAnimationFrame` loop with cleanup, resize and pixel-ratio handling, reduced motion | VERIFIED (jsdom, fake context, plus one manual check) | `FlowCanvas.test.tsx` |
| Source, age and freshness shown; DEMO indicator | VERIFIED | `StatusBar.test.tsx`, `LiveView.test.tsx` "labels demo data as DEMO" |
| Accessible summary; no axe violations | VERIFIED (axe in jsdom only) | `LiveView.test.tsx` accessibility tests |
| Provider chosen by configuration | VERIFIED for `demo`; `MOCK_ONLY` for `live` | `create-provider.test.ts`, `config.test.ts`; L-079 |
| Mobile layout | VERIFIED once by hand at 360 and 479 px; not on a real phone | see Manual verification |
| `docs/LIVE_VIEW.md` | done | thresholds `UNVERIFIED` |

## Verification status register
- Flow model, formatting, particles, polling, provider selection, gauge, status bar, page, renderer calls: `VERIFIED` by tests.
- Pixel appearance: checked once by eye in one embedded browser; desktop only by measurement (L-080).
- Thresholds (10 W idle, 6000 W full scale, 12 particles, 24 to 140 px/s, 5% critical, 10 s poll, 15 s announce): `UNVERIFIED` (L-077).
- `live` provider: `MOCK_ONLY`; no adapter yet (L-079).
- Real phones, Safari, NVDA, VoiceOver, keyboard-only: `NOT_EXECUTED` (L-080).
- CPU and battery use: `NOT_EXECUTED` (L-083). Playwright test: `NOT_EXECUTED` (L-085).
- Device clock error mislabelling freshness: known (L-084).

## Outstanding issues
- Look at the page on a real phone and on desktop, and try it with a screen reader and the keyboard (L-080).
- Add a Playwright test for the Live View when the owner wants one (L-085).
- The low-battery boundary differs from the domain's `describeFlows` at exactly 15% (L-078). Should one of the two change?
- Branch name and missing PR (L-076); CI has not run.
- Question for the owner: is 60 frames a second acceptable on phones, or should the loop be capped (L-083)?

## Environment variables
`VITE_TELEMETRY_PROVIDER` (`demo` or `live`; optional). Set locally in `.env.local`; for a deployment, as a Vite build variable (it is public, not a secret). Documented in `.env.example`. Unset: `demo` in demo mode, otherwise `live`.

## Instructions for the next task
- The live data source plugs in at one place: the `live` branch of `chooseProvider` in `apps/web/src/features/live/create-provider.ts`. It must return a stable object (create it once, not inside a render), implement `TelemetryProvider<'TESLA'>` from `@autopw3/domain`, and map failures to `TelemetryProviderError` so the page's fixed error sentences apply. Never show provider error text in the UI.
- Do not change `flow-model.ts` semantics (unknown is never zero; only `LIVE` moves) without a decision.
- Do not draw the Live View from demo data in a live deployment: `live` must never fall back to demo (D-063).
- Keep the canvas `aria-hidden` and the numbers as real text.
- Check commands: `npm run check`; for the web workspace only, `npm test -w @autopw3/web`.

## Next task
TASK-10 Tariff engine (docs/ai-build-kit/tasks/TASK-10-tariff-engine.md). Prerequisite: the owner's say-so and, as before, the local-branch and no-PR handling.
