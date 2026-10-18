import { binaryPath } from "@opencode-ai/pty";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";

export const available = binaryPath !== undefined;

const Registration = Schema.Struct({
  instance_id: Schema.String,
  protocol: Schema.Literal(7),
  socket: Schema.String,
  token: Schema.String,
});

const Terminal = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  group_id: Schema.String,
  command: Schema.Array(Schema.String),
  cwd: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
  foreground_process: Schema.NullOr(Schema.String),
  output_tail: Schema.Number,
  lifecycle: Schema.Union([
    Schema.Struct({ status: Schema.Literal("running") }),
    Schema.Struct({ status: Schema.Literal("exited"), exit_code: Schema.NullOr(Schema.Number) }),
    Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String }),
  ]),
});
export type Terminal = typeof Terminal.Type;

const Response = Schema.Union([
  Schema.Struct({ type: Schema.Literal("owned") }),
  Schema.Struct({ type: Schema.Literal("ok") }),
  Schema.Struct({ type: Schema.Literal("created"), terminal: Terminal }),
  Schema.Struct({ type: Schema.Literal("terminals"), terminals: Schema.Array(Terminal) }),
  Schema.Struct({
    type: Schema.Literal("rows"),
    terminal: Terminal,
    lines: Schema.Array(Schema.String),
    cursor_x: Schema.Number,
    cursor_y: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
]);

/** Only this plugin's fresh runtime directory is used; never discover or claim another daemon. */
export class PtyDaemon {
  private constructor(
    private readonly registration: typeof Registration.Type,
    private readonly releaseOwner: () => void,
    private readonly process: Bun.Subprocess<"ignore", "ignore", "ignore">,
  ) {}

  static async start(root: string) {
    if (!binaryPath) throw new Error("The PTY plugin requires Linux, macOS, or Windows on x64 or arm64.");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const name = crypto.randomUUID();
    const child = Bun.spawn([binaryPath, "daemon", "--runtime-dir", root, "--name", name], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    // Windows Bun 1.3 loses exit notifications after unref, so keep its child referenced through shutdown.
    if (process.platform !== "win32") child.unref();
    try {
      const file = path.join(root, name, "service.json");
      const signal = AbortSignal.timeout(5_000);
      // A BunFile retains stat information; discovery needs a fresh one after the daemon's atomic rename.
      while (!(await Bun.file(file).exists())) {
        signal.throwIfAborted();
        if (child.exitCode !== null) throw new Error(`PTY daemon exited during startup (${child.exitCode}).`);
        await Bun.sleep(25);
      }
      const registration = Schema.decodeUnknownSync(Registration)(await Bun.file(file).json());
      const owner = await exchange(registration, { op: "own", instance_id: registration.instance_id }, signal, child.pid, true);
      if (owner.response.type !== "owned") {
        owner.close();
        throw new Error(`Expected PTY ownership, received ${owner.response.type}.`);
      }
      return new PtyDaemon(registration, owner.close, child);
    } catch (error) {
      child.kill();
      await child.exited;
      throw error;
    }
  }

  async request(value: object, signal: AbortSignal) {
    if (this.process.exitCode !== null) throw new Error("PTY daemon exited. Reload the plugin to start fresh terminals.");
    return (await exchange(this.registration, value, signal, this.process.pid)).response;
  }

  async close() {
    // Owner loss is the daemon's normal shutdown path, including termination of every child PTY.
    this.releaseOwner();
    await this.process.exited;
  }
}

async function exchange(registration: typeof Registration.Type, request: object, signal: AbortSignal, expectedPid: number, keep = false) {
  const payload = Buffer.from(JSON.stringify({ token: registration.token, request }));
  if (payload.length > 8 * 1024 * 1024) throw new Error("PTY request exceeds the 8 MiB protocol limit.");
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length);
  payload.copy(frame, 4);

  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  cancellation.throwIfAborted();
  if (process.platform === "win32") {
    const { connect } = await import("./pipe.windows.ts");
    const pipe = await connect(registration.socket, expectedPid, cancellation);
    try {
      pipe.write(frame, cancellation);
      const length = (await pipe.read(4, cancellation)).readUInt32BE();
      if (length > 8 * 1024 * 1024) throw new Error("PTY response exceeds the 8 MiB protocol limit.");
      const response = decode(await pipe.read(length, cancellation));
      if (!keep) pipe.close();
      return { response, close: pipe.close };
    } catch (error) {
      pipe.close();
      throw error;
    }
  }

  const reply = Promise.withResolvers<{ response: Exclude<typeof Response.Type, { type: "error" }>; close: () => void }>();
  let connection: Bun.Socket<undefined> | undefined;
  let pending = Buffer.alloc(0);
  let sent = 0;
  const abort = () => {
    reply.reject(cancellation.reason);
    connection?.terminate();
  };
  const write = (socket: Bun.Socket<undefined>) => {
    sent += socket.write(frame.subarray(sent));
  };
  cancellation.addEventListener("abort", abort, { once: true });
  try {
    connection = await Bun.connect<undefined>({
      unix: registration.socket,
      socket: {
        open: write,
        drain: write,
        data(socket, data) {
          try {
            pending = Buffer.concat([pending, data]);
            if (pending.length < 4) return;
            const length = pending.readUInt32BE(0);
            if (length > 8 * 1024 * 1024) throw new Error("PTY response exceeds the 8 MiB protocol limit.");
            if (pending.length < length + 4) return;
            const response = decode(pending.subarray(4, length + 4));
            reply.resolve({ response, close: () => socket.terminate() });
            if (keep) socket.unref();
            if (!keep) socket.terminate();
          } catch (error) {
            reply.reject(error);
            socket.terminate();
          }
        },
        error(socket, error) {
          reply.reject(error);
          socket.terminate();
        },
        close() {
          reply.reject(new Error("PTY connection closed before a complete response. The operation may have run; inspect before retrying."));
        },
      },
    });
    if (cancellation.aborted) abort();
    return await reply.promise;
  } finally {
    cancellation.removeEventListener("abort", abort);
  }
}

function decode(payload: Buffer) {
  const response = Schema.decodeUnknownSync(Response)(JSON.parse(payload.toString("utf8")));
  if (response.type === "error") throw new Error(response.message);
  return response;
}
