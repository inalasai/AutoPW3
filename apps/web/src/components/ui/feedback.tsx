import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { Button } from './Button';
import { AlertIcon, CloseIcon, InfoIcon } from './icons';
import type { IconProps } from './icons';

/** Loading placeholder block. Decorative: pair with `LoadingRegion` so assistive technology hears one message. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx('animate-pulse rounded-control bg-line', className)} />
  );
}

/** Groups skeletons and announces a single "Loading" status. Replace it with content when the data arrives. */
export function LoadingRegion({
  label = 'Loading',
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: (props: IconProps) => ReactNode;
  action?: ReactNode;
  /** Level of the title. Default 3 (inside a card with an h2); use 2 when the empty state follows the page h1. */
  headingLevel?: 2 | 3;
}

/** "Nothing here yet" panel. Say what is missing and what the user can do about it. */
export function EmptyState({
  title,
  description,
  icon: IconComponent,
  action,
  headingLevel = 3,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      {IconComponent !== undefined ? (
        <span className="flex size-12 items-center justify-center rounded-pill border border-line bg-space-900 text-ink-muted">
          <IconComponent width={24} height={24} />
        </span>
      ) : null}
      <Heading className="text-base font-semibold">{title}</Heading>
      {description !== undefined ? (
        <p className="max-w-prose text-sm text-ink-muted">{description}</p>
      ) : null}
      {action !== undefined ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export type BannerTone = 'error' | 'warning' | 'info';

const BANNER_TONE: Record<BannerTone, { box: string; icon: string }> = {
  error: { box: 'border-danger', icon: 'text-danger' },
  warning: { box: 'border-warning', icon: 'text-warning' },
  info: { box: 'border-info', icon: 'text-info' },
};

export interface ErrorBannerProps {
  tone?: BannerTone;
  title: string;
  message?: string;
  /** Request id from the API error envelope. Shown so a user can quote it; never a stack trace or internals. */
  requestId?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

/**
 * Inline message for errors, warnings and notices. Errors use `role="alert"` (announced at once);
 * warnings and info use `role="status"`. Text and icon carry the meaning, the border colour only reinforces it.
 */
export function ErrorBanner({
  tone = 'error',
  title,
  message,
  requestId,
  onRetry,
  onDismiss,
}: ErrorBannerProps) {
  const styles = BANNER_TONE[tone];
  const BannerIcon = tone === 'info' ? InfoIcon : AlertIcon;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex items-start gap-3 rounded-control border bg-space-900 p-3', styles.box)}
    >
      <BannerIcon className={cx('mt-0.5 shrink-0', styles.icon)} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{title}</p>
        {message !== undefined ? <p className="mt-0.5 text-ink-muted">{message}</p> : null}
        {requestId !== undefined ? (
          <p className="mt-1 text-ink-muted">
            Reference: <span className="break-all font-mono">{requestId}</span>
          </p>
        ) : null}
        {onRetry !== undefined ? (
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : null}
      </div>
      {onDismiss !== undefined ? (
        <button
          type="button"
          aria-label="Dismiss message"
          onClick={onDismiss}
          className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-line hover:text-ink"
        >
          <CloseIcon width={18} height={18} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Persistent demo indicator. Visible whenever demo mode is on (docs/ai-build-kit/02-PROJECT-CONTEXT.md:
 * demo data is labelled and never mixed with live data). Not dismissible, and not colour-only.
 */
export function DemoBanner() {
  return (
    <div
      role="status"
      data-testid="demo-banner"
      className="flex items-center justify-center gap-2 border-b border-warning bg-space-900 px-4 py-1.5 text-center text-xs font-medium text-warning sm:py-2 sm:text-sm"
    >
      <span className="rounded-pill border border-warning px-2 font-mono text-xs tracking-wider">
        DEMO
      </span>
      <span>DEMO MODE: synthetic data only. Nothing here comes from a real site.</span>
    </div>
  );
}
