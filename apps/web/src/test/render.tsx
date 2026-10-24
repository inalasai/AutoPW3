import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@autopw3/shared';
import { AppFrame } from '../app/App';
import type { EffectsMode } from '../app/effects';

export interface RenderAppOptions {
  path?: string;
  demoMode?: boolean;
  role?: Role | null;
  /** 
ull leaves the choice to the provider (stored value, then system preference). */
  effects?: EffectsMode | null;
}

/** Render the whole app (providers, layouts, routes) at a path with a memory router. */
export function renderApp({
  path = '/live',
  demoMode = true,
  role = null,
  effects = 'on',
}: RenderAppOptions = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppFrame
        config={{ demoMode }}
        role={role}
        {...(effects !== null ? { initialEffects: effects } : {})}
      />
    </MemoryRouter>,
  );
}
