import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render';

afterEach(() => {
  window.localStorage.clear();
  document.title = '';
});

describe('AdminPanel', () => {
  it('renders admin cockpit with member directory, invitations, and navigation tabs', async () => {
    renderApp({ path: '/admin', demoMode: false, account: 'ADMIN' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();

    // Verify Tab headers
    expect(screen.getByRole('tab', { name: 'Members & Invitations' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Audit History' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Household Settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Privacy & Data' })).toBeInTheDocument();

    // Verify Household Members table
    expect(screen.getByText('Household Members')).toBeInTheDocument();
    expect(screen.getByText('Alice Admin (You)')).toBeInTheDocument();
    expect(screen.getByText('Bob Member')).toBeInTheDocument();
    expect(screen.getByText('Charlie Viewer')).toBeInTheDocument();

    // Verify Pending Invitations
    expect(screen.getByText('Pending Invitations')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite Member' })).toBeInTheDocument();
  });

  it('blocks READ_ONLY role with Not authorised page when attempting to access /admin', async () => {
    renderApp({ path: '/admin', demoMode: false, account: 'READ_ONLY' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Not authorised' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your role in this household does not allow you to open this page/i),
    ).toBeInTheDocument();
  });

  it('displays read-only notice and disables admin actions in demo mode', async () => {
    renderApp({ path: '/admin', demoMode: true });

    expect(await screen.findByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();

    // Non-admin notice is visible in demo mode
    expect(screen.getByText('Read-Only Administrative Access')).toBeInTheDocument();
    expect(
      screen.getByText(/You do not have the ADMIN role in this household/i),
    ).toBeInTheDocument();

    // Change Role and Remove buttons are not rendered for non-admins
    expect(screen.queryByRole('button', { name: 'Invite Member' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change Role' })).not.toBeInTheDocument();
  });

  it('filters member directory by text search', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/admin', demoMode: false, account: 'ADMIN' });

    expect(await screen.findByText('Bob Member')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Search members...');
    await user.type(searchInput, 'Charlie');

    expect(screen.getByText('Charlie Viewer')).toBeInTheDocument();
    expect(screen.queryByText('Bob Member')).not.toBeInTheDocument();
  });

  it('opens invite member modal and creates an invitation link', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/admin', demoMode: false, account: 'ADMIN' });

    const inviteBtn = await screen.findByRole('button', { name: 'Invite Member' });
    await user.click(inviteBtn);

    expect(screen.getByRole('heading', { name: 'Invite Household Member' })).toBeInTheDocument();

    const emailInput = screen.getByPlaceholderText('colleague@example.com');
    await user.type(emailInput, 'newguest@example.com');

    const submitBtn = screen.getByRole('button', { name: 'Create Invitation' });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Invitation link is ready!')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Copy Link' })).toBeInTheDocument();
  });

  it('switches tabs to Audit History and displays audit events', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/admin', demoMode: false, account: 'ADMIN' });

    const auditTab = await screen.findByRole('tab', { name: 'Audit History' });
    await user.click(auditTab);

    expect(screen.getByRole('heading', { level: 2, name: 'Audit Log' })).toBeInTheDocument();
    expect(screen.getAllByText('rule.mode_changed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('bootstrap.completed').length).toBeGreaterThan(0);
  });

  it('switches tabs to Household Settings and displays Tesla connection state', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/admin', demoMode: false, account: 'ADMIN' });

    const settingsTab = await screen.findByRole('tab', { name: 'Household Settings' });
    await user.click(settingsTab);

    expect(screen.getByText('Tesla Connection Status')).toBeInTheDocument();
    expect(screen.getByText('Tesla Fleet API Connected')).toBeInTheDocument();
    expect(screen.getByLabelText('Monthly Spend Cap (USD)')).toBeInTheDocument();
  });

  it('switches tabs to Privacy & Data and renders export and erasure operations', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/admin', demoMode: false, account: 'ADMIN' });

    const privacyTab = await screen.findByRole('tab', { name: 'Privacy & Data' });
    await user.click(privacyTab);

    expect(screen.getByText('Data Portability & Export (GDPR Article 20)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Export Household Data (JSON)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Export My Account Data (JSON)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Household' })).toBeInTheDocument();
  });

  it('renders settings page on /settings with focused tabs', async () => {
    renderApp({ path: '/settings', demoMode: false, account: 'ADMIN' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Tesla Connection Status')).toBeInTheDocument();
  });
});
