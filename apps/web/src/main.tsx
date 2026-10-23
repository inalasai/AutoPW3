import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { readConfig } from './lib/config';
import './styles/index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <App config={readConfig(import.meta.env)} />
  </StrictMode>,
);
