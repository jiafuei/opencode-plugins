import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import RedactKeys from "./server.ts";

type Hook = (event: any) => Promise<void> | void;

const SECRET = "sk-ant-abcdefghijklmnopqrstuvwxyz0123";

async function instance(storage: Map<string, unknown>) {
  const hooks = new Map<string, Hook>();
  const events: unknown[] = [];
  let wake: (() => void) | undefined;
  const ctx = {
    options: {},
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
      remove: async (key: string) => { storage.delete(key); },
      scan: async ({ prefix }: { prefix: string }) => ({
        entries: [...storage].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
      }),
    },
    tool: { hook: async (name: string, callback: Hook) => { hooks.set(name, callback); } },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => (async function* () {
        while (!signal.aborted) {
          if (events.length > 0) yield events.shift();
          else await new Promise<void>((resolve) => { wake = resolve; signal.addEventListener("abort", () => resolve(), { once: true }); });
        }
      })(),
    },
  };
  const dispose = (await RedactKeys.setup(ctx as never))!;
  return {
    dispose,
    after: async (tool: string, input: unknown, content: string) => {
      const event = { tool, sessionID: "ses_a", input, status: "completed", result: { content } };
      await hooks.get("execute.after")!(event);
      return event.result.content;
    },
    before: async (tool: string, input: Record<string, string>) => {
      await hooks.get("execute.before")!({ tool, sessionID: "ses_a", input });
      return input;
    },
    deleteSession: async (sessionID: string) => {
      events.push({ type: "session.deleted", data: { sessionID } });
      wake?.();
      await Bun.sleep(10);
    },
  };
}

test("restores placeholders after a restart, redacts grep, and forgets deleted sessions", async () => {
  const dataHome = await mkdtemp("/tmp/redact-keys-test-");
  process.env.XDG_DATA_HOME = dataHome;
  const storage = new Map<string, unknown>();

  let app = await instance(storage);
  const read = await app.after("read", { path: "app/.env" }, `1: KEY=${SECRET}`);
  const placeholder = read.match(/<redacted_[0-9a-f]{8}>/)![0];
  expect(read).toBe(`1: KEY=${placeholder}`);
  expect(JSON.stringify([...storage.values()])).not.toContain(SECRET);

  const grep = await app.after("grep", {}, `app/.env:\n  Line 1: KEY=${SECRET}\n\nsrc/index.ts:\n  Line 3: const key = "${SECRET}"`);
  expect(grep).toBe(`app/.env:\n  Line 1: KEY=${placeholder}\n\nsrc/index.ts:\n  Line 3: const key = "${SECRET}"`);
  await app.dispose();

  app = await instance(storage);
  expect((await app.before("write", { path: "app/.env", content: `KEY=${placeholder}\n` })).content).toBe(`KEY=${SECRET}\n`);
  await expect(app.before("write", { path: "app/.env", content: "KEY=<redacted_00000000>\n" })).rejects.toThrow("Unknown redaction placeholder");

  await app.deleteSession("ses_a");
  expect(storage.size).toBe(0);
  await app.dispose();
  await rm(dataHome, { recursive: true, force: true });
});
