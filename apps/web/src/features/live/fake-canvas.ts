/**
 * A recording stand-in for a 2D canvas context, for tests. jsdom has no canvas, so pixels cannot be checked;
 * this records which drawing calls were made and with what arguments, which is enough to test the renderer's
 * decisions (arrows always, particles only when animated) without a browser.
 */

export interface DrawCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface FakeContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: readonly DrawCall[];
  count: (name: string) => number;
  /** The values assigned to a property, in order (for example `fillStyle`). */
  assigned: (property: string) => readonly unknown[];
}

export function createFakeContext(): FakeContext {
  const calls: DrawCall[] = [];
  const values = new Map<string, unknown>();
  const assignments = new Map<string, unknown[]>();
  const target: object = {};
  const ctx = new Proxy(target, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      if (values.has(property)) return values.get(property);
      return (...args: unknown[]) => {
        calls.push({ name: property, args });
      };
    },
    set(_target, property, value) {
      if (typeof property !== 'string') return false;
      values.set(property, value);
      const list = assignments.get(property) ?? [];
      list.push(value);
      assignments.set(property, list);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    calls,
    count: (name) => calls.filter((call) => call.name === name).length,
    assigned: (property) => assignments.get(property) ?? [],
  };
}
