import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EnergyChart } from './EnergyChart';
import type { EnergyChartPoint } from './types';

describe('EnergyChart', () => {
  const samplePoints: EnergyChartPoint[] = [
    {
      timestamp: '2026-06-21T12:00:00Z',
      label: '12:00',
      solarKwh: 3.456,
      homeKwh: 1.2,
      gridImportKwh: 0,
      gridExportKwh: 2.256,
      batteryChargedKwh: 0,
      batteryDischargedKwh: 0,
      isGap: false,
    },
  ];

  it('renders energy chart title and toggle button', () => {
    render(<EnergyChart points={samplePoints} />);

    expect(screen.getByText('Energy Generation & Consumption')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view as table/i })).toBeInTheDocument();
  });

  it('toggles to accessible table view and displays formatted rows', async () => {
    const user = userEvent.setup();
    render(<EnergyChart points={samplePoints} />);

    const toggleBtn = screen.getByRole('button', { name: /view as table/i });
    await user.click(toggleBtn);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('3.456 kWh')).toBeInTheDocument();
    expect(screen.getByText('1.200 kWh')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('renders empty state when no points exist', () => {
    render(<EnergyChart points={[]} />);
    expect(screen.getByText('No Energy Data')).toBeInTheDocument();
  });
});
