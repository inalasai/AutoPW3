import { useId } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cx } from '../../lib/cx';

const FIELD_CONTROL =
  'block w-full min-w-0 rounded-control border border-field-border bg-space-900 px-3 py-2 text-sm text-ink placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger';

interface FieldFrameProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  hideLabel?: boolean | undefined;
  children: ReactNode;
}

function FieldFrame({ id, label, hint, error, hideLabel, children }: FieldFrameProps) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={cx('mb-1 block text-sm font-medium', hideLabel && 'sr-only')}>
        {label}
      </label>
      {children}
      {hint !== undefined && error === undefined ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint: string | undefined, error: string | undefined) {
  if (error !== undefined) return `${id}-error`;
  if (hint !== undefined) return `${id}-hint`;
  return undefined;
}

export interface TextFieldProps extends Omit<ComponentPropsWithoutRef<'input'>, 'id'> {
  label: string;
  hint?: string;
  /** When set the field is marked invalid and the message is announced with the label. */
  error?: string;
  hideLabel?: boolean;
  id?: string;
}

/** Labelled text input. Label, hint and error are wired with `for`, `aria-describedby` and `aria-invalid`. */
export function TextField({
  label,
  hint,
  error,
  hideLabel,
  id,
  className,
  ...rest
}: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <input
        id={fieldId}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cx(FIELD_CONTROL, 'h-10', className)}
        {...rest}
      />
    </FieldFrame>
  );
}

export interface SelectFieldProps extends Omit<ComponentPropsWithoutRef<'select'>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  id?: string;
  /** `<option>` elements. A native select keeps keyboard and screen reader behaviour for free. */
  children: ReactNode;
}

/** Labelled native select. */
export function SelectField({
  label,
  hint,
  error,
  hideLabel,
  id,
  className,
  children,
  ...rest
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <select
        id={fieldId}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cx(FIELD_CONTROL, 'h-10', className)}
        {...rest}
      >
        {children}
      </select>
    </FieldFrame>
  );
}

export interface SwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Extra help text, linked with `aria-describedby`. */
  description?: string;
  disabled?: boolean;
  /** Hide the visible label below the sm breakpoint (it stays the accessible name). For tight toolbars. */
  compactLabel?: boolean;
}

/** On/off switch (`role="switch"`). Space and Enter toggle it because it is a real button. */
export function Switch({
  label,
  checked,
  onCheckedChange,
  description,
  disabled,
  compactLabel,
}: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-describedby={description !== undefined ? `${id}-desc` : undefined}
        disabled={disabled === true}
        onClick={() => {
          onCheckedChange(!checked);
        }}
        className={cx(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          checked ? 'border-select bg-select' : 'border-field-border bg-space-900',
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'block size-4 rounded-pill transition-transform',
            checked ? 'translate-x-6 bg-space-950' : 'translate-x-1 bg-ink',
          )}
        />
      </button>
      <label
        htmlFor={id}
        className={cx('text-sm font-medium', compactLabel === true && 'sr-only sm:not-sr-only')}
      >
        {label}
      </label>
      {description !== undefined ? (
        <span id={`${id}-desc`} className="sr-only">
          {description}
        </span>
      ) : null}
    </div>
  );
}
