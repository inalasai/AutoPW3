import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cx } from '../../lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-select text-space-950 hover:brightness-110',
  secondary: 'border border-field-border bg-transparent text-ink hover:bg-line',
  ghost: 'bg-transparent text-ink hover:bg-line',
  danger: 'bg-danger-solid text-ink hover:brightness-110',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
};

export const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';

export function buttonClasses(variant: ButtonVariant, size: ButtonSize, extra?: string): string {
  return cx(BUTTON_BASE, VARIANTS[variant], SIZES[size], extra);
}

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets `aria-busy` and ignores clicks. The label stays so screen readers keep the context. */
  loading?: boolean;
  children: ReactNode;
}

/** Text button. `type` defaults to "button" so a button inside a form never submits by accident. */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading ? true : undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
          className="animate-spin"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray="42 100"
            strokeLinecap="round"
          />
        </svg>
      ) : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  /** Required accessible name: an icon-only control has no visible text. */
  label: string;
  variant?: ButtonVariant;
  children: ReactNode;
}

/** Square icon-only button. The icon child must be decorative (our icons are `aria-hidden`). */
export function IconButton({
  label,
  variant = 'ghost',
  className,
  type = 'button',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(BUTTON_BASE, VARIANTS[variant], 'size-10', className)}
      {...rest}
    >
      {children}
    </button>
  );
}
