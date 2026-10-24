import { roleAtLeast } from '@autopw3/shared';
import type { Role } from '@autopw3/shared';
import type { ReactNode } from 'react';
import {
  ChartIcon,
  GearIcon,
  PulseIcon,
  ShieldIcon,
  SlidersIcon,
  SparkleIcon,
  TagIcon,
} from '../components/ui/icons';
import type { IconProps } from '../components/ui/icons';

/** Who may see a route in the navigation. `public` needs no sign-in. This is a display hint only: the Worker and the database authorise. */
export type PageAccess = 'public' | Role;

export interface AppRoute {
  /** Stable key used by tests and the page components. */
  id: string;
  path: string;
  /** Page title (also the document title). */
  title: string;
  /** Present when the route appears in the sidebar and the mobile menu. */
  nav?: { label: string; icon: (props: IconProps) => ReactNode };
  access: PageAccess;
  /** Task that builds the real page (docs/PRODUCT_REQUIREMENTS.md section 5). */
  task: string;
}

/**
 * The route inventory of docs/PRODUCT_REQUIREMENTS.md section 5, as data. Order is navigation order.
 * Placeholders today; each feature task replaces its page, not this table.
 */
export const APP_ROUTES = [
  {
    id: 'live',
    path: '/live',
    title: 'Live',
    nav: { label: 'Live', icon: PulseIcon },
    access: 'READ_ONLY',
    task: '09',
  },
  {
    id: 'analytics',
    path: '/analytics',
    title: 'Analytics',
    nav: { label: 'Analytics', icon: ChartIcon },
    access: 'READ_ONLY',
    task: '13',
  },
  {
    id: 'tariffs',
    path: '/tariffs',
    title: 'Tariffs',
    nav: { label: 'Tariffs', icon: TagIcon },
    access: 'READ_ONLY',
    task: '12',
  },
  {
    id: 'controls',
    path: '/controls',
    title: 'Controls',
    nav: { label: 'Controls', icon: SlidersIcon },
    access: 'READ_ONLY',
    task: '17',
  },
  {
    id: 'automation',
    path: '/automation',
    title: 'Automation',
    nav: { label: 'Automation', icon: SparkleIcon },
    access: 'READ_ONLY',
    task: '18',
  },
  {
    id: 'settings',
    path: '/settings',
    title: 'Settings',
    nav: { label: 'Settings', icon: GearIcon },
    access: 'READ_ONLY',
    task: '15/19',
  },
  {
    id: 'admin',
    path: '/admin',
    title: 'Admin',
    nav: { label: 'Admin', icon: ShieldIcon },
    access: 'ADMIN',
    task: '19',
  },
  { id: 'login', path: '/login', title: 'Sign in', access: 'public', task: '07' },
  { id: 'register', path: '/register', title: 'Create account', access: 'public', task: '07' },
  {
    id: 'invite',
    path: '/invite/:token',
    title: 'Accept invitation',
    access: 'public',
    task: '07/19',
  },
] as const satisfies ReadonlyArray<AppRoute>;

export type AppRouteId = (typeof APP_ROUTES)[number]['id'];

export const NOT_FOUND_TITLE = 'Page not found';

export const DEFAULT_PATH = '/live';

export function routeById(id: AppRouteId): AppRoute {
  const found = APP_ROUTES.find((r) => r.id === id);
  if (found === undefined) throw new Error(`unknown route ${id}`);
  return found;
}

export interface NavContext {
  /** Demo mode shows every entry: it holds only synthetic data and no privileges. */
  demoMode: boolean;
  /** Role hint from the signed-in session; `null` when nobody is signed in. Supplied by TASK-07. */
  role: Role | null;
}

/**
 * Entries to show in the sidebar and mobile menu. Hiding is a courtesy: a hidden route still renders its own
 * state, and the Worker and database refuse anything the user may not do.
 */
export function visibleNavRoutes(routes: ReadonlyArray<AppRoute>, context: NavContext): AppRoute[] {
  return routes.filter((route) => {
    if (route.nav === undefined) return false;
    if (context.demoMode) return true;
    if (route.access === 'public') return true;
    return context.role !== null && roleAtLeast(context.role, route.access);
  });
}
