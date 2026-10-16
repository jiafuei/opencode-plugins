import type { Command, Reply, Request, Result } from "./protocol.ts";

/** One browser owner per OpenCode session. Code Mode may issue parallel calls; this owner serializes them. */
export class BrowserRuntime {
  private readonly process;
  private readonly pending = new Map<number, { resolve: (value: Result) => void; reject: (error: Error) => void }>();
  private readonly exit = Promise.withResolvers<void>();
  private queue: Promise<unknown> = Promise.resolve();
  private nextID = 0;
  private stopped = false;
  private closing?: Promise<void>;
  private terminationReason?: string;

  constructor(directory: string, onExit: () => void) {
    const bun = Bun.which("bun");
    if (!bun) throw new Error("The browser plugin needs Bun on PATH to start its worker process.");
    this.process = Bun.spawn({
      cmd: [bun, `${import.meta.dir}/worker.ts`],
      cwd: directory,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "inherit",
      serialization: "json",
      ipc: (reply: Reply) => {
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        this.pending.delete(reply.id);
        if (reply.ok) pending.resolve(reply.result);
        else pending.reject(new Error(reply.error));
      },
      onExit: (_process, exitCode, signalCode) => {
        this.stopped = true;
        for (const pending of this.pending.values()) {
          pending.reject(new Error(this.terminationReason ?? `Browser worker exited (${signalCode ?? exitCode}). The action may have run. Launch/connect again and inspect before repeating it.`));
        }
        this.pending.clear();
        onExit();
        this.exit.resolve();
      },
    });
  }

  call(command: Command, signal: AbortSignal, timeoutMs?: number): Promise<Result> {
    const work = this.queue.then(async () => {
      if (this.closing && command.method !== "close") throw new Error("Browser worker is closing.");
      if (this.stopped) throw new Error("Browser worker is closed. Launch or connect again.");
      const cancellation = timeoutMs === undefined ? signal : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
      cancellation.throwIfAborted();
      const id = ++this.nextID;
      const abort = () => {
        this.stopped = true;
        this.terminationReason = "Browser operation cancelled or timed out. The worker was stopped; launched browsers close, attached browsers remain open. The action may have run. Reconnect and inspect before repeating it.";
        this.process.kill("SIGKILL");
      };
      cancellation.addEventListener("abort", abort, { once: true });
      try {
        return await new Promise<Result>((resolve, reject) => {
          this.pending.set(id, { resolve, reject });
          const request: Request = { id, command };
          this.process.send(request);
        });
      } finally {
        cancellation.removeEventListener("abort", abort);
        this.pending.delete(id);
      }
    });
    this.queue = work.catch(() => {});
    return work;
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      if (this.pending.size > 0) {
        this.stopped = true;
        this.process.kill("SIGKILL");
      }
      try {
        if (!this.stopped) await this.call({ method: "close" }, AbortSignal.timeout(30_000));
      } finally {
        await this.exit.promise;
      }
    })();
  }
}
