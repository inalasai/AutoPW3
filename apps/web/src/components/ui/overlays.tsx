import { cloneElement, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/cx';
import { Button } from './Button';
import { useFocusTrap } from './useFocusTrap';

export interface ModalProps {
  open: boolean;
  /** Called for Escape and for a click on the backdrop. */
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
  /** Id of the element that names the dialog. */
  labelledBy: string;
  describedBy?: string;
  /** `center` is a dialog box; `left` is a navigation drawer. */
  placement?: 'center' | 'left';
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * Accessible modal surface used by `ConfirmDialog` and the mobile navigation drawer: portal to `document.body`,
 * `aria-modal`, focus trap, Escape, backdrop click, focus restored on close. Rendered only while open.
 */
export function Modal({
  open,
  onClose,
  role = 'dialog',
  labelledBy,
  describedBy,
  placement = 'center',
  initialFocus,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open, {
    onEscape: onClose,
    ...(initialFocus !== undefined ? { initialFocus } : {}),
  });
  if (!open) return null;
  return createPortal(
    <div
      data-testid="modal-backdrop"
      className={cx(
        'fixed inset-0 z-50 flex bg-space-950/80 [backdrop-filter:blur(var(--glass-blur))]',
        placement === 'center' ? 'items-center justify-center p-4' : 'items-stretch justify-start',
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cx(
          'glass max-h-full overflow-y-auto',
          placement === 'center'
            ? 'w-full max-w-md p-5'
            : 'w-[min(20rem,85vw)] rounded-l-none rounded-r-card p-4',
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` styles the confirm button as destructive. */
  tone?: 'default' | 'danger';
  /** Shows a spinner on the confirm button while the action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for consequential actions (commands, deletes, resume). Uses `role="alertdialog"`; focus starts on
 * Cancel so an accidental Enter does not confirm. The caller decides what confirming does.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      open={open}
      onClose={onCancel}
      role="alertdialog"
      labelledBy={`${id}-title`}
      describedBy={`${id}-desc`}
      initialFocus={cancelRef}
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      <p id={`${id}-desc`} className="mt-2 text-sm text-ink-muted">
        {description}
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="inline-flex h-10 items-center justify-center rounded-control border border-field-border px-4 text-sm font-medium hover:bg-line"
        >
          {cancelLabel}
        </button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          loading={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export interface TooltipProps {
  /** Short supplementary text. Anything essential belongs in visible text, not a tooltip. */
  content: string;
  /** A single focusable element. It receives `aria-describedby`. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

/**
 * Tooltip that follows WCAG 1.4.13: shown on hover and keyboard focus, stays while the pointer is over it,
 * and Escape dismisses it. The text is always in the DOM, so it is also the trigger's description.
 */
export function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
      onFocus={() => {
        setOpen(true);
      }}
      onBlur={() => {
        setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        role="tooltip"
        id={id}
        hidden={!open}
        className="absolute left-1/2 top-full z-40 mt-2 w-max max-w-56 -translate-x-1/2 rounded-control border border-field-border bg-space-900 px-2 py-1 text-xs text-ink"
      >
        {content}
      </span>
    </span>
  );
}
