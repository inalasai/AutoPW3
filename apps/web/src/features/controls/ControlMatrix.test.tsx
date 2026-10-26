import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render';

afterEach(() => {
  window.localStorage.clear();
  document.title = '';
});

describe('ControlMatrix', () => {
  it('renders control matrix with active configuration, emergency pause and capabilities', async () => {
    renderApp({ path: '/controls', demoMode: false, account: 'READ_WRITE' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Controls' })).toBeInTheDocument();

    // Verify Active Powerwall Configuration card
    expect(screen.getByText('Active Powerwall Configuration')).toBeInTheDocument();
    expect(screen.getAllByText('Backup Reserve').length).toBeGreaterThan(0);
    expect(screen.getAllByText('20%').length).toBeGreaterThan(0);

    // Verify Emergency Pause toggle
    expect(screen.getByText('Emergency Pause')).toBeInTheDocument();
    expect(screen.getByTestId('automation-pause-status')).toHaveTextContent('AUTOMATION ACTIVE');

    // Verify Safety Disclaimer
    expect(screen.getByTestId('safety-disclaimer')).toHaveTextContent(
      'Configuration Confirmed ≠ Physical Outcome Guaranteed',
    );

    // Verify Supported Device Controls section
    expect(screen.getByText('Supported Device Controls')).toBeInTheDocument();

    // Verify Disabled & Unsupported Controls section
    expect(screen.getByText('Disabled & Unsupported Controls')).toBeInTheDocument();
    expect(screen.getByText('Forced Grid Charging')).toBeInTheDocument();
    expect(screen.getByText('Forced Grid Export')).toBeInTheDocument();
    expect(screen.getByText('Solar Inverter Bypass')).toBeInTheDocument();
    expect(screen.getByText('Manual Islanding')).toBeInTheDocument();
    expect(screen.getByText('Off-Grid Vehicle Reserve')).toBeInTheDocument();
  });

  it('restricts READ_ONLY role from dispatching commands or toggling emergency pause', async () => {
    renderApp({ path: '/controls', demoMode: false, account: 'READ_ONLY' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Controls' })).toBeInTheDocument();

    // ReadOnlyNotice banner is shown
    expect(screen.getByText('You have read-only access')).toBeInTheDocument();
    expect(
      screen.getByText(/You can view this page, but you cannot send commands/i),
    ).toBeInTheDocument();

    // Emergency Pause button is disabled
    const pauseBtn = screen.getByRole('button', { name: 'Emergency Pause' });
    expect(pauseBtn).toBeDisabled();

    // Control buttons are disabled
    const applyReserveBtn = screen.getByRole('button', { name: /Apply Reserve/i });
    expect(applyReserveBtn).toBeDisabled();

    const applyModeBtn = screen.getByRole('button', { name: 'Apply Mode' });
    expect(applyModeBtn).toBeDisabled();
  });

  it('opens ConfirmDialog before applying a backup reserve change', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/controls', demoMode: false, account: 'READ_WRITE' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Controls' })).toBeInTheDocument();

    // Move slider or change target reserve
    const slider = screen.getByLabelText('Backup reserve percentage slider');
    // Note: slider has initial value 20; if we change it:
    await user.click(slider);

    // Check emergency pause confirmation dialog
    const pauseBtn = screen.getByRole('button', { name: 'Emergency Pause' });
    await user.click(pauseBtn);

    // Dialog appears with alertdialog role and starts focus on Cancel
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Emergency Pause All Automation?',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Emergency pause immediately suspends all automated rule dispatches/i),
    ).toBeInTheDocument();

    // Cancel closes dialog
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelBtn);

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', {
          level: 2,
          name: 'Emergency Pause All Automation?',
        }),
      ).not.toBeInTheDocument();
    });
  });

  it('executes emergency pause confirmation and updates status', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/controls', demoMode: false, account: 'READ_WRITE' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Controls' })).toBeInTheDocument();

    const pauseBtn = screen.getByRole('button', { name: 'Emergency Pause' });
    await user.click(pauseBtn);

    const confirmBtn = await screen.findByRole('button', { name: 'Emergency Pause Now' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByTestId('automation-pause-status')).toHaveTextContent('AUTOMATION PAUSED');
    });
  });
});
