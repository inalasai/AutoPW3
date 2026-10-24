import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router';
import { DemoBanner } from '../../components/ui/feedback';
import { NavList } from './NavList';
import { Header } from './Header';
import type { AppRoute } from '../routes';

export interface AppShellProps {
  demoMode: boolean;
  navItems: ReadonlyArray<AppRoute>;
  /** Extra sidebar content under the links (the dev catalogue link). */
  sidebarFooter?: ReactNode;
}

/**
 * After a navigation (a link, a redirect, the back button) focus moves to the page title so keyboard and screen
 * reader users start at the new page. The very first load of the app is left alone (the browser's own behaviour).
 */
function useMoveFocusAfterNavigation(fallback: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      // `POP` on the first render is the initial page load. A redirect into this layout (for example after
      // signing in) is `REPLACE` or `PUSH` and does move focus.
      if (navigationType === 'POP') return;
    }
    const title = document.getElementById('page-title');
    (title ?? fallback.current)?.focus();
  }, [pathname]); // Only a change of page moves focus.
}

/** The demo banner in a named region, so it is reachable as a landmark and outside the sticky header. */
function DemoRegion() {
  return (
    <div role="region" aria-label="Demo mode">
      <DemoBanner />
    </div>
  );
}

/**
 * Layout for signed-in style pages: skip link, demo banner, header, sidebar (wide screens) and the page.
 */
export function AppShell({ demoMode, navItems, sidebarFooter }: AppShellProps) {
  const mainRef = useRef<HTMLElement>(null);
  useMoveFocusAfterNavigation(mainRef);

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-select focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-space-950"
      >
        Skip to main content
      </a>
      {demoMode ? <DemoRegion /> : null}
      <Header demoMode={demoMode} navItems={navItems} />
      <div className="mx-auto flex w-full max-w-[96rem]">
        <aside className="sticky top-header hidden max-h-[calc(100vh-var(--spacing-header))] w-sidebar shrink-0 flex-col gap-4 self-start overflow-y-auto border-r border-line p-3 lg:flex">
          <NavList label="Primary" items={navItems} />
          {sidebarFooter !== undefined ? <div>{sidebarFooter}</div> : null}
        </aside>
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Layout for sign-in, registration and invitation pages: no navigation, content centred. */
export function AuthLayout({ demoMode }: { demoMode: boolean }) {
  const mainRef = useRef<HTMLElement>(null);
  useMoveFocusAfterNavigation(mainRef);
  return (
    <div className="min-h-screen">
      {demoMode ? <DemoRegion /> : null}
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-md px-4 py-10 focus:outline-none"
      >
        <Outlet />
      </main>
    </div>
  );
}
