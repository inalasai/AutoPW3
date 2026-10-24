import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { BatteryGauge } from './BatteryGauge';
import { buildFlowModel } from './flow-model';
import type { FlowSample } from './flow-model';

function batteryOf(
  soc: number | null,
  options: {
    batteryPowerW?: number | null;
    freshness?: 'FRESH' | 'STALE' | 'UNAVAILABLE';
    quality?: FlowSample['quality'];
    noSample?: boolean;
  } = {},
) {
  return buildFlowModel({
    sample: options.noSample
      ? null
      : {
          solarPowerW: 0,
          batteryPowerW: options.batteryPowerW === undefined ? 0 : options.batteryPowerW,
          gridPowerW: 0,
          loadPowerW: 0,
          batterySocPercent: soc,
          quality: options.quality ?? 'OK',
        },
    freshness: options.freshness ?? 'FRESH',
  }).battery;
}

describe('BatteryGauge', () => {
  it('shows a normal level as a meter with the number, the word and the direction', () => {
    render(<BatteryGauge battery={batteryOf(58, { batteryPowerW: -2400 })} />);
    const meter = screen.getByRole('meter', { name: 'Battery level' });
    expect(meter).toHaveAttribute('aria-valuenow', '58');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '58 percent, normal');
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
    expect(screen.getByText('charging')).toBeInTheDocument();
  });

  it('says low and critical in words, not only in colour, and they differ', () => {
    const { rerender } = render(<BatteryGauge battery={batteryOf(14.9)} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    rerender(<BatteryGauge battery={batteryOf(4.9)} />);
    expect(screen.getByText('Critically low')).toBeInTheDocument();
    expect(screen.queryByText('Low')).not.toBeInTheDocument();
    rerender(<BatteryGauge battery={batteryOf(15)} />);
    expect(screen.getByText('Normal')).toBeInTheDocument();
  });

  it('keeps the last level for stale data but labels it stale and hatches it', () => {
    const { container } = render(<BatteryGauge battery={batteryOf(58, { freshness: 'STALE' })} />);
    expect(screen.getByText('Stale reading')).toBeInTheDocument();
    expect(
      screen.getByText('This is the last known level. The data is stale.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute(
      'aria-valuetext',
      '58 percent, stale reading',
    );
    expect(container.querySelector('pattern')).not.toBeNull();
    expect(container.querySelector('rect[fill^="url(#"]')).not.toBeNull();
  });

  it('does not call a flagged reading normal', () => {
    render(<BatteryGauge battery={batteryOf(58, { quality: 'SUSPECT' })} />);
    expect(screen.getByText('No reliable level')).toBeInTheDocument();
    expect(screen.getByText('This level was flagged as unreliable.')).toBeInTheDocument();
    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
  });

  it('shows a dash and no meter when the level is missing, never 0', () => {
    const { container } = render(<BatteryGauge battery={batteryOf(null)} />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByText('The battery level is missing from this reading.')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says so when there is no reading at all', () => {
    render(<BatteryGauge battery={batteryOf(null, { noSample: true })} />);
    expect(screen.getByText('There is no battery reading.')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('fills in proportion to the level', () => {
    const { container, rerender } = render(<BatteryGauge battery={batteryOf(100)} />);
    const full = Number(container.querySelector('rect[rx="3"]')?.getAttribute('height'));
    rerender(<BatteryGauge battery={batteryOf(50)} />);
    const half = Number(container.querySelector('rect[rx="3"]')?.getAttribute('height'));
    expect(full).toBeGreaterThan(0);
    expect(half).toBeCloseTo(full / 2, 1);
  });

  it('has no accessibility violations in any state', async () => {
    const states = [
      batteryOf(58),
      batteryOf(10),
      batteryOf(3),
      batteryOf(58, { freshness: 'STALE' }),
      batteryOf(58, { quality: 'SUSPECT' }),
      batteryOf(null),
    ];
    for (const battery of states) {
      const { container, unmount } = render(<BatteryGauge battery={battery} />);
      await expectNoAxeViolations(container);
      unmount();
    }
  });
});
