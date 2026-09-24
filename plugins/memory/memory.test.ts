import { afterEach, describe, expect, jest, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import MemoryModule, {
  dreamDue,
  indexLine,
  memoryProjectKey as serverProjectKey,
  parseIndexLine,
} from "./server.tsx";
import MemoryTui, { memoryProjectKey as tuiProjectKey } from "./tui.tsx";

const originalDataHome = process.env.XDG_DATA_HOME;
afterEach(() => {
  if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalDataHome;
});

type WorkerCall = { prompt: string; model?: { providerID: string; id: string; variant?: string } };
type FakeMessage = { id: string; role: string; content: Array<{ type: string; text: string }> };
type DreamStatus = { requestID: string | null; runID: string; state: string; sessionID?: string; counts?: Record<string, number>; message?: string };
type Hook = (event: never) => Promise<void> | void;

async function fixture(
  directory: string,
  respond: (call: WorkerCall) => unknown,
  options: {
    classifier_model?: string;
    extractor_model?: string;
    dream_model?: string;
    interval?: number;
    idle_delay_ms?: number;
    dream_interval_hours?: number;
    dream_min_additions?: number;
  } = {},
) {
  const calls: WorkerCall[] = [];
  const emitted: Array<{ name: string; data: Record<string, unknown> }> = [];
  const hooks = new Map<string, Hook>();
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let dream: ((input: { requestID: string; sessionID?: string }) => Promise<unknown>) | undefined;
  const ctx = {
    location: { directory },
    options: { interval: 2, ...options },
    generate: {
      text: async (input: WorkerCall) => {
        calls.push(input);
        return { text: JSON.stringify(await respond(input)) };
      },
    },
    rpc: {
      register: async (_definition: unknown, handlers: { dream: typeof dream }) => {
        dream = handlers.dream;
        return { events: { emit: async (name: string, data: Record<string, unknown>) => { emitted.push({ name, data }); } } };
      },
    },
    session: { hook: async (name: string, callback: Hook) => { hooks.set(name, callback); } },
    permission: { hook: async (name: string, callback: Hook) => { hooks.set(`permission.${name}`, callback); } },
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
    dispose: cleanup,
    statuses: () => emitted.flatMap((event) => event.name === "dream" ? [event.data as DreamStatus] : []),
    saved: () => emitted.flatMap((event) => event.name === "saved" ? [event.data] : []),
    message: async (sessionID: string, text: string) => {
      const messageID = `msg_${crypto.randomUUID()}`;
      await hooks.get("prompt")!({ sessionID, messageID, prompt: { text }, delivery: "steer" } as never);
      return messageID;
    },
    context: async (sessionID: string, messages: FakeMessage[] = []) => {
      const event = { sessionID, system: [] as Array<{ type: string; text: string }>, messages };
      await hooks.get("context")!(event as never);
      return event;
    },
    permission: async (action: string, resources: string[]) => {
      const event = { sessionID: "ses_permission", action, resources, effect: "ask" };
      await hooks.get("permission.evaluate")!(event as never);
      return event.effect;
    },
    emit: async (type: string, sessionID: string) => {
      queue.push({ type, data: { sessionID } });
      wake?.();
      await settle();
    },
    dream: (requestID: string, sessionID?: string) => dream!({ requestID, sessionID }),
  };
}

const userMessage = (id: string, text = id): FakeMessage => ({ id, role: "user", content: [{ type: "text", text }] });

async function store(dataHome: string, directory: string, entries: { file: string; title?: string; summary?: string; content?: string }[]) {
  const path = join(dataHome, "opencode", "memory", serverProjectKey(directory));
  await mkdir(path, { recursive: true });
  await Bun.write(join(path, "index.md"), `# Project memory\n\n${entries.map((entry) =>
    `- [${entry.title ?? entry.file}](${entry.file}) - ${entry.summary ?? "Stored topic"}`).join("\n")}\n`);
  for (const entry of entries) if (entry.content !== undefined) await Bun.write(join(path, entry.file), entry.content);
  return path;
}

type Extraction = {
  title: string;
  summary: string;
  type: string;
  scope: string;
  content: string;
};

const memoryExtraction = (overrides: Partial<Extraction> = {}): Extraction => ({
  title: "Stored progress",
  summary: "A durable project outcome.",
  type: "recap",
  scope: "project",
  content: "The parser migration shipped and the focused suite passes.",
  ...overrides,
});

const createDecision = (subject: string) => ({ action: "create", target: null, subject });
const replaceDecision = (target: string, subject: string) => ({ action: "replace", target, subject });
const saveDecisions = (...items: Array<ReturnType<typeof createDecision> | ReturnType<typeof replaceDecision>>) => ({ decisions: items });

// Builds a seeded topic file body with plugin-owned frontmatter. Revisions
// must satisfy the server's `[a-f0-9-]+` revision pattern to exercise real
// parsing paths.
const seededTopic = (revision: string, body: string, type = "recap") =>
  `---\nrevision: "${revision}"\ntype: "${type}"\nscope: "project"\nsessionId: "ses_seed"\nupdatedAt: "2026-08-01"\n---\n\n${body}\n`;

const isClassifier = (call: WorkerCall) => call.prompt.startsWith("You are a project-memory classifier");
const isDreamSelector = (call: WorkerCall) => call.prompt.startsWith("You are a project-memory consolidation selector");
const isDreamCurator = (call: WorkerCall) => call.prompt.startsWith("You are a project-memory curator");

async function until(condition: () => boolean | Promise<boolean>) {
  while (!(await condition())) await new Promise<void>((resolve) => setImmediate(resolve));
}

// Flush pending microtask and filesystem callbacks without waiting on real
// time (safe under fake timers), so background restore/cleanup work settles.
async function settle() {
  for (let i = 0; i < 25; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("memory project directory keys", () => {
  test("matches the TUI implementation", () => {
    expect(serverProjectKey("/a/b-c")).not.toBe(serverProjectKey("/a-b/c"));
    for (const directory of ["/tmp/project", "/tmp/My Project+"]) {
      expect(tuiProjectKey(directory)).toBe(serverProjectKey(directory));
    }
  });
});

describe("memory index lines", () => {
  test("parses legacy and typed entries and renders them stably", () => {
    const legacy = parseIndexLine("- [Old topic](old.md) - Legacy summary")!;
    expect(legacy).toEqual({ title: "Old topic", file: "old.md", summary: "Legacy summary", metadata: {} });
    expect(indexLine(legacy)).toBe("- [Old topic](old.md) - Legacy summary");

    const typed = parseIndexLine("- [Typed](typed.md) - [preference|editor|2026-08-01] Be concise")!;
    expect(typed.metadata).toEqual({ type: "preference", scope: "editor", updated: "2026-08-01" });
    expect(indexLine(typed)).toBe("- [Typed](typed.md) - [preference|editor|2026-08-01] Be concise");

    expect(parseIndexLine("- [Nested](nested/e.md) - s")).toBeUndefined();
  });
});

describe("memory persistence", () => {
  test.serial("sends configured models and variants with classifier and extractor calls", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-variants-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-variant-project";
    const app = await fixture(directory, (call) =>
      isClassifier(call)
        ? saveDecisions(createDecision("the completed parser migration"))
        : memoryExtraction(), {
      classifier_model: "test/small#fast",
      extractor_model: "test/small#thorough",
    });

    await app.message("ses_variants", "The parser migration is complete.");
    await app.message("ses_variants", "The focused tests pass.");
    await app.message("ses_variants", "Continue.");
    await until(() => app.calls.length >= 2);
    await app.dispose();

    expect(app.calls[0]!.model).toEqual({ providerID: "test", id: "small", variant: "fast" });
    expect(app.calls[1]!.model).toEqual({ providerID: "test", id: "small", variant: "thorough" });
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("creates typed memory with the originating session as last writer", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-plugin-project";
    const app = await fixture(directory, (call) => isClassifier(call)
      ? saveDecisions(createDecision("confirmed focused test approach"))
      : {
        title: "Confirmed test approach",
        summary: "Use the confirmed focused test approach.",
        type: "instruction",
        scope: "testing",
        content: "Run the affected plugin's focused Bun test before the full suite.",
      });

    await app.message("ses_origin", "For future testing, run the affected plugin's focused Bun test before the full suite.");
    await app.message("ses_origin", "Keep that as a testing instruction.");
    await app.message("ses_origin", "Continue.");
    const memoryDirectory = join(dataHome, "opencode", "memory", serverProjectKey(directory));
    await until(async () => Bun.file(join(memoryDirectory, "index.md")).exists());
    await app.dispose();

    const topic = (await readdir(memoryDirectory)).find((name) => name.endsWith(".md") && name !== "index.md")!;
    const content = await Bun.file(join(memoryDirectory, topic)).text();
    expect(content).toContain('type: "instruction"');
    expect(content).toContain('sessionId: "ses_origin"');
    const index = await Bun.file(join(memoryDirectory, "index.md")).text();
    expect(index).toContain("[Confirmed test approach]");
    expect(app.saved()).toEqual([{ sessionID: "ses_origin", title: "Confirmed test approach" }]);

    expect(app.calls[0]!.prompt).toContain("For future testing");
    expect(app.calls[0]!.prompt).not.toContain("Continue.");
    expect(app.calls[1]!.prompt).toContain("confirmed focused test approach");
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("replaces a legacy topic with typed last-writer metadata", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-legacy-project";
    const path = await store(dataHome, directory, [{
      file: "legacy.md",
      title: "Legacy",
      content: '---\nrevision: "old"\n---\n\nOld durable rule.\n',
    }]);
    let classifications = 0;
    const app = await fixture(directory, (call) => {
      if (isClassifier(call)) {
        return classifications++ === 0 ? saveDecisions() : saveDecisions(replaceDecision("legacy.md", "the established rule"));
      }
      return memoryExtraction({ title: "Updated legacy" });
    });
    await app.message("ses_latest", "Load memory.");
    await app.message("ses_latest", "Update the established rule.");
    await app.message("ses_latest", "Continue.");
    await until(() => app.calls.length >= 1);
    // Let the first checkpoint finish clearing the in-flight marker before
    // driving the next one.
    await Bun.sleep(50);
    await app.message("ses_latest", "Apply the update.");
    await app.message("ses_latest", "Make it durable.");
    const indexPath = join(path, "index.md");
    await until(async () => (await Bun.file(indexPath).text()).includes("[Updated legacy](legacy.md)"));
    await app.dispose();

    const topic = await Bun.file(join(path, "legacy.md")).text();
    expect(topic).toContain('type: "recap"');
    expect(topic).toContain('sessionId: "ses_latest"');
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("updates a long insight without truncating facts or promoting its type", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-insight-update-project";
    const facts = Array.from({ length: 80 }, (_, i) => `- Condition ${i}: retain this scoped observation and its exception.`).join("\n");
    const existing = seededTopic("abc1234", facts, "insight");
    const path = await store(dataHome, directory, [{ file: "insight.md", title: "Existing insight", content: existing }]);
    const summary = "Conditions, scoped observations, and exceptions governing project memory updates; covers the distinction between derived conclusions and explicitly stated user preferences, plus their application to future work.";
    const content = `${facts}\n\nThe user clarified that this applies to memory updates only.`;
    const app = await fixture(directory, (call) => {
      if (isClassifier(call)) return saveDecisions(replaceDecision("insight.md", "memory update scope"));
      expect(call.prompt).toContain(existing);
      return { title: "Updated insight", summary, content, scope: "plugins/memory" };
    });
    await app.message("ses_insight", "This applies to memory updates only.");
    await app.message("ses_insight", "Keep the existing conditions and exceptions.");
    await app.message("ses_insight", "Continue.");
    const indexPath = join(path, "index.md");
    await until(async () => (await Bun.file(indexPath).text()).includes("[Updated insight]"));
    await app.dispose();

    const topic = await Bun.file(join(path, "insight.md")).text();
    expect(topic).toContain('type: "insight"');
    expect(topic).toContain(content);
    expect(await Bun.file(indexPath).text()).toContain(summary);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("does not persist or maintain when disabled during extraction", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-disabled-project";
    const extraction = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    let selections = 0;
    const app = await fixture(directory, (call) => {
      if (isClassifier(call)) return saveDecisions(createDecision("a durable rule"));
      if (isDreamSelector(call)) {
        selections += 1;
        return { action: "none" };
      }
      started.resolve();
      return extraction.promise;
    });
    await app.message("ses_disabled", "First.");
    await app.message("ses_disabled", "Remember this durable rule.");
    await app.message("ses_disabled", "Continue.");
    await started.promise;
    const path = join(dataHome, "opencode", "memory", serverProjectKey(directory));
    await Bun.write(join(path, "settings.json"), JSON.stringify({ enabled: false }));
    extraction.resolve(memoryExtraction());
    await app.dispose();

    const names = await readdir(path);
    expect(names.filter((name) => name.endsWith(".md") && name !== "index.md")).toEqual([]);
    expect(selections).toBe(0);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("repairs missing index entries and orphan topics on first use", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-repair-project";
    const path = await store(dataHome, directory, [
      { file: "valid.md", content: "valid" },
      { file: "missing.md" },
    ]);
    await Bun.write(join(path, "orphan.md"), "orphan");
    const app = await fixture(directory, () => saveDecisions());
    await app.message("ses_repair", "Use memory.");
    await until(async () => !(await Bun.file(join(path, "orphan.md")).exists()));
    await app.dispose();

    const index = await Bun.file(join(path, "index.md")).text();
    expect(index).toContain("valid.md");
    expect(index).not.toContain("missing.md");
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("uses the dream engine to synthesize complete sources above the maintenance threshold", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-consolidation-project";
    const entries = Array.from({ length: 201 }, (_, index) => ({
      file: `topic-${index}.md`,
      content: `---\nrevision: "${index}"\n---\n\nCOMPLETE_START_${index}\n${"x".repeat(80)}\nCOMPLETE_END_${index}\n`,
    }));
    const path = await store(dataHome, directory, entries);
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
      return saveDecisions();
    });
    await app.message("ses_maintenance_writer", "Use memory.");
    await until(() => app.statuses().some((status) => status.state === "changed"));
    await app.dispose();

    expect(consolidationPrompt).toContain("COMPLETE_END_0");
    expect(consolidationPrompt).toContain("COMPLETE_END_1");
    const outputName = (await readdir(path)).find((name) => name.startsWith("consolidated-topic-"))!;
    const consolidatedContent = await Bun.file(join(path, outputName)).text();
    expect(consolidatedContent).toContain('sessionId: "ses_maintenance_writer"');
    expect(await Bun.file(join(path, "topic-0.md")).exists()).toBe(false);
    expect(await Bun.file(join(path, "topic-1.md")).exists()).toBe(false);
    expect(app.statuses().at(-1)!.counts).toEqual({ synthesize: 1, prune: 0 });
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("coordinates two plugin instances without losing either index entry", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-concurrent-project";
    const make = (title: string) => fixture(directory, (call) => isClassifier(call)
      ? saveDecisions(createDecision(`${title} durable fact`))
      : memoryExtraction({ title }));
    const [first, second] = await Promise.all([make("First writer"), make("Second writer")]);
    await Promise.all([
      first.message("ses_first", "First.").then(() => first.message("ses_first", "Save first.")).then(() => first.message("ses_first", "Continue.")),
      second.message("ses_second", "First.").then(() => second.message("ses_second", "Save second.")).then(() => second.message("ses_second", "Continue.")),
    ]);
    const path = join(dataHome, "opencode", "memory", serverProjectKey(directory));
    await until(async () => {
      const file = Bun.file(join(path, "index.md"));
      if (!(await file.exists())) return false;
      const index = await file.text();
      return index.includes("First writer") && index.includes("Second writer");
    });
    await Promise.all([first.dispose(), second.dispose()]);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("adds the complete current index and directory to main-model system context", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-system-context";
    const path = await store(dataHome, directory, [
      { file: "first.md", title: "First", summary: "First summary", content: "first" },
      { file: "second.md", title: "Second", summary: "Second summary", content: "second" },
      { file: "third.md", title: "Typed", summary: "[reference|editor|2026-08-01] Typed reference summary", content: "third" },
    ]);
    const app = await fixture(directory, () => saveDecisions());

    const output = await app.context("ses_index");
    expect(output.system[0]!.text).toContain(path);
    expect(output.system[0]!.text).toContain("[First](first.md) - First summary");
    expect(output.system[0]!.text).toContain("[Typed](third.md) - [reference|editor|2026-08-01] Typed reference summary");

    await Bun.write(join(path, "index.md"), "# Project memory\n\n- [Third](third.md) - Third summary\n");
    expect((await app.context("ses_index")).system).toEqual(output.system);
    expect((await app.context("ses_new")).system[0]!.text).toContain("Third summary");

    await Bun.write(join(path, "settings.json"), JSON.stringify({ enabled: false }));
    expect((await app.context("ses_index")).system).toEqual([]);
    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("allows external-directory access only for this memory directory", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-permission";
    const path = await store(dataHome, directory, [{ file: "topic.md", content: "topic" }]);
    const app = await fixture(directory, () => saveDecisions());

    expect(await app.permission("external_directory", [join(path, "*")])).toBe("allow");
    expect(await app.permission("external_directory", [`${path}-sibling/*`])).toBe("ask");
    expect(await app.permission("external_directory", [join(path, "*"), "/elsewhere/*"])).toBe("ask");
    expect(await app.permission("read", [join(path, "*")])).toBe("ask");
    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("queues compact deltas for the next user message without changing the system snapshot", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-delta-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-delta-project";
    const path = await store(dataHome, directory, [
      { file: "first.md", title: "First", summary: "First summary", content: "first" },
    ]);
    const app = await fixture(directory, (call) => {
      if (isClassifier(call)) return saveDecisions(createDecision("editor reply preference"));
      return memoryExtraction({
        title: "Concise replies",
        summary: "Prefer concise replies.",
        type: "preference",
        scope: "editor",
        content: "Keep replies short unless asked for detail.",
      });
    });

    // Snapshot the system context before any save; it must stay immutable.
    const before = await app.context("ses_delta");
    await app.message("ses_delta", "One.");
    await app.message("ses_delta", "Two.");
    await app.message("ses_delta", "Three.");
    const indexPath = join(path, "index.md");
    // The saved event follows the queued delta.
    await until(() => app.saved().length === 1);

    // The next genuine user message carries a compact delta text part.
    const next = await app.message("ses_delta", "Next question");
    const after = await app.context("ses_delta", [userMessage(next)]);
    expect(after.system).toEqual(before.system);
    const part = after.messages[0]!.content[1]!;
    expect(part.text).toContain("- [Concise replies](");
    expect(part.text).not.toContain("First summary");
    expect(part.text).not.toContain("Keep replies short");
    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("freezes deltas at the first request of a user message and defers mid-turn saves", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-freeze-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-freeze-project";
    const path = await store(dataHome, directory, []);
    const extraction = Promise.withResolvers<Extraction>();
    const started = Promise.withResolvers<void>();
    const app = await fixture(directory, (call) => {
      if (isClassifier(call)) return saveDecisions(createDecision("deferred durable rule"));
      started.resolve();
      return extraction.promise;
    });

    await app.message("ses_freeze", "One.");
    await app.message("ses_freeze", "Two.");
    const third = await app.message("ses_freeze", "Three.");
    await started.promise;

    // First request for this message: nothing committed yet, nothing injected.
    expect((await app.context("ses_freeze", [userMessage(third)])).messages[0]!.content).toHaveLength(1);

    // The save commits mid-turn; it must not be injected into the same message.
    extraction.resolve(memoryExtraction({
      title: "Deferred rule",
      summary: "A deferred durable rule.",
      type: "instruction",
      content: "Always defer mid-turn memory saves to the next genuine turn.",
    }));
    await until(() => app.saved().length === 1);
    expect((await app.context("ses_freeze", [userMessage(third)])).messages[0]!.content).toHaveLength(1);

    // A synthetic latest user message never receives the pending delta.
    const synthetic = await app.context("ses_freeze", [userMessage(third), userMessage("msg_synthetic")]);
    expect(synthetic.messages.map((message) => message.content.length)).toEqual([1, 1]);

    // The next genuine user message receives the frozen delta.
    const fourth = await app.message("ses_freeze", "Four.");
    const history = [userMessage(third), userMessage(fourth)];
    const request = await app.context("ses_freeze", history);
    expect(request.messages[1]!.content).toHaveLength(2);
    expect(request.messages[1]!.content[1]!.text).toContain("Deferred rule");

    // History is rebuilt for each request; the delta is injected again.
    const again = await app.context("ses_freeze", [userMessage(third), userMessage(fourth)]);
    expect(again.messages[1]!.content[1]!.text).toBe(request.messages[1]!.content[1]!.text);
    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

});

describe("memory idle revision gating", () => {
  test.serial("checkpoints a long completed message without truncating it or including the next turn", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-checkpoint-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-checkpoint-project";
    const prompt = `${"Complete user context. ".repeat(700)}Final qualification: only apply to the memory plugin.`;
    const app = await fixture(directory, () => saveDecisions(), { interval: 6 });
    await app.message("ses_checkpoint", prompt);
    expect(app.calls).toHaveLength(0);
    await app.message("ses_checkpoint", "NEW_TURN_EXCLUDED");
    await until(() => app.calls.length === 1);
    expect(app.calls[0]!.prompt).toContain(prompt);
    expect(app.calls[0]!.prompt).not.toContain("NEW_TURN_EXCLUDED");
    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("restores complete source after failure and waits for new content before reviewing again", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-idle-gate-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-idle-gate-project";
    const longPrompt = `${"A complete scoped user statement. ".repeat(500)}Do not generalize this exception.`;
    let classifications = 0;
    // The first classification returns malformed output, which fails loudly.
    const app = await fixture(directory, (call) => {
      if (isClassifier(call)) return ++classifications === 1 ? { decisions: "invalid" } : saveDecisions();
      return memoryExtraction();
    }, { idle_delay_ms: 1000 });
    const idle = () => app.emit("session.execution.succeeded", "ses_idle_gate");

    try {
      jest.useFakeTimers();
      await app.message("ses_idle_gate", "Alpha one.");
      await app.message("ses_idle_gate", longPrompt);
      await idle();
      jest.advanceTimersByTime(1000);
      await until(() => app.calls.length === 1);
      await settle();

      // A repeated idle event with nothing newly collected must not launch
      // another review of the restored buffer.
      await idle();
      jest.advanceTimersByTime(1000);
      await settle();
      expect(app.calls).toHaveLength(1);

      // A new genuine prompt makes the source reviewable again; the second
      // review sees the restored turns merged with the new one.
      await app.message("ses_idle_gate", "Gamma three.");
      await idle();
      jest.advanceTimersByTime(1000);
      await until(() => app.calls.length === 2);
      expect(app.calls[1]!.prompt).toContain("Alpha one.");
      expect(app.calls[1]!.prompt).toContain(longPrompt);
      expect(app.calls[1]!.prompt).toContain("Gamma three.");
      await settle();
    } finally {
      jest.useRealTimers();
    }
    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
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
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-init-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-init-project";
    const path = await store(dataHome, directory, [
      { file: "one.md", title: "One", content: seededTopic("aaa1111", "One body") },
      { file: "two.md", title: "Two", content: seededTopic("bbb2222", "Two body") },
      { file: "three.md", title: "Three", content: seededTopic("ccc3333", "Three body") },
    ]);
    await Bun.write(join(path, "settings.json"), JSON.stringify({ dream_auto: true }));
    const app = await fixture(directory, () => saveDecisions());
    await app.message("ses_auto_init", "Use memory.");
    const statePath = join(path, ".dream.json");
    await until(async () => Bun.file(statePath).exists());
    await app.dispose();

    const state = await Bun.file(statePath).json();
    expect(state).toMatchObject({ auto: true, additions: 3 });
    expect(app.calls.filter(isDreamSelector)).toHaveLength(0);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("resets counters after a due no-op run", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-gate-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-gate-project";
    const path = await store(dataHome, directory, [
      { file: "one.md", title: "One", content: seededTopic("aaa1111", "One body") },
      { file: "two.md", title: "Two", content: seededTopic("bbb2222", "Two body") },
    ]);
    const statePath = join(path, ".dream.json");
    await Bun.write(join(path, "settings.json"), JSON.stringify({ dream_auto: true }));
    const app = await fixture(directory, (call) => (isDreamSelector(call) ? { action: "none" } : saveDecisions()));
    await Bun.write(statePath, JSON.stringify({ auto: true, additions: 7, since: Date.now() - 37 * 3_600_000 }));
    await app.message("ses_gate", "Use memory.");
    await until(() => app.statuses().some((status) => status.state === "noop"));
    await app.dispose();

    const state = await Bun.file(statePath).json();
    expect(state.additions).toBe(0);
    expect(typeof state.lastRunAt).toBe("number");
    await rm(dataHome, { recursive: true, force: true });
  });
});

describe("memory manual dreaming", () => {
  const finished = (app: Awaited<ReturnType<typeof fixture>>, state: string, requestID?: string) =>
    until(() => app.statuses().some((status) => status.state === state && (!requestID || status.requestID === requestID)));

  test.serial("handles an rpc request without another message", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-rpc-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-rpc-project";
    await store(dataHome, directory, [
      { file: "x.md", title: "X", content: seededTopic("abc1111", "X body") },
      { file: "y.md", title: "Y", content: seededTopic("def2222", "Y body") },
    ]);
    const app = await fixture(
      directory,
      (call) => isDreamSelector(call) ? { action: "none" } : saveDecisions(),
      { dream_model: "test/deep-model#deep" },
    );

    await app.dream("req-rpc", "ses_rpc");
    await finished(app, "noop", "req-rpc");
    expect(app.statuses()[0]).toMatchObject({ requestID: "req-rpc", state: "running", sessionID: "ses_rpc" });
    const dreamCall = app.calls.filter(isDreamSelector);
    expect(dreamCall).toHaveLength(1);
    expect(dreamCall[0]!.model).toEqual({ providerID: "test", id: "deep-model", variant: "deep" });

    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("synthesizes complete replacements across iterations without source history", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-run-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-run-project";
    const sourceBody = Array.from({ length: 600 }, (_, i) => `Observation ${i}: the shared pattern has this condition and qualification.`).join("\n");
    const synthesizedBody = Array.from({ length: 80 }, (_, i) => `- Fact ${i}: retain its distinct condition and qualification.`).join("\n");
    const path = await store(dataHome, directory, [
      { file: "a.md", title: "Alpha plan", summary: "[recap|project|2026-08-01] Alpha summary", content: seededTopic("aaaa1111", "ALPHA_BODY_ONE shared duplicate fact") },
      { file: "b.md", title: "Alpha variant", summary: "[recap|project|2026-08-01] Alpha variant summary", content: seededTopic("bbbb2222", "ALPHA_BODY_TWO shared duplicate fact") },
      { file: "c.md", title: "Gamma outcome", summary: "[recap|project|2026-08-01] Gamma summary", content: seededTopic("cccc3333", "GAMMA_BODY outdated claim") },
      { file: "d.md", title: "Delta note", summary: "[insight|project|2026-08-01] Delta summary", content: seededTopic("dddd4444", sourceBody, "insight") },
    ]);

    const findPrefix = async (prefix: string) => (await readdir(path)).find((name) => name.startsWith(prefix))!;
    let selections = 0;
    let curations = 0;
    const app = await fixture(directory, async (call) => {
      if (isDreamSelector(call)) {
        selections += 1;
        if (selections === 1) return { action: "synthesize", files: ["a.md", "b.md"], reason: "duplicate alpha recaps" };
        if (selections === 2) return { action: "synthesize", files: [await findPrefix("merged-alpha-"), "c.md"], reason: "corrected gamma outcome" };
        if (selections === 3) return { action: "synthesize", files: [await findPrefix("superseding-gamma-"), "d.md"], reason: "shared stable pattern" };
        return { action: "none" };
      }
      if (isDreamCurator(call)) {
        curations += 1;
        if (curations === 1) return memoryExtraction({ title: "Merged alpha" });
        if (curations === 2) return memoryExtraction({ title: "Superseding gamma" });
        expect(call.prompt).toContain(sourceBody);
        return memoryExtraction({ title: "Cross-topic insight", content: synthesizedBody });
      }
      return saveDecisions();
    });

    await app.dream("req-big", "ses_dreamer");
    await finished(app, "changed");
    await app.dispose();

    const status = app.statuses().at(-1)!;
    const manifest = await Bun.file(join(path, ".dreams", `${status.runID}.json`)).json();
    const merged = manifest.actions[0].output.file as string;
    const superseded = manifest.actions[1].output.file as string;
    const insight = manifest.actions[2].output.file as string;
    const names = await readdir(path);
    for (const gone of ["a.md", "b.md", "c.md", "d.md", merged, superseded]) expect(names).not.toContain(gone);

    const index = await Bun.file(join(path, "index.md")).text();
    expect(index).not.toContain(`(${merged})`);
    expect(index).not.toContain(`(${superseded})`);
    expect(index).toContain(`(${insight})`);

    const insightContent = await Bun.file(join(path, insight)).text();
    expect(insightContent).toContain('type: "insight"');
    expect(insightContent).toContain('sessionId: "ses_dreamer"');
    expect(insightContent).not.toContain("sources:");
    expect(insightContent).toContain(synthesizedBody);
    for (const action of manifest.actions) {
      expect(action.sources).toBeUndefined();
      expect(action.output.revision).toBeUndefined();
    }

    expect(status.counts).toEqual({ synthesize: 3, prune: 0 });
    expect(JSON.stringify(manifest)).not.toContain("ALPHA_BODY");
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("prunes a singleton into quarantine with evidence", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-prune-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-prune-project";
    const path = await store(dataHome, directory, [{
      file: "receipt.md",
      title: "Completed cleanup",
      summary: "[recap|plugins/memory|2026-08-01] Cleanup receipt",
      content: seededTopic("abc1111", "The cleanup commit landed and tests pass."),
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
      return saveDecisions();
    });

    await app.dream("req-prune", "ses_prune");
    await finished(app, "changed");
    await app.dispose();

    const status = app.statuses().at(-1)!;
    expect(await Bun.file(join(path, "receipt.md")).exists()).toBe(false);
    expect(await Bun.file(join(path, ".trash", status.runID, "receipt.md")).text()).toContain("cleanup commit landed");
    expect(await Bun.file(join(path, "index.md")).text()).not.toContain("receipt.md");
    const manifest = await Bun.file(join(path, ".dreams", `${status.runID}.json`)).json();
    expect(manifest.actions[0].verdicts[0]).toMatchObject({
      file: "receipt.md",
      verdict: "remove",
      evidence: ["plugins/memory/memory.test.ts"],
      quarantinePath: `.trash/${status.runID}/receipt.md`,
    });
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("safely keeps evidence-less removals and does not reselect all-kept nominations", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-prune-keep-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-prune-keep-project";
    const path = await store(dataHome, directory, [
      { file: "a.md", title: "A", content: seededTopic("aaa1111", "Potentially durable rationale.") },
      { file: "b.md", title: "B", content: seededTopic("bbb2222", "Another durable constraint.") },
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
      return saveDecisions();
    });

    await app.dream("req-keep", "ses_keep");
    await finished(app, "noop");
    await app.dispose();

    expect(await Bun.file(join(path, "a.md")).exists()).toBe(true);
    const manifest = await Bun.file(join(path, ".dreams", `${app.statuses().at(-1)!.runID}.json`)).json();
    expect(manifest.actions[0].verdicts[0]).toMatchObject({ file: "a.md", verdict: "keep" });
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("prunes topics independently of legacy insight source metadata", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-prune-cascade-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-prune-cascade-project";
    const insight = `---\nrevision: "def2222"\ntype: "insight"\nscope: "project"\nsessionId: "ses_seed"\nupdatedAt: "2026-08-01"\nsources: ["source.md@abc1111"]\n---\n\nDerived only from the source.\n`;
    const path = await store(dataHome, directory, [
      { file: "source.md", title: "Source", content: seededTopic("abc1111", "Passing test receipt.") },
      { file: "insight.md", title: "Insight", summary: "[insight|project|2026-08-01] Derived", content: insight },
    ]);
    let selections = 0;
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return ++selections === 1
        ? { action: "prune", files: ["source.md"], reason: "receipt" }
        : { action: "none" };
      if (isDreamCurator(call)) return { verdicts: [{ file: "source.md", verdict: "remove", category: "task_receipt", reason: "Only a test receipt.", evidence: [] }] };
      return saveDecisions();
    });

    await app.dream("req-cascade", "ses_cascade");
    await finished(app, "changed");
    await app.dispose();

    const status = app.statuses().at(-1)!;
    expect(await Bun.file(join(path, "source.md")).exists()).toBe(false);
    expect(await Bun.file(join(path, "insight.md")).text()).toBe(insight);
    const manifest = await Bun.file(join(path, ".dreams", `${status.runID}.json`)).json();
    expect(manifest.actions[0].verdicts).toHaveLength(1);
    expect(status.counts).toEqual({ synthesize: 0, prune: 1 });
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("purges successful older quarantine only after a later successful run", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-trash-retention-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-trash-retention-project";
    const path = await store(dataHome, directory, [{ file: "old.md", content: seededTopic("abc1111", "Task receipt.") }]);

    let app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "prune", files: ["old.md"], reason: "receipt" };
      if (isDreamCurator(call)) return { verdicts: [{ file: "old.md", verdict: "remove", category: "task_receipt", reason: "Receipt only.", evidence: [] }] };
      return saveDecisions();
    });
    await app.dream("req-trash-1", "ses_trash");
    await finished(app, "changed");
    const firstRun = app.statuses().at(-1)!.runID;
    await app.dispose();
    expect(await Bun.file(join(path, ".trash", firstRun, "old.md")).exists()).toBe(true);

    await Bun.write(join(path, "new.md"), seededTopic("def2222", "Still durable."));
    await Bun.write(join(path, "index.md"), "# Project memory\n\n- [New](new.md) - Stored topic\n");

    app = await fixture(directory, (call) => isDreamSelector(call) ? { action: "prune", files: [], reason: "malformed" } : saveDecisions());
    await app.dream("req-trash-2", "ses_trash");
    await finished(app, "failed");
    await app.dispose();
    expect(await Bun.file(join(path, ".trash", firstRun, "old.md")).exists()).toBe(true);

    const corruptRun = "corrupt-run";
    await mkdir(join(path, ".trash", corruptRun), { recursive: true });
    await Bun.write(join(path, ".trash", corruptRun, "recoverable.md"), "quarantined");
    await Bun.write(join(path, ".dreams", `${corruptRun}.json`), "{");

    app = await fixture(directory, (call) => isDreamSelector(call) ? { action: "none" } : saveDecisions());
    await app.dream("req-trash-3", "ses_trash");
    await finished(app, "noop");
    await app.dispose();
    expect(await Bun.file(join(path, ".trash", firstRun, "old.md")).exists()).toBe(false);
    expect(await Bun.file(join(path, ".trash", corruptRun, "recoverable.md")).exists()).toBe(true);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("aborts a stale run without resetting the counters but keeps its manifest", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-stale-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-stale-project";
    const path = await store(dataHome, directory, [
      { file: "x.md", title: "X topic", summary: "[recap|project|2026-08-01] X summary", content: seededTopic("abc1234", "X_SHARED_BODY") },
      { file: "y.md", title: "Y topic", summary: "[recap|project|2026-08-01] Y summary", content: seededTopic("def5678", "Y_SHARED_BODY") },
    ]);
    await Bun.write(join(path, ".dream.json"), JSON.stringify({ auto: true, additions: 3, since: Date.now() }));

    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<Extraction>();
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "synthesize", files: ["x.md", "y.md"], reason: "duplicate topics" };
      if (isDreamCurator(call)) {
        started.resolve();
        return gate.promise;
      }
      return saveDecisions();
    });

    await app.dream("req-stale", "ses_dreamer");
    await started.promise;
    // One source mutates on disk while the executor runs: the commit must
    // detect the stale snapshot and abort the whole run.
    await Bun.write(join(path, "x.md"), seededTopic("abc4567", "X_MUTATED_BODY"));
    gate.resolve(memoryExtraction({ title: "Merged xy" }));
    await finished(app, "failed");
    await app.dispose();

    expect(app.statuses().at(-1)!.message).toContain("changed");
    expect(await Bun.file(join(path, "x.md")).text()).toContain("X_MUTATED_BODY");
    expect(await Bun.file(join(path, "y.md")).text()).toContain("Y_SHARED_BODY");
    const state = await Bun.file(join(path, ".dream.json")).json();
    expect(state.additions).toBe(3);
    expect(typeof state.failAt).toBe("number");
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("fails a manual request while another instance holds the dream lock", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-lock-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-lock-project";
    await store(dataHome, directory, [
      { file: "x.md", title: "X topic", summary: "[recap|project|2026-08-01] X summary", content: seededTopic("abc1111", "X_LOCK_BODY") },
      { file: "y.md", title: "Y topic", summary: "[recap|project|2026-08-01] Y summary", content: seededTopic("def2222", "Y_LOCK_BODY") },
    ]);

    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = await fixture(directory, (call) => {
      if (isDreamSelector(call)) {
        started.resolve();
        return release.promise.then(() => ({ action: "none" }));
      }
      return saveDecisions();
    });
    const second = await fixture(directory, (call) => isDreamSelector(call) ? { action: "none" } : saveDecisions());

    await first.dream("req-lock-1", "ses_lock");
    await started.promise;
    await second.dream("req-lock-2", "ses_lock");
    await finished(second, "failed", "req-lock-2");
    expect(second.statuses().at(-1)!.message).toContain("another OpenCode process");
    expect(second.calls.filter(isDreamSelector)).toHaveLength(0);

    release.resolve();
    await finished(first, "noop", "req-lock-1");
    await Promise.all([first.dispose(), second.dispose()]);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("broadcasts upsert and tombstone deltas to all live sessions", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-delta-dream-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-delta-project";
    await store(dataHome, directory, [
      { file: "x.md", title: "X topic", summary: "[recap|project|2026-08-01] X summary", content: seededTopic("abc1111", "X_DELTA_BODY") },
      { file: "y.md", title: "Y topic", summary: "[recap|project|2026-08-01] Y summary", content: seededTopic("def2222", "Y_DELTA_BODY") },
    ]);
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "synthesize", files: ["x.md", "y.md"], reason: "duplicate topics" };
      if (isDreamCurator(call)) return memoryExtraction({ title: "Unified story" });
      return saveDecisions();
    });

    // Live sessions first, so their delta queues exist before the dream.
    const messages = new Map<string, string>();
    for (const sessionID of ["ses_one", "ses_two", "ses_three"]) messages.set(sessionID, await app.message(sessionID, "Hello."));
    await app.dream("req-broadcast", "ses_three");
    await finished(app, "changed");
    await app.dispose();

    for (const [sessionID, messageID] of messages) {
      const part = (await app.context(sessionID, [userMessage(messageID)])).messages[0]!.content[1]!;
      expect(part.text).toContain("- [Unified story](");
      expect(part.text).toContain("Removed topics: x.md, y.md");
    }
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("keeps additions recorded while a dream was running", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-keep-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-keep-project";
    const path = await store(dataHome, directory, [
      { file: "x.md", title: "X topic", summary: "[recap|project|2026-08-01] X summary", content: seededTopic("abc1111", "X_KEEP_BODY") },
      { file: "y.md", title: "Y topic", summary: "[recap|project|2026-08-01] Y summary", content: seededTopic("def2222", "Y_KEEP_BODY") },
    ]);
    await Bun.write(join(path, ".dream.json"), JSON.stringify({ auto: true, additions: 4, since: Date.now() }));

    const curatorGate = Promise.withResolvers<Extraction>();
    const curatorStarted = Promise.withResolvers<void>();
    let classifications = 0;
    const app = await fixture(directory, (call) => {
      if (isDreamSelector(call)) return { action: "synthesize", files: ["x.md", "y.md"], reason: "duplicate topics" };
      if (isDreamCurator(call)) {
        curatorStarted.resolve();
        return curatorGate.promise;
      }
      if (isClassifier(call)) {
        classifications += 1;
        return saveDecisions(createDecision("a rule saved during the dream"));
      }
      return memoryExtraction();
    });

    await app.dream("req-keep", "ses_keep");
    await curatorStarted.promise;
    // An ordinary checkpoint save commits while the dream is parked mid-run.
    await app.message("ses_keep", "Start dreaming.");
    await app.message("ses_keep", "Remember something during the dream.");
    await app.message("ses_keep", "Second turn.");
    await until(() => classifications >= 1);
    await until(async () => ((await Bun.file(join(path, ".dream.json")).json()) as { additions?: number }).additions === 5);
    curatorGate.resolve(memoryExtraction({ title: "Merged keep" }));
    await finished(app, "changed");
    await app.dispose();

    // Only the pre-dream baseline (4) is subtracted; the concurrent save (+1)
    // survives completion.
    const state = await Bun.file(join(path, ".dream.json")).json();
    expect(state.additions).toBe(1);
    await rm(dataHome, { recursive: true, force: true });
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
  test.serial("preserves settings when automatic dreaming is toggled", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-tui-dream-toggle-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-tui-dream-toggle";
    const memoryDirectory = join(dataHome, "opencode", "memory", tuiProjectKey(directory));
    await mkdir(memoryDirectory, { recursive: true });
    const settingsPath = join(memoryDirectory, "settings.json");
    await Bun.write(settingsPath, JSON.stringify({ enabled: false, custom: "keep" }));
    const app = await tuiFixture(directory);

    app.command("memory");
    await app.select({ type: "dreamToggle" });
    await until(async () => (await Bun.file(settingsPath).json() as { dream_auto?: boolean }).dream_auto === true);
    expect(await Bun.file(settingsPath).json()).toEqual({ enabled: false, custom: "keep", dream_auto: true });
    await app.select(undefined);

    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
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
    expect(app.toasts.map((toast) => toast.message)).toEqual(["Reviewing conversation...", "Saved: Saved topic"]);
    await app.dispose();
  });
});
