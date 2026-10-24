import { afterAll, describe, expect, jest, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import MemoryModule, { dreamDue } from "./server.tsx";
import { indexLine, parseIndex } from "./store.ts";
import MemoryTui from "./tui.tsx";
import { importMemoryPartition, memoryProjectKey, memoryScopeRoot, openMemoryStore } from "./scope.ts";

// Keeps memory files away from the real data directory.
const dataHome = `/tmp/opencode/memory-test-${crypto.randomUUID()}`;
process.env.XDG_DATA_HOME = dataHome;
afterAll(() => rm(dataHome, { recursive: true, force: true }));

type WorkerCall = { prompt: string; model?: { providerID: string; id: string; variant?: string } };
type FakeMessage = { id: string; role: string; content: Array<{ type: string; text: string }> };
type DreamStatus = { requestID: string | null; runID: string; state: string; sessionID?: string; counts?: Record<string, number>; message?: string };
type Hook = (event: never) => Promise<void> | void;
type MemoryTool = { name: string; execute: (input: unknown, context: { sessionID: string; agent: string }) => Promise<{ content: string }> };
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
    dream_target?: number;
    canonical?: string;
  } = {},
  storage = new Map<string, unknown>(),
) {
  const calls: WorkerCall[] = [];
  const emitted: Array<{ name: string; data: Record<string, unknown> }> = [];
  const hooks = new Map<string, Hook>();
  const queue: unknown[] = [];
  const histories = new Map<string, unknown[]>();
  let sourceID = 0;
  const withSource = (sessionID: string, input: Record<string, unknown>) => {
    if (input.source_message_ids) return input;
    const id = `msg_source_${String(++sourceID).padStart(4, "0")}`;
    histories.set(sessionID, [...(histories.get(sessionID) ?? []), { id, type: "user", text: input.content, time: { created: Date.UTC(2026, 7, 1) } }]);
    return { ...input, source_message_ids: [id] };
  };
  let wake: (() => void) | undefined;
  let handlers: Handlers = {};
  const tools: Record<string, MemoryTool> = {};
  const ctx = {
    location: { directory, project: { id: "test-project", directory, canonical: options.canonical ?? directory } },
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
    tool: { transform: async (callback: (editor: { add: (value: MemoryTool) => void }) => void) => callback({ add: (value) => { tools[value.name] = value; } }) },
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
    save: (sessionID: string, input: Record<string, unknown>) => tools.memory_save!.execute(withSource(sessionID, input), { sessionID, agent: "build" }),
    correct: (sessionID: string, id: string, input: Record<string, unknown>) => tools.memory_correct!.execute(withSource(sessionID, { id, ...input }), { sessionID, agent: "build" }),
    read: (sessionID: string, id: string) => tools.memory_read!.execute({ id }, { sessionID, agent: "build" }),
    search: (sessionID: string, query: string, offset?: number, all_projects?: boolean, include_history?: boolean) => tools.memory_search!.execute({ query, ...(offset === undefined ? {} : { offset }), all_projects, include_history }, { sessionID, agent: "build" }),
    delete: (sessionID: string, id: string) => tools.memory_delete!.execute({ id }, { sessionID, agent: "build" }),
    history: (sessionID: string, messages: Array<{ id: string; type: string; time?: { created: number } } & Record<string, unknown>>) => histories.set(sessionID, messages.map((message) => ({ time: { created: Date.UTC(2026, 7, 1) }, ...message }))),
    message: async (sessionID: string, text: string) => {
      const messageID = `msg_${crypto.randomUUID()}`;
      await hooks.get("prompt")!({ sessionID, messageID, prompt: { text }, delivery: "steer" } as never);
      return messageID;
    },
    context: async (sessionID: string, messages: FakeMessage[] = []) => {
      const event = { sessionID, agent: "build", tools: { ...tools } as Record<string, unknown>, system: [] as Array<{ type: string; text: string }>, messages };
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
  hook: string;
  type: string;
  content: string;
};

const memoryExtraction = (overrides: Partial<Extraction> = {}): Extraction => ({
  title: "Stored progress",
  hook: "A durable project outcome.",
  type: "recap",
  content: "The parser migration shipped and the focused suite passes.",
  ...overrides,
});

const noMemories = () => ({ create: [], correct: [] });

const isReflection = (call: WorkerCall) => call.prompt.startsWith("You are a project-memory reviewer");
const isReflectionSelector = (call: WorkerCall) => call.prompt.startsWith("You are a project-memory reflection selector");
const isDreamSelector = (call: WorkerCall) => call.prompt.startsWith("You are a project-memory consolidation selector");
const isDreamCurator = (call: WorkerCall) => call.prompt.startsWith("You are a project-memory curator");

describe("memory scopes", () => {
  test.serial("manual dreaming visits both scopes without combining their sources", async () => {
    const directory = "/tmp/scoped-memory-dream";
    const storage = new Map<string, unknown>();
    const files = ["one.md", "two.md", "three.md"];
    const project = store(storage, directory, files.map((file) => ({ file, content: `project evidence ${file}` })));
    const central = join(dataHome, "opencode", "memory");
    const global = openMemoryStore(central, "global");
    for (const file of files) await global.writeTopic(file, `global evidence ${file}`);
    await global.writeIndex(files.map((file) => ({ title: file, file, summary: "Global evidence", type: "reference" as const, updated: "2026-10-16" })));
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "synthesize", files, reason: "Related evidence" };
      const globalScope = call.prompt.includes("global evidence one");
      expect(call.prompt.includes("project evidence one")).toBe(!globalScope);
      return { title: globalScope ? "Global summary" : "Project summary", hook: "Evidence", content: globalScope ? "global evidence" : "project evidence" };
    }, {}, storage);
    try {
      await app.dream("req-scoped-dream");
      await until(() => app.statuses().some((status) => status.state !== "running"));
      const status = app.statuses().at(-1)!;
      expect(status.state).toBe("changed");
      expect(status.counts!.synthesize).toBe(2);
      const globalSummary = (await global.readCatalog()).find((entry) => entry.children)!;
      const projectSummary = project.index().find((entry) => entry.children)!;
      expect(globalSummary.title).toBe("Global summary");
      expect(projectSummary.title).toBe("Project summary");
      expect(globalSummary.children!.map((child) => child.file)).toEqual(files);
      expect(projectSummary.children!.map((child) => child.file)).toEqual(files);
      const state = await app.rpc.state!({} as never) as { topics: Array<{ file: string; scope: string; path: string; children: string[]; parent?: string }> };
      const globalTopic = state.topics.find((entry) => entry.file === `global:${globalSummary.file}`)!;
      expect(globalTopic).toMatchObject({ scope: "global", path: join(memoryScopeRoot(central, "global"), globalSummary.file), children: files.map((file) => `global:${file}`) });
      expect(state.topics.find((entry) => entry.file === "global:one.md")!.parent).toBe(`global:${globalSummary.file}`);
      expect(state.topics.find((entry) => entry.file === projectSummary.file)!.scope).toBe("project");
    } finally {
      await app.dispose();
      await rm(memoryScopeRoot(central, "global"), { recursive: true, force: true });
    }
  });

  test.serial("worktrees share canonical memory while global and explicit cross-project IDs stay distinct", async () => {
    const storage = new Map<string, unknown>();
    const canonical = "/tmp/scoped-memory-main";
    const otherDirectory = "/tmp/scoped-memory-other";
    const project = store(storage, canonical, [{ file: "shared.md", content: "scopeprobe project" }]);
    const other = store(storage, otherDirectory, [{ file: "shared.md", content: "scopeprobe other" }]);
    const central = join(dataHome, "opencode", "memory");
    const global = openMemoryStore(central, "global");
    await global.writeTopic("shared.md", "scopeprobe global");
    await global.writeIndex([{ title: "General", file: "shared.md", summary: "General preference", type: "preference", updated: "2026-10-16" }]);
    const main = await fixture(canonical, noMemories, {}, storage);
    const worktree = await fixture("/tmp/scoped-memory-worktree", noMemories, { canonical }, storage);
    try {
      const injected = (await worktree.context("ses_sub_scopes")).system[0]!.text;
      expect(injected).toContain("scopeprobe global");
      expect(injected).toContain("[id: shared.md]");
      expect(injected).not.toContain("scopeprobe other");
      const local = (await main.search("ses_scopes", "scopeprobe")).content;
      expect(local).toContain("[id: global:shared.md]");
      expect(local).toContain("[id: shared.md]");
      expect(local).not.toContain("project:");
      const remoteID = `project:${memoryProjectKey(otherDirectory)}:shared.md`;
      expect((await main.search("ses_scopes", "scopeprobe", 0, true)).content).toContain(`[id: ${remoteID}]`);
      expect((await main.read("ses_scopes", remoteID)).content).toContain("scopeprobe other");
      await expect(main.correct("ses_scopes", remoteID, { content: "Wrong project" })).rejects.toThrow("read-only");
      await expect(main.delete("ses_scopes", remoteID)).rejects.toThrow("read-only");
      await worktree.correct("ses_scopes", "shared.md", { content: "canonical correction" });
      expect((await main.read("ses_scopes", "shared.md")).content).toContain("Historical version");
      expect(project.index().find((entry) => entry.file === "shared.md")!.supersededBy).toBeDefined();
      expect(other.topic("shared.md")).toBe("scopeprobe other");
      await main.delete("ses_scopes", "global:shared.md");
      expect(project.topic("shared.md")).toBe("scopeprobe project");
      expect(await global.readCatalog()).toHaveLength(0);
      await expect(main.read("ses_scopes", "../shared.md")).rejects.toThrow("exact memory id");
    } finally {
      await main.dispose();
      await worktree.dispose();
      await rm(memoryScopeRoot(central, "global"), { recursive: true, force: true });
    }
  });

  test.serial("reflection creates requested global context and corrects its original scope", async () => {
    const directory = "/tmp/scoped-memory-reflection";
    const storage = new Map<string, unknown>();
    const central = join(dataHome, "opencode", "memory");
    const global = openMemoryStore(central, "global");
    await global.writeTopic("rule.md", "Use the old style.");
    await global.writeIndex([{ title: "Style", file: "rule.md", summary: "Style preference", type: "preference", updated: "2026-10-16" }]);
    const app = await fixture(directory, (call) => isReflectionSelector(call)
      ? { needed: true, ids: ["global:rule.md"] }
      : { create: [{ ...memoryExtraction({ title: "Shared reference", type: "reference" }), scope: "global", outlasts_task: true, source_message_ids: ["msg_1"] }], correct: [{ id: "global:rule.md", content: "Use the new style.", source_message_ids: ["msg_1"] }] }, { idle_delay_ms: 1000 }, storage);
    try {
      await app.context("ses_scope_reflect");
      app.history("ses_scope_reflect", [{ id: "msg_1", type: "user", text: "Use the new style everywhere, and save this reference globally." }]);
      jest.useFakeTimers();
      await app.emit("session.execution.succeeded", "ses_scope_reflect");
      jest.advanceTimersByTime(1000);
      await until(() => app.saved().length === 2 || app.errors().length > 0);
      expect(app.errors()).toHaveLength(0);
      const catalog = await global.readCatalog();
      const original = catalog.find((entry) => entry.file === "rule.md")!;
      expect(await global.readTopic(original.supersededBy!)).toBe("Use the new style.");
      expect(catalog.find((entry) => entry.title === "Shared reference")!.type).toBe("reference");
      expect(memory(storage, directory).index()).toHaveLength(0);
    } finally {
      jest.useRealTimers();
      await app.dispose();
      await rm(memoryScopeRoot(central, "global"), { recursive: true, force: true });
    }
  });

  test.serial("lazy imports preserve history and do not resurrect deletes or overwrite collisions", async () => {
    const central = join(dataHome, "migration");
    const source = openMemoryStore(central, "old-worktree");
    const target = openMemoryStore(central, "canonical");
    await source.writeTopic("original.md", "original");
    await source.writeTopic("replacement.md", "replacement");
    await source.writeIndex([
      { title: "Original", file: "original.md", summary: "History", type: "fact", updated: "2026-10-16", supersededBy: "replacement.md" },
      { title: "Replacement", file: "replacement.md", summary: "Current", type: "fact", updated: "2026-10-16" },
    ]);
    await importMemoryPartition(central, "old-worktree", "canonical");
    expect(await target.readCatalog()).toEqual(await source.readCatalog());
    expect(await target.readTopic("original.md")).toBe("original");
    await target.serializeWrite(async () => target.remove(await target.readCatalog(), "replacement.md"));
    await importMemoryPartition(central, "old-worktree", "canonical");
    expect((await target.readCatalog()).map((entry) => entry.file)).toEqual(["original.md"]);
    expect(await source.readTopic("replacement.md")).toBe("replacement");
    const collision = openMemoryStore(central, "collision");
    await collision.writeTopic("original.md", "unknown destination body");
    await expect(importMemoryPartition(central, "canonical", "collision")).rejects.toThrow("collision");
    expect(await collision.readTopic("original.md")).toBe("unknown destination body");
    expect(await target.readTopic("original.md")).toBe("original");
  });

  test.serial("independent store views serialize writes", async () => {
    const central = join(dataHome, "queues");
    const first = openMemoryStore(central, "shared");
    const second = openMemoryStore(central, "shared");
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const one = first.serializeWrite(async () => {
      const catalog = await first.readCatalog();
      entered();
      await gate;
      return first.save(catalog, memoryExtraction({ title: "First" }) as never);
    });
    await started;
    const two = second.serializeWrite(async () => second.save(await second.readCatalog(), memoryExtraction({ title: "Second" }) as never));
    release();
    await Promise.all([one, two]);
    expect((await first.readCatalog()).map((entry) => entry.title).sort()).toEqual(["First", "Second"]);
  });
});

async function until(condition: () => boolean | Promise<boolean>) {
  while (!(await condition())) await new Promise<void>((resolve) => setImmediate(resolve));
}

// Flush pending microtask and filesystem callbacks without waiting on real
// time (safe under fake timers), so background work settles.
async function settle() {
  for (let i = 0; i < 25; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("memory persistence", () => {
  test.serial("memory tool saves a topic and queues its delta only for other sessions", async () => {
    const directory = "/tmp/memory-tool-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{ file: "first.md", title: "First", summary: "First summary", content: "first" }]);
    const app = await fixture(directory, noMemories, {}, storage);

    // Both sessions snapshot the index before the save.
    const before = await app.context("ses_origin");
    await app.context("ses_other");
    await expect(app.save("ses_origin", memoryExtraction({ title: "" }))).rejects.toThrow("non-empty title");
    const result = await app.save("ses_origin", {
      title: "Focused tests first",
      hook: "Run the focused Bun test before the full suite.",
      content: "Run the affected plugin's focused Bun test before the full suite.",
      type: "instruction",
    });
    const file = result.content.match(/\[id: ([^\]]+)\]/)![1]!;
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

  test.each(["disabled", "backoff", "no-op", "rules"] as const)("size-triggered dreams respect %s", async (mode) => {
    const directory = `/tmp/memory-threshold-controls-${mode}`;
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "a.md", type: mode === "rules" ? "instruction" : "fact" },
      { file: "b.md", type: mode === "rules" ? "preference" : "fact" },
    ]);
    if (mode === "disabled") project.set("settings", { dream_auto: false });
    if (mode === "backoff") project.set("dream", { auto: true, additions: 0, since: Date.now(), failAt: Date.now() });
    const app = await fixture(directory, (call) => isDreamSelector(call) ? { action: "none" } : noMemories(), { dream_topic_limit: 2, dream_target: 0 }, storage);
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
    expect(output.tools.memory_save).toBeDefined();
    expect(output.tools.memory_correct).toMatchObject({ input: { required: ["id", "content", "source_message_ids"] } });
    expect(output.tools.memory).toBeUndefined();

    for (const sessionID of ["ses_sub", "ses_worker_1"]) {
      // Mutation denial also applies before the session's first context hook.
      await expect(app.save(sessionID, memoryExtraction())).rejects.toThrow("read/search-only");
      await expect(app.correct(sessionID, "first.md", { content: "Changed" })).rejects.toThrow("read/search-only");
      await expect(app.delete(sessionID, "first.md")).rejects.toThrow("read/search-only");
      const restricted = await app.context(sessionID);
      expect(restricted.system[0]!.text).toContain("SECOND_BODY");
      expect(restricted.system[0]!.text).not.toContain("id: gone.md");
      expect(restricted.system[0]!.text).toContain("First [id: first.md]");
      expect(restricted.system[0]!.text).toContain("Typed [id: third.md]");
      expect(restricted.system[0]!.text).not.toContain("FIRST_BODY");
      expect(Object.keys(restricted.tools).sort()).toEqual(["memory_read", "memory_search"]);
      expect(restricted.tools.memory_read).toMatchObject({ input: { required: ["id"] } });
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
      expect(disabled.tools).toEqual({});
      expect(disabled.messages[0]!.content).toHaveLength(1);
      const child = await app.context("ses_sub");
      expect(child.tools).toEqual({});
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
    const app = await fixture(directory, (call) => {
      if (isReflectionSelector(call)) return { needed: !call.prompt.includes("Thanks, now rename the helper."), ids: [] };
      return isReflection(call)
        ? { create: [{ ...memoryExtraction({ title: "Login investigation", type: "working", content: "The user suspects the shared Redis fixture; this is not confirmed." }), outlasts_task: true, source_message_ids: ["msg_1"] }], correct: [] }
        : noMemories();
    }, { idle_delay_ms: 1000, reflect_model: "test/small#low" }, storage);
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
      expect(app.calls).toHaveLength(2);
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
      await until(() => app.calls.length === 3);
      await settle();
      expect(app.calls[2]!.prompt).toContain("Thanks, now rename the helper.");
      expect(app.calls[2]!.prompt).not.toContain("I suspect the shared Redis fixture");
      expect(app.calls[2]!.prompt).toContain("- Login investigation (login-investigation-");
    } finally {
      jest.useRealTimers();
    }
    expect(memory(storage, directory).index()[0]!).toMatchObject({ title: "Login investigation", type: "working" });
    await app.dispose();
  });

  test.serial("reviews pre-compaction evidence after a restart without replacing its statement date", async () => {
    const directory = "/tmp/memory-compaction-capture";
    const storage = new Map<string, unknown>();
    const statedAt = Date.UTC(2024, 1, 3, 12);
    let app = await fixture(directory, noMemories, { idle_delay_ms: 1000 }, storage);
    app.history("ses_capture", [
      { id: "msg_1", type: "user", time: { created: statedAt }, text: `Always ask before deploying.\n${"Background context. ".repeat(3000)}` },
      { id: "msg_2", type: "assistant", content: [{ type: "text", text: "I propose a staging-first workflow." }] },
      { id: "msg_3", type: "user", time: { created: statedAt + 1000 }, text: "Yes, use that workflow." },
    ]);
    const context = await app.context("ses_capture", [userMessage("msg_1", "Always ask before deploying.")]);
    expect(context.messages[0]!.content[1]!.text).toContain('memory_source id="msg_1"');
    await app.compaction("ses_capture");
    app.history("ses_capture", []);
    await app.dispose();

    app = await fixture(directory, (call) => {
      if (isReflectionSelector(call)) return { needed: true, ids: [] };
      if (call.prompt.includes('<user id="msg_3"')) {
        return { create: [{ ...memoryExtraction({ title: "Deployment workflow", content: "The user accepted a staging-first workflow." }), outlasts_task: true, source_message_ids: ["msg_3"] }], correct: [] };
      }
      return { create: [{ ...memoryExtraction({ title: "Deployment approval", type: "instruction", content: "Ask before deploying." }), outlasts_task: true, source_message_ids: ["msg_1"] }], correct: [] };
    }, { idle_delay_ms: 1000 }, storage);
    try {
      jest.useFakeTimers();
      await app.context("ses_capture");
      await app.emit("session.execution.succeeded", "ses_capture");
      jest.advanceTimersByTime(1000);
      await until(() => app.saved().length === 1);
      await until(() => (storage.get("session/ses_capture") as { writes: unknown[] }).writes.length === 0);
      await settle();
      await app.compaction("ses_capture");
      jest.advanceTimersByTime(1000);
      await until(() => app.saved().length === 2);
      await until(() => (storage.get("session/ses_capture") as { writes: unknown[] }).writes.length === 0);
      const record = memory(storage, directory).index().find((entry) => entry.title === "Deployment approval")!;
      expect(record.evidence).toEqual([{ sessionID: "ses_capture", messageID: "msg_1", createdAt: statedAt }]);
      expect((await app.read("ses_capture", record.file)).content).toContain("2024-02-03T12:00:00.000Z");
      expect(storage.get("session/ses_capture")).toMatchObject({ cursor: "msg_3", backlog: [], writes: [] });
      expect(app.calls.filter(isReflection).at(-1)!.prompt).toContain("I propose a staging-first workflow.");
      expect(JSON.stringify(storage.get("session/ses_capture"))).not.toContain("Always ask before deploying.");
    } finally {
      jest.useRealTimers();
      await app.dispose();
    }
  });

  test.serial("retries only failed reflection writes after a restart", async () => {
    const directory = "/tmp/memory-reflection-retry";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [{ file: "plan.md", type: "working", content: "Original plan." }]);
    let fail = true;
    const write = Bun.write;
    const failingWrite = jest.spyOn(Bun, "write").mockImplementation(((...args: Parameters<typeof write>) => {
      const content: unknown = args[1];
      if (fail && typeof content === "string" && content.startsWith("Retry this memory")) return Promise.reject(new Error("Temporary write failure"));
      return write(...args);
    }) as typeof Bun.write);
    let app = await fixture(directory, (call) => isReflectionSelector(call)
      ? { needed: true, ids: ["plan.md"] }
      : { create: [
        { ...memoryExtraction({ title: "Successful sibling", content: "Keep this memory." }), outlasts_task: true, source_message_ids: ["msg_1"] },
        { ...memoryExtraction({ title: "Pending sibling", content: "Retry this memory." }), outlasts_task: true, source_message_ids: ["msg_1"] },
      ], correct: [{ id: "plan.md", content: "Retry this memory, replacing the plan.", source_message_ids: ["msg_1"] }] }, { idle_delay_ms: 1000 }, storage);
    try {
      app.history("ses_retry", [{ id: "msg_1", type: "user", text: "Keep both decisions for future work." }]);
      await app.context("ses_retry");
      jest.useFakeTimers();
      await app.emit("session.execution.succeeded", "ses_retry");
      jest.advanceTimersByTime(1000);
      await until(() => app.errors().length > 0);
      expect(storage.get("session/ses_retry")).toMatchObject({ cursor: "msg_1", backlog: [] });
      expect((storage.get("session/ses_retry") as { writes: unknown[] }).writes).toHaveLength(2);
      await app.dispose();
      project.setTopic("plan.md", "User changed the plan meanwhile.");
      fail = false;
      app = await fixture(directory, () => { throw new Error("Retry must not re-extract reviewed text"); }, { idle_delay_ms: 1000 }, storage);
      await app.context("ses_retry");
      await app.emit("session.execution.succeeded", "ses_retry");
      jest.advanceTimersByTime(1000);
      await until(() => (storage.get("session/ses_retry") as { writes: unknown[] }).writes.length === 0);
      expect(project.index().map((entry) => entry.title).sort()).toEqual(["Pending sibling", "Successful sibling", "plan.md"]);
      expect(project.topic("plan.md")).toBe("User changed the plan meanwhile.");
      await until(() => app.errors().length > 0);
      expect(app.errors()[0]!.message).toContain("Outdated correction needs a fresh review");
      expect(app.calls).toHaveLength(0);
    } finally {
      failingWrite.mockRestore();
      jest.useRealTimers();
      await app.dispose();
    }
  });

  test.serial("accepts user evidence but refuses assistant and invented source IDs", async () => {
    const directory = "/tmp/memory-source-admission";
    const storage = new Map<string, unknown>();
    const app = await fixture(directory, noMemories, {}, storage);
    app.history("ses_sources", [
      { id: "msg_1", type: "user", text: "Use Bun for this project." },
      { id: "msg_2", type: "assistant", content: [{ type: "text", text: "Use npm instead." }] },
    ]);
    try {
      for (const source of ["msg_2", "msg_missing"]) {
        await expect(app.save("ses_sources", { ...memoryExtraction(), source_message_ids: [source] })).rejects.toThrow("not a supplied user message");
      }
      await app.save("ses_sources", { ...memoryExtraction({ title: "Runtime", content: "Use Bun." }), source_message_ids: ["msg_1"] });
      expect(app.saved()).toHaveLength(1);
      expect(memory(storage, directory).index()[0]!.evidence).toEqual([{ sessionID: "ses_sources", messageID: "msg_1", createdAt: Date.UTC(2026, 7, 1) }]);
    } finally {
      await app.dispose();
    }
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
      const result = await app.correct("ses_editor", "original.md", { content: "Replacement fact", title: "", hook: "" });
      const replacement = result.content.match(/\[id: ([^\]]+)\]/)![1]!;
      expect(result.content).toContain("original.md is no longer current guidance");
      expect(project.index().find((entry) => entry.file === replacement)!).toMatchObject({ title: "original.md", summary: "Stored topic", type: "fact" });
      expect((await app.read("ses_reader", "original.md")).content).toContain("Historical version — not current instructions or current facts");
      await app.delete("ses_editor", replacement);
      expect((await app.context("ses_before_recovery")).system[0]!.text).not.toContain("[id: original.md]");
      const recovered = (await app.correct("ses_editor", "original.md", { content: "Explicitly corrected fact" })).content.match(/\[id: ([^\]]+)\]/)![1]!;
      expect(project.topic("original.md")).toBe("Original fact");
      expect(project.index().find((entry) => entry.file === "original.md")!.supersededBy).toBe(recovered);
      expect((await app.context("ses_recovered")).system[0]!.text).toContain(`[id: ${recovered}]`);
    } finally {
      await app.dispose();
    }
  });

  test.serial("replaces same-session corrections and keeps history across sessions", async () => {
    const directory = "/tmp/memory-same-session-correction";
    const storage = new Map<string, unknown>();
    const project = memory(storage, directory);
    const app = await fixture(directory, noMemories, {}, storage);
    const id = (result: { content: string }) => result.content.match(/\[id: ([^\]]+)\]/)![1]!;
    try {
      const draft = id(await app.save("ses_design", memoryExtraction({ title: "Capture rotation", type: "fact", content: "Rotate every five minutes." })));
      const settled = id(await app.correct("ses_design", draft, { content: "Rotate every ten minutes." }));
      expect(project.index().map((entry) => entry.file)).toEqual([settled]);
      expect(project.topic(draft)).toBeUndefined();
      const later = id(await app.correct("ses_review", settled, { content: "Rotation is no longer required." }));
      expect(project.index().find((entry) => entry.file === settled)!.supersededBy).toBe(later);
    } finally {
      await app.dispose();
    }
  });

  test.serial("reflection sees records citing its messages and drops task-only and duplicate creates", async () => {
    const directory = "/tmp/memory-reflection-overlap";
    const storage = new Map<string, unknown>();
    const rule = memoryExtraction({ title: "Deployment approval", type: "instruction", content: "Ask before deploying." });
    const app = await fixture(directory, (call) => {
      if (isReflectionSelector(call)) return { needed: true, ids: [] };
      if (!isReflection(call)) return noMemories();
      expect(call.prompt).toContain("<memory_detail");
      expect(call.prompt).toContain("Ask before deploying.");
      return { create: [
        { ...rule, outlasts_task: true, source_message_ids: ["msg_1"] },
        { ...memoryExtraction({ title: "Fix login form", type: "instruction", content: "Fix the login form now." }), outlasts_task: false, source_message_ids: ["msg_1"] },
      ], correct: [] };
    }, { idle_delay_ms: 1000 }, storage);
    await app.context("ses_overlap");
    app.history("ses_overlap", [{ id: "msg_1", type: "user", text: "Always ask before deploying. Also fix the login form." }]);
    try {
      await app.save("ses_overlap", { ...rule, source_message_ids: ["msg_1"] });
      jest.useFakeTimers();
      await app.emit("session.execution.succeeded", "ses_overlap");
      jest.advanceTimersByTime(1000);
      await until(() => (storage.get("session/ses_overlap") as { cursor?: string }).cursor === "msg_1");
      await settle();
      expect(memory(storage, directory).index()).toHaveLength(1);
      expect(app.errors()).toEqual([]);
    } finally {
      jest.useRealTimers();
      await app.dispose();
    }
  });

  test.serial("paginates all-words detail search with superseded history opt-in", async () => {
    const directory = "/tmp/memory-search-pages-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "old.md", content: "An old literal [shared] detail" },
      ...Array.from({ length: 25 }, (_, index) => ({ file: `detail-${index}.md`, content: "A literal [shared] detail", type: index === 24 ? "insight" : "fact" })),
    ]);
    project.setIndex(project.index().map((entry) => entry.file === "old.md" ? { ...entry, supersededBy: "detail-0.md" } : entry));
    const app = await fixture(directory, noMemories, {}, storage);
    try {
      const first = (await app.search("ses_sub", '"[shared]", LITERAL')).content;
      expect(first).not.toContain("[id: old.md]");
      expect(first).toContain("[id: detail-19.md]");
      expect(first).not.toContain("[id: detail-24.md]");
      expect(first).toContain("offset: 20");
      const second = (await app.search("ses_sub", '"[shared]", LITERAL', 20)).content;
      expect(second).toContain("[id: detail-24.md]");
      expect(second).not.toContain("[id: detail-0.md]");
      const history = (await app.search("ses_sub", '"[shared]", LITERAL', 0, false, true)).content;
      expect(history).toContain("[id: old.md]");
      expect(history).toContain("superseded by detail-0.md");
      expect(history).toContain("offset: 20, include_history: true");
      const historyNext = (await app.search("ses_sub", '"[shared]", LITERAL', 20, false, true)).content;
      expect(historyNext).toContain("[id: detail-24.md]");
      expect(historyNext).not.toContain("[id: old.md]");
      expect((await app.search("ses_sub", "literal missing-word")).content).toContain("Try fewer or different words");
    } finally {
      await app.dispose();
    }
  });

  test.serial("reflection reads folded details before applying an explicit user correction", async () => {
    const directory = "/tmp/memory-reflection-correction-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "plan.md", title: "Fixture plan", summary: "Fixtures: use shared Redis", type: "working", content: "Status: tentative. Use shared Redis fixtures." },
      { file: "context.md", content: "The user needs isolated test runs." },
      { file: "runner.md", content: "Tests run in parallel." },
    ]);
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "synthesize", files: ["plan.md", "context.md", "runner.md"], reason: "Fixture context" };
      if (isDreamCurator(call)) return memoryExtraction({ title: "Fixture context summary" });
      if (isReflectionSelector(call)) return { needed: true, ids: ["missing.md", "plan.md"] };
      if (!isReflection(call)) return noMemories();
      expect(call.prompt).toContain("Status: tentative. Use shared Redis fixtures.");
      return { create: [], correct: [
        { id: "unread.md", content: "An unread correction", source_message_ids: ["msg_1"] },
        { id: "plan.md", content: "The user decided to use isolated Redis fixtures.", hook: "Fixtures: use isolated Redis", source_message_ids: ["msg_1"] },
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
      expect(project.topic(original.supersededBy!)).toContain("decided to use isolated Redis fixtures");
      expect(project.index().find((entry) => entry.file === original.supersededBy)!).toMatchObject({ type: "working", summary: "Fixtures: use isolated Redis" });
      await until(() => app.errors().length === 1);
      expect(app.errors()[0]!.message).toContain("Unresolved correction: unread.md");
      await until(() => (storage.get("session/ses_reflection_correction") as { cursor?: string }).cursor === "msg_1");
      const next = await app.message("ses_reflection_correction", "Continue.");
      expect((await app.context("ses_reflection_correction", [userMessage(next)])).messages[0]!.content[1]!.text).toContain(`Fixture plan [id: ${original.supersededBy}]`);
    } finally {
      jest.useRealTimers();
      await app.dispose();
    }
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
  const finished = (app: Awaited<ReturnType<typeof fixture>>, state: string) =>
    until(() => app.statuses().some((status) => status.state === state));

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
      { file: "c.md", title: "Gamma" },
    ]);
    await rm(join(dataHome, "opencode", "memory", memoryProjectKey(directory), "missing.md"));
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) {
        expect(call.prompt).not.toContain("missing.md");
        return { action: "synthesize", files: ["a.md", "b.md", "c.md"], reason: "shared pattern" };
      }
      return memoryExtraction({ title: "Merged", content: "Combined facts" });
    }, {}, storage);

    try {
      await app.dream("req-missing");
      await until(() => app.statuses().some((status) => status.state !== "running"));
      const status = app.statuses().at(-1)!;
      expect(status).toMatchObject({ state: "changed", counts: { synthesize: 1 } });
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

  test.serial("extends summaries flatly from their details while retaining searchable sources", async () => {
    const directory = "/tmp/memory-dream-run-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "a.md", title: "Alpha plan", summary: "Alpha summary", content: "ALPHA_BODY_ONE [shared] duplicate fact" },
      { file: "b.md", title: "Alpha variant", summary: "Alpha variant summary", content: "ALPHA_BODY_TWO shared duplicate fact" },
      { file: "c.md", title: "Gamma outcome", summary: "Gamma summary", content: "GAMMA_BODY outdated claim" },
      { file: "d.md", title: "Delta note", summary: "Delta summary", content: "DELTA_BODY stable pattern" },
      { file: "e.md", title: "Epsilon note", summary: "Epsilon summary", content: "EPSILON_BODY unrelated" },
    ]);

    let first: string | undefined;
    let selections = 0;
    const app = await fixture(directory, async (call) => {
      if (isDreamSelector(call)) {
        selections += 1;
        if (selections === 1) return { action: "synthesize", files: ["a.md", "b.md", "c.md"], reason: "alpha and gamma" };
        // A summary written in this run is not offered again.
        if (selections === 2) {
          expect(call.prompt).not.toContain("SUMMARY_LAYER");
          return { action: "none" };
        }
        first = project.index().find((entry) => entry.title === "Alpha summary layer")!.file;
        return { action: "synthesize", files: [first, "d.md"], reason: "shared stable pattern" };
      }
      if (isDreamCurator(call)) {
        if (selections === 1) return memoryExtraction({ title: "Alpha summary layer", hook: "SUMMARY_LAYER", content: "First overview" });
        // Rebuilt from the details, never from the absorbed summary's prose.
        for (const body of ["ALPHA_BODY_ONE", "ALPHA_BODY_TWO", "GAMMA_BODY", "DELTA_BODY"]) expect(call.prompt).toContain(body);
        expect(call.prompt).not.toContain("First overview");
        return memoryExtraction({ title: "Cross-topic insight", content: "Rebuilt overview" });
      }
      return noMemories();
    }, {}, storage);

    await app.dream("req-first", "ses_dreamer");
    await finished(app, "changed");
    await app.dream("req-absorb", "ses_dreamer");
    await until(() => app.statuses().filter((status) => status.state === "changed").length === 2);
    const status = app.statuses().at(-1)!;
    const manifest = project.get(`dreams/${status.runID}`);
    const insight = manifest.actions[0].output.file as string;
    await app.dispose();

    const reader = await fixture(directory, noMemories, {}, storage);
    expect(project.index().some((entry) => entry.file === first)).toBe(false);
    expect(project.topic(first!)).toBeUndefined();
    expect(project.index().find((entry) => entry.file === insight)!.children!.map((child) => child.file)).toEqual(["a.md", "b.md", "c.md", "d.md"]);
    const roots = (await reader.context("ses_roots")).system[0]!.text;
    expect(roots).toContain(`[id: ${insight}]`);
    expect(roots).not.toContain("[id: a.md]");
    const summary = (await reader.read("ses_reader", insight)).content;
    expect(summary).toContain("Derived summary — not user-stated");
    expect(summary).toContain("a.md");
    expect((await reader.search("ses_sub", "ALPHA_BODY_ONE [shared]")).content).toContain("a.md");
    expect((await reader.search("ses_sub", "durable project outcome", 0, false, true)).content).not.toContain(`[id: ${insight}]`);
    expect(JSON.stringify(manifest)).not.toContain("ALPHA_BODY");
    await reader.dispose();
  });

  test.each(["correction", "body edit", "metadata edit", "delete", "unfold"] as const)("invalidates a summary after %s without losing sibling details", async (change) => {
    const directory = `/tmp/memory-hierarchy-invalidation-${change}`;
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "a.md", title: "Alpha", content: "Original alpha detail", type: "fact" },
      { file: "b.md", title: "Beta", content: "Beta detail", type: "working" },
      { file: "c.md", title: "Gamma", content: "Gamma detail" },
      { file: "rule.md", title: "Rule", content: "Keep instructions precise", type: "instruction" },
    ]);
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) {
        expect(call.prompt).not.toContain("[id: rule.md]");
        return { action: "synthesize", files: ["a.md", "b.md", "c.md"], reason: "related details" };
      }
      if (isDreamCurator(call)) return memoryExtraction({ title: "Layer", content: "Summary layer" });
      return noMemories();
    }, {}, storage);

    try {
      await app.dream("req-invalidation");
      await finished(app, "changed");
      const first = project.index().find((entry) => entry.title === "Layer")!;
      await expect(app.correct("ses_editor", first.file, { content: "Wrong summary correction" })).rejects.toThrow("derived summary");
      let replacement: string | undefined;
      if (change === "correction") {
        replacement = (await app.correct("ses_editor", "a.md", { content: "Corrected alpha detail" })).content.match(/\[id: ([^\]]+)\]/)![1]!;
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
      else {
        const removed = (await app.delete("ses_editor", change === "delete" ? "a.md" : first.file)).content;
        if (change === "unfold") {
          expect(removed).toContain("sources were not deleted: a.md, b.md, c.md");
          expect(removed).toContain("No replacement summary was generated");
        }
      }

      const roots = (await app.context("ses_roots")).system[0]!.text;
      expect(roots).not.toContain(`[id: ${first.file}]`);
      expect(roots).toContain("[id: b.md]");
      expect(roots).toContain("[id: c.md]");
      expect(roots).toContain("[id: rule.md]");
      expect(project.topic("b.md")).toBe("Beta detail");
      if (replacement) expect(roots).toContain(`[id: ${replacement}]`);
      if (change === "delete") {
        expect(project.topic("a.md")).toBeUndefined();
        expect(project.topic(first.file)).toBeUndefined();
        expect((await app.search("ses_reader", "Original alpha detail")).content).not.toContain("a.md");
      } else if (change !== "correction") expect(roots).toContain("[id: a.md]");
      if (change === "body edit") {
        project.setTopic("a.md", "Original alpha detail");
        const reverted = (await app.context("ses_reverted")).system[0]!.text;
        expect(reverted).not.toContain(`[id: ${first.file}]`);
        expect(project.index().find((entry) => entry.file === first.file)!.retired).toBe(true);
      }
    } finally {
      await app.dispose();
    }
  });

  test.each(["body", "metadata"] as const)("aborts a stale synthesis after a %s change without resetting the counters", async (change) => {
    const directory = `/tmp/memory-dream-stale-project-${change}`;
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "x.md", title: "X topic", summary: "X summary", content: "X_SHARED_BODY" },
      { file: "y.md", title: "Y topic", summary: "Y summary", content: "Y_SHARED_BODY" },
      { file: "z.md", title: "Z topic", summary: "Z summary" },
    ]);
    project.set("dream", { auto: true, additions: 3, since: Date.now() });

    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<unknown>();
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "synthesize", files: ["x.md", "y.md", "z.md"], reason: "duplicate topics" };
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
    else await app.correct("ses_editor", "x.md", { title: "New instruction", type: "instruction", content: "X_SHARED_BODY" });
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

  test.serial("keeps additions recorded while a dream was running", async () => {
    const directory = "/tmp/memory-dream-keep-project";
    const storage = new Map<string, unknown>();
    const project = store(storage, directory, [
      { file: "x.md", title: "X topic", summary: "X summary", content: "X_KEEP_BODY" },
      { file: "y.md", title: "Y topic", summary: "Y summary", content: "Y_KEEP_BODY" },
      { file: "z.md", title: "Z topic", summary: "Z summary" },
    ]);
    project.set("dream", { auto: true, additions: 4, since: Date.now() });

    const curatorGate = Promise.withResolvers<Extraction>();
    const curatorStarted = Promise.withResolvers<void>();
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "synthesize", files: ["x.md", "y.md", "z.md"], reason: "duplicate topics" };
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
      expect(app.dialogs[3]!.options.find((option) => option.value.type === "edit")!.description).toContain("dependent summaries retire");
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
    app.emit("dream", { requestID: null, runID: "run-auto", state: "changed", counts: { synthesize: 1 } });
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
