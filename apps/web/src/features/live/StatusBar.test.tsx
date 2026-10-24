import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { StatusBar } from './StatusBar';
import type { StatusBarProps } from './StatusBar';

const BASE: StatusBarProps = {
  data: 'LIVE',
  loading: false,
  source: 'DEMO',
  sampledAt: '2026-06-21T12:00:00.000Z',
  freshness: 'FRESH',
  ageSeconds: 12,
  quality: 'OK',
  timeZone: 'Europe/Dublin',
  refreshError: null,
};

describe('StatusBar', () => {
  it('labels demo data clearly, with the age and the time of the reading', () => {
    render(<StatusBar {...BASE} />);
    expect(screen.getByTestId('live-demo-badge')).toHaveTextContent('DEMO');
    expect(screen.getByText('Simulated data')).toBeInTheDocument();
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('Updated 12 s ago')).toBeInTheDocument();
    const time = screen.getByText('13:00:00');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-06-21T12:00:00.000Z');
    expect(screen.getByText(/Europe\/Dublin/)).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows no demo label for a live source', () => {
    render(<StatusBar {...BASE} source="TESLA" />);
    expect(screen.queryByTestId('live-demo-badge')).not.toBeInTheDocument();
  });

  it('warns that stale data is out of date and marks the connection stale', () => {
    render(<StatusBar {...BASE} data="STALE" freshness="STALE" ageSeconds={1200} />);
    expect(screen.getByText('This data is out of date')).toBeInTheDocument();
    // The freshness badge and the connection indicator both say it in words.
    expect(screen.getAllByText('Stale')).toHaveLength(2);
    expect(screen.getByText('Updated 20 min ago')).toBeInTheDocument();
  });

  it('warns about a suspect reading and about a partial one', () => {
    const { rerender } = render(<StatusBar {...BASE} data="SUSPECT" quality="SUSPECT" />);
    expect(screen.getByText('This reading may be unreliable')).toBeInTheDocument();
    rerender(<StatusBar {...BASE} quality="PARTIAL" />);
    expect(screen.getByText('Part of this reading is missing')).toBeInTheDocument();
    expect(screen.queryByText('This reading may be unreliable')).not.toBeInTheDocument();
  });

  it('shows connecting while loading, and disconnected or error with no reading', () => {
    const none: StatusBarProps = {
      ...BASE,
      data: 'NONE',
      source: null,
      sampledAt: null,
      freshness: 'UNAVAILABLE',
      ageSeconds: null,
      quality: null,
    };
    const { rerender } = render(<StatusBar {...none} loading />);
    expect(screen.getByText('Connecting')).toBeInTheDocument();
    rerender(<StatusBar {...none} />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.queryByText(/^Updated/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-demo-badge')).not.toBeInTheDocument();
    rerender(<StatusBar {...none} refreshError="The data source did not answer." />);
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('says a refresh failed without hiding the last reading', () => {
    render(<StatusBar {...BASE} refreshError="The data source did not answer. Trying again." />);
    expect(screen.getByText('Could not refresh')).toBeInTheDocument();
    expect(screen.getByText('The data source did not answer. Trying again.')).toBeInTheDocument();
    expect(screen.getByText('Updated 12 s ago')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <StatusBar {...BASE} data="STALE" freshness="STALE" quality="PARTIAL" refreshError="Oops." />,
    );
    await expectNoAxeViolations(container);
  });
});
