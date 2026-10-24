import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { DemoBanner, EmptyState, ErrorBanner, LoadingRegion, Skeleton } from './feedback';
import { SunIcon } from './icons';

describe('ErrorBanner', () => {
  it('announces errors with role="alert" and shows a reference, never internals', () => {
    render(
      <ErrorBanner
        title="Could not load data"
        message="The server returned an error."
        requestId="req-123"
      />,
    );
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Could not load data');
    expect(banner).toHaveTextContent('Reference: req-123');
  });

  it('uses role="status" for warnings and info so they do not interrupt', () => {
    render(
      <>
        <ErrorBanner tone="warning" title="Stale" />
        <ErrorBanner tone="info" title="Note" />
      </>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('offers retry and dismiss only when handlers are given', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(<ErrorBanner title="Failed" />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<ErrorBanner title="Failed" onRetry={onRetry} onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <div>
        <ErrorBanner
          title="Failed"
          message="Details"
          onRetry={() => undefined}
          onDismiss={() => undefined}
        />
        <ErrorBanner tone="warning" title="Stale" />
        <ErrorBanner tone="info" title="Note" />
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('DemoBanner', () => {
  it('says plainly that the data is synthetic, in text', () => {
    render(<DemoBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'DEMO MODE: synthetic data only. Nothing here comes from a real site.',
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<DemoBanner />);
    await expectNoAxeViolations(container);
  });
});

describe('Skeleton and LoadingRegion', () => {
  it('announces one loading message and hides the decorative blocks', () => {
    const { container } = render(
      <LoadingRegion label="Loading readings">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-40" />
      </LoadingRegion>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading readings');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    for (const block of container.querySelectorAll('[aria-hidden="true"]')) {
      expect(block).toHaveClass('animate-pulse');
    }
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <LoadingRegion>
        <Skeleton className="h-4 w-20" />
      </LoadingRegion>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('EmptyState', () => {
  it('shows a title, an explanation and an action', () => {
    render(
      <EmptyState
        icon={SunIcon}
        title="No sites yet"
        description="Connect a Tesla account to add a site."
        action={<button type="button">Connect</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No sites yet' })).toBeInTheDocument();
    expect(screen.getByText('Connect a Tesla account to add a site.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <EmptyState icon={SunIcon} title="Nothing yet" description="Text" />,
    );
    await expectNoAxeViolations(container);
  });
});
