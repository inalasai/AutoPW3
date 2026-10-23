/**
 * Public, browser-visible configuration. `VITE_` variables are public: never put a secret in one.
 * Demo mode is the default so the app runs with no Tesla or production database credentials.
 */
export interface AppConfig {
  /** True when the app shows synthetic, clearly labelled DEMO data only. */
  demoMode: boolean;
}

export function readConfig(env: Record<string, string | undefined>): AppConfig {
  // Demo is the safe default: only an explicit "false" turns it off.
  return { demoMode: env['VITE_DEMO_MODE'] !== 'false' };
}
