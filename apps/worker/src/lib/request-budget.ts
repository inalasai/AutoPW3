/** One request deadline, including body reads and RPC orchestration; no background retries. */
export class RequestBudget {
  readonly deadline: number;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(milliseconds = 25_000) {
    this.deadline = Date.now() + milliseconds;
    this.timer = setTimeout(() => this.controller.abort(), milliseconds);
  }

  check(): void {
    if (this.controller.signal.aborted || Date.now() >= this.deadline)
      throw new Error('Discovery request deadline exceeded');
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.check();
    let abort: () => void = () => undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('Discovery request deadline exceeded'));
      this.controller.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const result = await Promise.race([operation(), timeout]);
      this.check();
      return result;
    } finally {
      this.controller.signal.removeEventListener('abort', abort);
    }
  }

  fetcher(transport: typeof fetch = fetch): typeof fetch {
    return (input, init) =>
      this.run(() =>
        transport.call(globalThis, input, {
          ...init,
          signal: AbortSignal.any([this.controller.signal, ...(init?.signal ? [init.signal] : [])]),
        }),
      );
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.controller.abort();
  }
}
