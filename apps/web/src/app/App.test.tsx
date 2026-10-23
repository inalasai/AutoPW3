import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App shell', () => {
  it('shows a visible demo indicator in demo mode', () => {
    render(<App config={{ demoMode: true }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/DEMO MODE/);
    expect(screen.getByRole('heading', { name: 'AutoPW3' })).toBeInTheDocument();
  });

  it('hides the demo indicator when demo mode is off', () => {
    render(<App config={{ demoMode: false }} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
