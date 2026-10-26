# Tariff Manager

Status: **implemented in TASK-12, awaiting owner review.** Code: `apps/web/src/features/tariffs/`.

## 1. Overview
The Tariff Manager lets users create, inspect, edit, clone, and archive electricity tariff profiles. It supports both import and export directions across all pricing structures:
- `TIME_OF_USE`: multi-window schedules, day-type subsets (`ALL`, `WEEKDAY`, `WEEKEND`), seasons, and date overrides.
- `FLAT`: single flat rate per kWh with daily standing charge and VAT.
- `DYNAMIC`: half-hourly / wholesale dynamic price observations.

All monetary rates, standing charges, VAT percentages, and amounts travel as decimal-safe strings (never floating-point numbers).

---

## 2. Windows and Midnight Crossing Decomposition
In real-world tariffs (e.g. night rates), off-peak windows frequently span midnight (e.g. 23:00 to 08:00).
- The underlying database schema and domain tariff engine enforce `0 <= startMinute < endMinute <= 1440` on each `TariffSlot`. A slot itself cannot wrap around midnight.
- In `windows.ts`:
  - **`windowToSlots`**: If a window crosses midnight (`startMinute >= endMinute`), it is automatically decomposed into two distinct canonical slots:
    1. `[startMinute, 1440)` covering the end of the day.
    2. `[0, endMinute)` covering the start of the day.
  - **`slotsToWindows`**: When loading a tariff into the editor, matching slots ending at 1440 and starting at 0 with identical labels, day types, and rates are rejoined into a single user-friendly window.

---

## 3. Effective-Dated Versioning
Electricity tariffs evolve over time as suppliers adjust prices.
- **No In-Place Overwrites**: Editing an existing tariff generates a **new version** (`version: n + 1`) under the same `tariffKey`.
- **Historical Continuity**: The previous version's `effectiveTo` is updated to the new version's `effectiveFrom`, ensuring zero overlap and preserving historical energy accounting calculations.
- **Archive / End**: Setting an `effectiveTo` date archives a tariff without deleting historical audit records.

---

## 4. Live Domain Engine Validation
The UI executes real-time validation on every change via `validateTariffForm`:
1. **Zod Structural Schema**: Field lengths, numeric boundaries, decimal string patterns, tax mode rules, and required fields.
2. **Domain Tariff Engine (`validateTariff`)**:
   - `SLOT_OVERLAP`: Overlapping time slots within the same schedule.
   - `COVERAGE_GAP`: Uncovered hours in daily schedules.
   - `SEASON_OVERLAP` / `SEASON_GAP`: Ambiguous season dates or missing fallback base slots.
   - `OVERRIDE_PRIORITY_TIE`: Conflicting overrides with identical priority.
   - `TIMEZONE_UNKNOWN`: Invalid IANA timezone identifiers.
   - `LEVY_ON_EXPORT`: Levies incorrectly configured on export tariffs.

Save actions are disabled and rejected if any validation problems exist.

---

## 5. Visual Schedule Preview & DST Adaptation
Driven directly by the domain functions `splitIntervalAtBoundaries`, `resolveTariffRate`, and `localDay`:
- **Interactive 24-Hour Bar**: Visualizes rate bands and labels across the day with color-coded intensity.
- **DST Clock Changes**:
  - Spring-forward days (e.g. `2026-03-29` in `Europe/Dublin`) are correctly rendered as **23 hours** (1,380 minutes).
  - Fall-back days (e.g. `2026-10-25` in `Europe/Dublin`) are correctly rendered as **25 hours** (1,500 minutes).
- **Accessible Data Table**: Companion segment table listing wall-clock window, duration, label, source, and exact rate.

---

## 6. Repository Architecture
The UI interacts with an explicit `TariffRepository` interface:
```ts
export interface TariffRepository {
  listTariffs(siteId?: string | null): Promise<Tariff[]>;
  getTariff(id: string): Promise<Tariff | null>;
  saveTariff(request: CreateTariffRequest, currentRole: Role | null): Promise<Tariff>;
  endTariff(id: string, effectiveTo: string, currentRole: Role | null): Promise<Tariff>;
}
```
- **`InMemoryTariffRepository`**: Used in demo mode and tests, seeded with `TARIFF_EXAMPLES`.
- **Role Enforcement**: The data layer strictly checks `currentRole`. If `currentRole === 'READ_ONLY'`, `saveTariff` and `endTariff` throw `Error('READ_ONLY role cannot persist tariffs')`.

---

## 7. Role-Based Access Control
- `READ_ONLY` users:
  - Can view all tariffs, review settings, and interact with the schedule preview.
  - See `ReadOnlyNotice`: *"You have read-only access. You can view this page, but you cannot change tariffs."*
  - Action buttons (`New tariff`, `Save New Version`, `Clone`, `End / Archive`) are disabled.
  - Form fields are disabled.
- `READ_WRITE` / `ADMIN` users:
  - Full creation, editing, cloning, and versioning capabilities.

---

## 8. Illustrative Irish Templates
Pre-configured templates are available in `TemplateModal.tsx` for quick setup:
- Flat Import (0.30/kWh + 23% VAT)
- Day & Night Import (TOU 0.18 / 0.35 + 13.5% VAT)
- Day, Night & Peak Import (with levies)
- Seasonal & Date Overrides
- Feed-in Export (0.10/kWh credit)
- Export Unpaid

All templates display the mandatory disclaimer:
> **⚠️ ILLUSTRATIVE EXAMPLE values only: not a real supplier tariff and not current.**
