import { Schema } from "effect";
import { PtyDaemon, type Terminal } from "./daemon.ts";

const id = Schema.Int.check(Schema.isGreaterThan(0)).annotate({ description: "Terminal ID from start or list" });
const until = Schema.String.check(Schema.isMinLength(1));
const timeoutMs = Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 120_000 }))).annotate({
  description: "Maximum wait in milliseconds, from 0 to 120000. Defaults to 10000. 0 captures the screen immediately and reports timeout unless the wait condition is already met.",
});
export const Start = Schema.Struct({
  command: Schema.String.check(Schema.isMinLength(1)).annotate({ description: "Shell command to run, for example python3 or an installer" }),
  cwd: Schema.optional(Schema.String).annotate({ description: "Working directory, resolved against the project directory. Defaults to the project directory." }),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({ description: "Environment variable overrides. Other variables are inherited from the PTY daemon's environment." }),
  until: Schema.optional(until).annotate({ description: "Literal text to wait for on the screen. Without it, the wait ends after 500 ms of quiet output." }),
  timeoutMs,
});
export const Send = Schema.Struct({
  id,
  text: Schema.optional(Schema.String).annotate({ description: "Text to type exactly as given. To submit a line, also pass keys: [\"Enter\"]." }),
  keys: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Named keys to press after text: Enter, Tab, Backspace, Escape, Up, Down, Left, Right, Home, End, PageUp, PageDown, Delete, F1 to F12, Ctrl+<letter>, or Alt+<character>. Ctrl+C interrupts the foreground program.",
  }),
  until: Schema.optional(until).annotate({
    description: "Literal text to wait for. Only a new occurrence counts, compared with the screen before the input, so avoid text that your input echoes. If an older occurrence scrolls off the screen, the wait can time out; use read to inspect. Without until, the wait ends after 500 ms of quiet output.",
  }),
  timeoutMs,
});
export const Read = Schema.Struct({
  id,
  lines: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))).annotate({
    description: "Number of recent physical rows to read, including retained scrollback, from 1 to 65535. Defaults to the 60-row screen.",
  }),
  until: Schema.optional(until).annotate({ description: "Literal text to wait for in the requested rows. Without it, the wait ends after 500 ms of quiet output." }),
  timeoutMs,
});
export const Close = Schema.Struct({ id });

const keys: Record<string, string> = {
  Enter: "\r", Tab: "\t", Backspace: "\x7f", Escape: "\x1b",
  Up: "\x1b[A", Down: "\x1b[B", Right: "\x1b[C", Left: "\x1b[D",
  Home: "\x1b[H", End: "\x1b[F", PageUp: "\x1b[5~", PageDown: "\x1b[6~", Delete: "\x1b[3~",
  F1: "\x1bOP", F2: "\x1bOQ", F3: "\x1bOR", F4: "\x1bOS",
  F5: "\x1b[15~", F6: "\x1b[17~", F7: "\x1b[18~", F8: "\x1b[19~",
  F9: "\x1b[20~", F10: "\x1b[21~", F11: "\x1b[23~", F12: "\x1b[24~",
};

/** All session access is checked here, before any input, read, or termination reaches the daemon. */
export class Terminals {
  constructor(private readonly daemon: PtyDaemon) {}

  async start(sessionID: string, input: typeof Start.Type & { cwd: string }, signal: AbortSignal) {
    const response = await this.daemon.request({
      op: "create",
      program: process.env.SHELL || "/bin/sh",
      args: ["-lc", input.command],
      cwd: input.cwd,
      title: input.command,
      group_id: sessionID,
      env: input.env ?? {},
      cols: 300,
      rows: 60,
    }, signal);
    if (response.type !== "created") throw new Error(`Expected created, received ${response.type}.`);
    return this.view(response.terminal, input, signal);
  }

  async list(sessionID: string, signal: AbortSignal) {
    const response = await this.daemon.request({ op: "list" }, signal);
    if (response.type !== "terminals") throw new Error(`Expected terminals, received ${response.type}.`);
    return response.terminals.filter((terminal) => terminal.group_id === sessionID);
  }

  private async get(sessionID: string, id: number, signal: AbortSignal) {
    const terminal = (await this.list(sessionID, signal)).find((terminal) => terminal.id === id);
    if (!terminal) throw new Error(`Terminal ${id} not found in this session.`);
    return terminal;
  }

  async send(sessionID: string, input: typeof Send.Type, signal: AbortSignal) {
    const data = (input.text ?? "") + (input.keys ?? []).map((key) => {
      if (Object.hasOwn(keys, key)) return keys[key];
      if (/^Ctrl\+[a-z]$/i.test(key)) return String.fromCharCode(key.charCodeAt(5) & 0x1f);
      if (/^Alt\+.$/u.test(key)) return `\x1b${key.slice(4)}`;
      throw new Error(`Unknown terminal key: ${key}`);
    }).join("");
    if (!data) throw new Error("Provide text or keys to send. Use read to observe without input.");
    const terminal = await this.get(sessionID, input.id, signal);
    const previousMatches = input.until === undefined ? 0
      : (await this.rows(input.id, undefined, signal)).lines.join("\n").split(input.until).length - 1;
    const response = await this.daemon.request({
      op: "write", id: input.id, attachment_id: null, data_base64: Buffer.from(data).toString("base64"),
    }, signal);
    if (response.type !== "ok") throw new Error(`Expected ok, received ${response.type}.`);
    return this.view(terminal, input, signal, previousMatches);
  }

  async read(sessionID: string, input: typeof Read.Type, signal: AbortSignal) {
    return this.view(await this.get(sessionID, input.id, signal), input, signal);
  }

  async close(sessionID: string, id: number, signal: AbortSignal) {
    await this.get(sessionID, id, signal);
    const response = await this.daemon.request({ op: "terminate", id }, signal);
    if (response.type !== "ok") throw new Error(`Expected ok, received ${response.type}.`);
    return { closed: id };
  }

  private async rows(id: number, lines: number | undefined, signal: AbortSignal) {
    const response = await this.daemon.request({ op: "read_rows", id, rows: lines }, signal);
    if (response.type !== "rows") throw new Error(`Expected rows, received ${response.type}.`);
    return response;
  }

  private async view(terminal: Terminal, input: { until?: string; timeoutMs?: number; lines?: number }, signal: AbortSignal, previousMatches = 0) {
    const deadline = performance.now() + (input.timeoutMs ?? 10_000);
    let tail = terminal.output_tail;
    let changedAt = performance.now();
    let exitTail: number | undefined;
    while (true) {
      signal.throwIfAborted();
      const response = await this.rows(terminal.id, input.lines, signal);
      const now = performance.now();
      if (response.terminal.output_tail !== tail) changedAt = now;
      tail = response.terminal.output_tail;
      const text = response.lines.join("\n");
      const exited = response.terminal.lifecycle.status !== "running";
      // Count new occurrences after a send so echoed input cannot unlock an unchanged old prompt.
      // Child exit precedes PTY EOF; confirm an unchanged output tail on the next read before returning exited.
      const waited: "matched" | "settled" | "exited" | "timeout" | undefined = exited && exitTail === tail ? "exited"
        : !exited && input.until !== undefined && text.split(input.until).length - 1 > previousMatches ? "matched"
        : now >= deadline ? "timeout"
        : !exited && input.until === undefined && now - changedAt >= 500 ? "settled"
        : undefined;
      exitTail = exited ? tail : undefined;
      if (waited) {
        // Keep the newest screen rows, including the prompt; never silently slice a long physical row.
        const lines = [...response.lines];
        while (lines.at(-1) === "") lines.pop();
        let retained = 0;
        let length = 0;
        for (const line of lines.toReversed()) {
          if (retained > 0 && length + line.length + 1 > 12_000) break;
          length += line.length + 1;
          retained++;
        }
        const omittedLines = lines.length - retained;
        return {
          id: terminal.id,
          ...status(response.terminal),
          foreground: response.terminal.foreground_process,
          waited,
          cursor: { row: response.cursor_y, col: response.cursor_x },
          screen: lines.slice(omittedLines).join("\n"),
          ...(omittedLines > 0 ? { omittedLines } : {}),
        };
      }
      await Bun.sleep(Math.min(100, Math.max(0, deadline - now)));
    }
  }
}

export function status(terminal: Terminal) {
  return {
    status: terminal.lifecycle.status,
    ...(terminal.lifecycle.status === "exited" ? { exitCode: terminal.lifecycle.exit_code } : {}),
    ...(terminal.lifecycle.status === "failed" ? { error: terminal.lifecycle.message } : {}),
  };
}
