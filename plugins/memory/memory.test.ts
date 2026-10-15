import { afterAll, describe, expect, jest, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import MemoryModule, {
  dreamDue,
  indexLine,
  memoryProjectKey,
  parseIndex,
} from "./server.tsx";
import MemoryTui from "./tui.tsx";

// Keeps memory files away from the real data directory.
const dataHome = `/tmp/opencode/memory-test-${crypto.randomUUID()}`;
process.env.XDG_DATA_HOME = dataHome;
afterAll(() => rm(dataHome, { recursive: true, force: true }));

type WorkerCall = { prompt: string; model?: { providerID: string; id: string; variant?: string } };
type FakeMessage = { id: string; role: string; content: Array<{ type: string; text: string }> };
type DreamStatus = { requestID: string | null; runID: string; state: string; sessionID?: string; counts?: Record<string, number>; message?: string };
type Hook = (event: never) => Promise<void> | void;
type MemoryTool = { execute: (input: unknown, context: { sessionID: string; agent: string }) => Promise<{ content: string }> };
type Handlers = Record<string, (input: never) => Promise<unknown>>;
type Entry = {
  title: string;
  file: string;
  summary: string;
  type: string;
  updated: string;
  children?: Array<{ file: string; revision: string }>;
  supersededBy?: string;
};

async function fixture(
  directory: string,
  respond: (call: WorkerCall) => unknown,
  options: {
    reflect_model?: string;
    dream_model?: string;
    idle_delay_ms?: number;
    dream_topic_limit?: number;
  } = {},
  storage = new Map<string, unknown>(),
) {
  const calls: WorkerCall[] = [];
  const emitted: Array<{ name: string; data: Record<string, unknown> }> = [];
  const hooks = new Map<string, Hook>();
  const queue: unknown[] = [];
  const histories = new Map<string, unknown[]>();
  let wake: (() => void) | undefined;
  let handlers: Handlers = {};
  let tool: MemoryTool | undefined;
  const ctx = {
    location: { directory },
    options,
    generate: {
      text: async (input: WorkerCall) => {
        calls.push(input);
        return { text: JSON.stringify(await respond(input)) };
      },
    },
    rpc: {
      register: async (_definition: unknown, value: Handlers) => {
        handlers = value;
        return { events: { emit: async (name: string, data: Record<string, unknown>) => { emitted.push({ name, data }); } } };
      },
    },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
      remove: async (key: string) => { storage.delete(key); },
      scan: async ({ prefix, after, limit = 1000 }: { prefix: string; after?: string; limit?: number }) => {
        const keys = [...storage.keys()].filter((key) => key.startsWith(prefix) && (!after || key > after)).sort();
        const page = keys.slice(0, limit);
        return { entries: page.map((key) => ({ key, value: storage.get(key) })), next: keys.length > limit ? page.at(-1) : undefined };
      },
    },
    tool: { transform: async (callback: (editor: { add: (value: MemoryTool) => void }) => void) => callback({ add: (value) => { tool = value; } }) },
    session: {
      hook: async (name: string, callback: Hook) => { hooks.set(name, callback); },
      get: async ({ sessionID }: { sessionID: string }) => ({
        id: sessionID,
        ...(sessionID.startsWith("ses_sub") ? { parentID: "ses_parent" } : {}),
        metadata: sessionID.startsWith("ses_worker") ? { workflowWorkerID: "worker" } : {},
      }),
      context: async ({ sessionID }: { sessionID: string }) => histories.get(sessionID) ?? [],
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => (async function* () {
        while (!signal.aborted) {
          if (queue.length > 0) yield queue.shift();
          else await new Promise<void>((resolve) => { wake = resolve; signal.addEventListener("abort", () => resolve(), { once: true }); });
        }
      })(),
    },
  };
  const cleanup = (await MemoryModule.setup(ctx as never))!;
  return {
    calls,
    rpc: handlers,
    dispose: cleanup,
    statuses: () => emitted.flatMap((event) => event.name === "dream" ? [event.data as DreamStatus] : []),
    saved: () => emitted.flatMap((event) => event.name === "saved" ? [event.data] : []),
    errors: () => emitted.flatMap((event) => event.name === "error" ? [event.data] : []),
    save: (sessionID: string, input: Record<string, unknown>) => tool!.execute({ action: "save", ...input }, { sessionID, agent: "build" }),
    read: (sessionID: string, target: string) => tool!.execute({ action: "read", target }, { sessionID, agent: "build" }),
    search: (sessionID: string, query: string, offset?: number) => tool!.execute({ action: "search", query, ...(offset === undefined ? {} : { offset }) }, { sessionID, agent: "build" }),
    delete: (sessionID: string, target: string) => tool!.execute({ action: "delete", target }, { sessionID, agent: "build" }),
    history: (sessionID: string, messages: unknown[]) => histories.set(sessionID, messages),
    message: async (sessionID: string, text: string) => {
      const messageID = `msg_${crypto.randomUUID()}`;
      await hooks.get("prompt")!({ sessionID, messageID, prompt: { text }, delivery: "steer" } as never);
      return messageID;
    },
    context: async (sessionID: string, messages: FakeMessage[] = []) => {
      const event = { sessionID, agent: "build", tools: { memory: {} } as Record<string, unknown>, system: [] as Array<{ type: string; text: string }>, messages };
      await hooks.get("context")!(event as never);
      return event;
    },
    compaction: (sessionID: string) => hooks.get("compaction")!({ sessionID } as never),
    emit: async (type: string, sessionID: string) => {
      queue.push({ type, data: { sessionID } });
      wake?.();
      await settle();
    },
    dream: (requestID: string, sessionID?: string) => handlers.dream!({ requestID, sessionID } as never),
  };
}

const userMessage = (id: string, text = id): FakeMessage => ({ id, role: "user", content: [{ type: "text", text }] });

// Accessors for one project's markdown files and `memory/<projectKey>/`
// storage keys.
function memory(storage: Map<string, unknown>, directory: string) {
  const key = (suffix: string) => `memory/${memoryProjectKey(directory)}/${suffix}`;
  const root = join(dataHome, "opencode", "memory", memoryProjectKey(directory));
  const write = (file: string, text: string) => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, file), text);
  };
  return {
    key,
    get: (suffix: string) => storage.get(key(suffix)) as any,
    set: (suffix: string, value: unknown) => storage.set(key(suffix), value),
    index: () => existsSync(join(root, "index.md")) ? parseIndex(readFileSync(join(root, "index.md"), "utf8")) : [],
    setIndex: (entries: Entry[]) => write("index.md", entries.map((entry) => `${indexLine(entry as never)}\n`).join("")),
    topic: (file: string) => existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8").trim() : undefined,
    setTopic: (file: string, content: string) => write(file, `${content}\n`),
  };
}

function store(
  storage: Map<string, unknown>,
  directory: string,
  entries: { file: string; title?: string; summary?: string; content?: string; type?: string }[],
) {
  const project = memory(storage, directory);
  project.setIndex(entries.map((entry) => ({
    title: entry.title ?? entry.file,
    file: entry.file,
    summary: entry.summary ?? "Stored topic",
    type: entry.type ?? "recap",
    updated: "2026-08-01",
  })));
  for (const entry of entries) project.setTopic(entry.file, entry.content ?? `${entry.file} body`);
  return project;
}

type Extraction = {
  title: string;
  summary: string;
  type: string;
  content: string;
};

const memoryExtraction = (overrides: Partial<Extraction> = {}): Extraction => ({
  title: "Stored progress",
  summary: "A durable project outcome.",
  type: "recap",
  content: "The parser migration shipped and the focused suite passes.",
  ...overrides,
});

const noMemories = () => ({ memories: [] });

const isReflection = (call: WorkerCall) => call.prompt.startsWith("You are a project-memory reviewer");
const isDreamSelector = (call: WorkerCall) => call.prompt.startsWith("You are a project-memory consolidation selector");
const isDreamCurator = (call: WorkerCall) => call.prompt.startsWith("You are a project-memory curator");

async function until(condition: () => boolean | Promise<boolean>) {
  while (!(await condition())) await new Promise<void>((resolve) => setImmediate(resolve));
}

// Flush pending microtask and filesystem callbacks without waiting on real
// time (safe under fake timers), so background work settles.
async function settle() {
  for (let i = 0; i < 25; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("memory index lines", () => {
  test("renders and parses typed entries", () => {
    const entry = { title: "Typed", file: "typed.md", summary: "Be concise", type: "preference" as const, updated: "2026-08-01" };
    expect(indexLine(entry)).toBe("- [Typed](typed.md) - [preference|2026-08-01] Be concise");
    expect(parseIndex(`# Notes\n${indexLine(entry)}\n- [Loose](loose.md) - No prefix\n`)).toEqual([entry]);
  });
});

describe("memory persistence", () => {
  test.serial("memory tool saves a topic and queues its delta only for other sessions", async () => {
    const directory = "/tmp/memory-tool-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{ file: "first.md", title: "First", summary: "First summary", content: "first" }]);
    const app = await fixture(directory, noMemories, {}, storage);

    // Both sessions snapshot the index before the save.
    const before = await app.context("ses_origin");
    await app.context("ses_other");
    const result = await app.save("ses_origin", {
      title: "Focused tests first",
      summary: "Run the focused Bun test before the full suite.",
      content: "Run the affected plugin's focused Bun test before the full suite.",
      type: "instruction",
    });
    const file = result.content.replace("Saved ", "");
    expect(project.topic(file)).toBe("Run the affected plugin's focused Bun test before the full suite.");
    expect(indexLine(project.index()[0]!)).toStartWith(`- [Focused tests first](${file}) - [instruction|`);
    expect(app.saved()).toEqual([{ sessionID: "ses_origin", title: "Focused tests first" }]);

    const other = await app.message("ses_other", "Next.");
    const otherRequest = await app.context("ses_other", [userMessage(other)]);
    expect(otherRequest.messages[0]!.content[1]!.text).toContain(`Focused tests first [id: ${file}]`);

    const origin = await app.message("ses_origin", "Next.");
    const originRequest = await app.context("ses_origin", [userMessage(origin)]);
    expect(originRequest.messages[0]!.content).toHaveLength(1);
    expect(originRequest.system).toEqual(before.system);
    await app.dispose();
  });

  test.serial("memory tool reads topics and returns the current index for stale ids", async () => {
    const directory = "/tmp/memory-read-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{ file: "rule.md", title: "Rule", content: "Always run the focused suite.", type: "instruction" }]);
    const app = await fixture(directory, noMemories, {}, storage);
    expect((await app.read("ses_read", "rule.md")).content)
      .toContain("Always run the focused suite.");
    project.setIndex([{ file: "replacement.md", title: "Replacement", summary: "Current topic", type: "recap", updated: "2026-10-13" }]);
    project.setTopic("replacement.md", "Replacement detail");
    const stale = (await app.read("ses_read", "rule.md")).content;
    expect(stale).toContain("Replacement [id: replacement.md]");
    await app.dispose();
  });

  test.each([false, true])("deletes topics, including missing bodies, and updates live and resumed sessions (missing: %s)", async (missing) => {
    const directory = `/tmp/memory-delete-project-${missing}`;
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{ file: "rule.md", title: "Rule" }]);
    let app = await fixture(directory, noMemories, {}, storage);
    const before = await app.context("ses_dormant");
    await app.dispose();
    app = await fixture(directory, noMemories, {}, storage);
    try {
      await app.context("ses_origin");
      await app.context("ses_live");
      if (missing) await rm(join(dataHome, "opencode", "memory", memoryProjectKey(directory), "rule.md"));
      expect((await app.delete("ses_origin", "rule.md")).content).toStartWith("Deleted rule.md");
      expect(project.index()).toEqual([]);
      expect(project.topic("rule.md")).toBeUndefined();
      expect((await app.read("ses_origin", "rule.md")).content).toContain("The current memory index is empty.");

      for (const sessionID of ["ses_live", "ses_dormant"]) {
        const next = await app.message(sessionID, "Next.");
        const history = () => [userMessage(next)];
        const request = await app.context(sessionID, history());
        expect(request.system).toEqual(before.system);
        expect(request.messages[0]!.content[1]!.text).toContain("rule.md");
        expect((await app.context(sessionID, history())).messages).toEqual(request.messages);
      }
      const next = await app.message("ses_origin", "Next.");
      expect((await app.context("ses_origin", [userMessage(next)])).messages[0]!.content).toHaveLength(1);
    } finally {
      await app.dispose();
    }
  });

  test.serial("starts a dream when a save grows the index past the configured topic limit", async () => {
    const directory = "/tmp/memory-consolidation-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{ file: "a.md" }, { file: "b.md" }]);
    let selections = 0;
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return ++selections === 1
        ? { action: "synthesize", files: ["a.md", "b.md"], reason: "related topics" }
        : { action: "none" };
      if (isDreamCurator(call)) return memoryExtraction({ title: "Consolidated topic" });
      return noMemories();
    }, { dream_topic_limit: 2 }, storage);
    await app.save("ses_maintenance_writer", memoryExtraction({ title: "Threshold crossing" }));
    await until(() => app.statuses().some((status) => status.state === "changed"));
    await app.dispose();

    expect(project.topic("a.md")).toBe("a.md body");
    expect(project.topic("b.md")).toBe("b.md body");
    expect(app.statuses().at(-1)!.counts).toEqual({ synthesize: 1, prune: 0 });
  });

  test.each(["disabled", "backoff", "no-op", "rules"] as const)("size-triggered dreams respect %s", async (mode) => {
    const directory = `/tmp/memory-threshold-controls-${mode}`;
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "a.md", type: mode === "rules" ? "instruction" : "fact" },
      { file: "b.md", type: mode === "rules" ? "preference" : "fact" },
    ]);
    if (mode === "disabled") project.set("settings", { dream_auto: false });
    if (mode === "backoff") project.set("dream", { auto: true, additions: 0, since: Date.now(), failAt: Date.now() });
    const app = await fixture(directory, (call) => isDreamSelector(call) ? { action: "none" } : noMemories(), { dream_topic_limit: 2 }, storage);
    try {
      await app.save("ses_writer", memoryExtraction({ title: "Threshold detail", type: "fact" }));
      if (mode === "no-op") {
        await until(() => app.statuses().some((status) => status.state === "noop"));
        await app.save("ses_writer", memoryExtraction({ title: "Still above threshold", type: "fact" }));
      }
      await settle();
      expect(app.calls.filter(isDreamSelector)).toHaveLength(mode === "no-op" ? 1 : 0);
      if (mode === "disabled") {
        await app.dream("req-manual-disabled-auto");
        await until(() => app.statuses().some((status) => status.requestID === "req-manual-disabled-auto" && status.state === "noop"));
        expect(app.calls.filter(isDreamSelector)).toHaveLength(1);
      }
    } finally {
      await app.dispose();
    }
  });

  test.serial("gives restricted sessions inline rules and read-only access to hint topics", async () => {
    const directory = "/tmp/memory-system-context";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "first.md", title: "First", summary: "First summary", content: "FIRST_BODY" },
      { file: "second.md", title: "Second", summary: "Second summary", content: "SECOND_BODY", type: "instruction" },
      { file: "third.md", title: "Typed", summary: "Typed reference summary", content: "THIRD_BODY", type: "reference" },
      { file: "gone.md", title: "Gone", type: "instruction" },
    ]);
    // A hand-deleted topic file must not drop the other user-stated topics.
    await rm(join(dataHome, "opencode", "memory", memoryProjectKey(directory), "gone.md"));
    const app = await fixture(directory, noMemories, {}, storage);

    const output = await app.context("ses_index");
    expect(output.system[0]!.text).toContain("First [id: first.md] - [recap|2026-08-01] First summary");
    expect(output.system[0]!.text).not.toContain("FIRST_BODY");
    expect(output.tools.memory).toBeDefined();

    for (const sessionID of ["ses_sub", "ses_worker_1"]) {
      // Mutation denial also applies before the session's first context hook.
      await expect(app.save(sessionID, memoryExtraction())).rejects.toThrow("cannot save or delete memories");
      await expect(app.delete(sessionID, "first.md")).rejects.toThrow("cannot save or delete memories");
      const restricted = await app.context(sessionID);
      expect(restricted.system[0]!.text).toContain("SECOND_BODY");
      expect(restricted.system[0]!.text).not.toContain("id: gone.md");
      expect(restricted.system[0]!.text).toContain("First [id: first.md]");
      expect(restricted.system[0]!.text).toContain("Typed [id: third.md]");
      expect(restricted.system[0]!.text).not.toContain("FIRST_BODY");
      expect(restricted.tools.memory).toMatchObject({ input: {
        properties: { action: { enum: ["read", "search"] } }, required: ["action"],
      } });
      expect((await app.read(sessionID, "first.md")).content).toContain("FIRST_BODY");
      expect((await app.search(sessionID, "FIRST_BODY")).content).toContain("first.md");
    }

    project.setIndex([{ title: "Third", file: "third.md", summary: "Third summary", type: "recap", updated: "2026-08-01" }]);
    expect((await app.context("ses_index")).system).toEqual(output.system);
    expect((await app.context("ses_new")).system[0]!.text).toContain("Third summary");

    await app.dispose();
  });

  test.serial("freezes deltas at the first request of a user message and defers mid-turn saves", async () => {
    const directory = "/tmp/memory-freeze-project";
    const app = await fixture(directory, noMemories);

    const third = await app.message("ses_freeze", "Three.");
    // First request for this message: nothing committed yet, nothing injected.
    expect((await app.context("ses_freeze", [userMessage(third)])).messages[0]!.content).toHaveLength(1);

    // Another session's save commits mid-turn; it must not be injected into the same message.
    await app.save("ses_writer", memoryExtraction({ title: "Deferred rule", type: "instruction" }));
    expect((await app.context("ses_freeze", [userMessage(third)])).messages[0]!.content).toHaveLength(1);

    // A synthetic latest user message never receives the pending delta.
    const synthetic = await app.context("ses_freeze", [userMessage(third), userMessage("msg_synthetic")]);
    expect(synthetic.messages.map((message) => message.content.length)).toEqual([1, 1]);

    // The next genuine user message receives the frozen delta.
    const fourth = await app.message("ses_freeze", "Four.");
    const request = await app.context("ses_freeze", [userMessage(third), userMessage(fourth)]);
    expect(request.messages[1]!.content).toHaveLength(2);
    expect(request.messages[1]!.content[1]!.text).toStartWith("<system>\n<memory_update>");
    expect(request.messages[1]!.content[1]!.text).toContain("Deferred rule");

    // History is rebuilt for each request; the delta is injected again.
    const again = await app.context("ses_freeze", [userMessage(third), userMessage(fourth)]);
    expect(again.messages[1]!.content[1]!.text).toBe(request.messages[1]!.content[1]!.text);
    await app.dispose();
  });

  test.serial("disabling removes memory context without consuming changes or rewriting frozen updates", async () => {
    const directory = "/tmp/memory-disabled-updates-project";
    const storage = new Map<string, unknown>();
    const project = memory(storage, directory);
    const app = await fixture(directory, noMemories, {}, storage);
    try {
      const before = await app.context("ses_reader");
      await app.save("ses_writer", memoryExtraction({ title: "Pending rule" }));
      project.set("settings", { enabled: false });
      const disabledTurn = await app.message("ses_reader", "Next.");
      const disabled = await app.context("ses_reader", [userMessage(disabledTurn)]);
      expect(disabled.system).toEqual([]);
      expect(disabled.tools.memory).toBeUndefined();
      expect(disabled.messages[0]!.content).toHaveLength(1);
      const child = await app.context("ses_sub");
      expect(child.tools.memory).toBeUndefined();
      await expect(app.read("ses_sub", "missing.md")).rejects.toThrow("Project memory is disabled");
      await expect(app.search("ses_sub", "Pending")).rejects.toThrow("Project memory is disabled");

      project.set("settings", { enabled: true });
      expect((await app.context("ses_reader", [userMessage(disabledTurn)])).messages[0]!.content).toHaveLength(1);
      const next = await app.message("ses_reader", "Next enabled turn.");
      const history = () => [userMessage(disabledTurn), userMessage(next)];
      const request = await app.context("ses_reader", history());
      expect(request.system).toEqual(before.system);
      expect(request.messages[1]!.content[1]!.text).toContain("Pending rule");
      project.set("settings", { enabled: false });
      expect((await app.context("ses_reader", history())).messages.map((message) => message.content.length)).toEqual([1, 1]);
      project.set("settings", { enabled: true });
      expect((await app.context("ses_reader", history())).messages).toEqual(request.messages);
    } finally {
      await app.dispose();
    }
  });

  test.serial("restores the identical system block and frozen delta after a restart, and refreshes after compaction", async () => {
    const directory = "/tmp/memory-restore-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{ file: "first.md", title: "First", summary: "First summary", content: "first" }]);
    let app = await fixture(directory, noMemories, {}, storage);

    const initial = await app.context("ses_restore");
    await app.save("ses_writer", memoryExtraction({ title: "Restored rule", type: "instruction" }));
    const next = await app.message("ses_restore", "Next.");
    const history = () => [userMessage("msg_old"), userMessage(next)];
    const request = await app.context("ses_restore", history());
    await app.dispose();

    // The index file changes; the restored session still renders its snapshot.
    project.setIndex([{ title: "Changed", file: "changed.md", summary: "Changed summary", type: "recap", updated: "2026-08-01" }]);
    project.setTopic("changed.md", "Changed detail");
    app = await fixture(directory, noMemories, {}, storage);
    const restored = await app.context("ses_restore", history());
    expect(restored.system).toEqual(initial.system);
    expect(restored.messages).toEqual(request.messages);

    await app.compaction("ses_restore");
    const compacted = await app.context("ses_restore", history());
    expect(compacted.system[0]!.text).toContain("Changed summary");
    expect(compacted.messages[1]!.content).toHaveLength(1);
    await app.dispose();
  });

  test.serial("reflection commits a returned memory and advances its cursor", async () => {
    const directory = "/tmp/memory-reflect-project";
    const storage = new Map<string, unknown>();
    const app = await fixture(directory, (call) => isReflection(call)
      ? { memories: [{ ...memoryExtraction({ title: "Login investigation", type: "working", content: "Status: tentative. The user suspects the shared Redis fixture; this is not confirmed." }) }] }
      : noMemories(), { idle_delay_ms: 1000, reflect_model: "test/small#low" }, storage);
    const assistant = (id: string, text: string) => ({
      id, type: "assistant", content: [
        { type: "text", text },
        { type: "tool", name: "bash", state: { status: "completed", input: { command: "bun test" }, content: [{ type: "text", text: "TOOL_OUTPUT" }] } },
      ],
    });
    await app.context("ses_reflect");
    app.history("ses_reflect", [
      { id: "msg_1", type: "user", text: "I suspect the shared Redis fixture makes the login test flaky; not confirmed yet." },
      assistant("msg_2", "I will investigate fixture isolation."),
    ]);

    try {
      jest.useFakeTimers();
      await app.emit("session.execution.succeeded", "ses_reflect");
      jest.advanceTimersByTime(1000);
      await until(() => app.saved().length === 1);
      await settle();
      expect(app.calls).toHaveLength(1);
      expect(app.calls[0]!.model).toEqual({ providerID: "test", id: "small", variant: "low" });
      expect(app.calls[0]!.prompt).toContain("I suspect the shared Redis fixture");
      expect(app.calls[0]!.prompt).toContain("I will investigate fixture isolation.");
      expect(app.calls[0]!.prompt).not.toContain("TOOL_OUTPUT");
      const next = await app.message("ses_reflect", "Continue.");
      expect((await app.context("ses_reflect", [userMessage(next)])).messages[0]!.content[1]!.text).toContain("Login investigation [id:");

      // Only messages after the cursor are reviewed; the earlier save is listed.
      app.history("ses_reflect", [
        { id: "msg_1", type: "user", text: "I suspect the shared Redis fixture makes the login test flaky; not confirmed yet." },
        assistant("msg_2", "I will investigate fixture isolation."),
        { id: "msg_3", type: "user", text: "Thanks, now rename the helper." },
      ]);
      await app.emit("session.execution.succeeded", "ses_reflect");
      jest.advanceTimersByTime(1000);
      await until(() => app.calls.length === 2);
      await settle();
      expect(app.calls[1]!.prompt).toContain("Thanks, now rename the helper.");
      expect(app.calls[1]!.prompt).not.toContain("I suspect the shared Redis fixture");
      expect(app.calls[1]!.prompt).toContain("- Login investigation (login-investigation-");
    } finally {
      jest.useRealTimers();
    }
    expect(memory(storage, directory).index()[0]!).toMatchObject({ title: "Login investigation", type: "working" });
    await app.dispose();
  });

  test.serial("notifies existing sessions of body-only edits without rewriting their cached snapshot", async () => {
    const directory = "/tmp/memory-body-delta-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{ file: "detail.md", title: "Editable detail", content: "Before edit" }]);
    const app = await fixture(directory, noMemories, {}, storage);
    try {
      const before = await app.context("ses_reader");
      await app.read("ses_reader", "detail.md");
      project.setTopic("detail.md", "After edit");
      const next = await app.message("ses_reader", "Continue.");
      const updated = await app.context("ses_reader", [userMessage(next)]);
      expect(updated.system).toEqual(before.system);
      expect(updated.messages[0]!.content[1]!.text).toContain("Editable detail [id: detail.md]");
      expect(updated.messages[0]!.content[1]!.text).toContain("reread");
      expect((await app.read("ses_reader", "detail.md")).content).toContain("After edit");
    } finally {
      await app.dispose();
    }
  });

  test.serial("allows correcting retained history when its replacement was explicitly deleted", async () => {
    const directory = "/tmp/memory-deleted-replacement-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{ file: "original.md", content: "Original fact", type: "fact" }]);
    const app = await fixture(directory, noMemories, {}, storage);
    try {
      const replacement = (await app.save("ses_editor", { target: "original.md", ...memoryExtraction({ title: "Replacement", type: "fact" }) })).content.replace("Saved ", "");
      await app.delete("ses_editor", replacement);
      expect((await app.context("ses_before_recovery")).system[0]!.text).not.toContain("[id: original.md]");
      const recovered = (await app.save("ses_editor", { target: "original.md", ...memoryExtraction({ title: "Recovered fact", type: "fact", content: "Explicitly corrected fact" }) })).content.replace("Saved ", "");
      expect(project.topic("original.md")).toBe("Original fact");
      expect(project.index().find((entry) => entry.file === "original.md")!.supersededBy).toBe(recovered);
      expect((await app.context("ses_recovered")).system[0]!.text).toContain(`[id: ${recovered}]`);
    } finally {
      await app.dispose();
    }
  });

  test.serial("paginates literal search so retained details beyond the first page remain reachable", async () => {
    const directory = "/tmp/memory-search-pages-project";
    const storage = new Map<string, unknown>();
    store(storage, directory, Array.from({ length: 25 }, (_, index) => ({ file: `detail-${index}.md`, content: "A literal [shared] detail" })));
    const app = await fixture(directory, noMemories, {}, storage);
    try {
      const first = (await app.search("ses_sub", "literal [shared]")).content;
      expect(first).toContain("[id: detail-19.md]");
      expect(first).not.toContain("[id: detail-24.md]");
      expect(first).toContain("offset: 20");
      const second = (await app.search("ses_sub", "literal [shared]", 20)).content;
      expect(second).toContain("[id: detail-24.md]");
      expect(second).not.toContain("[id: detail-0.md]");
    } finally {
      await app.dispose();
    }
  });

  test.serial("reflection reads folded details before applying an explicit user correction", async () => {
    const directory = "/tmp/memory-reflection-correction-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "plan.md", type: "working", content: "Status: tentative. Use shared Redis fixtures." },
      { file: "context.md", content: "The user needs isolated test runs." },
    ]);
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "synthesize", files: ["plan.md", "context.md"], reason: "Fixture context" };
      if (isDreamCurator(call)) return memoryExtraction({ title: "Fixture context summary" });
      if (!isReflection(call)) return noMemories();
      if (!call.prompt.includes("<read_details>")) return { read: ["missing.md", "plan.md"], memories: [] };
      expect(call.prompt).toContain("Status: tentative. Use shared Redis fixtures.");
      return { read: ["another-round.md"], memories: [
        { target: "unread.md", ...memoryExtraction({ title: "Unread correction", type: "fact" }) },
        { target: "plan.md", ...memoryExtraction({ title: "Fixture plan", type: "fact", content: "Status: decided. Use isolated Redis fixtures." }) },
      ] };
    }, { idle_delay_ms: 1000 }, storage);
    try {
      await app.dream("req-reflection-context");
      await until(() => app.statuses().some((status) => status.state === "changed"));
      await app.context("ses_reflection_correction");
      app.history("ses_reflection_correction", [{ id: "msg_1", type: "user", text: "The fixture plan is decided: use isolated Redis fixtures instead of shared ones." }]);
      jest.useFakeTimers();
      await app.emit("session.execution.succeeded", "ses_reflection_correction");
      jest.advanceTimersByTime(1000);
      await until(() => app.saved().length === 1);
      const original = project.index().find((entry) => entry.file === "plan.md")!;
      expect(project.topic("plan.md")).toContain("Status: tentative");
      expect(project.topic(original.supersededBy!)).toContain("Status: decided");
      expect(project.index().find((entry) => entry.file === original.supersededBy)!.type).toBe("working");
      await until(() => app.errors().length === 1);
      expect(app.errors()[0]!.message).toContain("Skipped unread correction target");
      await until(() => (storage.get("session/ses_reflection_correction") as { cursor?: string }).cursor === "msg_1");
      const next = await app.message("ses_reflection_correction", "Continue.");
      expect((await app.context("ses_reflection_correction", [userMessage(next)])).messages[0]!.content[1]!.text).toContain(`Fixture plan [id: ${original.supersededBy}]`);
    } finally {
      jest.useRealTimers();
      await app.dispose();
    }
  });

  test.serial("toggles one setting and preserves the others", async () => {
    const directory = "/tmp/memory-toggle-project";
    const storage = new Map<string, unknown>();
    const project = memory(storage, directory);
    project.set("settings", { enabled: false, custom: "keep" });
    const app = await fixture(directory, noMemories, {}, storage);
    await app.rpc.toggle!({ key: "dream_auto" } as never);
    expect(project.get("settings")).toEqual({ enabled: false, custom: "keep", dream_auto: false });
    await app.dispose();
  });
});

describe("memory dreaming configuration", () => {
  test("gates auto dreaming on both the interval window and the minimum additions", () => {
    const now = 1_000_000_000_000;
    const options = { intervalHours: 36, minAdditions: 7 };
    expect(dreamDue(now, { additions: 7, since: now - 36 * 3_600_000 }, options)).toBe(true);
    // Interval elapsed but too few additions.
    expect(dreamDue(now, { additions: 6, since: now - 40 * 3_600_000 }, options)).toBe(false);
    // Enough additions but the window is fresh.
    expect(dreamDue(now, { additions: 9, since: now - 1 * 3_600_000 }, options)).toBe(false);
    expect(dreamDue(now, { additions: 9, since: now - 40 * 3_600_000, failAt: now - 60_000 }, options)).toBe(false);
  });
});

describe("memory auto dreaming", () => {
  test.serial("initializes additions from the indexed topic count when auto is first enabled", async () => {
    const directory = "/tmp/memory-dream-init-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "one.md", title: "One" },
      { file: "two.md", title: "Two" },
      { file: "three.md", title: "Three" },
    ]);
    const app = await fixture(directory, () => noMemories(), {}, storage);
    await app.message("ses_auto_init", "Use memory.");
    await until(() => project.get("dream") !== undefined);
    await app.dispose();

    expect(project.get("dream")).toMatchObject({ auto: true, additions: 3 });
    expect(app.calls.filter(isDreamSelector)).toHaveLength(0);
  });

  test.serial("resets counters after a due no-op run", async () => {
    const directory = "/tmp/memory-dream-gate-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "one.md", title: "One" },
      { file: "two.md", title: "Two" },
    ]);
    project.set("dream", { auto: true, additions: 7, since: Date.now() - 37 * 3_600_000 });
    const app = await fixture(directory, (call) => (isDreamSelector(call) ? { action: "none" } : noMemories()), {}, storage);
    await app.message("ses_gate", "Use memory.");
    await until(() => app.statuses().some((status) => status.state === "noop"));
    await app.dispose();

    const state = project.get("dream");
    expect(state.additions).toBe(0);
    expect(typeof state.lastRunAt).toBe("number");
  });
});

describe("memory manual dreaming", () => {
  const finished = (app: Awaited<ReturnType<typeof fixture>>, state: string, requestID?: string) =>
    until(() => app.statuses().some((status) => status.state === state && (!requestID || status.requestID === requestID)));

  test.serial("handles an rpc request without another message", async () => {
    const directory = "/tmp/memory-dream-rpc-project";
    const storage = new Map<string, unknown>();
    store(storage, directory, [
      { file: "x.md", title: "X" },
      { file: "y.md", title: "Y" },
    ]);
    const app = await fixture(
      directory,
      (call) => isDreamSelector(call) ? { action: "none" } : noMemories(),
      { dream_model: "test/deep-model#deep" },
      storage,
    );

    await app.dream("req-rpc", "ses_rpc");
    await finished(app, "noop", "req-rpc");
    expect(app.statuses()[0]).toMatchObject({ requestID: "req-rpc", state: "running", sessionID: "ses_rpc" });
    const dreamCall = app.calls.filter(isDreamSelector);
    expect(dreamCall).toHaveLength(1);
    expect(dreamCall[0]!.model).toEqual({ providerID: "test", id: "deep-model", variant: "deep" });

    await app.dispose();
  });

  test.serial("fails a dream whose worker never answers", async () => {
    const directory = "/tmp/memory-dream-timeout-project";
    const storage = new Map<string, unknown>();
    store(storage, directory, [{ file: "a.md" }, { file: "b.md" }]);
    const app = await fixture(directory, (call) => isDreamSelector(call) ? new Promise(() => {}) : noMemories(), {}, storage);
    try {
      jest.useFakeTimers();
      await app.dream("req-timeout");
      await until(() => app.calls.some(isDreamSelector));
      jest.advanceTimersByTime(5 * 60_000);
      await until(() => app.statuses().some((status) => status.state !== "running"));
      expect(app.statuses().at(-1)).toMatchObject({ state: "failed", message: expect.stringContaining("timed out") });
    } finally {
      jest.useRealTimers();
      await app.dispose();
    }
  });

  test.serial("retains missing-file metadata without exposing it as active or dreaming over it", async () => {
    const directory = "/tmp/memory-dream-missing-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "missing.md", title: "Missing" },
      { file: "a.md", title: "Alpha" },
      { file: "b.md", title: "Beta" },
    ]);
    await rm(join(dataHome, "opencode", "memory", memoryProjectKey(directory), "missing.md"));
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) {
        expect(call.prompt).not.toContain("missing.md");
        return { action: "synthesize", files: ["a.md", "b.md"], reason: "shared pattern" };
      }
      return memoryExtraction({ title: "Merged", content: "Combined facts" });
    }, {}, storage);

    try {
      await app.dream("req-missing");
      await until(() => app.statuses().some((status) => status.state !== "running"));
      const status = app.statuses().at(-1)!;
      expect(status).toMatchObject({ state: "changed", counts: { synthesize: 1, prune: 0 } });
      expect(project.index().map((entry) => entry.file)).toContain("missing.md");
      expect((await app.context("ses_missing")).system[0]!.text).not.toContain("[id: missing.md]");
      expect(project.get(`dreams/${status.runID}`).orphans).toEqual(["missing.md"]);
      const output = project.index().find((entry) => entry.file.startsWith("merged-"))!;
      expect(project.topic(output.file)).toBe("Combined facts");
      expect(project.topic("a.md")).toBe("a.md body");
      expect(project.topic("b.md")).toBe("b.md body");
    } finally {
      await app.dispose();
    }
  });

  test.serial("builds recursive summaries while retaining searchable source details", async () => {
    const directory = "/tmp/memory-dream-run-project";
    const sourceBody = Array.from({ length: 600 }, (_, i) => `Observation ${i}: the shared pattern has this condition and qualification.`).join("\n");
    const synthesizedBody = Array.from({ length: 80 }, (_, i) => `- Fact ${i}: retain its distinct condition and qualification.`).join("\n");
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "a.md", title: "Alpha plan", summary: "Alpha summary", content: "ALPHA_BODY_ONE [shared] duplicate fact" },
      { file: "b.md", title: "Alpha variant", summary: "Alpha variant summary", content: "ALPHA_BODY_TWO shared duplicate fact" },
      { file: "c.md", title: "Gamma outcome", summary: "Gamma summary", content: "GAMMA_BODY outdated claim" },
      { file: "d.md", title: "Delta note", summary: "Delta summary", content: sourceBody, type: "insight" },
    ]);

    const findPrefix = (prefix: string) => project.index().find((entry) => entry.file.startsWith(prefix))!.file;
    let selections = 0;
    let curations = 0;
    const app = await fixture(directory, async (call) => {
      if (isDreamSelector(call)) {
        selections += 1;
        if (selections === 1) return { action: "synthesize", files: ["a.md", "b.md"], reason: "duplicate alpha recaps" };
        if (selections === 2) return { action: "synthesize", files: [findPrefix("merged-alpha-"), "c.md"], reason: "corrected gamma outcome" };
        if (selections === 3) return { action: "synthesize", files: [findPrefix("superseding-gamma-"), "d.md"], reason: "shared stable pattern" };
        return { action: "none" };
      }
      if (isDreamCurator(call)) {
        curations += 1;
        if (curations === 1) return memoryExtraction({ title: "Merged alpha" });
        if (curations === 2) return memoryExtraction({ title: "Superseding gamma" });
        expect(call.prompt).toContain(sourceBody);
        return memoryExtraction({ title: "Cross-topic insight", content: synthesizedBody });
      }
      return noMemories();
    }, {}, storage);

    await app.dream("req-big", "ses_dreamer");
    await finished(app, "changed");
    const status = app.statuses().at(-1)!;
    const manifest = project.get(`dreams/${status.runID}`);
    const merged = manifest.actions[0].output.file as string;
    const superseded = manifest.actions[1].output.file as string;
    const insight = manifest.actions[2].output.file as string;
    await app.dispose();
    const reader = await fixture(directory, noMemories, {}, storage);
    for (const retained of ["a.md", "b.md", "c.md", "d.md", merged, superseded]) expect(project.topic(retained)).toBeDefined();
    const roots = (await reader.context("ses_roots")).system[0]!.text;
    expect(roots).toContain(`[id: ${insight}]`);
    expect(roots).not.toContain(`[id: ${merged}]`);
    expect(roots).not.toContain("[id: a.md]");
    expect((await reader.read("ses_reader", insight)).content).toContain(superseded);
    expect((await reader.read("ses_reader", superseded)).content).toContain(merged);
    expect((await reader.read("ses_reader", merged)).content).toContain("a.md");
    expect((await reader.read("ses_reader", "a.md")).content).toContain("ALPHA_BODY_ONE");
    expect((await reader.search("ses_sub", "ALPHA_BODY_ONE [shared]")).content).toContain("a.md");

    expect(project.index()[0]!.type).toBe("insight");
    expect(project.topic(insight)).toBe(synthesizedBody);
    expect(status.counts).toEqual({ synthesize: 3, prune: 0 });
    expect(JSON.stringify(manifest)).not.toContain("ALPHA_BODY");
    await reader.dispose();
  });

  test.each(["correction", "body edit", "metadata edit", "delete", "unfold"] as const)("invalidates summary ancestors after %s without losing sibling details", async (change) => {
    const directory = `/tmp/memory-hierarchy-invalidation-${change}`;
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "a.md", title: "Alpha", content: "Original alpha detail", type: "fact" },
      { file: "b.md", title: "Beta", content: "Beta detail", type: "working" },
      { file: "c.md", title: "Gamma", content: "Gamma detail" },
      { file: "rule.md", title: "Rule", content: "Keep instructions precise", type: "instruction" },
    ]);
    let selections = 0;
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) {
        expect(call.prompt).not.toContain("[id: rule.md]");
        if (++selections === 1) return { action: "synthesize", files: ["a.md", "b.md"], reason: "related details" };
        const first = project.index().find((entry) => entry.children?.some((child) => child.file === "a.md"))!;
        return selections === 2
          ? { action: "synthesize", files: [first.file, "c.md"], reason: "broader pattern" }
          : { action: "none" };
      }
      if (isDreamCurator(call)) return memoryExtraction({ title: `Layer ${selections}`, content: `Summary layer ${selections}` });
      return noMemories();
    }, {}, storage);

    try {
      await app.dream("req-invalidation");
      await finished(app, "changed");
      const first = project.index().find((entry) => entry.title === "Layer 1")!;
      const second = project.index().find((entry) => entry.title === "Layer 2")!;
      await expect(app.save("ses_editor", { target: first.file, ...memoryExtraction() })).rejects.toThrow();
      let replacement: string | undefined;
      if (change === "correction") {
        replacement = (await app.save("ses_editor", { target: "a.md", ...memoryExtraction({ title: "Corrected alpha", content: "Corrected alpha detail", type: "fact" }) })).content.replace("Saved ", "");
        expect(project.topic("a.md")).toBe("Original alpha detail");
        expect((await app.read("ses_reader", "a.md")).content).toContain(replacement);
      } else if (change === "body edit") {
        project.set("settings", { enabled: false });
        project.setTopic("a.md", "Manually corrected alpha");
        await app.rpc.state!({} as never);
        expect(project.index().find((entry) => entry.file === first.file)!.retired).not.toBe(true);
        project.set("settings", { enabled: true });
      }
      else if (change === "metadata edit") project.setIndex(project.index().map((entry) => entry.file === "a.md" ? { ...entry, summary: "Changed alpha metadata" } : entry));
      else await app.delete("ses_editor", change === "delete" ? "a.md" : first.file);

      const roots = (await app.context("ses_roots")).system[0]!.text;
      expect(roots).not.toContain(`[id: ${first.file}]`);
      expect(roots).not.toContain(`[id: ${second.file}]`);
      expect(roots).toContain("[id: b.md]");
      expect(roots).toContain("[id: c.md]");
      expect(roots).toContain("[id: rule.md]");
      expect(project.topic("b.md")).toBe("Beta detail");
      if (replacement) expect(roots).toContain(`[id: ${replacement}]`);
      if (change === "delete") {
        expect(project.topic("a.md")).toBeUndefined();
        expect(project.topic(first.file)).toBeUndefined();
        expect(project.topic(second.file)).toBeUndefined();
        expect((await app.search("ses_reader", "Original alpha detail")).content).not.toContain("a.md");
      } else if (change !== "correction") expect(roots).toContain("[id: a.md]");
      if (change === "body edit") {
        project.setTopic("a.md", "Original alpha detail");
        const reverted = (await app.context("ses_reverted")).system[0]!.text;
        expect(reverted).not.toContain(`[id: ${first.file}]`);
        expect(project.index().find((entry) => entry.file === second.file)!.retired).toBe(true);
      }
    } finally {
      await app.dispose();
    }
  });

  test.each([
    { action: "synthesize", change: "body" },
    { action: "synthesize", change: "metadata" },
  ])("aborts stale $action after a $change change without resetting the counters", async ({ action, change }) => {
    const directory = `/tmp/memory-dream-stale-project-${action}-${change}`;
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "x.md", title: "X topic", summary: "X summary", content: "X_SHARED_BODY" },
      { file: "y.md", title: "Y topic", summary: "Y summary", content: "Y_SHARED_BODY" },
    ]);
    project.set("dream", { auto: true, additions: 3, since: Date.now() });

    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<unknown>();
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action, files: ["x.md", "y.md"], reason: "duplicate topics" };
      if (isDreamCurator(call)) {
        started.resolve();
        return gate.promise;
      }
      return noMemories();
    }, {}, storage);

    await app.dream("req-stale", "ses_dreamer");
    await started.promise;
    // Metadata-only edits must invalidate the snapshot just like body edits.
    if (change === "body") project.setTopic("x.md", "X_MUTATED_BODY");
    else await app.save("ses_editor", { target: "x.md", ...memoryExtraction({ title: "New instruction", type: "instruction", content: "X_SHARED_BODY" }) });
    gate.resolve(memoryExtraction({ title: "Merged xy" }));
    await until(() => app.statuses().some((status) => status.state !== "running"));
    await app.dispose();

    const status = app.statuses().at(-1)!;
    expect(status.state).toBe("failed");
    expect(status.message).toContain("changed");
    expect(project.topic("x.md")).toBe(change === "body" ? "X_MUTATED_BODY" : "X_SHARED_BODY");
    if (change === "metadata") expect(project.index().find((entry) => entry.file === "x.md")!.supersededBy).toBeDefined();
    expect(project.topic("y.md")).toBe("Y_SHARED_BODY");
    expect(project.get(`dreams/${status.runID}`).state).toBe("failed");
    const state = project.get("dream");
    expect(state.additions).toBe(change === "body" ? 3 : 4);
    expect(typeof state.failAt).toBe("number");
  });

  test.serial("broadcasts summary root changes without making retained source ids unreadable", async () => {
    const directory = "/tmp/memory-dream-delta-project";
    const storage = new Map<string, unknown>();
    store(storage, directory, [
      { file: "x.md", title: "X topic", summary: "X summary", content: "X_DELTA_BODY" },
      { file: "y.md", title: "Y topic", summary: "Y summary", content: "Y_DELTA_BODY" },
    ]);
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "synthesize", files: ["x.md", "y.md"], reason: "duplicate topics" };
      if (isDreamCurator(call)) return memoryExtraction({ title: "Unified story" });
      return noMemories();
    }, {}, storage);

    // Live sessions snapshot first, so their delta queues exist before the dream.
    const messages = new Map<string, string>();
    for (const sessionID of ["ses_one", "ses_two", "ses_three"]) {
      await app.context(sessionID);
      messages.set(sessionID, await app.message(sessionID, "Hello."));
    }
    await app.dream("req-broadcast", "ses_three");
    await finished(app, "changed");
    for (const [sessionID, messageID] of messages) {
      const part = (await app.context(sessionID, [userMessage(messageID)])).messages[0]!.content[1]!;
      expect(part.text).toContain("- Unified story [id:");
      expect(part.text).toContain("x.md");
      expect(part.text).toContain("y.md");
      expect(part.text).not.toContain("Discard any cached references");
    }
    expect((await app.read("ses_one", "x.md")).content).toContain("X_DELTA_BODY");
    await app.dispose();
  });

  test.serial("keeps additions recorded while a dream was running", async () => {
    const directory = "/tmp/memory-dream-keep-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "x.md", title: "X topic", summary: "X summary", content: "X_KEEP_BODY" },
      { file: "y.md", title: "Y topic", summary: "Y summary", content: "Y_KEEP_BODY" },
    ]);
    project.set("dream", { auto: true, additions: 4, since: Date.now() });

    const curatorGate = Promise.withResolvers<Extraction>();
    const curatorStarted = Promise.withResolvers<void>();
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "synthesize", files: ["x.md", "y.md"], reason: "duplicate topics" };
      if (isDreamCurator(call)) {
        curatorStarted.resolve();
        return curatorGate.promise;
      }
      return noMemories();
    }, {}, storage);

    await app.dream("req-keep", "ses_keep");
    await curatorStarted.promise;
    // An ordinary save commits while the dream is parked mid-run.
    await app.save("ses_keep", memoryExtraction({ title: "Saved during the dream" }));
    expect(project.get("dream").additions).toBe(5);
    curatorGate.resolve(memoryExtraction({ title: "Merged keep" }));
    await finished(app, "changed");
    await app.dispose();

    // Only the pre-dream baseline (4) is subtracted; the concurrent save (+1)
    // survives completion.
    expect(project.get("dream").additions).toBe(1);
  });
});

type Toast = { variant?: string; title?: string; message: string };

async function tuiFixture(
  directory: string,
  options: {
    route?: { type: string; sessionID?: string };
    sessions?: string[];
    topics?: Array<{ file: string; title: string; summary: string; status: string; children: string[]; supersedes: string[]; parent?: string }>;
    choices?: Array<{ type: string; file?: string }>;
  } = {},
) {
  const toasts: Toast[] = [];
  const handlers = new Map<string, (event: { data: Record<string, unknown> }) => void>();
  const claims: Array<{ append?: string; render: (input: unknown) => unknown }> = [];
  const commands: Array<{ slash?: { name: string }; run: () => void }> = [];
  const requests: Array<{ requestID: string; sessionID?: string }> = [];
  const dialogs: Array<{ title: string; options: Array<{ title: string; description?: string; value: { type: string; file?: string } }> }> = [];
  const choices = [...options.choices ?? []];
  const sessions = new Set(options.sessions ?? []);
  const ctx = {
    location: { directory },
    theme: { text: { base: "white", muted: "gray", feedback: { warning: { base: "yellow" } } } },
    data: { session: { get: (id: string) => sessions.has(id) ? { id } : undefined } },
    client: {
      rpc: () => ({
        state: async () => ({ enabled: true, dream_auto: true, directory, topics: options.topics ?? [] }),
        dream: async (input: { requestID: string; sessionID?: string }) => {
          requests.push(input);
          return {};
        },
        events: {
          on: (name: string, handler: (event: { data: Record<string, unknown> }) => void) => {
            handlers.set(name, handler);
            return () => handlers.delete(name);
          },
        },
      }),
    },
    keymap: { layer: (layer: () => { commands: typeof commands }) => commands.push(...layer().commands) },
    ui: {
      toast: { show: (toast: Toast) => toasts.push(toast) },
      dialog: {
        select: async (dialog: typeof dialogs[number]) => { dialogs.push(dialog); return choices.shift(); },
        clear: () => {},
      },
      router: { current: () => options.route ?? { type: "home" } },
      slot: (claim: (typeof claims)[number]) => {
        claims.push(claim);
        return () => {};
      },
    },
  };
  const cleanup = (await MemoryTui.setup(ctx as never))!;
  for (const claim of claims) if (claim.append === "app") claim.render({});
  return {
    toasts,
    requests,
    dialogs,
    command: (name: string) => commands.find((command) => command.slash?.name === name)!.run(),
    emit: (name: string, data: Record<string, unknown>) => handlers.get(name)!({ data }),
    dispose: cleanup,
  };
}

describe("memory tui notifications", () => {
  test.serial("starts with active records and lets users browse retained sources and their parent", async () => {
    const app = await tuiFixture("/tmp/memory-tui-hierarchy", {
      topics: [
        { file: "summary.md", title: "Fixture summary", summary: "Fixture overview", status: "active", children: ["detail.md"], supersedes: [] },
        { file: "detail.md", title: "Fixture detail", summary: "Detailed constraint", status: "consolidated", children: [], supersedes: ["old.md"], parent: "summary.md" },
        { file: "old.md", title: "Older fixture detail", summary: "Earlier constraint", status: "superseded", children: [], supersedes: [] },
      ],
      choices: [{ type: "history" }, { type: "topic", file: "summary.md" }, { type: "topic", file: "detail.md" }],
    });
    try {
      app.command("memory");
      await until(() => app.dialogs.length === 4);
      expect(app.dialogs[0]!.options.filter((option) => option.value.type === "topic").map((option) => option.title)).toEqual(["Fixture summary"]);
      expect(app.dialogs[1]!.options.find((option) => option.title === "Fixture detail")!.description).toContain("In Fixture summary");
      expect(app.dialogs[2]!.options.some((option) => option.title === "Source: Fixture detail")).toBe(true);
      expect(app.dialogs[3]!.options.some((option) => option.title === "Parent summary: Fixture summary")).toBe(true);
      expect(app.dialogs[3]!.options.some((option) => option.title === "Earlier version: Older fixture detail")).toBe(true);
      expect(app.dialogs[3]!.options.find((option) => option.value.type === "edit")!.description).toContain("Saving changes retires");
    } finally {
      await app.dispose();
    }
  });

  test.serial("toasts changed dreams and warns only the manual requester about failures", async () => {
    const app = await tuiFixture("/tmp/memory-tui-dream-status", { route: { type: "session", sessionID: "ses_parent" } });
    app.command("dream");
    await until(() => app.requests.length === 1);
    const requestID = app.requests[0]!.requestID;

    app.emit("dream", { requestID: null, runID: "run-other", state: "failed", message: "other failure" });
    app.emit("dream", { requestID: null, runID: "run-auto", state: "changed", counts: { synthesize: 1, prune: 0 } });
    app.emit("dream", { requestID, runID: "run-failed", state: "failed", sessionID: "ses_parent", message: "worker timed out" });
    expect(app.toasts.map((toast) => toast.message)).toEqual(["Dreaming...", "Dream complete: 1 synthesized", "Dream failed: worker timed out"]);
    await app.dispose();
  });

  test.serial("toasts reviews and saves only for sessions this TUI knows", async () => {
    const app = await tuiFixture("/tmp/memory-tui-project", { sessions: ["ses_parent"] });

    app.emit("review", { sessionID: "ses_parent" });
    app.emit("review", { sessionID: "ses_other" });
    app.emit("saved", { sessionID: "ses_other", title: "Other topic" });
    app.emit("saved", { sessionID: "ses_parent", title: "Saved topic" });
    app.emit("error", { message: "Memory context failed: invalid catalog metadata" });
    expect(app.toasts.map((toast) => toast.message)).toEqual(["Reviewing conversation...", "Saved: Saved topic", "Memory context failed: invalid catalog metadata"]);
    await app.dispose();
  });
});
