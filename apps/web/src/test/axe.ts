import axe from 'axe-core';
import { expect } from 'vitest';

interface AxeOptions {
  /**
   * Check that all content sits inside landmarks. Right for whole pages, wrong for a single component rendered
   * on its own, so it is off by default.
   */
  landmarks?: boolean;
}

/**
 * Run axe-core on a rendered subtree and fail with a readable list. The `color-contrast` rule is off because jsdom
 * has no layout or stylesheet; contrast is checked on the design tokens by `styles/contrast.test.ts` and in a real
 * browser (docs/DESIGN_SYSTEM.md section 6).
 */
export async function expectNoAxeViolations(
  node: Element,
  { landmarks = false }: AxeOptions = {},
): Promise<void> {
  const results = await axe.run(node, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: landmarks },
    },
  });
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`,
  );
  expect(summary).toEqual([]);
}
