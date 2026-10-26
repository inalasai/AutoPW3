import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render';

afterEach(() => {
  window.localStorage.clear();
  document.title = '';
});

describe('AutomationManager', () => {
  it('renders automation manager with active rules, emergency pause and execution history', async () => {
    renderApp({ path: '/automation', demoMode: false, account: 'READ_WRITE' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Automation' }),
    ).toBeInTheDocument();

    // Verify Emergency Pause toggle & status
    expect(screen.getByText('Emergency Pause')).toBeInTheDocument();
    expect(screen.getByTestId('automation-pause-status')).toHaveTextContent('AUTOMATION ACTIVE');

    // Verify Safety Guardrail notice
    expect(screen.getByTestId('automation-safety-notice')).toHaveTextContent(
      'Real Automation is Off by Default',
    );

    // Verify Configured Automation Rules
    expect(screen.getByText('Configured Automation Rules')).toBeInTheDocument();
    expect(screen.getByText('Cheap Night Charge Window')).toBeInTheDocument();
    expect(screen.getAllByText('DRY_RUN').length).toBeGreaterThan(0);

    // Verify Execution History card
    expect(screen.getByText('Automation Execution History')).toBeInTheDocument();
    expect(screen.getByText('WOULD ACT (DRY RUN)')).toBeInTheDocument();
  });

  it('restricts READ_ONLY role from creating rules or toggling emergency pause', async () => {
    renderApp({ path: '/automation', demoMode: false, account: 'READ_ONLY' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Automation' }),
    ).toBeInTheDocument();

    // ReadOnlyNotice banner is shown
    expect(screen.getByText('You have read-only access')).toBeInTheDocument();
    expect(
      screen.getByText(/You can view this page, but you cannot change rules/i),
    ).toBeInTheDocument();

    // Emergency Pause and New rule buttons are disabled
    const pauseBtn = screen.getByRole('button', { name: 'Emergency Pause' });
    expect(pauseBtn).toBeDisabled();

    const newRuleBtn = screen.getByRole('button', { name: 'New rule' });
    expect(newRuleBtn).toBeDisabled();
  });

  it('allows emergency pause toggle confirmation', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/automation', demoMode: false, account: 'READ_WRITE' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Automation' }),
    ).toBeInTheDocument();

    const pauseBtn = screen.getByRole('button', { name: 'Emergency Pause' });
    await user.click(pauseBtn);

    // Dialog appears with alertdialog role
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Emergency Pause All Automation?',
      }),
    ).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: 'Emergency Pause Now' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByTestId('automation-pause-status')).toHaveTextContent('AUTOMATION PAUSED');
    });
  });

  it('opens New Rule modal and creates a new DRY_RUN rule', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/automation', demoMode: false, account: 'READ_WRITE' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Automation' }),
    ).toBeInTheDocument();

    const newRuleBtn = screen.getByRole('button', { name: 'New rule' });
    await user.click(newRuleBtn);

    // Modal opens
    expect(
      await screen.findByRole('heading', { level: 2, name: 'New Automation Rule' }),
    ).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Rule Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Afternoon Solar Boost');

    const submitBtn = screen.getByRole('button', { name: 'Create Rule' });
    await user.click(submitBtn);

    // Modal closes and new rule appears
    await waitFor(() => {
      expect(screen.getByText('Afternoon Solar Boost')).toBeInTheDocument();
    });
  });
});
