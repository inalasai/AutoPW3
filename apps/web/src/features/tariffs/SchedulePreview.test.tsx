import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SchedulePreview } from './SchedulePreview';
import { TARIFF_EXAMPLES } from '@autopw3/domain';

describe('SchedulePreview', () => {
  it('renders 24-hour visual bar and segment table for standard day', () => {
    render(<SchedulePreview tariff={TARIFF_EXAMPLES.DAY_NIGHT_IMPORT} />);

    expect(screen.getByText('Schedule Preview')).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
    // Reconstructed segments: 00:00-08:00 (Night), 08:00-23:00 (Day), 23:00-24:00 (Night)
    expect(screen.getAllByText('Night').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Day').length).toBeGreaterThanOrEqual(1);
  });

  it('correctly calculates DST spring forward (23h day) when preset clicked', async () => {
    const user = userEvent.setup();
    render(<SchedulePreview tariff={TARIFF_EXAMPLES.DAY_NIGHT_IMPORT} />);

    const springBtn = screen.getByRole('button', { name: /Spring Forward \(23h DST\)/i });
    await user.click(springBtn);

    // Verify 23 hours in the summary description
    expect(screen.getByText(/23 hours/i)).toBeInTheDocument();
    expect(screen.getByText(/Clock change \(\+60m\)/i)).toBeInTheDocument();
  });

  it('correctly calculates DST fall back (25h day) when preset clicked', async () => {
    const user = userEvent.setup();
    render(<SchedulePreview tariff={TARIFF_EXAMPLES.DAY_NIGHT_IMPORT} />);

    const fallBtn = screen.getByRole('button', { name: /Fall Back \(25h DST\)/i });
    await user.click(fallBtn);

    // Verify 25 hours in the summary description
    expect(screen.getByText(/25 hours/i)).toBeInTheDocument();
    expect(screen.getByText(/Clock change \(-60m\)/i)).toBeInTheDocument();
  });
});
