import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render';
import { defaultInMemoryTariffRepository } from './repository';

afterEach(() => {
  window.localStorage.clear();
  document.title = '';
  defaultInMemoryTariffRepository.reset();
});

describe('TariffManager', () => {
  it('renders tariff manager with seed profiles and shows effective-dated versioning', async () => {
    renderApp({ path: '/tariffs', demoMode: false, account: 'READ_WRITE' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Tariffs' })).toBeInTheDocument();
    expect(await screen.findByText(/Effective-dated versioning/i)).toBeInTheDocument();

    // Verify configured tariffs list
    const tariffList = screen.getByText('Configured Tariffs').closest('div');
    expect(tariffList).toBeInTheDocument();
    expect(await screen.findByText(/EXAMPLE flat import/i)).toBeInTheDocument();
  });

  it('restricts READ_ONLY role from persisting tariffs (acceptance criterion)', async () => {
    renderApp({ path: '/tariffs', demoMode: false, account: 'READ_ONLY' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Tariffs' })).toBeInTheDocument();

    // Notice shown
    expect(screen.getByText('You have read-only access')).toBeInTheDocument();
    expect(
      screen.getByText(/You can view this page, but you cannot change tariffs/i),
    ).toBeInTheDocument();

    // New tariff button disabled with explanation
    const newTariffBtn = screen.getByRole('button', { name: 'New tariff' });
    expect(newTariffBtn).toBeDisabled();
    expect(screen.getByText('Read-only access: you cannot make changes.')).toBeInTheDocument();

    // Save button disabled
    const saveBtn = screen.getByRole('button', { name: /Save New Version|Create Tariff/i });
    expect(saveBtn).toBeDisabled();
  });

  it('allows READ_WRITE users to create and edit tariffs', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/tariffs', demoMode: false, account: 'READ_WRITE' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Tariffs' })).toBeInTheDocument();

    const newTariffBtn = screen.getByRole('button', { name: 'New tariff' });
    expect(newTariffBtn).not.toBeDisabled();
    await user.click(newTariffBtn);

    // Form title switches to New Tariff
    expect(screen.getByRole('heading', { level: 2, name: 'New Tariff' })).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('allows loading example templates with warning notice', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/tariffs', demoMode: false, account: 'READ_WRITE' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Tariffs' })).toBeInTheDocument();

    const tmplBtn = screen.getByRole('button', { name: 'Example Templates' });
    await user.click(tmplBtn);

    // Modal opens with disclaimer notice
    expect(await screen.findByText('Example Tariff Templates')).toBeInTheDocument();
    expect(
      screen.getByText(/ILLUSTRATIVE EXAMPLE values only: not a real supplier tariff/i),
    ).toBeInTheDocument();

    // Select Day & Night template
    const dayNightOption = screen.getByRole('button', {
      name: /Day & Night Import \(TOU\)/i,
    });
    await user.click(dayNightOption);

    // Modal closes and form is updated
    await waitFor(() => {
      expect(screen.queryByText('Example Tariff Templates')).toBeNull();
    });
    expect(screen.getByDisplayValue(/EXAMPLE day and night import/i)).toBeInTheDocument();
  });

  it('blocks saving and shows engine validation problems when tariff has gaps', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/tariffs', demoMode: false, account: 'READ_WRITE' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Tariffs' })).toBeInTheDocument();

    // Switch to a new tariff
    await user.click(screen.getByRole('button', { name: 'New tariff' }));

    // Remove window 2 and 3 to cause coverage gap
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    if (removeButtons[1]) await user.click(removeButtons[1]);

    // Validation problem should be surfaced
    await waitFor(() => {
      expect(screen.getByText('Tariff cannot be saved:')).toBeInTheDocument();
      expect(screen.getByText(/No rate for every day between/i)).toBeInTheDocument();
    });

    // Attempting to save shows save error
    const saveBtn = screen.getByRole('button', { name: /Create Tariff/i });
    await user.click(saveBtn);

    expect(
      await screen.findByText('Please resolve all validation errors before saving.'),
    ).toBeInTheDocument();
  });

  it('creates a new version and updates list when saving valid edits', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/tariffs', demoMode: false, account: 'READ_WRITE' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Tariffs' })).toBeInTheDocument();

    // Edit flat rate
    const flatTariffCard = await screen.findByText('EXAMPLE flat import');
    await user.click(flatTariffCard);

    const nameInput = screen.getByLabelText('Tariff Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Flat Import Plan');

    const saveBtn = screen.getByRole('button', { name: 'Save New Version' });
    await user.click(saveBtn);

    // Toast and updated list
    await waitFor(() => {
      expect(
        screen.getByText(/Saved "Updated Flat Import Plan" \(version 2\)/i),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Effective-dated versioning \(Version 2\)/i)).toBeInTheDocument();
  });
});
