import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyEffects, readInitialEffects } from './app/effects';
import { readConfig } from './lib/config';
import './styles/index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root not found');
}

// Apply the stored effects choice before the first paint so the page does not flash glow it will then remove.
applyEffects(readInitialEffects());

createRoot(container).render(
  <StrictMode>
    <App config={readConfig(import.meta.env)} />
  </StrictMode>,
);
