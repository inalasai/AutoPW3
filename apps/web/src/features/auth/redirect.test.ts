import { describe, expect, it } from 'vitest';
import { extractInvitationToken } from './invitation';
import { readLoginState, safeReturnPath } from './redirect';

const TOKEN = 'ab'.repeat(32);

describe('safeReturnPath', () => {
  it('accepts a same-site path with a query', () => {
    expect(safeReturnPath('/tariffs')).toBe('/tariffs');
    expect(safeReturnPath('/analytics?range=7d')).toBe('/analytics?range=7d');
  });

  it('refuses anything that could leave the site (open redirect)', () => {
    for (const bad of [
      'https://evil.example/phish',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'tariffs',
      '',
      '/ok\nHost: evil',
      '/tab\there',
      42,
      null,
      undefined,
      {},
    ]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
  });
});

describe('readLoginState', () => {
  it('reads a valid state', () => {
    expect(readLoginState({ from: '/admin', reason: 'expired' })).toEqual({
      from: '/admin',
      reason: 'expired',
    });
  });

  it('ignores anything unexpected', () => {
    expect(readLoginState(null)).toEqual({});
    expect(readLoginState('x')).toEqual({});
    expect(readLoginState({ from: 'https://evil.example', reason: 'nope' })).toEqual({});
  });
});

describe('extractInvitationToken', () => {
  it('reads a bare token', () => {
    expect(extractInvitationToken(TOKEN)).toBe(TOKEN);
    expect(extractInvitationToken(`  ${TOKEN}\n`)).toBe(TOKEN);
  });

  it('reads the token from a pasted link', () => {
    expect(extractInvitationToken(`https://app.example/invite/${TOKEN}`)).toBe(TOKEN);
    expect(extractInvitationToken(`https://app.example/invite/${TOKEN}?x=1#y`)).toBe(TOKEN);
  });

  it('refuses anything that is not a 64 character lowercase hex token', () => {
    for (const bad of [
      '',
      'hello',
      'ab'.repeat(31),
      'AB'.repeat(32),
      'zz'.repeat(32),
      `https://app.example/invite/${TOKEN}extra`,
      'https://app.example/live',
    ]) {
      expect(extractInvitationToken(bad)).toBeNull();
    }
  });
});
