import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyEffects, readInitialEffects } from './app/effects';
import { StartupError } from './app/StartupError';
import { createAuthClient } from './features/auth/create-client';
import type { AuthClient } from './features/auth/types';
import { readConfig } from './lib/config';
import './styles/index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root not found');
}
const root = createRoot(container);

// Apply the stored effects choice before the first paint so the page does not flash glow it will then remove.
applyEffects(readInitialEffects());

async function start(): Promise<void> {
  const config = readConfig(import.meta.env, { isDev: import.meta.env.DEV });
  let authClient: AuthClient | null;
  try {
    authClient = await createAuthClient(config.auth);
  } catch (error) {
    // The messages raised for an unusable configuration name settings and never show values.
    const message =
      config.auth.kind === 'invalid' && error instanceof Error
        ? error.message
        : 'Sign-in could not be started. Reload the page, or try again later.';
    root.render(
      <StrictMode>
        <StartupError message={message} />
      </StrictMode>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <App config={config} authClient={authClient} />
    </StrictMode>,
  );
}

void start();
