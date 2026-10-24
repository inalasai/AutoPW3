import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * The single visual-effects switch. "on" shows glow, glass blur, background light and animation;
 * "off" removes all of it by setting `data-effects="off"` on `<html>` (see styles/tokens.css and base.css).
 * The choice is a UI preference stored in localStorage; it holds nothing sensitive.
 * `prefers-reduced-motion: reduce` starts a new visitor with effects off, and base.css stops animation regardless.
 */
export type EffectsMode = 'on' | 'off';

export const EFFECTS_STORAGE_KEY = 'autopw3.effects';

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Stored choice, else "off" for people who asked their system for reduced motion, else "on". */
export function readInitialEffects(): EffectsMode {
  try {
    const stored = window.localStorage.getItem(EFFECTS_STORAGE_KEY);
    if (stored === 'on' || stored === 'off') return stored;
  } catch {
    // Storage can be blocked (private mode, policy). Fall through to the default.
  }
  return prefersReducedMotion() ? 'off' : 'on';
}

export function applyEffects(mode: EffectsMode): void {
  document.documentElement.dataset['effects'] = mode;
}

interface EffectsApi {
  effects: EffectsMode;
  setEffects: (mode: EffectsMode) => void;
}

const EffectsContext = createContext<EffectsApi | null>(null);

export function EffectsProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** Override for tests and the catalogue. */
  initial?: EffectsMode;
}) {
  const [effects, setEffectsState] = useState<EffectsMode>(() => initial ?? readInitialEffects());

  useEffect(() => {
    applyEffects(effects);
  }, [effects]);

  const setEffects = useCallback((mode: EffectsMode) => {
    setEffectsState(mode);
    try {
      window.localStorage.setItem(EFFECTS_STORAGE_KEY, mode);
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, []);

  const value = useMemo<EffectsApi>(() => ({ effects, setEffects }), [effects, setEffects]);
  return <EffectsContext.Provider value={value}>{children}</EffectsContext.Provider>;
}

export function useEffects(): EffectsApi {
  const api = useContext(EffectsContext);
  if (api === null) throw new Error('useEffects must be used inside <EffectsProvider>');
  return api;
}
