# AutoPW3 - Task Handoff Report

## Task completed
Number and name: TASK-10 Universal Tariff Engine
Branch / commit: `Raj-AutoPW3` (owner chose this branch instead of `task-10-tariff-engine`); commits prefixed `task-10:`. Not pushed. No PR opened (L-087, as L-075 and L-076).
Date: 2026-10-24

**Status: complete for what could be run locally.** All three acceptance criteria are met and proven by tests. Not done: GitHub CI and the pull request (`NOT_EXECUTED`, L-087), `npm run db:*` and `npm run test:e2e` (nothing in the database or browser app changed). Every tariff figure in fixtures and documents is an `ILLUSTRATIVE EXAMPLE` (L-092). Negative prices work in the engine but cannot be stored yet (L-086, owner's choice).

## Summary
`packages/domain/src/tariff` is now a pure tariff engine. It validates tariffs, tariff sets and dynamic price points; resolves the rate at an instant with a fixed precedence (version, date override, dynamic price, season, base slots, flat); splits any time range at every instant the rate can change, correctly across DST days of 23 and 25 hours; prices an energy interval in decimal with VAT, levies and export payment, with an explicit status when it cannot (no rate, or more than one rate); and charges standing charges per local date. Missing coverage is always a returned problem, never zero. Nine labelled example tariffs and half-hourly price generators are exported for later tasks.

## Files created
All under `packages/domain/src/tariff/` unless stated.
| Path | Purpose |
|---|---|
| `types.ts` | `TariffDefinition`, `ResolvedRate`, `RateProblem`, `RateSegment`, `CoverageGap`, price observation types |
| `money.ts` | shared `Decimal`, `decimalFrom` (refuses numbers), `energyWhFrom`, `whToKwh`, `exact`, `minorUnitDigits`, `roundToMinorUnit` |
| `calendar.ts` | local date and minute of an instant in a zone, day type, month-day seasons, `localDay` (start, end, DST change), `instantsOfLocalMinute` (0, 1 or 2 instants) |
| `select.ts` | version in force, schedule for a date (override, season, base), day-type slot sets, slot lookup |
| `observations.ts` | `indexPricePoints`, price point lookup (binary search; overlaps remembered) |
| `resolve.ts` | `resolveTariffRate` |
| `split.ts` | `splitIntervalAtBoundaries`, `findCoverageGaps`, `MAX_SPLIT_DAYS` |
| `charges.ts` | decimal breakdown (base, levies, VAT, total), `energyCharge`, `chargesForLocalDates`, `MAX_CHARGE_DAYS` |
| `price.ts` | `priceInterval`, `PRICING_MODES` |
| `validate.ts` | `validateTariff`, `validateTariffSet`, `validatePricePoints`, `uncoveredMinutes` |
| `index.ts` | public exports (re-exported by `packages/domain/src/index.ts`) |
| `fixtures/examples.ts`, `fixtures/index.ts` | nine `ILLUSTRATIVE EXAMPLE` tariffs, `halfHourlyPricePointsForDay(s)`, `rateFromMicro` |
| `test-helpers.ts` | `ms`, `variant`, `rateOrCode` (tests only) |
| `*.test.ts` (11 files, 283 tests run; 509 in the whole domain package) | `calendar`, `money`, `observations`, `resolve`, `split`, `price`, `charges`, `validate`, `fixtures`, `no-float-money`, `properties` |
| `docs/TARIFF_ENGINE.md` | data model, precedence, DST, validation, money, statuses, API summary, fixtures |
| `docs/handoffs/TASK-10.md` | this report |

## Files modified
Outside the named write path (`packages/domain/src/tariff`, `docs/TARIFF_ENGINE.md`), each for a reason:
| Path | What changed and why |
|---|---|
| `packages/shared/src/constants/enums.ts` | four codes appended to `TARIFF_PROBLEM_CODES`: `TIMEZONE_UNKNOWN`, `TIMEZONE_MISMATCH`, `PRICE_POINT_OVERLAP`, `LEVY_ON_EXPORT`. Additive, as the enum's comment allows; nothing stores them (D-080) |
| `packages/domain/package.json`, `package-lock.json` | devDependencies `@vitest/coverage-v8` 5.0.5 and `fast-check` 4.10.2 (owner approved both, D-081); script `test:coverage` |
| `packages/domain/vitest.config.ts` | V8 coverage settings for `src/tariff` (on demand) |
| `packages/domain/src/index.ts` | `export * from './tariff'` |
| `packages/domain/README.md`, `docs/README.md`, `docs/TESTING.md`, `docs/ai-build-kit/00-README.md` | status, links, coverage and property-test notes, TASK-10 ticked |
| `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` | D-068 to D-081 and L-086 to L-093 appended. The last line of `DECISIONS.md` gained a trailing newline, so git shows it as one changed line; its text is unchanged |
| removed | `packages/domain/src/tariff/.gitkeep` |

`docs/HowToBuild.docx` is untracked and was not committed.

## Decisions
D-068 results not exceptions, never zero; D-069 site-specific version beats household default; D-070 precedence details (day-type sets replace `ALL`, overrides replace the whole day, empty season inherits, equal priority ambiguous; this was the stop condition and is documented before use); D-071 midnight crossing is two slots; D-072 DST: price by the instant's local time; D-073 splitting uses the resolver's schedule; D-074 pricing statuses and the Q-08 default `STRICT`; D-075 VAT and levies; D-076 no rounding in the engine, half-up display rounding; D-077 standing charge per local date; D-078 negative prices engine-only; D-079 range limits; D-080 shared problem codes and fixtures location; D-081 development dependencies. All in `docs/DECISIONS.md`, all **Proposed**.

## Database changes
None.

## API changes
None. The shared `TARIFF_PROBLEM_CODES` list has four more values; `TariffProblemSchema` accepts them (tested). `docs/API_CONTRACT.md` does not list the codes, so it needed no change. The Worker is untouched.

## Function contracts
Instants are epoch milliseconds (whole numbers). `tariffs` is every version the caller has for the site, both directions; `direction` selects. `options.siteId` selects a site-specific version over household defaults (D-069). `options.priceObservations` comes from `indexPricePoints`. Money and rates are decimal strings. All functions are pure and deterministic and do not change their input.

| Function | Returns | Throws `RangeError` for |
|---|---|---|
| `resolveTariffRate(atMs, tariffs, direction, options?)` | `{ ok: true, ratePerKwh, currency, tariffId, tariffKey, version, source: OVERRIDE\|DYNAMIC\|SEASON\|BASE\|FLAT, label, scheduleName, localDate, localMinute }` or `{ ok: false, code: NO_TARIFF_FOR_DATE\|TARIFF_GAP\|NO_PRICE_POINT\|AMBIGUOUS_TARIFF, message, localDate }` | an instant that is not a whole number |
| `splitIntervalAtBoundaries(startMs, endMs, tariffs, direction, options?)` | `RateSegment[]` (`{ startMs, endMs, result }`): contiguous, ordered, exactly covering `[startMs, endMs)`; neighbours with the same result joined | empty range, inexact instant, range over 400 days |
| `findCoverageGaps(startMs, endMs, tariffs, direction, options?)` | `CoverageGap[]` (`{ startMs, endMs, code, message }`); empty means fully covered | same as the splitter |
| `priceInterval({ startMs, endMs, energyWh }, tariffs, direction, { siteId?, priceObservations?, mode? })` | `PRICED` or `ESTIMATE` (`direction`, `currency`, `energyKwh`, `exportPaymentModel`, `parts[]`, `amounts`), `UNPRICEABLE_AT_RESOLUTION` (`segments`) or `UNPRICED` (`gaps`). `mode` is `STRICT` (default) or `PRORATA_ESTIMATE` | empty or inexact range, negative or non-finite energy, range over 400 days, a taxed tariff with no VAT rate, versions of different currencies in one interval |
| `chargesForLocalDates(fromDate, toDateExclusive, tariffs, { siteId? })` | `{ ok: true, currency, days[] (localDate, tariffId, standingChargeAmount, levyLines, amounts), totals }` or `{ ok: false, problems: [{ localDate, code }] }` | malformed, empty or reversed dates, over 1100 days, mixed currencies, a taxed tariff with no VAT rate |
| `validateTariff(tariff)` | `TariffProblem[]` (`SLOT_OVERLAP`, `COVERAGE_GAP`, `SEASON_OVERLAP`, `SEASON_GAP`, `OVERRIDE_PRIORITY_TIE`, `TIMEZONE_UNKNOWN`, `LEVY_ON_EXPORT`) | never |
| `validateTariffSet(tariffs)` | each tariff's problems with paths `tariffs[i].…`, plus `EFFECTIVE_DATE_OVERLAP`, `CURRENCY_MISMATCH`, `TIMEZONE_MISMATCH` | never |
| `validatePricePoints(points, path?)` | `PRICE_POINT_OVERLAP` for the later point of each overlapping pair | never |
| `indexPricePoints([{ tariffId, pricePoints }])` | lookup structure | an unreadable or empty interval (parse with `PricePointSchema` first) |
| `roundToMinorUnit(amount, currency)` | display string, half up | an unlisted currency |
| `decimalFrom(text)` | `Decimal` | anything that is not a decimal string, including a number |

Amounts (`AmountBreakdown`): `baseAmount`, `levyAmount`, `vatAmount`, `totalAmount`, `amountExcludingVat`, all exact decimal strings, never rounded.

## Fixture index
All in `packages/domain/src/tariff/fixtures/examples.ts`, exported from `@autopw3/domain`. EUR, `Europe/Dublin`, names start `EXAMPLE`. **All figures `ILLUSTRATIVE EXAMPLE`.**
| Export | Use it to test |
|---|---|
| `FLAT_IMPORT_EXAMPLE` | flat rate, standing charge, VAT exclusive. 2 kWh: base 0.6, VAT 0.138, total 0.738 |
| `DAY_NIGHT_IMPORT_EXAMPLE` | day and night across midnight, VAT inclusive |
| `DAY_NIGHT_PEAK_IMPORT_EXAMPLE` | three bands, a per-kWh levy outside VAT, a per-day taxable levy |
| `SEASONAL_WEEKDAY_WEEKEND_IMPORT_EXAMPLE` | seasons wrapping the year end, weekday and weekend sets, two overlapping overrides with different priority |
| `DYNAMIC_IMPORT_EXAMPLE` | dynamic prices (supply them with `halfHourlyPricePointsForDay(s)`: 48, 46 or 50 points a day) |
| `DAY_NIGHT_VERSION_1_EXAMPLE`, `DAY_NIGHT_VERSION_2_EXAMPLE` | an effective-date change on 2026-11-01 (standing charge 0.60 to 0.70) |
| `EXPORT_PER_KWH_EXAMPLE`, `EXPORT_NONE_EXAMPLE` | export paid 0.10 per kWh; export paid nothing (explicit zero) |
| `TARIFF_EXAMPLES`, `TARIFF_FIXTURE_NOTICE`, `rateFromMicro` | all examples by name; the notice text; millionths to a decimal string |

## Checks executed
| Exact command | Executed? | Result | Relevant output |
|---|---|---|---|
| `npm run check` (typecheck incl. `e2e/`, lint with architecture rules and Prettier, tests, build, secrets scan) on the code commit plus the documentation changes | yes | exit 0 | tests: shared 226 (15 files), domain 509 (22 files), web 462 (25 files), worker 4 (1 file); all lint-rule checks and Prettier pass; web build and `wrangler deploy --dry-run` pass; Secretlint clean |
| `npm run test:coverage -w @autopw3/domain` | yes | exit 0, 509 tests pass | `src/tariff`: statements 98.09% (567/578), branches 95.41% (354/371), functions 100% (105/105), lines 99.59% (486/488). Per file (statements, branches): `calendar` 98.46, 93.93; `charges` 98.48, 97.29; `money` 96, 93.75; `observations` 100, 97.36; `price` 95.91, 88.88; `split` 95.89, 92.06; `validate` 97.58, 94.93; `resolve`, `select`, `types`, `index` and `fixtures` 100. Uncovered: defensive branches that cannot be reached with schema-valid data (for example `price.ts` 158-160 and 171, `money.ts` 31, `validate.ts` 28, 99-102 and 225). Coverage covers the tariff folder only |
| Clean clone of the branch into a temporary folder, `npm ci`, `npm run check` (run on the final code and documentation commit, before the handoff-only commit) | yes | `npm ci` exit 0; `npm run check` exit 0 | clone of commit `8dfd8e6`: shared 226, domain 509, web 462, worker 4; lint-rule checks, Prettier, wrangler dry-run and Secretlint pass |
| `npm run test:e2e`, `npm run db:test`, `npm run db:verify`, `npm run db:types -- --check` | no | `NOT_EXECUTED` | no browser page or database object changed |
| GitHub CI, PR | no | `NOT_EXECUTED` | nothing pushed |

Vitest does not type-check, so `npm run typecheck` was run separately and passes for the tests too. The web entry chunk is unchanged at 478 kB (152 kB gzip): the web app does not import the engine yet, and `sideEffects: false` keeps it out.

## Manual verification
None by hand: the engine has no UI. Independent checks that are not the code under test:
- The DST facts (Dublin 2026-03-29 is 23 hours with the change at 01:00Z; 2026-10-25 is 25 hours, starting 2026-10-24T23:00Z; New York 2026-03-08 and 2026-11-01) were derived by hand in UTC and are asserted in `calendar.test.ts`.
- `split.test.ts` compares the splitter with a minute-by-minute scan of `resolveTariffRate` over spring-forward, fall-back, week and season changes.
- Every money expectation in `price.test.ts`, `charges.test.ts` and `no-float-money.test.ts` was calculated by hand before running (for example 25% inclusive on 0.50: VAT 0.10, ex-VAT 0.40; the ENERGY_ACCOUNTING section 8 illustration: net 1.426 unrounded, 1.43 as rounded lines).

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| All named boundary, overnight and DST tests pass | VERIFIED | midnight crossing: `resolve.test.ts` "night crosses midnight without a break", `split.test.ts` "joins a night that crosses midnight into one segment". Spring forward and fall back: `resolve.test.ts` (both DST describes), `split.test.ts` "spring forward 2026-03-29 (23 hours)" and "fall back 2026-10-25 (25 hours)", `price.test.ts` "prices across the fall-back day in the right proportions: 9 hours of night, not 8". Boundary instants (start inclusive, end exclusive): `resolve.test.ts` "boundaries are start-inclusive and end-exclusive", `split.test.ts` "start is inclusive and end is exclusive". Overlap rejection: `validate.test.ts` `SLOT_OVERLAP`, `SEASON_OVERLAP`, `OVERRIDE_PRIORITY_TIE`, `EFFECTIVE_DATE_OVERLAP`, `PRICE_POINT_OVERLAP`. Coverage gaps: `validate.test.ts` `COVERAGE_GAP`, `split.test.ts` `findCoverageGaps`. Missing rate error: `resolve.test.ts` (`TARIFF_GAP`, `NO_PRICE_POINT`, `NO_TARIFF_FOR_DATE`), `price.test.ts` "problems are never priced". Effective-date change mid-range: `resolve.test.ts` "effective-dated versions", `split.test.ts` "splits where an effective-dated version takes over", `charges.test.ts` "uses the version in force on each date". Import/export asymmetry: `resolve.test.ts` "import and export are separate", `price.test.ts` "export". Negative price: `price.test.ts` "negative prices". Standing charge per day across DST: `charges.test.ts` "four days across the spring-forward day", "three days across the fall-back day". VAT inclusive vs exclusive: `price.test.ts` "VAT: inclusive and exclusive", `properties.test.ts` VAT property. Property-based: `properties.test.ts` (14 properties) |
| No floating-point money, proven by a lint rule or a test | VERIFIED | ESLint and `scripts/check-lint-rules.mjs` forbid `parseFloat` and `toFixed` in every package ("no parseFloat for money", "no toFixed for money" pass); `no-float-money.test.ts` scans the engine source and checks every output is a decimal string and that `0.1 + 0.2` kWh priced piecewise is exact; `money.test.ts` `decimalFrom` refuses numbers |
| Tariff-module coverage reported honestly | VERIFIED | numbers above, from the V8 report; uncovered lines named; no threshold was set to flatter them |
| Precedence not in the architecture is proposed, recorded and documented before proceeding (stop condition) | VERIFIED | D-069 and D-070 in `docs/DECISIONS.md`, `docs/TARIFF_ENGINE.md` section 3; proposed in the plan before any code |
| `docs/TARIFF_ENGINE.md`, schemas, fixtures, tests | done | files above. No new schema was needed; the engine uses the TASK-05 schemas |

## Verification status register
- Resolution, splitting, pricing, charges, validation, fixtures, DST days, no-float money: `VERIFIED` by tests.
- DST dates depend on the runtime's time zone data (Node's ICU), not on a tz library: `VERIFIED` for the two zones with hand-derived values and the property tests over four zones (Dublin, New York, Sydney, UTC); other zones and other ICU versions not tried (L-093).
- Negative prices: engine `VERIFIED`; storage `UNSUPPORTED` by the current schema and database (L-086).
- Real supplier tariffs and tax treatment of export credits: `UNVERIFIED`, no real data used (L-092, Q-09).
- Limits (400 days, 1100 days) and performance: `UNVERIFIED` (L-090).
- Q-08 default (`STRICT`): implemented as documented; the owner has not confirmed it.
- GitHub CI, PR: `NOT_EXECUTED`.

## Outstanding issues
- Questions for the owner: confirm the site-scope rule (D-069), the day-type replacement rule (D-070), the repeated-hour reading (D-072) and the Q-08 default (D-074); say whether negative prices should become storable (a schema and migration change, L-086); decide whether export credits are taxed (Q-09).
- Partial-day standing charges are TASK-11's to decide (L-088).
- The currency table is short (L-091).
- Branch name and missing PR (L-087); CI has not run.
- `docs/ENERGY_ACCOUNTING.md` section 4 says a slot in a repeated hour "occurs once, at its first occurrence". The engine prices both passes through the hour by the band they fall in (D-072). The wording of section 4 was not edited (the design documents are the owner's to change); D-072 records the interpretation.

## Environment variables
None added.

## Instructions for the next task
- TASK-11 uses the engine through `@autopw3/domain`: `priceInterval` for energy intervals, `chargesForLocalDates` for standing charges, `roundToMinorUnit` once per displayed line. It must treat `UNPRICEABLE_AT_RESOLUTION` and `UNPRICED` as unpriced and count them against completeness, never as zero, and must not add amounts of two currencies.
- Do not round inside the accounting engine before the final line; amounts from the tariff engine are exact.
- Use the tariff fixtures from `@autopw3/domain` (labelled examples) for accounting golden values, and calculate the expected numbers independently by hand as these tests do.
- Do not change precedence or DST semantics without a new decision. The tests in `resolve.test.ts`, `split.test.ts` and `properties.test.ts` will fail if the resolver and splitter drift apart.
- Check commands: `npm run check`; domain only `npm test -w @autopw3/domain`; coverage `npm run test:coverage -w @autopw3/domain`.

## Next task
TASK-11 Accounting engine (`docs/ai-build-kit/tasks/TASK-11-accounting-engine.md`). Prerequisite: the owner's say-so and, as before, the local-branch and no-PR handling.
