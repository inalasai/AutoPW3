/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
  WCAG 2.2 AA on the design tokens. jsdom has no layout, so contrast cannot be measured on rendered pages;
  instead every text and control colour pair the components use is computed here from tokens.css.
  Text needs 4.5:1; UI component boundaries and graphics need 3:1 (success criteria 1.4.3 and 1.4.11).
*/

const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

function tokenMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, hex] = match;
    if (name !== undefined && hex !== undefined) map.set(name, hex.toLowerCase());
  }
  return map;
}

const TOKENS = tokenMap();

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function token(name: string): Rgb {
  const hex = TOKENS.get(name);
  if (hex === undefined) throw new Error(`unknown token ${name}`);
  return rgb(hex);
}

/** `.glass` over the page: the panel colour at the glass alpha on space-950 (worst case for light text). */
function glassOverPage(alpha: number): Rgb {
  const panel = token('panel');
  const page = token('space-950');
  return [0, 1, 2].map((i) =>
    Math.round((panel[i] ?? 0) * alpha + (page[i] ?? 0) * (1 - alpha)),
  ) as unknown as Rgb;
}

const SURFACES = ['space-950', 'space-900', 'panel'] as const;

describe('design tokens', () => {
  it('defines every colour as a six-digit hex value', () => {
    expect(TOKENS.size).toBeGreaterThanOrEqual(16);
    for (const [name, hex] of TOKENS) {
      expect(hex, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('uses the identity colours from the project context', () => {
    expect(TOKENS.get('space-950')).toBe('#020617');
    expect(TOKENS.get('space-900')).toBe('#090d16');
    expect(TOKENS.get('line')).toBe('#1e293b');
    expect(TOKENS.get('solar')).toBe('#f59e0b');
    expect(TOKENS.get('battery')).toBe('#10b981');
    expect(TOKENS.get('grid')).toBe('#6366f1');
    expect(TOKENS.get('select')).toBe('#06b6d4');
  });
});

describe('text contrast (4.5:1)', () => {
  const textColours = [
    'ink',
    'ink-muted',
    'solar',
    'battery',
    'grid-ink',
    'select',
    'info',
    'success',
    'warning',
    'danger',
  ] as const;

  for (const fg of textColours) {
    for (const bg of SURFACES) {
      it(`${fg} on ${bg}`, () => {
        expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('ink and muted ink stay readable on a glass panel over the page', () => {
    const glass = glassOverPage(0.6);
    expect(contrast(token('ink'), glass)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('ink-muted'), glass)).toBeGreaterThanOrEqual(4.5);
  });

  it('control labels on their own backgrounds', () => {
    expect(contrast(token('space-950'), token('select'))).toBeGreaterThanOrEqual(4.5); // primary button, selected segment, skip link
    expect(contrast(token('ink'), token('danger-solid'))).toBeGreaterThanOrEqual(4.5); // danger button
    expect(contrast(token('ink'), token('line'))).toBeGreaterThanOrEqual(4.5); // active and hovered navigation
    expect(contrast(token('ink-muted'), token('line'))).toBeGreaterThanOrEqual(4.5); // hovered ghost items
    expect(contrast(token('space-950'), token('ink'))).toBeGreaterThanOrEqual(4.5); // switch knob on dark
  });
});

describe('non-text contrast (3:1)', () => {
  it('field borders and the focus ring are visible on every surface', () => {
    for (const bg of SURFACES) {
      expect(
        contrast(token('field-border'), token(bg)),
        `field-border on ${bg}`,
      ).toBeGreaterThanOrEqual(3);
      expect(contrast(token('select'), token(bg)), `select on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('energy colours and status borders are visible as graphics', () => {
    for (const name of ['solar', 'battery', 'grid', 'danger', 'warning', 'success', 'info']) {
      expect(contrast(token(name), token('space-900')), name).toBeGreaterThanOrEqual(3);
    }
  });

  it('the grid colour is for graphics only; its text variant is the lighter one', () => {
    expect(contrast(token('grid'), token('space-900'))).toBeLessThan(4.5);
    expect(contrast(token('grid-ink'), token('space-900'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('effects switch', () => {
  it('turns every glow off, makes glass opaque and removes blur, light and motion in one rule', () => {
    const off = /:root\[data-effects='off'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const on = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const glows = [...on.matchAll(/--(glow-[a-z]+):/g)].map((m) => m[1]);
    expect(glows.length).toBe(4);
    for (const glow of glows) {
      expect(off, glow).toMatch(new RegExp(`--${glow}:\\s*none`));
    }
    expect(off).toMatch(/--glass-alpha:\s*1;/);
    expect(off).toMatch(/--glass-blur:\s*0px;/);
    expect(off).toMatch(/--aurora-opacity:\s*0;/);
    expect(off).toMatch(/--motion-scale:\s*0;/);
  });

  it('stops animation for reduced-motion users and when effects are off', () => {
    const base = readFileSync(join(import.meta.dirname, 'base.css'), 'utf8');
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(base).toMatch(/:root\[data-effects='off'\]/);
  });
});
