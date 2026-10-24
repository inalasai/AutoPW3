import { render, screen, within } from '@testing-library/react';
import { SITE_CONNECTION_STATES, FRESHNESS_STATES } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import {
  ConnectionIndicator,
  DataTable,
  FreshnessBadge,
  GlassCard,
  PageHeader,
  TelemetryValue,
} from './display';

describe('GlassCard', () => {
  it('is a region named by its heading', () => {
    render(<GlassCard title="Now">content</GlassCard>);
    expect(screen.getByRole('region', { name: 'Now' })).toHaveTextContent('content');
    expect(screen.getByRole('heading', { level: 2, name: 'Now' })).toBeInTheDocument();
  });

  it('lets the page choose the heading level', () => {
    render(
      <GlassCard title="Inner" headingLevel={3}>
        x
      </GlassCard>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Inner' })).toBeInTheDocument();
  });

  it('adds a glow class only when asked; the class is a no-op with effects off (tokens.css)', () => {
    const { container } = render(
      <GlassCard title="A" glow="solar">
        x
      </GlassCard>,
    );
    expect(container.firstElementChild).toHaveClass('glass', 'glow-solar');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <GlassCard title="Now" actions={<button type="button">Refresh</button>}>
        content
      </GlassCard>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('PageHeader', () => {
  it('renders the page h1, which can be focused by script', () => {
    render(<PageHeader title="Live" description="Real-time flow" status={<span>Status</span>} />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Live' });
    expect(h1).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Real-time flow')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });
});

describe('TelemetryValue', () => {
  it('shows a monospace, tabular value with its unit', () => {
    render(<TelemetryValue label="Solar" value="3.42" unit="kW" tone="solar" />);
    const value = screen.getByText('3.42');
    expect(value.parentElement).toHaveClass('font-mono', 'tabular-nums', 'text-solar');
    expect(screen.getByText('kW')).toBeInTheDocument();
    expect(screen.getByText('Solar')).toBeInTheDocument();
  });

  it('shows a dash for missing data, never zero, and says "No data" to screen readers', () => {
    render(<TelemetryValue label="Grid" value={null} unit="kW" />);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText('No data')).toHaveClass('sr-only');
    expect(screen.getByText('\u2014')).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not reformat what it is given', () => {
    render(<TelemetryValue label="Battery" value="-1.200" unit="kW" />);
    expect(screen.getByText('-1.200')).toBeInTheDocument();
  });
});

describe('ConnectionIndicator', () => {
  it('has a word for every connection state in the shared enum', () => {
    for (const state of SITE_CONNECTION_STATES) {
      const { unmount } = render(<ConnectionIndicator state={state} />);
      expect(screen.getByRole('status').textContent?.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('shows the state as text, with optional detail', () => {
    render(<ConnectionIndicator state="ERROR" detail="Provider unavailable" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Error');
    expect(status).toHaveTextContent('Provider unavailable');
  });
});

describe('FreshnessBadge', () => {
  it('has a word for every freshness state and shows the age label as given', () => {
    for (const state of FRESHNESS_STATES) {
      const { unmount } = render(<FreshnessBadge state={state} ageLabel="updated 3 min ago" />);
      expect(screen.getByText('updated 3 min ago')).toBeInTheDocument();
      unmount();
    }
    render(<FreshnessBadge state="STALE" />);
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <div>
        <ConnectionIndicator state="LIVE" />
        <FreshnessBadge state="FRESH" ageLabel="updated now" />
        <TelemetryValue label="Solar" value="1.0" unit="kW" />
        <TelemetryValue label="Grid" value={null} unit="kW" />
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('DataTable', () => {
  interface Row {
    id: string;
    name: string;
    kw: string;
  }
  const rows: Row[] = [
    { id: 'a', name: 'Alpha', kw: '1.250' },
    { id: 'b', name: 'Beta', kw: '12.500' },
  ];
  const columns = [
    { key: 'name', header: 'Name', render: (r: Row) => r.name },
    { key: 'kw', header: 'Power (kW)', numeric: true, render: (r: Row) => r.kw },
  ];

  it('is a real table with a caption, column headers and rows', () => {
    render(<DataTable caption="Readings" rows={rows} columns={columns} getRowKey={(r) => r.id} />);
    const table = screen.getByRole('table', { name: 'Readings' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Name', 'Power (kW)']);
    for (const header of within(table).getAllByRole('columnheader')) {
      expect(header).toHaveAttribute('scope', 'col');
    }
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('right-aligns numeric columns in monospace tabular digits', () => {
    render(<DataTable caption="Readings" rows={rows} columns={columns} getRowKey={(r) => r.id} />);
    expect(screen.getByRole('cell', { name: '12.500' })).toHaveClass(
      'font-mono',
      'tabular-nums',
      'text-right',
    );
    expect(screen.getByRole('cell', { name: 'Alpha' })).not.toHaveClass('font-mono');
  });

  it('keeps wide tables inside a keyboard-focusable scroll region', () => {
    render(<DataTable caption="Readings" rows={rows} columns={columns} getRowKey={(r) => r.id} />);
    const region = screen.getByRole('region', { name: 'Readings (scrollable)' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveClass('overflow-x-auto');
  });

  it('shows an empty message spanning the table', () => {
    render(
      <DataTable
        caption="Readings"
        rows={[]}
        columns={columns}
        getRowKey={(r: Row) => r.id}
        emptyMessage="Nothing yet"
      />,
    );
    expect(screen.getByRole('cell', { name: 'Nothing yet' })).toHaveAttribute('colspan', '2');
  });

  it('can hide the caption visually but keep it as the name', () => {
    render(
      <DataTable
        caption="Readings"
        captionHidden
        rows={rows}
        columns={columns}
        getRowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText('Readings', { selector: 'caption' })).toHaveClass('sr-only');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <DataTable caption="Readings" rows={rows} columns={columns} getRowKey={(r) => r.id} />,
    );
    await expectNoAxeViolations(container);
  });
});
