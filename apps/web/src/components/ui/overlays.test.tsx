import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Button } from './Button';
import { ConfirmDialog, Tooltip } from './overlays';
import { DEFAULT_TOAST_MS, ToastProvider, useToast } from './toast';

function DialogHarness({
  onConfirm = () => undefined,
  tone = 'default',
}: {
  onConfirm?: () => void;
  tone?: 'default' | 'danger';
}) {
  const [open, setOpen] = useState(false);
  return (
    <div id="root">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      <ConfirmDialog
        open={open}
        tone={tone}
        title="Remove member?"
        description="They lose access immediately."
        confirmLabel="Remove"
        onCancel={() => {
          setOpen(false);
        }}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
      />
    </div>
  );
}

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(<DialogHarness />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('opens as a named, described alertdialog with focus on Cancel', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove member?' });
    expect(dialog).toHaveAccessibleDescription('They lose access immediately.');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside the dialog and makes the page inert', async () => {
    const user = userEvent.setup();
    const { container } = render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(container.querySelector('#root')).toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    const user = userEvent.setup();
    const { container } = render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(opener).toHaveFocus();
    expect(container.querySelector('#root')).not.toHaveAttribute('inert');
  });

  it('closes when the backdrop is clicked, but not when the dialog itself is', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('alertdialog'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('only confirms when the confirm button is used', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DialogHarness onConfirm={onConfirm} tone="danger" />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Enter}'); // focus is on Cancel
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations while open', async () => {
    const user = userEvent.setup();
    render(<DialogHarness tone="danger" />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await expectNoAxeViolations(screen.getByRole('alertdialog'));
  });
});

describe('Tooltip', () => {
  it('describes its trigger and shows on keyboard focus, hides on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="More detail">
        <Button>Trigger</Button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    expect(trigger).toHaveAccessibleDescription('More detail');
    expect(screen.getByRole('tooltip', { hidden: true })).not.toBeVisible();
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('tooltip')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('tooltip', { hidden: true })).not.toBeVisible();
  });

  it('shows on hover and stays while the pointer is over the tooltip text', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="More detail">
        <Button>Trigger</Button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole('button', { name: 'Trigger' }));
    expect(screen.getByRole('tooltip')).toBeVisible();
    await user.hover(screen.getByRole('tooltip'));
    expect(screen.getByRole('tooltip')).toBeVisible();
    await user.unhover(screen.getByRole('tooltip'));
    expect(screen.getByRole('tooltip', { hidden: true })).not.toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <Tooltip content="More detail">
        <Button>Trigger</Button>
      </Tooltip>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('Toasts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function Pusher({ tone }: { tone: 'success' | 'error' }) {
    const toast = useToast();
    return (
      <button
        type="button"
        onClick={() => {
          toast.push({ tone, title: `A ${tone} toast`, message: 'Details' });
        }}
      >
        Push
      </button>
    );
  }

  it('announces through a polite live region named Notifications', () => {
    render(
      <ToastProvider>
        <Pusher tone="success" />
      </ToastProvider>,
    );
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(region).toHaveTextContent('A success toast');
  });

  it('removes success toasts after the default time', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Pusher tone="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(screen.getByText('A success toast')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_MS + 50);
    });
    expect(screen.queryByText('A success toast')).toBeNull();
  });

  it('keeps error toasts, as role="alert", until they are dismissed', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Pusher tone="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(screen.getByRole('alert')).toHaveTextContent('A error toast');
    act(() => {
      vi.advanceTimersByTime(10 * DEFAULT_TOAST_MS);
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification: A error toast' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pauses the timer while the pointer is over the toast', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Pusher tone="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    const toast = screen.getByText('A success toast').closest('div[class*="glass"]');
    expect(toast).not.toBeNull();
    fireEvent.mouseEnter(toast as Element);
    act(() => {
      vi.advanceTimersByTime(3 * DEFAULT_TOAST_MS);
    });
    expect(screen.getByText('A success toast')).toBeInTheDocument();
    fireEvent.mouseLeave(toast as Element);
    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_MS + 50);
    });
    expect(screen.queryByText('A success toast')).toBeNull();
  });

  it('refuses to be used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Pusher tone="success" />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });

  it('has no accessibility violations with toasts showing', async () => {
    render(
      <ToastProvider>
        <Pusher tone="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    await expectNoAxeViolations(screen.getByRole('region', { name: 'Notifications' }));
  });
});
