import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FixedClock } from '@autopw3/domain';
import type { DemoScenarioId } from '@autopw3/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import type { TelemetryConfig } from '../../lib/config';
import { createFakeContext } from './fake-canvas';
import { LiveView } from './LiveView';

const CLOCK = new FixedClock(new Date('2026-06-21T12:00:00Z'));

interface Options {
  telemetry?: TelemetryConfig;
  effectsOn?: boolean;
  announceIntervalMs?: number;
}

function renderLive({
  telemetry = { kind: 'demo' },
  effectsOn = false,
  announceIntervalMs = 0,
}: Options = {}) {
  return render(
    <LiveView
      telemetry={telemetry}
      clock={CLOCK}
      effectsOn={effectsOn}
      announceIntervalMs={announceIntervalMs}
      pollIntervalMs={60_000}
      timeZone="Europe/Dublin"
    />,
  );
}

/** Pick a demo scenario and wait for its reading to be on the page. */
async function chooseScenario(id: DemoScenarioId, title: string) {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Scenario'), id);
  await screen.findByText(/^Updated /);
  expect(screen.getByLabelText('Scenario')).toHaveValue(id);
  return title;
}

function card(name: string): HTMLElement {
  const items = within(screen.getByRole('list', { name: 'Power now' })).getAllByRole('listitem');
  const found = items.find((item) => item.textContent.startsWith(name));
  if (found === undefined) throw new Error(`no card for ${name}`);
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LiveView: following the data', () => {
  it('reverses the battery flow, its words and its level when the reading changes', async () => {
    renderLive();
    await chooseScenario('BATTERY_CHARGING', 'Battery charging');
    expect(screen.getByText(/Battery charging 2\.00 kilowatts/)).toBeInTheDocument();
    expect(card('Battery').textContent).toMatch(/Charging\s*Core Hub\s*→\s*to\s*Battery/);
    expect(screen.getByRole('meter', { name: 'Battery level' })).toHaveAttribute(
      'aria-valuenow',
      '48',
    );

    await chooseScenario('BATTERY_DISCHARGING', 'Battery discharging');
    await waitFor(() => {
      expect(screen.getByText(/Battery discharging 1\.90 kilowatts/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Battery charging \d/)).not.toBeInTheDocument();
    expect(card('Battery').textContent).toMatch(/Discharging\s*Battery\s*→\s*to\s*Core Hub/);
    expect(screen.getByRole('meter', { name: 'Battery level' })).toHaveAttribute(
      'aria-valuenow',
      '71',
    );
  });

  it('reverses the grid flow between import and export', async () => {
    renderLive();
    await chooseScenario('GRID_IMPORT', 'Grid import');
    expect(card('Grid').textContent).toMatch(/Importing\s*Grid\s*→\s*to\s*Core Hub/);
    expect(screen.getByText(/Grid importing 0\.30 kilowatts/)).toBeInTheDocument();

    await chooseScenario('GRID_EXPORT', 'Grid export');
    await waitFor(() => {
      expect(card('Grid').textContent).toMatch(/Exporting\s*Core Hub\s*→\s*to\s*Grid/);
    });
    expect(screen.getByText(/Grid exporting 4\.20 kilowatts/)).toBeInTheDocument();
  });

  it('states a low battery in words', async () => {
    renderLive();
    await chooseScenario('LOW_BATTERY', 'Low battery');
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '7 percent, low');
    expect(screen.getByText(/Battery level 7 percent, low/)).toBeInTheDocument();
  });

  it('shows stale data as stale: numbers kept, a warning, and the old age', async () => {
    renderLive();
    await chooseScenario('STALE_DATA', 'Stale data');
    expect(screen.getByText('This data is out of date')).toBeInTheDocument();
    expect(screen.getByText('Updated 3 h ago')).toBeInTheDocument();
    expect(card('Solar').textContent).toContain('1.20');
    expect(screen.getByText(/Data is stale, showing the last reading/)).toBeInTheDocument();
    expect(screen.getByText('Stale reading')).toBeInTheDocument();
  });

  it('shows missing values as dashes and never as zero', async () => {
    renderLive();
    await chooseScenario('MISSING_DATA', 'Missing data');
    expect(screen.getByText('Part of this reading is missing')).toBeInTheDocument();
    expect(card('Battery').textContent).toContain('No data');
    expect(card('Home').textContent).toContain('No data');
    expect(card('Solar').textContent).toContain('2.40');
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.getByText(/Battery no data/)).toBeInTheDocument();
  });

  it('flags invalid readings and does not draw their values as live', async () => {
    renderLive();
    await chooseScenario('INVALID_READINGS', 'Invalid');
    expect(screen.getByText('This reading may be unreliable')).toBeInTheDocument();
    expect(screen.getByText('The battery level is missing from this reading.')).toBeInTheDocument();
    expect(screen.getByText(/This reading was flagged as unreliable/)).toBeInTheDocument();
  });

  it('labels demo data as DEMO', async () => {
    renderLive();
    await screen.findByText(/^Updated /);
    expect(screen.getByTestId('live-demo-badge')).toHaveTextContent('DEMO');
    expect(screen.getByText('Simulated data')).toBeInTheDocument();
  });

  it('shows the reading time in the site zone', async () => {
    renderLive();
    await chooseScenario('SOLAR_SURPLUS', 'Solar surplus');
    // The reading is a few seconds before 12:00 UTC, which is 13:00 in Dublin in June (daylight saving).
    const time = screen.getByText(/^(12:59|13:00):\d\d$/);
    expect(time.tagName).toBe('TIME');
  });
});

describe('LiveView: configuration', () => {
  it('says no live source exists yet, shows no numbers and does not use demo data', async () => {
    renderLive({ telemetry: { kind: 'live' } });
    expect(
      screen.getByRole('heading', { name: 'No live data source is connected yet' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Power now' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Scenario')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-demo-badge')).not.toBeInTheDocument();
    expect(screen.queryByText(/kW/)).not.toBeInTheDocument();
    await expectNoAxeViolations(document.body);
  });

  it('shows the reason for an unusable setting', () => {
    renderLive({
      telemetry: { kind: 'invalid', reason: 'VITE_TELEMETRY_PROVIDER must be demo or live.' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('The data source setting is not valid');
    expect(screen.getByText('VITE_TELEMETRY_PROVIDER must be demo or live.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Power now' })).not.toBeInTheDocument();
  });
});

describe('LiveView: screen reader summary', () => {
  it('announces the summary politely and not on every change', async () => {
    renderLive({ announceIntervalMs: 15_000 });
    await chooseScenario('SOLAR_SURPLUS', 'Solar surplus');
    const summary = await screen.findByText(/Solar generating 3\.80 kilowatts/);
    expect(summary).toHaveAttribute('aria-live', 'polite');
    expect(summary).toHaveAttribute('role', 'status');
    // A new reading within the interval changes the page at once, but not the announcement.
    await chooseScenario('GRID_EXPORT', 'Grid export');
    expect(card('Grid').textContent).toMatch(/Exporting/);
    expect(screen.queryByText(/Grid exporting 4\.20 kilowatts/)).not.toBeInTheDocument();
    expect(screen.getByText(/Solar generating 3\.80 kilowatts/)).toBeInTheDocument();
  });
});

describe('LiveView: motion', () => {
  let requestFrame: ReturnType<typeof vi.fn>;
  let cancelFrame: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    cancelFrame = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      createFakeContext().ctx as unknown as RenderingContext,
    );
  });

  it('animates when effects are on and motion is allowed', async () => {
    renderLive({ effectsOn: true });
    await chooseScenario('SOLAR_SURPLUS', 'Solar surplus');
    await waitFor(() => {
      expect(requestFrame).toHaveBeenCalled();
    });
  });

  it('never animates with effects off, and the numbers and arrows are all still there', async () => {
    renderLive({ effectsOn: false });
    await chooseScenario('SOLAR_SURPLUS', 'Solar surplus');
    expect(requestFrame).not.toHaveBeenCalled();
    expect(card('Solar').textContent).toContain('3.80');
  });

  it('never animates when the system asks for reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    renderLive({ effectsOn: true });
    await chooseScenario('SOLAR_SURPLUS', 'Solar surplus');
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('never animates stale data', async () => {
    renderLive({ effectsOn: true });
    await chooseScenario('SOLAR_SURPLUS', 'Solar surplus');
    await waitFor(() => {
      expect(requestFrame).toHaveBeenCalled();
    });
    const cancelled = vi.mocked(cancelFrame).mock.calls.length;
    requestFrame.mockClear();
    await chooseScenario('STALE_DATA', 'Stale data');
    // The running loop was cancelled and no new one started.
    expect(vi.mocked(cancelFrame).mock.calls.length).toBeGreaterThan(cancelled);
    expect(requestFrame).not.toHaveBeenCalled();
  });
});

describe('LiveView: accessibility', () => {
  it('has no violations while loading and in each state', async () => {
    const { container } = renderLive();
    await expectNoAxeViolations(container);
    const states: Array<[DemoScenarioId, string]> = [
      ['SOLAR_SURPLUS', 'Solar surplus'],
      ['LOW_BATTERY', 'Low battery'],
      ['STALE_DATA', 'Stale data'],
      ['MISSING_DATA', 'Missing data'],
      ['INVALID_READINGS', 'Invalid'],
    ];
    for (const [id, title] of states) {
      await chooseScenario(id, title);
      await expectNoAxeViolations(container);
    }
  });

  it('keeps the canvas out of the accessibility tree', async () => {
    const { container } = renderLive();
    await screen.findByText(/^Updated /);
    const canvas = container.querySelector('canvas');
    expect(canvas?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
