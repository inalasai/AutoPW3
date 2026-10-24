import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface TabItem {
  id: string;
  label: string;
  panel: ReactNode;
}

export interface TabsProps {
  /** Accessible name of the tab list. */
  label: string;
  tabs: ReadonlyArray<TabItem>;
  defaultTabId?: string;
}

/**
 * Tabs with the WAI-ARIA tabs pattern: one tab stop (the selected tab), Left/Right/Home/End move and select,
 * the panel is labelled by its tab. Panels that are not selected are not rendered.
 */
export function Tabs({ label, tabs, defaultTabId }: TabsProps) {
  const base = useId();
  const first = tabs[0];
  const [selected, setSelected] = useState(defaultTabId ?? first?.id ?? '');
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function move(index: number) {
    const target = tabs[(index + tabs.length) % tabs.length];
    if (target === undefined) return;
    setSelected(target.id);
    refs.current.get(target.id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        move(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        move(0);
        break;
      case 'End':
        event.preventDefault();
        move(tabs.length - 1);
        break;
      default:
        break;
    }
  }

  const active = tabs.find((t) => t.id === selected) ?? first;

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-line"
      >
        {tabs.map((tab, index) => {
          const isSelected = tab.id === active?.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el === null) refs.current.delete(tab.id);
                else refs.current.set(tab.id, el);
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => {
                setSelected(tab.id);
              }}
              onKeyDown={(e) => {
                onKeyDown(e, index);
              }}
              className={cx(
                '-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                isSelected
                  ? 'border-select text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {active !== undefined ? (
        <div
          role="tabpanel"
          id={`${base}-panel-${active.id}`}
          aria-labelledby={`${base}-tab-${active.id}`}
          tabIndex={0}
          className="pt-4"
        >
          {active.panel}
        </div>
      ) : null}
    </div>
  );
}

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

export interface SegmentedControlProps<V extends string> {
  /** Accessible name of the group (rendered as a visually hidden legend). */
  label: string;
  options: ReadonlyArray<SegmentedOption<V>>;
  value: V;
  onValueChange: (value: V) => void;
}

/**
 * Segmented choice (for example a resolution switch). Built from native radio inputs, so arrow keys, a single tab
 * stop and screen-reader semantics come from the browser; the visual state is driven by `:checked`.
 */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onValueChange,
}: SegmentedControlProps<V>) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex max-w-full overflow-x-auto rounded-control border border-field-border bg-space-900 p-0.5">
        {options.map((option) => (
          <label key={option.value} className="relative">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => {
                onValueChange(option.value);
              }}
              className="peer sr-only"
            />
            <span className="block cursor-pointer whitespace-nowrap rounded-[0.375rem] px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors peer-checked:bg-select peer-checked:text-space-950 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-select">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
