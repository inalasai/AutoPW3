import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router';
import { DemoBanner } from '../../components/ui/feedback';
import { NavList } from './NavList';
import { Header } from './Header';
import type { AppRoute } from '../routes';

export interface AppShellProps {
  demoMode: boolean;
  navItems: ReadonlyArray<AppRoute>;
  signedIn: boolean;
  /** Extra sidebar content under the links (the dev catalogue link). */
  sidebarFooter?: ReactNode;
}

/**
 * Layout for signed-in style pages: skip link, demo banner, header, sidebar (wide screens) and the page.
 * After a navigation, focus moves to the page title so keyboard and screen reader users start at the new page.
 */
/** The demo banner in a named region, so it is reachable as a landmark and outside the sticky header. */
function DemoRegion() {
  return (
    <div role="region" aria-label="Demo mode">
      <DemoBanner />
    </div>
  );
}

export function AppShell({ demoMode, navItems, signedIn, sidebarFooter }: AppShellProps) {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const title = document.getElementById('page-title');
    (title ?? mainRef.current)?.focus();
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-select focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-space-950"
      >
        Skip to main content
      </a>
      {demoMode ? <DemoRegion /> : null}
      <Header demoMode={demoMode} navItems={navItems} signedIn={signedIn} />
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
  return (
    <div className="min-h-screen">
      {demoMode ? <DemoRegion /> : null}
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-md px-4 py-10 focus:outline-none"
      >
        <Outlet />
      </main>
    </div>
  );
}
