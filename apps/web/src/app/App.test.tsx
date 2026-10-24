import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { renderApp } from '../test/render';
import { EFFECTS_STORAGE_KEY } from './effects';
import { APP_ROUTES, visibleNavRoutes } from './routes';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-effects');
  document.title = '';
  vi.unstubAllGlobals();
});

/** Path to visit for each route (the invitation route has a parameter). */
function pathFor(path: string): string {
  return path.replace(':token', 'sample-token');
}

describe('routes', () => {
  for (const route of APP_ROUTES) {
    it(`${route.path} renders its page title as the h1 and sets the document title`, () => {
      renderApp({ path: pathFor(route.path) });
      expect(screen.getByRole('heading', { level: 1, name: route.title })).toBeInTheDocument();
      expect(document.title).toBe(`${route.title} - AutoPW3`);
    });
  }

  it('sends / to /live', () => {
    renderApp({ path: '/' });
    expect(screen.getByRole('heading', { level: 1, name: 'Live' })).toBeInTheDocument();
  });

  it('shows a not-found page with a way back', () => {
    renderApp({ path: '/nothing-here' });
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Live' })).toHaveAttribute('href', '/live');
    expect(document.title).toBe('Page not found - AutoPW3');
  });

  it('does not show the invitation token anywhere', () => {
    renderApp({ path: '/invite/secret-token-value' });
    expect(document.body).not.toHaveTextContent('secret-token-value');
  });
});

describe('page frame', () => {
  it('has a skip link to the main content, and a main landmark to land on', () => {
    renderApp();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('moves focus to the page heading after navigating with a link', async () => {
    const user = userEvent.setup();
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(nav).getByRole('link', { name: 'Analytics' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toHaveFocus();
  });

  it('marks the current page in the navigation', () => {
    renderApp({ path: '/tariffs' });
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Tariffs' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Live' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the sidebar and the header in landmarks', () => {
    renderApp();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });
});

describe('demo indicator', () => {
  it('is visible in demo mode, on pages with and without the sidebar', () => {
    for (const path of ['/live', '/login']) {
      const { unmount } = renderApp({ path, demoMode: true });
      expect(screen.getByTestId('demo-banner')).toHaveTextContent(/DEMO MODE: synthetic data only/);
      unmount();
    }
  });

  it('also shows a compact DEMO pill in the sticky header, which stays visible while scrolling', () => {
    renderApp({ demoMode: true });
    expect(within(screen.getByRole('banner')).getByTestId('demo-pill')).toHaveTextContent('DEMO');
  });

  it('is absent when demo mode is off', () => {
    renderApp({ demoMode: false });
    expect(screen.queryByTestId('demo-banner')).toBeNull();
    expect(screen.queryByTestId('demo-pill')).toBeNull();
    expect(screen.queryByText(/DEMO MODE/)).toBeNull();
  });
});

describe('navigation visibility', () => {
  function labels(): string[] {
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    return within(nav)
      .queryAllByRole('link')
      .map((a) => a.textContent ?? '');
  }

  it('demo mode shows every entry in route order', () => {
    renderApp({ demoMode: true });
    expect(labels()).toEqual([
      'Live',
      'Analytics',
      'Tariffs',
      'Controls',
      'Automation',
      'Settings',
      'Admin',
    ]);
  });

  it('hides the admin entry from a READ_ONLY or READ_WRITE user when demo mode is off', () => {
    for (const role of ['READ_ONLY', 'READ_WRITE'] as const) {
      const { unmount } = renderApp({ demoMode: false, role });
      expect(labels()).not.toContain('Admin');
      expect(labels()).toContain('Controls');
      unmount();
    }
  });

  it('shows the admin entry to an ADMIN', () => {
    renderApp({ demoMode: false, role: 'ADMIN' });
    expect(labels()).toContain('Admin');
  });

  it('shows nothing private to a visitor with no role when demo mode is off', () => {
    renderApp({ demoMode: false, role: null });
    expect(labels()).toEqual([]);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('hiding is a courtesy only: a route still renders if visited directly', () => {
    renderApp({ path: '/admin', demoMode: false, role: 'READ_ONLY' });
    expect(screen.getByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();
  });

  it('visibleNavRoutes follows the role order', () => {
    const ids = (role: 'READ_ONLY' | 'READ_WRITE' | 'ADMIN' | null) =>
      visibleNavRoutes(APP_ROUTES, { demoMode: false, role }).map((r) => r.id);
    expect(ids(null)).toEqual([]);
    expect(ids('READ_ONLY')).not.toContain('admin');
    expect(ids('ADMIN')).toContain('admin');
  });
});

describe('mobile navigation', () => {
  it('opens from the menu button, shows the same links, and closes with its close button', async () => {
    const user = userEvent.setup();
    renderApp();
    const menuButton = screen.getByRole('button', { name: 'Open menu' });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(menuButton);
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    // Seven pages plus the sign-in link, which the narrow header leaves out.
    expect(within(dialog).getAllByRole('link')).toHaveLength(8);
    expect(within(dialog).getByRole('button', { name: 'Close menu' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(menuButton).toHaveFocus();
  });

  it('is fully keyboard operable: Enter opens, Tab stays inside, Escape closes and returns focus', async () => {
    const user = userEvent.setup();
    renderApp();
    const menuButton = screen.getByRole('button', { name: 'Open menu' });
    menuButton.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Menu' });

    const stops = [
      within(dialog).getByRole('button', { name: 'Close menu' }),
      ...within(dialog).getAllByRole('link'),
    ];
    // Tab through every stop twice: focus never leaves the drawer.
    for (let pass = 0; pass < 2; pass++) {
      for (const stop of stops) {
        expect(stop).toHaveFocus();
        await user.tab();
      }
    }
    expect(stops[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(stops[stops.length - 1]).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(menuButton).toHaveFocus();
  });

  it('closes after a link is chosen, and lands on that page', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    await user.click(within(dialog).getByRole('link', { name: 'Controls' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Controls' })).toBeInTheDocument();
  });

  it('closes when the backdrop is pressed', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByTestId('modal-backdrop') });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('effects switch', () => {
  it('starts on, sets data-effects on the page root, and turns off with one switch', async () => {
    const user = userEvent.setup();
    renderApp({ effects: 'on' });
    const toggle = screen.getByRole('switch', { name: 'Effects' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.dataset['effects']).toBe('on');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(document.documentElement.dataset['effects']).toBe('off');
    expect(window.localStorage.getItem(EFFECTS_STORAGE_KEY)).toBe('off');
  });

  it('remembers the choice', () => {
    window.localStorage.setItem(EFFECTS_STORAGE_KEY, 'off');
    renderApp({ effects: null });
    expect(document.documentElement.dataset['effects']).toBe('off');
    expect(screen.getByRole('switch', { name: 'Effects' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('starts off for people whose system asks for reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    renderApp({ effects: null });
    expect(document.documentElement.dataset['effects']).toBe('off');
  });

  it('keeps every page content present with effects off (nothing is only decoration)', () => {
    renderApp({ path: '/live', effects: 'off' });
    expect(screen.getByRole('heading', { level: 1, name: 'Live' })).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getAllByText('No data')).toHaveLength(4);
  });
});

describe('accessibility (axe, whole page)', () => {
  for (const route of APP_ROUTES) {
    it(`${route.path} has no violations in demo mode`, async () => {
      const { container } = renderApp({ path: pathFor(route.path), demoMode: true });
      await expectNoAxeViolations(container, { landmarks: true });
    });
  }

  it('the not-found page has no violations', async () => {
    const { container } = renderApp({ path: '/nothing-here', demoMode: false });
    await expectNoAxeViolations(container, { landmarks: true });
  });

  it('the open mobile menu has no violations', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await expectNoAxeViolations(screen.getByRole('dialog', { name: 'Menu' }));
  });
});

describe('component catalogue (development only)', () => {
  it('renders in development and has no violations', async () => {
    const { container } = renderApp({ path: '/dev/components' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Component catalogue' }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container, { landmarks: true });
  });
});
