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
type Entry = { title: string; file: string; summary: string; type: string; updated: string };

async function fixture(
  directory: string,
  respond: (call: WorkerCall) => unknown,
  options: {
    reflect_model?: string;
    dream_model?: string;
    idle_delay_ms?: number;
    dream_interval_hours?: number;
    dream_min_additions?: number;
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
    save: (sessionID: string, input: Record<string, unknown>) => tool!.execute({ action: "save", ...input }, { sessionID, agent: "build" }),
    read: (sessionID: string, target: string) => tool!.execute({ action: "read", target }, { sessionID, agent: "build" }),
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
    const legacy = "- [Legacy](legacy.md) - [recap|editor|2026-08-02] Old scope";
    expect(indexLine(entry)).toBe("- [Typed](typed.md) - [preference|2026-08-01] Be concise");
    expect(parseIndex(`# Notes\n${indexLine(entry)}\n${legacy}\n- [Loose](loose.md) - No prefix\n`)).toEqual([
      entry,
      { title: "Legacy", file: "legacy.md", summary: "Old scope", type: "recap", updated: "2026-08-02" },
    ]);
  });
});

describe("memory persistence", () => {
  test.serial("exports the plugin-storage store to markdown files once", async () => {
    const directory = "/tmp/memory-export-project";
    const unrelated = { system: "<memory>other project</memory>", pending: [], frozen: [], saved: [] };
    const entry = { title: "Typed", file: "typed-a1b2c3d4", summary: "Run focused tests", type: "instruction", updated: "2026-08-02" };
    const cached = "<memory>cached index</memory>";
    const storage = new Map<string, unknown>([
      ["session/ses_other_project", unrelated],
      ["session/ses_migrated", { system: cached, pending: [], frozen: [["msg_existing", [[entry.file, entry]]]], saved: [] }],
    ]);
    const project = memory(storage, directory);
    project.set("index", [entry]);
    project.set("topic/typed-a1b2c3d4", { content: "Run the focused suite first.", type: "instruction", scope: "testing", revision: "abc", updatedAt: "2026-08-02" });
    project.set("settings", { dream_auto: true });
    const app = await fixture(directory, noMemories, {}, storage);
    const next = await app.message("ses_migrated", "Next.");
    const request = await app.context("ses_migrated", [userMessage("msg_existing"), userMessage(next)]);
    expect(request.system).toEqual([{ type: "text", text: cached }]);
    expect(request.messages[0]!.content[1]!.text).toBe(`<memory_update>
These index changes supersede matching entries in the <memory> index; the same guidance applies.

- [Typed](typed-a1b2c3d4) - [instruction|2026-08-02] Run focused tests
</memory_update>`);
    expect(request.messages[1]!.content).toHaveLength(1);
    expect((await app.read("ses_migrated", entry.file)).content).toContain("Run the focused suite first.");
    await app.dispose();

    expect(project.index()).toEqual([
      { title: "Typed", file: "typed-a1b2c3d4.md", summary: "Run focused tests", type: "instruction", updated: "2026-08-02" },
    ]);
    expect(project.topic("typed-a1b2c3d4.md")).toBe("Run the focused suite first.");
    expect(project.get("index")).toBeUndefined();
    expect(project.get(`topic/${entry.file}`)).toBeUndefined();
    expect(storage.get("session/ses_other_project")).toEqual(unrelated);
  });

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
    expect(otherRequest.messages[0]!.content[1]!.text).toContain(`- [Focused tests first](${file})`);

    const origin = await app.message("ses_origin", "Next.");
    const originRequest = await app.context("ses_origin", [userMessage(origin)]);
    expect(originRequest.messages[0]!.content).toHaveLength(1);
    expect(originRequest.system).toEqual(before.system);
    await app.dispose();
  });

  test.serial("memory tool reads a topic body with its header", async () => {
    const directory = "/tmp/memory-read-project";
    const storage = new Map<string, unknown>();
    store(storage, directory, [{ file: "rule.md", title: "Rule", content: "Always run the focused suite.", type: "instruction" }]);
    const app = await fixture(directory, noMemories, {}, storage);
    expect((await app.read("ses_read", "rule.md")).content)
      .toBe("Rule\ntype: instruction | updated: 2026-08-01\n\nAlways run the focused suite.");
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
      expect((await app.delete("ses_origin", "rule.md")).content).toBe("Deleted rule.md");
      expect(project.index()).toEqual([]);
      expect(project.topic("rule.md")).toBeUndefined();
      await expect(app.read("ses_origin", "rule.md")).rejects.toThrow("Memory index does not contain rule.md");

      for (const sessionID of ["ses_live", "ses_dormant"]) {
        const next = await app.message(sessionID, "Next.");
        const history = () => [userMessage(next)];
        const request = await app.context(sessionID, history());
        expect(request.system).toEqual(before.system);
        expect(request.messages[0]!.content[1]!.text).toContain("Removed topics: rule.md");
        expect((await app.context(sessionID, history())).messages).toEqual(request.messages);
      }
      const next = await app.message("ses_origin", "Next.");
      expect((await app.context("ses_origin", [userMessage(next)])).messages[0]!.content).toHaveLength(1);
    } finally {
      await app.dispose();
    }
  });

  test.serial("uses the dream engine to synthesize complete sources above the size threshold", async () => {
    const directory = "/tmp/memory-consolidation-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, Array.from({ length: 201 }, (_, index) => ({
      file: `topic-${index}.md`,
      content: `COMPLETE_START_${index}\n${"x".repeat(80)}\nCOMPLETE_END_${index}`,
    })));
    let consolidationPrompt = "";
    let selections = 0;
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return ++selections === 1
        ? { action: "synthesize", files: ["topic-0.md", "topic-1.md"], reason: "related topics" }
        : { action: "none" };
      if (isDreamCurator(call)) {
        consolidationPrompt = call.prompt;
        return memoryExtraction({ title: "Consolidated topic" });
      }
      return noMemories();
    }, {}, storage);
    await app.save("ses_maintenance_writer", memoryExtraction({ title: "Threshold crossing" }));
    await until(() => app.statuses().some((status) => status.state === "changed"));
    await app.dispose();

    expect(consolidationPrompt).toContain("COMPLETE_END_0");
    expect(consolidationPrompt).toContain("COMPLETE_END_1");
    const output = project.index().find((entry) => entry.file.startsWith("consolidated-topic-"))!;
    expect(project.topic("topic-0.md")).toBeUndefined();
    expect(project.topic("topic-1.md")).toBeUndefined();
    expect(app.statuses().at(-1)!.counts).toEqual({ synthesize: 1, prune: 0 });
  });

  test.serial("adds the index to primary context and user-stated topics inline to restricted sessions", async () => {
    const directory = "/tmp/memory-system-context";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "first.md", title: "First", summary: "First summary", content: "FIRST_BODY" },
      { file: "second.md", title: "Second", summary: "Second summary", content: "SECOND_BODY", type: "instruction" },
      { file: "third.md", title: "Typed", summary: "Typed reference summary", content: "THIRD_BODY", type: "reference" },
    ]);
    const app = await fixture(directory, noMemories, {}, storage);

    const output = await app.context("ses_index");
    expect(output.system[0]!.text).toContain("[First](first.md) - [recap|2026-08-01] First summary");
    expect(output.system[0]!.text).toContain("[Typed](third.md) - [reference|2026-08-01] Typed reference summary");
    expect(output.system[0]!.text).not.toContain("FIRST_BODY");
    expect(output.tools.memory).toBeDefined();

    for (const restricted of [await app.context("ses_sub"), await app.context("ses_worker_1")]) {
      expect(restricted.system[0]!.text).toContain("[Second](second.md)");
      expect(restricted.system[0]!.text).toContain("SECOND_BODY");
      expect(restricted.system[0]!.text).not.toContain("(first.md)");
      expect(restricted.system[0]!.text).not.toContain("(third.md)");
      expect(restricted.tools.memory).toBeUndefined();
    }

    project.setIndex([{ title: "Third", file: "third.md", summary: "Third summary", type: "recap", updated: "2026-08-01" }]);
    expect((await app.context("ses_index")).system).toEqual(output.system);
    expect((await app.context("ses_new")).system[0]!.text).toContain("Third summary");

    project.set("settings", { enabled: false });
    expect((await app.context("ses_index")).system).toEqual([]);
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
      ? { memories: [{ ...memoryExtraction({ title: "Redis fixture diagnosis" }) }] }
      : noMemories(), { idle_delay_ms: 1000, reflect_model: "test/small#low" }, storage);
    const assistant = (id: string, text: string, output: string) => ({
      id, type: "assistant", content: [
        { type: "text", text },
        { type: "tool", name: "bash", state: { status: "completed", input: { command: "bun test" }, content: [{ type: "text", text: output }] } },
      ],
    });
    await app.context("ses_reflect");
    app.history("ses_reflect", [
      { id: "msg_1", type: "user", text: "Why is the login test flaky?" },
      assistant("msg_2", "The shared Redis fixture leaks state.", `START${"x".repeat(5000)}END`),
    ]);

    try {
      jest.useFakeTimers();
      await app.emit("session.execution.succeeded", "ses_reflect");
      jest.advanceTimersByTime(1000);
      await until(() => app.saved().length === 1);
      await settle();
      expect(app.calls).toHaveLength(1);
      expect(app.calls[0]!.model).toEqual({ providerID: "test", id: "small", variant: "low" });
      expect(app.calls[0]!.prompt).toContain("Why is the login test flaky?");
      expect(app.calls[0]!.prompt).toContain("The shared Redis fixture leaks state.");
      expect(app.calls[0]!.prompt).toContain("START");
      expect(app.calls[0]!.prompt).not.toContain("END");

      // Only messages after the cursor are reviewed; the earlier save is listed.
      app.history("ses_reflect", [
        { id: "msg_1", type: "user", text: "Why is the login test flaky?" },
        assistant("msg_2", "The shared Redis fixture leaks state.", "ok"),
        { id: "msg_3", type: "user", text: "Thanks, now rename the helper." },
      ]);
      await app.emit("session.execution.succeeded", "ses_reflect");
      jest.advanceTimersByTime(1000);
      await until(() => app.calls.length === 2);
      await settle();
      expect(app.calls[1]!.prompt).toContain("Thanks, now rename the helper.");
      expect(app.calls[1]!.prompt).not.toContain("Why is the login test flaky?");
      expect(app.calls[1]!.prompt).toContain("- Redis fixture diagnosis (redis-fixture-diagnosis-");
    } finally {
      jest.useRealTimers();
    }
    expect(memory(storage, directory).index()[0]!.title).toBe("Redis fixture diagnosis");
    await app.dispose();
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
    project.set("settings", { dream_auto: true });
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
    project.set("settings", { dream_auto: true });
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

  test.serial("continues dreaming with available topics when an indexed file is missing", async () => {
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
      expect(app.statuses().at(-1)).toMatchObject({ state: "changed", counts: { synthesize: 1, prune: 0 } });
      const output = project.index().find((entry) => entry.file.startsWith("merged-"))!;
      expect(project.topic(output.file)).toBe("Combined facts");
      expect(project.topic("a.md")).toBeUndefined();
      expect(project.topic("b.md")).toBeUndefined();
    } finally {
      await app.dispose();
    }
  });

  test.serial("synthesizes complete replacements across iterations without source history", async () => {
    const directory = "/tmp/memory-dream-run-project";
    const sourceBody = Array.from({ length: 600 }, (_, i) => `Observation ${i}: the shared pattern has this condition and qualification.`).join("\n");
    const synthesizedBody = Array.from({ length: 80 }, (_, i) => `- Fact ${i}: retain its distinct condition and qualification.`).join("\n");
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "a.md", title: "Alpha plan", summary: "Alpha summary", content: "ALPHA_BODY_ONE shared duplicate fact" },
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
    await app.dispose();

    const status = app.statuses().at(-1)!;
    const manifest = project.get(`dreams/${status.runID}`);
    const merged = manifest.actions[0].output.file as string;
    const superseded = manifest.actions[1].output.file as string;
    const insight = manifest.actions[2].output.file as string;
    for (const gone of ["a.md", "b.md", "c.md", "d.md", merged, superseded]) expect(project.topic(gone)).toBeUndefined();
    expect(project.index().map((entry) => entry.file)).toEqual([insight]);

    expect(project.index()[0]!.type).toBe("insight");
    expect(project.topic(insight)).toBe(synthesizedBody);
    for (const action of manifest.actions) expect(action.sources).toBeUndefined();

    expect(status.counts).toEqual({ synthesize: 3, prune: 0 });
    expect(JSON.stringify(manifest)).not.toContain("ALPHA_BODY");
  });

  test.serial("prunes a singleton into quarantine with evidence", async () => {
    const directory = "/tmp/memory-dream-prune-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{
      file: "receipt.md",
      title: "Completed cleanup",
      summary: "Cleanup receipt",
      content: "The cleanup commit landed and tests pass.",
    }]);
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "prune", files: ["receipt.md"], reason: "task receipt" };
      if (isDreamCurator(call)) {
        return { verdicts: [{
          file: "receipt.md",
          verdict: "remove",
          category: "task_receipt",
          reason: "Only records completed cleanup and passing tests.",
          evidence: ["plugins/memory/memory.test.ts"],
        }] };
      }
      return noMemories();
    }, {}, storage);

    await app.dream("req-prune", "ses_prune");
    await finished(app, "changed");
    await app.dispose();

    const status = app.statuses().at(-1)!;
    expect(project.topic("receipt.md")).toBeUndefined();
    expect(project.get(`trash/${status.runID}/receipt.md`).content).toContain("cleanup commit landed");
    expect(project.index()).toEqual([]);
    expect(project.get(`dreams/${status.runID}`).actions[0].verdicts[0]).toMatchObject({
      file: "receipt.md",
      verdict: "remove",
      evidence: ["plugins/memory/memory.test.ts"],
      quarantinePath: `trash/${status.runID}/receipt.md`,
    });
  });

  test.serial("safely keeps evidence-less removals and does not reselect all-kept nominations", async () => {
    const directory = "/tmp/memory-dream-prune-keep-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "a.md", title: "A", content: "Potentially durable rationale." },
      { file: "b.md", title: "B", content: "Another durable constraint." },
    ]);
    let selectors = 0;
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) {
        selectors += 1;
        if (selectors === 1) return { action: "prune", files: ["a.md"], reason: "verify repository state" };
        expect(call.prompt).not.toContain("(a.md)");
        return { action: "none" };
      }
      if (isDreamCurator(call)) return { verdicts: [{
        file: "a.md",
        verdict: "remove",
        category: "repo_recoverable_state",
        reason: "Probably visible in the repository.",
        evidence: [],
      }] };
      return noMemories();
    }, {}, storage);

    await app.dream("req-keep", "ses_keep");
    await finished(app, "noop");
    await app.dispose();

    expect(project.topic("a.md")).toBeDefined();
    expect(project.get(`dreams/${app.statuses().at(-1)!.runID}`).actions[0].verdicts[0]).toMatchObject({ file: "a.md", verdict: "keep" });
  });

  test.serial("purges successful older quarantine only after a later successful run", async () => {
    const directory = "/tmp/memory-dream-trash-retention-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{ file: "old.md", content: "Task receipt." }]);

    let app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "prune", files: ["old.md"], reason: "receipt" };
      if (isDreamCurator(call)) return { verdicts: [{ file: "old.md", verdict: "remove", category: "task_receipt", reason: "Receipt only.", evidence: [] }] };
      return noMemories();
    }, {}, storage);
    await app.dream("req-trash-1", "ses_trash");
    await finished(app, "changed");
    const firstRun = app.statuses().at(-1)!.runID;
    await app.dispose();
    expect(project.get(`trash/${firstRun}/old.md`)).toBeDefined();

    store(storage, directory, [{ file: "new.md", title: "New", content: "Still durable." }]);

    app = await fixture(directory, (call) => isDreamSelector(call) ? { action: "prune", files: [], reason: "malformed" } : noMemories(), {}, storage);
    await app.dream("req-trash-2", "ses_trash");
    await finished(app, "failed");
    await app.dispose();
    expect(project.get(`trash/${firstRun}/old.md`)).toBeDefined();

    // Quarantine without a successful manifest is kept.
    project.set("trash/unfinished-run/recoverable", { content: "quarantined" });

    app = await fixture(directory, (call) => isDreamSelector(call) ? { action: "none" } : noMemories(), {}, storage);
    await app.dream("req-trash-3", "ses_trash");
    await finished(app, "noop");
    await app.dispose();
    expect(project.get(`trash/${firstRun}/old.md`)).toBeUndefined();
    expect(project.get("trash/unfinished-run/recoverable")).toBeDefined();
  });

  test.each([
    { action: "synthesize", change: "body" },
    { action: "synthesize", change: "metadata" },
    { action: "prune", change: "body" },
    { action: "prune", change: "metadata" },
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
    gate.resolve(action === "synthesize" ? memoryExtraction({ title: "Merged xy" }) : { verdicts: ["x.md", "y.md"].map((file) => ({
      file, verdict: "remove", category: "task_receipt", reason: "Receipt", evidence: [],
    })) });
    await until(() => app.statuses().some((status) => status.state !== "running"));
    await app.dispose();

    const status = app.statuses().at(-1)!;
    expect(status.state).toBe("failed");
    expect(status.message).toContain("changed");
    expect(project.topic("x.md")).toBe(change === "body" ? "X_MUTATED_BODY" : "X_SHARED_BODY");
    if (change === "metadata") expect(project.index().find((entry) => entry.file === "x.md")!.type).toBe("instruction");
    expect(project.topic("y.md")).toBe("Y_SHARED_BODY");
    expect(project.get(`dreams/${status.runID}`).state).toBe("failed");
    const state = project.get("dream");
    expect(state.additions).toBe(change === "body" ? 3 : 4);
    expect(typeof state.failAt).toBe("number");
  });

  test.serial("broadcasts upsert and tombstone deltas to all live sessions", async () => {
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
    await app.dispose();

    for (const [sessionID, messageID] of messages) {
      const part = (await app.context(sessionID, [userMessage(messageID)])).messages[0]!.content[1]!;
      expect(part.text).toContain("- [Unified story](");
      expect(part.text).toContain("Removed topics: x.md, y.md");
    }
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
  options: { route?: { type: string; sessionID?: string }; sessions?: string[] } = {},
) {
  const toasts: Toast[] = [];
  const handlers = new Map<string, (event: { data: Record<string, unknown> }) => void>();
  const claims: Array<{ append?: string; render: (input: unknown) => unknown }> = [];
  const commands: Array<{ slash?: { name: string }; run: () => void }> = [];
  const requests: Array<{ requestID: string; sessionID?: string }> = [];
  const selections: Array<(value: unknown) => void> = [];
  const sessions = new Set(options.sessions ?? []);
  const ctx = {
    location: { directory },
    theme: { text: { base: "white", muted: "gray", feedback: { warning: { base: "yellow" } } } },
    data: { session: { get: (id: string) => sessions.has(id) ? { id } : undefined } },
    client: {
      rpc: () => ({
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
      dialog: { select: () => new Promise((resolve) => selections.push(resolve)), clear: () => {} },
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
    command: (name: string) => commands.find((command) => command.slash?.name === name)!.run(),
    select: async (value: unknown) => {
      await until(() => selections.length > 0);
      selections.shift()!(value);
    },
    emit: (name: string, data: Record<string, unknown>) => handlers.get(name)!({ data }),
    dispose: cleanup,
  };
}

describe("memory tui notifications", () => {
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
    expect(app.toasts.map((toast) => toast.message)).toEqual(["Reviewing conversation...", "Saved: Saved topic"]);
    await app.dispose();
  });
});
