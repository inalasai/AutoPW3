import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render';

afterEach(() => {
  window.localStorage.clear();
  document.title = '';
});

describe('Analytics Integration', () => {
  it('renders analytics page with demo banner and summary cards', async () => {
    renderApp({ path: '/analytics', demoMode: true });

    // Page title and description
    expect(await screen.findByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Historical energy flows, tariff-aware costing, and counterfactual savings/i,
      ),
    ).toBeInTheDocument();

    // Source demo banner
    expect(screen.getByText(/DEMO TELEMETRY:/i)).toBeInTheDocument();

    // Summary cards
    expect(screen.getByText('Solar Generated')).toBeInTheDocument();
    expect(screen.getByText('Home Demand')).toBeInTheDocument();
    expect(screen.getByText('Grid Import')).toBeInTheDocument();
    expect(screen.getByText('Battery Charged')).toBeInTheDocument();
    expect(screen.getByText('Net Cost')).toBeInTheDocument();
    expect(screen.getByText('Net Savings')).toBeInTheDocument();
    expect(screen.getAllByText('ESTIMATE').length).toBeGreaterThanOrEqual(1);
  });

  it('reveals model assumptions when clicking Assumptions info button', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/analytics', demoMode: true });

    const assumptionsBtn = await screen.findByRole('button', { name: /assumptions/i });
    expect(assumptionsBtn).toBeInTheDocument();

    await user.click(assumptionsBtn);

    expect(screen.getByText(/Financial & Energy Model Disclosures/i)).toBeInTheDocument();
    expect(screen.getByText(/A-01 \(Standing charges\):/i)).toBeInTheDocument();
    expect(screen.getByText(/A-02 \(Counterfactual Baseline\):/i)).toBeInTheDocument();
    expect(screen.getByText(/A-03 \(Battery Efficiency\):/i)).toBeInTheDocument();
    expect(screen.getByText(/A-04 \(Tariff Optimisation\):/i)).toBeInTheDocument();
  });

  it('switches between presets and updates date period and available resolutions', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/analytics', demoMode: true });

    await screen.findByRole('heading', { level: 1, name: 'Analytics' });

    // Initial period is 2026-06-21 to 2026-06-21
    expect(screen.getByText(/Period: 2026-06-21 to 2026-06-21/i)).toBeInTheDocument();

    // Switch to Week preset
    const weekOption = screen.getByRole('radio', { name: 'Week' });
    await user.click(weekOption);

    // Week covers 7 local days
    await waitFor(() => {
      expect(screen.getByText(/Period: 2026-06-21 to 2026-06-27/i)).toBeInTheDocument();
    });

    // Switch to Month preset
    const monthOption = screen.getByRole('radio', { name: 'Month' });
    await user.click(monthOption);

    // Month covers entire month (2026-06-01 to 2026-06-30)
    await waitFor(() => {
      expect(screen.getByText(/Period: 2026-06-01 to 2026-06-30/i)).toBeInTheDocument();
    });
  });

  it('toggles between Energy and Cost tabs and provides accessible table alternative', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/analytics', demoMode: true });

    await screen.findByRole('heading', { level: 1, name: 'Analytics' });

    // Energy flows heading visible by default
    expect(await screen.findByText('Energy Generation & Consumption')).toBeInTheDocument();

    // Switch to accessible table view
    const viewTableBtn = screen.getByRole('button', { name: 'View as Table' });
    await user.click(viewTableBtn);

    // Table is displayed with caption and data
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Solar (kWh)')).toBeInTheDocument();

    // Switch to Cost & Net Invoicing tab
    const costTab = screen.getByRole('tab', { name: 'Cost & Net Invoicing' });
    await user.click(costTab);

    expect(await screen.findByText('Electricity Invoicing & Net Cost')).toBeInTheDocument();
  });

  it('triggers CSV download when Export CSV button is clicked', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/analytics', demoMode: true });

    const exportBtn = await screen.findByRole('button', { name: 'Export CSV' });
    expect(exportBtn).not.toBeDisabled();

    // Mock URL.createObjectURL and URL.revokeObjectURL
    const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    await user.click(exportBtn);

    expect(createObjectURLMock).toHaveBeenCalled();
  });
});
