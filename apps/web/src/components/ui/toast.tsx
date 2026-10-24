import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/cx';
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from './icons';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  message?: string;
  /** Milliseconds before it disappears. Default 6000 for success and info; errors stay until dismissed. */
  durationMs?: number;
}

interface ToastEntry {
  id: number;
  tone: ToastTone;
  title: string;
  message: string | undefined;
  durationMs: number | null;
}

interface ToastApi {
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const DEFAULT_TOAST_MS = 6000;

const TONE: Record<ToastTone, { border: string; icon: string }> = {
  success: { border: 'border-success', icon: 'text-success' },
  error: { border: 'border-danger', icon: 'text-danger' },
  info: { border: 'border-info', icon: 'text-info' },
};

/** Toast notifications. Wrap the app once; call `useToast().push(...)` anywhere below. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ReadonlyArray<ToastEntry>>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    const tone = input.tone ?? 'info';
    const durationMs = input.durationMs ?? (tone === 'error' ? null : DEFAULT_TOAST_MS);
    setToasts((current) => [
      ...current,
      { id, tone, title: input.title, message: input.message, durationMs },
    ]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          role="region"
          aria-label="Notifications"
          aria-live="polite"
          aria-relevant="additions"
          className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-96"
        >
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: number) => void }) {
  // Timers pause while the pointer or keyboard focus is on the toast, so it cannot vanish while being read.
  const [paused, setPaused] = useState(false);
  const { id, durationMs } = toast;

  useEffect(() => {
    if (durationMs === null || paused) return;
    const timer = setTimeout(() => {
      onDismiss(id);
    }, durationMs);
    return () => {
      clearTimeout(timer);
    };
  }, [id, durationMs, paused, onDismiss]);

  const styles = TONE[toast.tone];
  const ToneIcon =
    toast.tone === 'success' ? CheckIcon : toast.tone === 'error' ? AlertIcon : InfoIcon;

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : undefined}
      onMouseEnter={() => {
        setPaused(true);
      }}
      onMouseLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
      className={cx(
        'glass pointer-events-auto flex items-start gap-3 border p-3 shadow-lg',
        styles.border,
      )}
    >
      <ToneIcon className={cx('mt-0.5 shrink-0', styles.icon)} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{toast.title}</p>
        {toast.message !== undefined ? (
          <p className="mt-0.5 text-ink-muted">{toast.message}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`Dismiss notification: ${toast.title}`}
        onClick={() => {
          onDismiss(toast.id);
        }}
        className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-line hover:text-ink"
      >
        <CloseIcon width={18} height={18} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return api;
}
