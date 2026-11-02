import { afterEach, expect, it, vi } from 'vitest';
import { RequestBudget } from './request-budget';

afterEach(() => vi.useRealTimers());
it('bounds an entire phase even when the transport ignores abort', async () => {
  vi.useFakeTimers();
  const budget = new RequestBudget();
  const transport = vi.fn<typeof fetch>(async () => new Promise<Response>(() => undefined));
  const pending = budget.fetcher(transport)('https://fixture.invalid');
  const assertion = expect(pending).rejects.toThrow('deadline');
  await vi.advanceTimersByTimeAsync(25_001);
  await assertion;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  const later = vi.fn(async () => true);
  await expect(budget.run(later)).rejects.toThrow('deadline');
  expect(later).not.toHaveBeenCalled();
  budget.dispose();
});
it('propagates caller abort and preserves the global fetch receiver', async () => {
  const caller = new AbortController();
  const budget = new RequestBudget();
  const transport: typeof fetch = async function (this: typeof globalThis, _input, init) {
    expect(this).toBe(globalThis);
    expect(init?.signal?.aborted).toBe(true);
    return new Response('fixture');
  };
  caller.abort();
  await budget.fetcher(transport)('https://fixture.invalid', { signal: caller.signal });
  budget.dispose();
});
