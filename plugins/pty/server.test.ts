import { expect, test } from "bun:test";
import type { Info, ToolContext } from "@opencode/plugin/promise/tool";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Pty from "./server.ts";
import { available } from "./daemon.ts";

test.skipIf(!available)("plugin controls a private interactive PTY, preserves final output, and shuts down its children", async () => {
  const directory = await mkdtemp(path.join(process.platform === "win32" ? tmpdir() : "/tmp/opencode", "pty-test-"));
  const fixture = path.join(import.meta.dir, "terminal.fixture.ts");
  const command = process.platform === "win32"
    ? `& '${process.execPath.replaceAll("'", "''")}' '${fixture.replaceAll("'", "''")}'`
    : `exec '${process.execPath.replaceAll("'", "'\\''")}' '${fixture.replaceAll("'", "'\\''")}'`;
  const tools = new Map<string, Info>();
  const approvals: unknown[] = [];
  let deny = true;
  const dispose = await Pty.setup({
    location: { directory },
    permission: {
      async assert(input: unknown) {
        approvals.push(input);
        if (deny) throw new Error("permission denied");
      },
    },
    tool: {
      async transform(callback: (editor: { namespace(): void; add(tool: Info): void }) => void) {
        callback({ namespace() {}, add(tool) { tools.set(tool.name, tool); } });
      },
    },
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      },
    },
  } as never);
  if (!dispose) throw new Error("PTY plugin did not load on a supported platform.");

  async function call(name: string, input: object, sessionID = "ses_pty_a", signal = new AbortController().signal) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Missing tool ${name}`);
    const result = await tool.execute(input, {
      sessionID, signal, agent: "build", messageID: "msg_pty_test", id: "call_pty_test",
    } as ToolContext);
    return result.output as Record<string, unknown>;
  }

  try {
    expect(tools.get("send")?.input).toHaveProperty("~standard.jsonSchema");
    await expect(call("start", { command: "echo should-not-run" })).rejects.toThrow("permission denied");
    expect((await call("list", {})).terminals).toEqual([]);
    deny = false;
    const started = await call("start", {
      command,
      env: { PTY_TEST: "interactive" },
      until: "60 300",
    });
    expect(started.status).toBe("running");
    expect(started.screen).toContain("ready:interactive");
    expect(started.screen).toContain("60 300");
    expect(started.screen).not.toContain("\x1b");
    expect((await call("list", {}, "ses_pty_b")).terminals).toEqual([]);
    await expect(call("send", { id: started.id, text: "wrong-session", keys: ["Enter"] }, "ses_pty_b")).rejects.toThrow("not found in this session");
    await expect(call("read", { id: started.id }, "ses_pty_b")).rejects.toThrow("not found in this session");
    await expect(call("close", { id: started.id }, "ses_pty_b")).rejects.toThrow("not found in this session");

    const sent = await call("send", { id: started.id, text: "hello", keys: ["Enter"], until: "value:hello" });
    expect(sent.waited).toBe("matched");
    expect(sent.screen).toContain("value:hello");
    expect(approvals).toHaveLength(2);
    await expect(call("send", { id: started.id, keys: ["constructor"] })).rejects.toThrow("Unknown terminal key");

    const held = await call("send", { id: started.id, text: "hold", keys: ["Enter"], until: "ready:interactive", timeoutMs: 200 });
    expect(held.screen).toContain("hold-requested");
    expect(held.waited).toBe("timeout");
    expect((await call("send", { id: started.id, text: "release", keys: ["Enter"], until: "ready:interactive" })).waited).toBe("matched");

    const flood = await call("send", { id: started.id, text: "flood", keys: ["Enter"], until: "flood-done" });
    expect(String(flood.screen).length).toBeLessThanOrEqual(12_000);
    expect(flood.omittedLines).toBeGreaterThan(0);
    expect(flood.screen).toContain("flood-done");

    expect((await call("read", { id: started.id, until: "never-produced", timeoutMs: 0 })).waited).toBe("timeout");
    await expect(call("read", { id: started.id, until: "never-produced" }, "ses_pty_a", AbortSignal.timeout(20))).rejects.toThrow();
    expect((await call("read", { id: started.id, timeoutMs: 0 })).status).toBe("running");

    const exited = await call("send", { id: started.id, text: "bye", keys: ["Enter"] });
    expect(exited.status).toBe("exited");
    expect(exited.exitCode).toBe(7);
    expect(exited.screen).toContain("done");
    expect((await call("read", { id: started.id })).screen).toContain("done");
    await call("close", { id: started.id });
    expect((await call("list", {})).terminals).toEqual([]);

    const cleanup = await call("start", { command, env: { PTY_TEST: "cleanup" }, until: "ready:cleanup" });
    const interrupted = await call("send", { id: cleanup.id, keys: ["Ctrl+C"], until: "interrupted" });
    expect(interrupted.screen).toContain("interrupted");
    expect(interrupted.status).toBe("running");
    expect((await call("send", { id: cleanup.id, text: "still-running", keys: ["Enter"], until: "value:still-running" })).screen).toContain("value:still-running");
    const pid = Number(await Bun.file(`${directory}/child.pid`).text());
    expect(() => process.kill(pid, 0)).not.toThrow();
    await dispose();
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    await dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test.skipIf(process.platform !== "win32")("rejects a Windows pipe with a mismatched server PID before sending input", async () => {
  const { createServer } = await import("node:net");
  const { connect } = await import("./pipe.windows.ts");
  let received = 0;
  const server = createServer((socket) => socket.on("data", (data) => { received += data.length; }));
  const name = `\\\\.\\pipe\\opencode-pty-test-${crypto.randomUUID()}`;
  await new Promise<void>((resolve) => server.listen(name, resolve));
  try {
    await expect(connect(name, 0, AbortSignal.timeout(5_000))).rejects.toThrow("not the spawned PTY daemon");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  expect(received).toBe(0);
});
