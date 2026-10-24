import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { LoadingRegion, Skeleton } from '../components/ui/feedback';
import { ToastProvider } from '../components/ui/toast';
import { AuthProvider, useOptionalAuth } from '../features/auth/AuthProvider';
import { PublicOnly, RequireRole, RequireSession } from '../features/auth/guards';
import { InvitePage } from '../features/auth/pages/InvitePage';
import {
  AuthCallbackPage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from '../features/auth/pages/AuthPages';
import type { AuthClient } from '../features/auth/types';
import type { AppConfig } from '../lib/config';
import { EffectsProvider } from './effects';
import type { EffectsMode } from './effects';
import {
  AdminPage,
  AnalyticsPage,
  AutomationPage,
  ControlsPage,
  LivePage,
  NotFoundPage,
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
  /**
   * The identity adapter, or `null` in demo mode (nobody signs in). The role the interface uses comes from this
   * client's database answer and nowhere else.
   */
  authClient?: AuthClient | null;
  initialEffects?: EffectsMode;
}

function AppRoutes({ config }: { config: AppConfig }) {
  const auth = useOptionalAuth();
  // `role` is what the database returned for the signed-in person, or null. It only chooses which links to show.
  const role = auth?.permissions.role ?? null;
  const navItems = visibleNavRoutes(APP_ROUTES, { demoMode: config.demoMode, role });
  const devFooter =
    ComponentCatalogue !== null ? (
      <Link to="/dev/components" className="text-xs text-ink-muted underline underline-offset-2">
        Component catalogue (development only)
      </Link>
    ) : undefined;

  return (
    <Routes>
      <Route element={<AuthLayout demoMode={config.demoMode} />}>
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        </Route>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
      </Route>
      <Route
        element={
          <AppShell
            demoMode={config.demoMode}
            navItems={navItems}
            {...(devFooter !== undefined ? { sidebarFooter: devFooter } : {})}
          />
        }
      >
        <Route element={<RequireSession />}>
          <Route index element={<Navigate to={DEFAULT_PATH} replace />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/tariffs" element={<TariffsPage />} />
          <Route path="/controls" element={<ControlsPage />} />
          <Route path="/automation" element={<AutomationPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<RequireRole minimum="ADMIN" />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
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
  );
}

/** Providers, layouts and routes, without a router, so tests can supply a memory router. */
export function AppFrame({ config, authClient = null, initialEffects }: AppFrameProps) {
  const routes = <AppRoutes config={config} />;
  return (
    <EffectsProvider {...(initialEffects !== undefined ? { initial: initialEffects } : {})}>
      <ToastProvider>
        {authClient !== null ? <AuthProvider client={authClient}>{routes}</AuthProvider> : routes}
      </ToastProvider>
    </EffectsProvider>
  );
}

interface AppProps {
  config: AppConfig;
  authClient: AuthClient | null;
}

export function App({ config, authClient }: AppProps) {
  return (
    <BrowserRouter>
      <AppFrame config={config} authClient={authClient} />
    </BrowserRouter>
  );
}
