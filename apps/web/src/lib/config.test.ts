import { describe, expect, it } from 'vitest';
import { readConfig } from './config';

describe('readConfig', () => {
  it('defaults to demo mode when nothing is set', () => {
    expect(readConfig({}).demoMode).toBe(true);
  });

  it('stays in demo mode for any value except an explicit "false"', () => {
    expect(readConfig({ VITE_DEMO_MODE: 'true' }).demoMode).toBe(true);
    expect(readConfig({ VITE_DEMO_MODE: '' }).demoMode).toBe(true);
    expect(readConfig({ VITE_DEMO_MODE: 'no' }).demoMode).toBe(true);
  });

  it('leaves demo mode only on an explicit "false"', () => {
    expect(readConfig({ VITE_DEMO_MODE: 'false' }).demoMode).toBe(false);
  });
});
