import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import type { Role } from '@autopw3/shared';
import { LoadingRegion, Skeleton } from '../components/ui/feedback';
import { ToastProvider } from '../components/ui/toast';
import type { AppConfig } from '../lib/config';
import { EffectsProvider } from './effects';
import type { EffectsMode } from './effects';
import {
  AdminPage,
  AnalyticsPage,
  AutomationPage,
  ControlsPage,
  InvitePage,
  LivePage,
  LoginPage,
  NotFoundPage,
  RegisterPage,
  SettingsPage,
  TariffsPage,
} from './pages/AppPages';
import { APP_ROUTES, DEFAULT_PATH, visibleNavRoutes } from './routes';
import { AppShell, AuthLayout } from './shell/AppShell';

/**
 * The component catalogue exists only in development. `import.meta.env.DEV` is a build-time constant, so in a
 * production build this branch, the route below and the catalogue chunk are removed entirely (checked in the handoff).
 */
const ComponentCatalogue = import.meta.env.DEV
  ? lazy(() => import('./dev/ComponentCatalogue').then((m) => ({ default: m.ComponentCatalogue })))
  : null;

export interface AppFrameProps {
  config: AppConfig;
  /** Role hint from the session; `null` until TASK-07 provides sign-in. Used only to choose which links to show. */
  role?: Role | null;
  initialEffects?: EffectsMode;
}

/** Providers, layouts and routes, without a router, so tests can supply a memory router. */
export function AppFrame({ config, role = null, initialEffects }: AppFrameProps) {
  const navItems = visibleNavRoutes(APP_ROUTES, { demoMode: config.demoMode, role });
  const devFooter =
    ComponentCatalogue !== null ? (
      <Link to="/dev/components" className="text-xs text-ink-muted underline underline-offset-2">
        Component catalogue (development only)
      </Link>
    ) : undefined;

  return (
    <EffectsProvider {...(initialEffects !== undefined ? { initial: initialEffects } : {})}>
      <ToastProvider>
        <Routes>
          <Route element={<AuthLayout demoMode={config.demoMode} />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
          </Route>
          <Route
            element={
              <AppShell
                demoMode={config.demoMode}
                navItems={navItems}
                signedIn={role !== null}
                {...(devFooter !== undefined ? { sidebarFooter: devFooter } : {})}
              />
            }
          >
            <Route index element={<Navigate to={DEFAULT_PATH} replace />} />
            <Route path="/live" element={<LivePage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/tariffs" element={<TariffsPage />} />
            <Route path="/controls" element={<ControlsPage />} />
            <Route path="/automation" element={<AutomationPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            {ComponentCatalogue !== null ? (
              <Route
                path="/dev/components"
                element={
                  <Suspense
                    fallback={
                      <LoadingRegion label="Loading component catalogue">
                        <Skeleton className="h-8 w-64" />
                      </LoadingRegion>
                    }
                  >
                    <ComponentCatalogue />
                  </Suspense>
                }
              />
            ) : null}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </EffectsProvider>
  );
}

interface AppProps {
  config: AppConfig;
  role?: Role | null;
}

export function App({ config, role }: AppProps) {
  return (
    <BrowserRouter>
      <AppFrame config={config} {...(role !== undefined ? { role } : {})} />
    </BrowserRouter>
  );
}
