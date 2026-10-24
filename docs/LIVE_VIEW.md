# Live View

**Status:** built in TASK-09 against the demo provider. There is no live provider yet (Tesla adapter TASK-15, ingestion TASK-16, Worker routes TASK-14), so with live configuration the page says so and shows no numbers. Every threshold on this page is a proposal that no real Tesla data has checked (`UNVERIFIED`, L-077).

Code: `apps/web/src/features/live/`. Route: `/live` (`apps/web/src/app/pages/LivePage.tsx`).

## 1. What the page shows

| Card | Content |
|---|---|
| Demo scenario (demo configuration only) | A select that serves one fixed situation (solar surplus, battery charging, ...) instead of the time-of-day model, so each state can be seen at once. The demo model itself changes only every five minutes |
| Status | Source (a `DEMO` label for demo data), connection, freshness badge with the age ("Updated 12 s ago"), the time of the reading in the site's zone, and a warning when the data is stale, suspect, partial or the last refresh failed |
| Energy flow | The canvas: Core Hub in the centre with Solar (top), Grid (left), Home (right) and Battery (bottom), plus a text summary for screen readers |
| Power now | One card per node: kilowatts, what it is doing in words, and where the power goes ("Core Hub → Battery") |
| Battery | Vertical gauge, percentage, a state word and a caveat when the level is not reliable |

The numbers, the words and the arrows in the text are real page text. They stay readable with animation off, with effects off, with reduced motion, and when the canvas cannot draw.

## 2. How the pieces fit

```
configuration ──► chooseProvider ──► LiveProvider ──► useLiveReading (polls) ──► reading
                                                                                   │
clock ──► useClockTick ──► freshnessOf ────────────────────────────────────────────┤
                                                                                   ▼
                                              buildFlowModel (pure) ──► FlowModel
                                                    │                       │
                          FlowCanvas ◄──────────────┘       FlowReadouts, BatteryGauge,
                          (renderer draws only)             StatusBar, text summary
```

| File | Role |
|---|---|
| `flow-model.ts` | Pure. Turns a normalised reading and its freshness into directed flows, visual levels and a battery display. No canvas, no React, no clock |
| `format.ts` | Pure. Kilowatts, percent, ages, clock time and the screen-reader sentence. Integer arithmetic only (no `toFixed`) |
| `layout.ts` | Pure. Node positions and spoke paths for a given canvas size, and `pointOnPath` |
| `particles.ts` | Pure. `advancePhase` and `particleFractions` (deterministic; no randomness) |
| `renderer.ts` | Draws a `Scene` on a 2D context. It reads results; it never decides direction, size or animation |
| `FlowCanvas.tsx` | React wrapper: one effect owns the animation loop, resize, pixel ratio and cleanup |
| `BatteryGauge.tsx`, `StatusBar.tsx`, `FlowReadouts.tsx` | Text and SVG views of the model |
| `LiveView.tsx` | Page content: chooses the provider, polls, builds the model, renders the cards |
| `create-provider.ts` | The one place configuration becomes a provider |
| `use-live-reading.ts`, `use-time.ts`, `use-reduced-motion.ts` | Polling, the clock tick and the throttled announcement, the motion preference |

The flow model lives in the feature folder, not in `packages/domain`, because the Worker does not need it (task file: "otherwise keep it in the feature folder").

## 3. Flow model

### 3.1 Directions

Signs follow the project convention (solar >= 0; battery > 0 discharging; grid > 0 importing). The model uses the shared `batteryDirection` and `gridDirection` helpers; it does not read signs itself.

| Reading | Spoke kind | Direction |
|---|---|---|
| `solarPowerW` >= idle | `GENERATING` | Solar → Core Hub |
| `batteryPowerW` < 0 | `CHARGING` | Core Hub → Battery |
| `batteryPowerW` > 0 | `DISCHARGING` | Battery → Core Hub |
| `gridPowerW` > 0 | `IMPORTING` | Grid → Core Hub |
| `gridPowerW` < 0 | `EXPORTING` | Core Hub → Grid |
| `loadPowerW` >= idle | `CONSUMING` | Core Hub → Home |
| magnitude below the idle threshold | `IDLE` | no direction; the real number is still shown |
| `null`, not finite, or negative solar or load | `UNKNOWN` | no direction; a dash, never 0 |

### 3.2 Data states

| State | When | Numbers and arrows | Particles |
|---|---|---|---|
| `LIVE` | fresh and quality not `SUSPECT` | shown | move |
| `STALE` | freshness `STALE` | shown, lines dotted | none |
| `SUSPECT` | fresh but quality `SUSPECT` | shown with a warning | none |
| `NONE` | no reading, or freshness `UNAVAILABLE` | nothing is shown as a value; nothing is drawn as flowing | none |

Stale beats suspect. `PARTIAL` readings animate (they are live), and the missing values are dashes with a notice.

### 3.3 Visual scaling (proposals)

| Constant | Value | Meaning |
|---|---|---|
| `IDLE_THRESHOLD_W` | 10 W | below this a flow is idle, so meter noise does not make particles flicker |
| `FULL_SCALE_W` | 6000 W | power at which the visual level reaches 1 |
| level | `sqrt(magnitude / FULL_SCALE_W)`, clamped to 0..1 | small flows stay visible, large ones do not look frantic |
| speed | 24 to 140 px/s | `MIN_SPEED_PX_PER_SECOND`, `MAX_SPEED_PX_PER_SECOND`; hard upper bound whatever the input |
| particles | 1 to 12 per spoke | `MIN_PARTICLES`, `MAX_PARTICLES`; hard upper bound whatever the input |

A frame time larger than 0.1 s is clamped (`MAX_FRAME_SECONDS`) so a long pause (background tab) does not make particles jump.

### 3.4 Battery

| State | Condition | Colour and pattern | Word |
|---|---|---|---|
| `NORMAL` | level >= 15% | green, solid | Normal |
| `LOW` | 5% <= level < 15% | amber, solid | Low |
| `CRITICAL` | level < 5% | red, solid | Critically low |
| `STALE` | reading is stale | grey, hatched | Stale reading |
| `UNKNOWN` | no usable level, or a suspect reading | grey, hatched (dashed outline if no level) | No reliable level |

The percentage is rounded down (14.9 shows "14" and is Low), so the number never reads higher than the real level and always agrees with the word (D-065). The drawing is a `role="meter"` whenever there is a level.

The boundary is strict: exactly 15% is Normal. The domain's `describeFlows` treats `<= 15` as low, so the two disagree for a reading of exactly 15% (L-078).

## 4. Canvas and animation

- One `requestAnimationFrame` loop, owned by one effect in `FlowCanvas`. Phases, timestamps, the frame handle and the canvas size live in that effect's closure, not in React state, so a frame never causes a React render.
- The loop runs only while data is `LIVE`, some spoke is moving, `animate` is true and the tab is visible. It is cancelled on unmount and whenever one of those stops holding; when it is not running, the still frame is redrawn on every model, size or pixel-ratio change.
- `animate` is false when effects are switched off (`<html data-effects="off">`) or the system asks for reduced motion. The frame is then drawn once, with direction arrows and no particles, and no frame is ever requested.
- Resize: a `ResizeObserver` (a window `resize` listener where it is missing) re-measures the box. The bitmap is sized by the device pixel ratio and drawing is scaled to CSS pixels; a change of pixel ratio (browser zoom, another screen) is noticed through a `matchMedia` resolution query.
- The box is sized by Tailwind aspect classes: `10/11` up to 520 px wide, `100/56` wider. No inline styles.
- Colours are read once from the design tokens (CSS custom properties) with fallbacks.
- Active spokes always get a mid-path arrowhead, so direction is visible without motion. Dotted lines mean "not live".

## 5. Accessibility

- The canvas is `aria-hidden`. The same information is in the "Power now" list and in a polite live region (`role="status"`) that reads, for example: "Solar generating 3.80 kilowatts. Battery charging 2.40 kilowatts. Grid exporting 0.70 kilowatts. Home using 0.70 kilowatts. Battery level 58 percent." Stale and suspect data are announced as such.
- The live region is throttled: the first reading is announced at once, later changes at most every 15 s (a proposal), so a screen reader is not flooded.
- Nothing relies on colour: states have words, patterns (hatching, dotted lines, dashed outlines) and arrows.
- Missing values are a dash with "No data" for screen readers.
- axe runs on the loading state and on five scenarios (jsdom; contrast is covered by the token tests, L-048).

## 6. Configuration

`VITE_TELEMETRY_PROVIDER` chooses where readings come from. It is read by `apps/web/src/lib/config.ts`.

| Variable | Demo mode (`VITE_DEMO_MODE` not `false`) | Live mode (`VITE_DEMO_MODE=false`) |
|---|---|---|
| unset | `demo` | `live` |
| `demo` | `demo` | `demo` (labelled DEMO everywhere) |
| `live` | **invalid** (a contradiction; the page shows the reason) | `live` |
| anything else | invalid | invalid |

`live` has no provider yet, so the page shows "No live data source is connected yet" and no numbers. It never falls back to demo data (D-063). When the live provider exists it is added in `create-provider.ts` and nothing else changes.

## 7. Polling

One request at a time, the next scheduled only after the last finishes; no request while the tab is hidden; a refresh as soon as it is visible again (Tesla requests will cost money, D-023). A failed refresh keeps the last reading and says so; provider messages are never shown, only a fixed sentence per error kind. A late answer after unmount is ignored. The interval is 10 s (a proposal) and a prop.

## 8. Tests

`flow-model`, `format`, `layout-particles` (pure); `renderer` (a recording fake context: arrows always, particles only when animated, caps); `FlowCanvas` (loop, cleanup on unmount, reduced motion, hidden tab, resize and pixel ratio); `BatteryGauge`, `StatusBar`; `use-live-reading`, `use-time`, `create-provider`, `config`; `LiveView` (changing the scenario reverses the battery and grid flow text and updates the battery level, stale, missing, invalid, demo label, live-without-provider, announcements, motion, axe).

jsdom has no canvas: `test-setup.ts` makes `getContext` return `null`, as a browser without 2D support does, and canvas tests install `fake-canvas.ts`. Pixels are not tested (L-080).

## 9. Not verified

See `docs/KNOWN_LIMITATIONS.md` L-076 to L-085: every threshold above; behaviour with real Tesla readings; real devices, Safari, screen readers and keyboard-only use; CPU and battery cost of the loop; a device clock that is wrong.
