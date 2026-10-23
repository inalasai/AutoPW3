import type { AppConfig } from '../lib/config';

interface AppProps {
  config: AppConfig;
}

/** Placeholder shell (TASK-02). Routing, layout and the design system arrive in TASK-06. */
export function App({ config }: AppProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {config.demoMode ? (
        <div role="status" className="bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900">
          DEMO MODE: synthetic data only. Nothing here comes from a real site.
        </div>
      ) : null}
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">AutoPW3</h1>
        <p className="mt-2 text-slate-600">
          Energy management for Tesla Powerwall sites. Skeleton only: no features yet.
        </p>
      </main>
    </div>
  );
}
