import { afterEach, describe, expect, jest, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import MemoryModule, {
  dreamDue,
  indexLine,
  insightSources,
  memoryProjectKey as serverProjectKey,
  parseIndexLine,
  validateDreamOptions,
} from "./memory_server.tsx";
import MemoryTui, { dreamCountsMessage, managedIndexEntries, memoryProjectKey as tuiProjectKey, toggledSettings, topicDreamRunId, topicRevision, topicSessionId } from "./memory_tui.tsx";

const originalDataHome = process.env.XDG_DATA_HOME;
afterEach(() => {
  if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalDataHome;
});

type WorkerCall = { parentID: string; system: string; prompt: string; variant?: string; sessionVariant?: string };
type FakeMessage = { info: { id: string; sessionID: string; role: string }; parts: Array<{ type?: string; id?: string; synthetic?: boolean; text: string }> };

async function fixture(
  directory: string,
  respond: (call: WorkerCall) => unknown,
  options: {
    classifier_model?: string;
    classifier_variant?: string;
    extractor_model?: string;
    extractor_variant?: string;
    dream_model?: string;
    dream_variant?: string;
    interval?: number;
    idle_delay_ms?: number;
    dream_interval_hours?: number;
    dream_min_additions?: number;
  } = {},
) {
  const calls: WorkerCall[] = [];
  const creations: unknown[] = [];
  let parentID = "";
  let sessionVariant: string | undefined;
  const client = {
    session: {
      create: async (options: { body: { parentID: string; metadata?: unknown; model?: { variant?: string } } }) => {
        parentID = options.body.parentID;
        sessionVariant = options.body.model?.variant;
        creations.push(options.body.metadata ?? null);
        return { data: { id: crypto.randomUUID() } };
      },
      prompt: async (options: { body: { system: string; parts: { text: string }[]; variant?: string } }) => {
        const call = { parentID, system: options.body.system, prompt: options.body.parts[0]!.text, variant: options.body.variant, sessionVariant };
        calls.push(call);
        return { data: { info: { structured: await respond(call) } } };
      },
      abort: async () => ({ data: true }),
      delete: async () => ({ data: true }),
    },
    app: { log: async () => ({}) },
  };
  const hooks = await MemoryModule.server!({ client, directory } as never, { interval: 2, ...options } as never);
  await hooks.config!({ small_model: "test/small" } as never);
  return {
    hooks,
    calls,
    creations,
    message: async (sessionID: string, text: string) => {
      const output = { message: { id: crypto.randomUUID() }, parts: [{ type: "text", text }] };
      await hooks["chat.message"]!({ sessionID } as never, output as never);
      return output;
    },
    agentOutput: (sessionID: string, text: string) => hooks["experimental.text.complete"]!(
      { sessionID, messageID: crypto.randomUUID(), partID: crypto.randomUUID() },
      { text },
    ),
  };
}

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

// Pre-taxonomy topic: no `type` line at all, so the effective type comes from
// the server's frontmatter fallback rather than the index.
const legacyTopic = (revision: string, body: string) =>
  `---\nrevision: "${revision}"\nscope: "legacy scope"\nsessionId: "ses_seed"\nupdatedAt: "2026-08-01"\n---\n\n${body}\n`;

const workerSystem = (call: WorkerCall | string) => typeof call === "string" ? call : call.system;
const isDreamSelector = (call: WorkerCall | string) => workerSystem(call).includes("consolidation selector");
const isDreamCurator = (call: WorkerCall | string) => workerSystem(call).includes("project-memory curator");

async function until(condition: () => boolean | Promise<boolean>) {
  while (!(await condition())) await new Promise<void>((resolve) => setImmediate(resolve));
}

// Flush pending microtask and filesystem callbacks without waiting on real
// time (safe under fake timers), so background restore/cleanup work settles.
async function settle() {
  for (let i = 0; i < 25; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("memory project directory keys", () => {
  test("creates a readable normalized name with an 8-character hash", () => {
    const key = serverProjectKey("/Tmp/My Project+");

    expect(key).toMatch(/^-tmp-my-project--[a-f0-9]{8}$/);
    expect(key).toMatch(/^[a-z0-9._-]+$/);
  });

  test("distinguishes paths with the same normalized name", () => {
    expect(serverProjectKey("/a/b-c")).not.toBe(serverProjectKey("/a-b/c"));
  });

  test("is stable", () => {
    expect(serverProjectKey("/tmp/project")).toBe(serverProjectKey("/tmp/project"));
  });

  test("matches the TUI implementation", () => {
    for (const directory of ["/tmp/project", "/tmp/My Project+", "/a/b-c", "/a-b/c"]) {
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
    expect(typed.summary).toBe("Be concise");
    expect(indexLine(typed)).toBe("- [Typed](typed.md) - [preference|editor|2026-08-01] Be concise");

    // Unknown type tokens degrade to an untyped entry without losing data.
    const unknown = parseIndexLine("- [X](x.md) - [mystery|scope|2026-01-02] S")!;
    expect(unknown.metadata.type).toBeUndefined();
    expect(unknown.metadata.scope).toBe("scope");
    expect(unknown.summary).toBe("S");

    // Insights round-trip like any other stored type.
    const insight = parseIndexLine("- [Pattern](pattern.md) - [insight|project|2026-08-23] Derived pattern")!;
    expect(insight.metadata).toEqual({ type: "insight", scope: "project", updated: "2026-08-23" });
    expect(indexLine(insight)).toBe("- [Pattern](pattern.md) - [insight|project|2026-08-23] Derived pattern");

    expect(parseIndexLine("- [Nested](nested/e.md) - s")).toBeUndefined();

    // Rendering scrubs separator characters and CR/LF so generated scope stays
    // a parseable one-liner.
    const scrubbed = indexLine({ title: "T", file: "t.md", summary: "S", metadata: { type: "recap", scope: "a|b[c]\nd\re", updated: "2026-08-23" } });
    expect(scrubbed).toContain("[recap|a b c  d e|2026-08-23]");
    expect(parseIndexLine(scrubbed)!.metadata.scope).toBe("a b c  d e");
  });
});

describe("memory persistence", () => {
  test.serial("sends configured variants with classifier and extractor worker calls", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-variants-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-variant-project";
    const app = await fixture(directory, ({ system }) =>
      system.includes("classifier")
        ? saveDecisions(createDecision("the completed parser migration"))
        : memoryExtraction(), {
      classifier_variant: "fast",
      extractor_variant: "thorough",
    });

    await app.message("ses_variants", "The parser migration is complete.");
    await app.message("ses_variants", "The focused tests pass.");
    await app.message("ses_variants", "Continue.");
    await until(() => app.calls.length >= 2);
    await app.hooks.dispose!();

    expect(app.calls[0]!.variant).toBe("fast");
    expect(app.calls[0]!.sessionVariant).toBe("fast");
    expect(app.calls[1]!.variant).toBe("thorough");
    expect(app.calls[1]!.sessionVariant).toBe("thorough");
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("creates typed memory with the originating session as last writer", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const structured = [
      saveDecisions(createDecision("confirmed focused test approach")),
      {
        title: "Confirmed test approach",
        summary: "Use the confirmed focused test approach.",
        type: "instruction",
        scope: "testing",
        content: "Run the affected plugin's focused Bun test before the full suite.",
      },
    ];
    let worker = 0;
    const workerPrompts: string[] = [];
    const workerSystems: string[] = [];
    const workerMetadata: unknown[] = [];
    const client = {
      session: {
        create: async (options: { body: { metadata?: unknown } }) => {
          workerMetadata.push(options.body.metadata);
          return { data: { id: `worker-${worker}` } };
        },
        prompt: async (options: { body: { system: string; parts: { text: string }[] } }) => {
          workerSystems.push(options.body.system);
          workerPrompts.push(options.body.parts[0]!.text);
          return { data: { info: { structured: structured[worker++] } } };
        },
        abort: async () => ({ data: true }),
        delete: async () => ({ data: true }),
      },
      app: { log: async () => ({}) },
    };
    const directory = "/tmp/memory-plugin-project";
    const plugin = await MemoryModule.server!({ client, directory } as never, { interval: 2 } as never);
    await plugin.config!({ small_model: "test/small" } as never);

    const message = (text: string) => plugin["chat.message"]!(
      { sessionID: "ses_origin" } as never,
      { message: { id: crypto.randomUUID() }, parts: [{ type: "text", text }] } as never,
    );
    await message("Remember confirmed approaches.");
    await plugin["experimental.text.complete"]!({ sessionID: "ses_origin", messageID: "assistant-1", partID: "part-1" } as never,
      { text: "The focused Bun test is the confirmed approach." });
    await plugin["tool.execute.after"]!({ sessionID: "ses_origin", tool: "bash", args: { command: "bun test" } } as never,
      { title: "failed", output: "FAILED_EVIDENCE", metadata: { exit: 1 } } as never);
    await plugin["tool.execute.after"]!({ sessionID: "ses_origin", tool: "bash", args: { command: "bun test" } } as never,
      { title: "passed", output: "SUCCESS_EVIDENCE", metadata: { exit: 0 } } as never);
    await plugin["tool.execute.after"]!({ sessionID: "ses_origin", tool: "read", args: {} } as never,
      { title: "read", output: "READ_EVIDENCE", metadata: { exit: 1 } } as never);
    await message("This focused test approach worked.");
    await message("Continue.");
    const memoryDirectory = join(dataHome, "opencode", "memory", serverProjectKey(directory));
    await until(async () => Bun.file(join(memoryDirectory, "index.md")).exists());
    await plugin.dispose!();

    const topic = (await readdir(memoryDirectory)).find((name) => name.endsWith(".md") && name !== "index.md")!;
    const content = await Bun.file(join(memoryDirectory, topic)).text();
    expect(content).toContain('type: "instruction"');
    expect(content).toContain('scope: "testing"');
    expect(content).toMatch(/updatedAt: "\d{4}-\d{2}-\d{2}"/);
    expect(content).toContain('sessionId: "ses_origin"');
    const index = await Bun.file(join(memoryDirectory, "index.md")).text();
    expect(index).toMatch(
      /- \[Confirmed test approach\]\([a-z0-9-]+\.md\) - \[instruction\|testing\|\d{4}-\d{2}-\d{2}\] Use the confirmed focused test approach\./,
    );

    // The classifier sees only previously completed turns: buffered prompts and
    // the completed assistant output, but neither the triggering prompt nor any
    // tool output body.
    expect(workerPrompts[0]).toContain("Remember confirmed approaches.");
    expect(workerPrompts[0]).toContain("This focused test approach worked.");
    expect(workerPrompts[0]).toContain("agent_output");
    expect(workerPrompts[0]).toContain("The focused Bun test is the confirmed approach.");
    expect(workerPrompts[0]).not.toContain("Continue.");
    expect(workerPrompts[0]).toContain("bash: passed");
    expect(workerPrompts[0]).toContain("read: read");
    expect(workerPrompts[0]).not.toContain("command: bun test");
    expect(workerPrompts[0]).not.toContain("SUCCESS_EVIDENCE");
    expect(workerPrompts[0]).not.toContain("READ_EVIDENCE");
    expect(workerPrompts[0]).not.toContain("FAILED_EVIDENCE");
    expect(workerPrompts[0]).toContain("Recaps are only for completed tasks.");
    expect(workerPrompts[0]).toContain("questions and answers");
    // Extraction is constrained to the decision subject.
    expect(workerPrompts[1]).toContain("<subject>");
    expect(workerPrompts[1]).toContain("confirmed focused test approach");
    expect(workerSystems[1]).toContain("concretely completed task");
    expect(workerMetadata[0]).toEqual({ memoryWorker: true, memoryActivity: "classification" });
    expect(workerMetadata[1]).toEqual({ memoryWorker: true, memoryActivity: "extraction" });
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
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) {
        return classifications++ === 0 ? saveDecisions() : saveDecisions(replaceDecision("legacy.md", "the established rule"));
      }
      return memoryExtraction({ title: "Updated legacy" });
    });
    await app.message("ses_latest", "Load memory.");
    await app.message("ses_latest", "Update the established rule.");
    await app.message("ses_latest", "Continue.");
    await until(() => app.calls.length >= 1);
    // Let the failed checkpoint finish restoring its snapshot and clearing the
    // in-flight marker before driving the next one.
    await Bun.sleep(50);
    await app.message("ses_latest", "Apply the update.");
    await app.message("ses_latest", "Make it durable.");
    const indexPath = join(path, "index.md");
    await until(async () => (await Bun.file(indexPath).text()).includes("[Updated legacy](legacy.md)"));
    await app.hooks.dispose!();

    const topic = await Bun.file(join(path, "legacy.md")).text();
    const index = await Bun.file(indexPath).text();
    expect(topic).toContain('type: "recap"');
    expect(topic).toContain('scope: "project"');
    expect(topic).toMatch(/updatedAt: "\d{4}-\d{2}-\d{2}"/);
    expect(topic).toContain('sessionId: "ses_latest"');
    expect(index).toMatch(/- \[Updated legacy\]\(legacy\.md\) - \[recap\|project\|\d{4}-\d{2}-\d{2}\] A durable project outcome\./);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("does not persist or maintain when disabled during extraction", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-disabled-project";
    const extraction = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    let selections = 0;
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) return saveDecisions(createDecision("a durable rule"));
      if (system.includes("Select a single group")) {
        selections += 1;
        return { files: [] };
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
    await app.hooks.dispose!();

    const names = await readdir(path);
    expect(names.filter((name) => name.endsWith(".md") && name !== "index.md")).toEqual([]);
    expect(selections).toBe(0);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("preserves unrelated topics when semantic maintenance selects none", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-unrelated-project";
    const entries = Array.from({ length: 201 }, (_, index) => ({ file: `topic-${index}.md`, content: `complete ${index}` }));
    const path = await store(dataHome, directory, entries);
    const selected = Promise.withResolvers<void>();
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("Select a single group")) {
        selected.resolve();
        return { files: [] };
      }
      return [];
    });
    await app.message("ses_maintenance", "Use memory.");
    await selected.promise;
    await app.hooks.dispose!();

    expect((await Bun.file(join(path, "index.md")).text()).match(/^- \[/gm)).toHaveLength(201);
    expect((await readdir(path)).filter((name) => name.startsWith("topic-"))).toHaveLength(201);
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
    await app.hooks.dispose!();

    const index = await Bun.file(join(path, "index.md")).text();
    expect(index).toContain("valid.md");
    expect(index).not.toContain("missing.md");
    expect(await Bun.file(join(path, "orphan.md")).exists()).toBe(false);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("consolidates complete selected sources with the maintenance session as writer", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-consolidation-project";
    const entries = Array.from({ length: 201 }, (_, index) => ({
      file: `topic-${index}.md`,
      content: `---\nrevision: "${index}"\n---\n\nCOMPLETE_START_${index}\n${"x".repeat(80)}\nCOMPLETE_END_${index}\n`,
    }));
    const path = await store(dataHome, directory, entries);
    let consolidationPrompt = "";
    const consolidated = Promise.withResolvers<void>();
    const app = await fixture(directory, ({ system, prompt }) => {
      if (system.includes("Select a single group")) return { files: ["topic-0.md", "topic-1.md"] };
      if (system.includes("Consolidate the supplied")) {
        consolidationPrompt = prompt;
        consolidated.resolve();
        return memoryExtraction({ title: "Consolidated topic" });
      }
      return saveDecisions();
    });
    await app.message("ses_maintenance_writer", "Use memory.");
    await consolidated.promise;
    await app.hooks.dispose!();

    expect(consolidationPrompt).toContain("COMPLETE_START_0");
    expect(consolidationPrompt).toContain("COMPLETE_END_0");
    expect(consolidationPrompt).toContain("COMPLETE_START_1");
    expect(consolidationPrompt).toContain("COMPLETE_END_1");
    const outputName = (await readdir(path)).find((name) => name.startsWith("consolidated-topic-"))!;
    const consolidatedContent = await Bun.file(join(path, outputName)).text();
    expect(consolidatedContent).toContain('sessionId: "ses_maintenance_writer"');
    expect(consolidatedContent).toContain('scope: "project"');
    expect(consolidatedContent).toMatch(/updatedAt: "\d{4}-\d{2}-\d{2}"/);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("coordinates two plugin instances without losing either index entry", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-concurrent-project";
    const make = (title: string) => fixture(directory, ({ system }) => system.includes("classifier")
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
    await Promise.all([first.hooks.dispose!(), second.hooks.dispose!()]);

    const index = await Bun.file(join(path, "index.md")).text();
    expect(index).toContain("First writer");
    expect(index).toContain("Second writer");
    expect(index.match(/^- \[/gm)).toHaveLength(2);
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

    const output = { system: [] as string[] };
    await app.hooks["experimental.chat.system.transform"]!({ sessionID: "ses_index" } as never, output);
    expect(output.system).toHaveLength(1);
    expect(output.system[0]!.startsWith("<memory>\n")).toBe(true);
    expect(output.system[0]!.endsWith("\n</memory>")).toBe(true);
    expect(output.system[0]).toContain(path);
    expect(output.system[0]).toContain("[First](first.md) - First summary");
    expect(output.system[0]).toContain("[Second](second.md) - Second summary");
    // Typed index lines round-trip with their metadata prefix intact.
    expect(output.system[0]).toContain("[Typed](third.md) - [reference|editor|2026-08-01] Typed reference summary");
    expect(output.system[0]).toContain("normal read tool");
    expect(output.system[0]).toContain("Memories are hints only, not authoritative facts.");
    expect(output.system[0]).toContain("Verify relevant details against the current conversation, project state, or primary sources");
    expect(app.hooks.tool).toBeUndefined();

    await Bun.write(join(path, "index.md"), "# Project memory\n\n- [Third](third.md) - Third summary\n");
    const sameSession = { system: [] as string[] };
    await app.hooks["experimental.chat.system.transform"]!({ sessionID: "ses_index" } as never, sameSession);
    expect(sameSession.system).toEqual(output.system);
    expect(sameSession.system[0]).not.toContain("Third summary");

    const newSession = { system: [] as string[] };
    await app.hooks["experimental.chat.system.transform"]!({ sessionID: "ses_new" } as never, newSession);
    expect(newSession.system[0]).toContain("Third summary");

    const missingSession = { system: [] as string[] };
    await app.hooks["experimental.chat.system.transform"]!({} as never, missingSession);
    expect(missingSession.system).toEqual([]);
    await Bun.write(join(path, "settings.json"), JSON.stringify({ enabled: false }));
    const disabled = { system: [] as string[] };
    await app.hooks["experimental.chat.system.transform"]!({ sessionID: "ses_index" } as never, disabled);
    expect(disabled.system).toEqual([]);
    await app.hooks.dispose!();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("allows external-directory asks only for files inside this memory directory", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-permission";
    const path = await store(dataHome, directory, [{ file: "topic.md", content: "topic" }]);
    const app = await fixture(directory, () => saveDecisions());
    const ask = async (type: string, filepath: string) => {
      const output = { status: "ask" as "ask" | "allow" | "deny" };
      await app.hooks["permission.ask"]!({ type, metadata: { filepath } } as never, output);
      return output.status;
    };

    expect(await ask("external_directory", join(path, "topic.md"))).toBe("allow");
    expect(await ask("external_directory", join(path, "settings.json"))).toBe("ask");
    expect(await ask("external_directory", path)).toBe("ask");
    expect(await ask("external_directory", `${path}-sibling/topic.md`)).toBe("ask");
    expect(await ask("external_directory", join(path, "..", "outside.md"))).toBe("ask");
    expect(await ask("read", join(path, "topic.md"))).toBe("ask");
    await app.hooks.dispose!();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("does not block messages on save classification", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-background-classifier";
    const classification = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) {
        started.resolve();
        return classification.promise;
      }
      return memoryExtraction();
    });

    await app.message("ses_background", "First.");
    await app.message("ses_background", "Second.");
    // The checkpoint fires when the next real prompt arrives, covering only the
    // previously completed turns.
    await app.message("ses_background", "Third.");
    await started.promise;
    // Classification is still pending, so this message must not wait for it.
    await app.message("ses_background", "Fourth while classification is pending.");
    classification.resolve(saveDecisions());
    await app.hooks.dispose!();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("consumes an empty classification instead of reoffering the turns", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-consume-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-consume-project";
    let classifications = 0;
    const classifierPrompts: string[] = [];
    const app = await fixture(directory, ({ system, prompt }) => {
      if (system.includes("classifier")) {
        classifications += 1;
        classifierPrompts.push(prompt);
        return saveDecisions();
      }
      return memoryExtraction();
    });

    await app.message("ses_consume", "Alpha one.");
    await app.message("ses_consume", "Beta two.");
    await app.message("ses_consume", "Gamma three.");
    await until(() => classifications >= 1);
    // Let the empty classification finish clearing the in-flight marker.
    await Bun.sleep(50);
    await app.message("ses_consume", "Delta four.");
    await app.message("ses_consume", "Epsilon five.");
    await until(() => classifications >= 2);
    await app.hooks.dispose!();

    // Exactly one classification per checkpoint: the first checkpoint was
    // consumed, not restored for another attempt.
    expect(classifications).toBe(2);
    // The second checkpoint covers only turns completed since the first one.
    expect(classifierPrompts[1]).toContain("Gamma three.");
    expect(classifierPrompts[1]).toContain("Delta four.");
    expect(classifierPrompts[1]).not.toContain("Alpha one.");
    expect(classifierPrompts[1]).not.toContain("Beta two.");
    expect(classifierPrompts[1]).not.toContain("Epsilon five.");
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("queues compact deltas for the next user message without changing the system snapshot", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-delta-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-delta-project";
    const path = await store(dataHome, directory, [
      { file: "first.md", title: "First", summary: "First summary", content: "first" },
    ]);
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) return saveDecisions(createDecision("editor reply preference"));
      return memoryExtraction({
        title: "Concise replies",
        summary: "Prefer concise replies.",
        type: "preference",
        scope: "editor",
        content: "Keep replies short unless asked for detail.",
      });
    });

    // Snapshot the system context before any save; it must stay immutable.
    const before = { system: [] as string[] };
    await app.hooks["experimental.chat.system.transform"]!({ sessionID: "ses_delta" } as never, before);
    expect(before.system).toHaveLength(1);
    expect(before.system[0]).toContain("[First](first.md) - First summary");

    await app.message("ses_delta", "One.");
    await app.message("ses_delta", "Two.");
    await app.message("ses_delta", "Three.");
    const indexPath = join(path, "index.md");
    await until(async () => (await Bun.file(indexPath).text()).includes("Concise replies"));
    // Drain all background work so the committed delta is guaranteed queued.
    await app.hooks.dispose!();

    const after = { system: [] as string[] };
    await app.hooks["experimental.chat.system.transform"]!({ sessionID: "ses_delta" } as never, after);
    expect(after.system).toEqual(before.system);
    expect(after.system[0]).not.toContain("Concise replies");

    // The next genuine user message carries a compact synthetic delta part.
    const parts: FakeMessage["parts"] = [{ type: "text", text: "Next question" }];
    const messages: FakeMessage[] = [{ info: { id: "msg_delta_next", sessionID: "ses_delta", role: "user" }, parts }];
    await app.hooks["experimental.chat.messages.transform"]!({} as never, { messages } as never);
    expect(parts).toHaveLength(2);
    const part = parts[1]!;
    expect(part.id).toBe("memory-update-msg_delta_next");
    expect(part.synthetic).toBe(true);
    expect(part.text.startsWith("<memory_update>")).toBe(true);
    expect(part.text).toContain("supersedes");
    expect(part.text).toContain("Memories are hints only, not authoritative facts.");
    expect(part.text).toContain("Verify relevant details against the current conversation, project state, or primary sources");
    expect(part.text).toContain("- [Concise replies](");
    expect(part.text).toMatch(/\[preference\|editor\|\d{4}-\d{2}-\d{2}\]/);
    // Only delta index lines: no full index repetition and no topic bodies.
    expect(part.text).not.toContain("First summary");
    expect(part.text).not.toContain("Keep replies short");
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("freezes deltas at the first transform of a user message and defers mid-turn saves", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-freeze-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-freeze-project";
    const path = await store(dataHome, directory, []);
    const extraction = Promise.withResolvers<Extraction>();
    const started = Promise.withResolvers<void>();
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) return saveDecisions(createDecision("deferred durable rule"));
      started.resolve();
      return extraction.promise;
    });

    await app.message("ses_freeze", "One.");
    await app.message("ses_freeze", "Two.");
    await app.message("ses_freeze", "Three.");
    await started.promise;

    const userMessage = (id: string): FakeMessage[] =>
      [{ info: { id, sessionID: "ses_freeze", role: "user" }, parts: [{ type: "text", text: id }] }];
    const transform = (messages: unknown) => app.hooks["experimental.chat.messages.transform"]!({} as never, { messages } as never);

    // First transform for this message: nothing committed yet, nothing injected.
    const first = userMessage("msg_freeze_1");
    await transform(first);
    expect(first[0]!.parts).toHaveLength(1);

    // The save commits mid-turn; it must not be injected into the same message.
    extraction.resolve(memoryExtraction({
      title: "Deferred rule",
      summary: "A deferred durable rule.",
      type: "instruction",
      content: "Always defer mid-turn memory saves to the next genuine turn.",
    }));
    await until(async () => (await Bun.file(join(path, "index.md")).text()).includes("Deferred rule"));
    // Drain background work so the queued delta is observable deterministically.
    await app.hooks.dispose!();
    const second = userMessage("msg_freeze_1");
    await transform(second);
    expect(second[0]!.parts).toHaveLength(1);

    // The next genuine user message receives the frozen delta.
    const third = userMessage("msg_freeze_2");
    await transform(third);
    expect(third[0]!.parts).toHaveLength(2);
    expect(third[0]!.parts[1]!.text).toContain("Deferred rule");

    // Deleting the session clears queued and frozen delta state.
    await app.hooks.event!({ event: { type: "session.deleted", properties: { info: { id: "ses_freeze" } } } } as never);
    const fourth = userMessage("msg_freeze_3");
    await transform(fourth);
    expect(fourth[0]!.parts).toHaveLength(1);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("persists a delayed commit after deletion without queueing a delta", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-race-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-race-project";
    const path = await store(dataHome, directory, []);
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<Extraction>();
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) return saveDecisions(createDecision("a durable rule"));
      started.resolve();
      return gate.promise;
    });
    const transform = (messages: FakeMessage[]) => app.hooks["experimental.chat.messages.transform"]!({} as never, { messages } as never);

    await app.message("ses_race", "One.");
    await app.message("ses_race", "Two.");
    await app.message("ses_race", "Three.");
    await started.promise;

    // Delete while the extractor is parked mid-flight. The delayed commit may
    // still persist, but must not queue update state for the deleted session.
    await app.hooks.event!({ event: { type: "session.deleted", properties: { info: { id: "ses_race" } } } } as never);
    gate.resolve(memoryExtraction({
      title: "Late rule",
      summary: "A rule committed after deletion.",
      type: "instruction",
      scope: "project",
      content: "Persist even when the originating session disappears mid-save.",
    }));
    const indexPath = join(path, "index.md");
    await until(async () => (await Bun.file(indexPath).text()).includes("Late rule"));
    // Drain all background work so the post-commit delta handling has settled.
    await app.hooks.dispose!();

    // A later or reconstructed transform of the deleted session must not
    // receive the late commit as a synthetic delta.
    const revived: FakeMessage = { info: { id: "msg_revived", sessionID: "ses_race", role: "user" }, parts: [{ type: "text", text: "reconstructed turn" }] };
    await transform([revived]);
    expect(revived.parts).toHaveLength(1);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("keeps one stable synthetic part across repeated transforms and reloaded history", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-stable-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-stable-project";
    const path = await store(dataHome, directory, []);
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) return saveDecisions(createDecision("stable rule"));
      return memoryExtraction({ title: "Stable rule", type: "instruction", scope: "project" });
    });

    await app.message("ses_stable", "One.");
    await app.message("ses_stable", "Two.");
    await app.message("ses_stable", "Three.");
    await until(async () => (await Bun.file(join(path, "index.md")).text()).includes("Stable rule"));
    // Drain background work so the queued delta is observable deterministically.
    await app.hooks.dispose!();

    const transform = (messages: unknown) => app.hooks["experimental.chat.messages.transform"]!({} as never, { messages } as never);
    const live: FakeMessage[] = [{ info: { id: "msg_stable", sessionID: "ses_stable", role: "user" }, parts: [{ type: "text", text: "hello" }] }];
    for (let i = 0; i < 3; i++) await transform(live);
    expect(live[0]!.parts).toHaveLength(2);
    const injected = live[0]!.parts[1]!;

    // History reloaded for each model call never contains the synthetic part;
    // transforming that fresh copy injects exactly one identical part again.
    const reloaded: FakeMessage[] = [{ info: { id: "msg_stable", sessionID: "ses_stable", role: "user" }, parts: [{ type: "text", text: "hello" }] }];
    await transform(reloaded);
    expect(reloaded[0]!.parts).toHaveLength(2);
    expect(reloaded[0]!.parts[1]!.id).toBe(injected.id);
    expect(reloaded[0]!.parts[1]!.text).toBe(injected.text);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("retains frozen deltas per historical user message and prunes evicted ones", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-history-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-history-project";
    const path = await store(dataHome, directory, []);
    const started = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    let extractionCalls = 0;
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) return saveDecisions(createDecision("a durable rule"));
      const call = extractionCalls++;
      started[call]?.resolve();
      return (gates[call] ?? gates[1]!).promise.then(() => memoryExtraction({
        title: call === 0 ? "First rule" : "Second rule",
        content: call === 0 ? "The first durable rule body." : "The second durable rule body.",
      }));
    });
    const transform = (messages: FakeMessage[]) => app.hooks["experimental.chat.messages.transform"]!({} as never, { messages } as never);

    // Turn A: the first delta is committed before A's first transform, so A
    // freezes it.
    await app.message("ses_hist", "One.");
    await app.message("ses_hist", "Two.");
    await app.message("ses_hist", "Three.");
    await started[0]!.promise;
    gates[0]!.resolve();
    const indexPath = join(path, "index.md");
    await until(async () => (await Bun.file(indexPath).text()).includes("First rule"));
    // Let queueDelta's continuation settle after the index becomes visible.
    await Bun.sleep(25);
    const msgA: FakeMessage = { info: { id: "msg_hist_a", sessionID: "ses_hist", role: "user" }, parts: [{ type: "text", text: "turn A" }] };
    await transform([msgA]);
    expect(msgA.parts).toHaveLength(2);
    const partA = msgA.parts[1]!;
    expect(partA.id).toBe("memory-update-msg_hist_a");
    expect(partA.text).toContain("First rule");

    // Turn B: the second delta commits mid-session; transforming history [A, B]
    // delivers B's own frozen set while A keeps its identical part.
    await app.message("ses_hist", "Four.");
    await app.message("ses_hist", "Five.");
    await started[1]!.promise;
    gates[1]!.resolve();
    await until(async () => (await Bun.file(indexPath).text()).includes("Second rule"));
    await Bun.sleep(25);
    const msgB: FakeMessage = { info: { id: "msg_hist_b", sessionID: "ses_hist", role: "user" }, parts: [{ type: "text", text: "turn B" }] };
    await transform([msgA, msgB]);
    expect(msgA.parts).toHaveLength(2);
    expect(msgA.parts[1]!.id).toBe(partA.id);
    expect(msgB.parts).toHaveLength(2);
    const partB = msgB.parts[1]!;
    expect(partB.id).toBe("memory-update-msg_hist_b");
    expect(partB.text).toContain("Second rule");
    expect(partB.text).not.toContain("First rule");

    // History reconstructed from storage re-injects both identical parts.
    const reloadedA: FakeMessage = { info: { id: "msg_hist_a", sessionID: "ses_hist", role: "user" }, parts: [{ type: "text", text: "turn A" }] };
    const reloadedB: FakeMessage = { info: { id: "msg_hist_b", sessionID: "ses_hist", role: "user" }, parts: [{ type: "text", text: "turn B" }] };
    await transform([reloadedA, reloadedB]);
    expect(reloadedA.parts).toHaveLength(2);
    expect(reloadedA.parts[1]!.id).toBe(partA.id);
    expect(reloadedA.parts[1]!.text).toBe(partA.text);
    expect(reloadedB.parts).toHaveLength(2);
    expect(reloadedB.parts[1]!.id).toBe(partB.id);
    expect(reloadedB.parts[1]!.text).toBe(partB.text);

    // Once A leaves the model history its assignment is pruned; a later
    // transform of revived history must not resurrect A's part.
    const evictedB: FakeMessage = { info: { id: "msg_hist_b", sessionID: "ses_hist", role: "user" }, parts: [{ type: "text", text: "turn B" }] };
    await transform([evictedB]);
    expect(evictedB.parts).toHaveLength(2);
    const revivedA: FakeMessage = { info: { id: "msg_hist_a", sessionID: "ses_hist", role: "user" }, parts: [{ type: "text", text: "turn A" }] };
    const revivedB: FakeMessage = { info: { id: "msg_hist_b", sessionID: "ses_hist", role: "user" }, parts: [{ type: "text", text: "turn B" }] };
    await transform([revivedA, revivedB]);
    expect(revivedA.parts).toHaveLength(1);
    expect(revivedB.parts).toHaveLength(2);
    await app.hooks.dispose!();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("keeps pending deltas queued across an all-synthetic latest user message", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-synthetic-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-synthetic-project";
    const path = await store(dataHome, directory, []);
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) return saveDecisions(createDecision("a durable rule"));
      started.resolve();
      return gate.promise.then(() => memoryExtraction({ title: "First rule" }));
    });
    const transform = (messages: FakeMessage[]) => app.hooks["experimental.chat.messages.transform"]!({} as never, { messages } as never);

    await app.message("ses_synth", "One.");
    await app.message("ses_synth", "Two.");
    await app.message("ses_synth", "Three.");
    await started.promise;
    gate.resolve();
    const indexPath = join(path, "index.md");
    await until(async () => (await Bun.file(indexPath).text()).includes("First rule"));
    // Let queueDelta's continuation settle after the index becomes visible.
    await Bun.sleep(25);

    // An older genuine user message followed by an all-synthetic latest user
    // message (compaction auto-continue): the transform must neither deliver
    // the pending delta nor newly assign it to the older genuine message.
    const genuine: FakeMessage = { info: { id: "msg_genuine", sessionID: "ses_synth", role: "user" }, parts: [{ type: "text", text: "real turn" }] };
    const syntheticTail: FakeMessage = { info: { id: "msg_synthetic", sessionID: "ses_synth", role: "user" }, parts: [{ type: "text", text: "auto continue", synthetic: true }] };
    await transform([genuine, syntheticTail]);
    expect(genuine.parts).toHaveLength(1);
    expect(syntheticTail.parts).toHaveLength(1);

    // The pending delta stays queued and is delivered on the next genuine
    // user message instead.
    const next: FakeMessage = { info: { id: "msg_after_synth", sessionID: "ses_synth", role: "user" }, parts: [{ type: "text", text: "next real turn" }] };
    await transform([genuine, syntheticTail, next]);
    expect(genuine.parts).toHaveLength(1);
    expect(syntheticTail.parts).toHaveLength(1);
    expect(next.parts).toHaveLength(2);
    expect(next.parts[1]!.id).toBe("memory-update-msg_after_synth");
    expect(next.parts[1]!.text).toContain("First rule");
    await app.hooks.dispose!();
    await rm(dataHome, { recursive: true, force: true });
  });
});

describe("memory idle revision gating", () => {
  // Drives the idle checkpoint with fake timers: idle_delay_ms is advanced
  // synchronously instead of waiting real seconds.
  const armIdle = (app: Awaited<ReturnType<typeof fixture>>, sessionID: string) =>
    app.hooks.event!({ event: { type: "session.idle", properties: { sessionID } } } as never);

  test.serial("does not relaunch review for restored source until new content is collected", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-idle-gate-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-idle-gate-project";
    const failedClassification = Promise.withResolvers<unknown>();
    let classifications = 0;
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) {
        classifications += 1;
        return classifications === 1 ? failedClassification.promise : saveDecisions();
      }
      return memoryExtraction();
    }, { idle_delay_ms: 1000 });
    const idle = () => armIdle(app, "ses_idle_gate");

    try {
      jest.useFakeTimers();
      await app.message("ses_idle_gate", "Alpha one.");
      await app.message("ses_idle_gate", "Beta two.");
      await idle();
      jest.advanceTimersByTime(1000);
      await until(() => app.calls.length === 1);
      expect(classifications).toBe(1);

      // Malformed classifier response: the checkpoint fails and its snapshot
      // is restored unchanged.
      failedClassification.resolve({});
      await settle();

      // A repeated idle event with nothing newly collected must not launch
      // another review of the restored buffer.
      await idle();
      jest.advanceTimersByTime(1000);
      await settle();
      expect(app.calls).toHaveLength(1);
      expect(classifications).toBe(1);

      // A new genuine prompt makes the source reviewable again; the second
      // review sees the restored turns merged with the new one.
      await app.message("ses_idle_gate", "Gamma three.");
      await idle();
      jest.advanceTimersByTime(1000);
      await until(() => app.calls.length === 2);
      expect(app.calls[1]!.prompt).toContain("Alpha one.");
      expect(app.calls[1]!.prompt).toContain("Beta two.");
      expect(app.calls[1]!.prompt).toContain("Gamma three.");
      await settle();
    } finally {
      jest.useRealTimers();
    }
    await app.hooks.dispose!();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("re-arms idle review on assistant output and tool activity but not blank collection", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-idle-collect-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-idle-collect-project";
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) return saveDecisions();
      return memoryExtraction();
    }, { idle_delay_ms: 1000 });
    const idle = () => armIdle(app, "ses_idle_collect");

    try {
      jest.useFakeTimers();
      await app.message("ses_idle_collect", "Only turn.");
      await idle();
      jest.advanceTimersByTime(1000);
      await until(() => app.calls.length === 1);
      await settle();

      // Blank assistant output collects nothing: no re-review of the already
      // consumed source.
      await app.agentOutput("ses_idle_collect", "   \n");
      await idle();
      jest.advanceTimersByTime(1000);
      await settle();
      expect(app.calls).toHaveLength(1);

      // Completed assistant output is collected and reviewed on the next idle.
      await app.agentOutput("ses_idle_collect", "Wrapped up the parser migration.");
      await idle();
      jest.advanceTimersByTime(1000);
      await until(() => app.calls.length === 2);
      expect(app.calls[1]!.prompt).toContain("Wrapped up the parser migration.");
      await settle();

      // Qualifying tool activity likewise makes a later idle event reviewable.
      await app.hooks["tool.execute.after"]!({ sessionID: "ses_idle_collect", tool: "bash", args: { command: "bun test plugins/memory" } } as never,
        { title: "passed", metadata: { exit: 0 } } as never);
      await idle();
      jest.advanceTimersByTime(1000);
      await until(() => app.calls.length === 3);
      expect(app.calls[2]!.prompt).toContain("bash: passed");
      await settle();
    } finally {
      jest.useRealTimers();
    }
    await app.hooks.dispose!();
    await rm(dataHome, { recursive: true, force: true });
  });
});

describe("memory dreaming configuration", () => {
  test("validates dream options and applies defaults", () => {
    expect(validateDreamOptions({})).toEqual({ intervalHours: 36, minAdditions: 7 });
    expect(validateDreamOptions({ dream_interval_hours: 0.5, dream_min_additions: 1 })).toEqual({ intervalHours: 0.5, minAdditions: 1 });
    for (const bad of [
      { dream_interval_hours: 0 },
      { dream_interval_hours: -1 },
      { dream_interval_hours: Number.POSITIVE_INFINITY },
      { dream_interval_hours: Number.NaN },
    ]) {
      expect(() => validateDreamOptions(bad as never)).toThrow("dream_interval_hours");
    }
    for (const bad of [{ dream_min_additions: 0 }, { dream_min_additions: -2 }, { dream_min_additions: 1.5 }]) {
      expect(() => validateDreamOptions(bad as never)).toThrow("dream_min_additions");
    }
  });

  test("gates auto dreaming on both the interval window and the minimum additions", () => {
    const now = 1_000_000_000_000;
    const options = { intervalHours: 36, minAdditions: 7 };
    expect(dreamDue(now, { additions: 7, since: now - 36 * 3_600_000 }, options)).toBe(true);
    // Interval elapsed but too few additions.
    expect(dreamDue(now, { additions: 6, since: now - 40 * 3_600_000 }, options)).toBe(false);
    // Enough additions but the window is fresh.
    expect(dreamDue(now, { additions: 9, since: now - 1 * 3_600_000 }, options)).toBe(false);
    // A recent failure backs off an otherwise-due run; old failures expire.
    expect(dreamDue(now, { additions: 9, since: now - 40 * 3_600_000, failAt: now - 60_000 }, options)).toBe(false);
    expect(dreamDue(now, { additions: 9, since: now - 40 * 3_600_000, failAt: now - 16 * 60_000 }, options)).toBe(true);
  });

  test("parses insight source fingerprints", () => {
    const content = '---\nrevision: "r"\ntype: "insight"\nscope: "project"\nsessionId: "s"\nupdatedAt: "2026-08-23"\nsources: ["a.md@rev1","b.md@rev2"]\n---\n\nbody';
    expect(insightSources(content)).toEqual(["a.md@rev1", "b.md@rev2"]);
    expect(insightSources('---\nrevision: "r"\n---\nbody')).toEqual([]);
    expect(insightSources("---\nsources: [broken\n---\n")).toEqual([]);
  });
});

describe("memory dream accounting", () => {
  test.serial("counts ordinary creates and replacements toward dream additions", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-count-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-count-project";
    let classifications = 0;
    const app = await fixture(directory, ({ system }) => {
      if (system.includes("classifier")) {
        classifications += 1;
        return classifications === 1
          ? saveDecisions(createDecision("a brand new durable rule"))
          : saveDecisions(replaceDecision("legacy.md", "the established rule"));
      }
      return memoryExtraction();
    });
    const path = await store(dataHome, directory, [
      { file: "legacy.md", title: "Legacy", content: seededTopic("deadbee1", "Old body") },
    ]);
    await app.message("ses_count", "Load memory.");
    await app.message("ses_count", "Remember a brand new durable rule.");
    await app.message("ses_count", "Continue.");
    await until(() => app.calls.length >= 2);
    await Bun.sleep(50);
    await app.message("ses_count", "Apply the update.");
    await app.message("ses_count", "Make it durable.");
    const statePath = join(path, ".dream.json");
    await until(async () => {
      try {
        return (await Bun.file(statePath).json() as { additions?: number }).additions === 2;
      } catch {
        return false;
      }
    });
    await app.hooks.dispose!();

    const state = await Bun.file(statePath).json();
    expect(state).toMatchObject({ additions: 2 });
    await rm(dataHome, { recursive: true, force: true });
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
    await app.hooks.dispose!();

    const state = await Bun.file(statePath).json();
    expect(state).toMatchObject({ auto: true, additions: 3 });
    expect(state.lastRunAt).toBeUndefined();
    // A fresh window means the very first evaluation never dreams.
    expect(app.calls.filter(isDreamSelector)).toHaveLength(0);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("runs only when both gate conditions hold, and a no-op run resets the counters", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-gate-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-gate-project";
    const path = await store(dataHome, directory, [
      { file: "one.md", title: "One", content: seededTopic("aaa1111", "One body") },
      { file: "two.md", title: "Two", content: seededTopic("bbb2222", "Two body") },
    ]);
    const statePath = join(path, ".dream.json");
    const statusPath = join(path, ".dream.status");
    await Bun.write(join(path, "settings.json"), JSON.stringify({ dream_auto: true }));
    const writeState = (state: Record<string, unknown>) => Bun.write(statePath, JSON.stringify(state));
    const selectorCalls = (app: Awaited<ReturnType<typeof fixture>>) => app.calls.filter(isDreamSelector).length;

    // Fresh window with enough additions: no run.
    let app = await fixture(directory, () => saveDecisions());
    await writeState({ auto: true, additions: 9, since: Date.now() });
    await app.message("ses_gate_a", "Use memory.");
    await Bun.sleep(150);
    expect(selectorCalls(app)).toBe(0);
    await app.hooks.dispose!();

    // Stale window with too few additions: still no run.
    app = await fixture(directory, () => saveDecisions());
    await writeState({ auto: true, additions: 6, since: Date.now() - 40 * 3_600_000 });
    await app.message("ses_gate_b", "Use memory.");
    await Bun.sleep(150);
    expect(selectorCalls(app)).toBe(0);
    await app.hooks.dispose!();

    // Auto-memory master switch disabled: no run even when due.
    app = await fixture(directory, () => saveDecisions());
    await Bun.write(join(path, "settings.json"), JSON.stringify({ enabled: false, dream_auto: true }));
    await writeState({ auto: true, additions: 9, since: Date.now() - 40 * 3_600_000 });
    await app.message("ses_gate_c", "Use memory.");
    await Bun.sleep(150);
    expect(selectorCalls(app)).toBe(0);
    await app.hooks.dispose!();

    // Both conditions met: the run happens; a selector "none" is a successful
    // no-op that resets additions and stamps lastRunAt.
    app = await fixture(directory, ({ system }) => (isDreamSelector(system) ? { action: "none" } : saveDecisions()));
    await Bun.write(join(path, "settings.json"), JSON.stringify({ dream_auto: true }));
    await writeState({ auto: true, additions: 7, since: Date.now() - 37 * 3_600_000 });
    await app.message("ses_gate_d", "Use memory.");
    await until(async () => {
      try {
        return (await Bun.file(statusPath).json() as { state?: string }).state === "noop";
      } catch {
        return false;
      }
    });
    await app.hooks.dispose!();

    const status = await Bun.file(statusPath).json();
    expect(status.state).toBe("noop");
    // Decision-only manifests live under .dreams/ keyed by run ID, including
    // no-op runs.
    const manifest = await Bun.file(join(path, ".dreams", `${status.runID}.json`)).json();
    expect(manifest).toMatchObject({ trigger: "auto", model: "test/small", state: "noop", changed: false, actions: [] });
    const state = await Bun.file(statePath).json();
    expect(state.additions).toBe(0);
    expect(typeof state.lastRunAt).toBe("number");
    expect(selectorCalls(app)).toBe(1);
    await rm(dataHome, { recursive: true, force: true });
  });
});

describe("memory manual dreaming", () => {
  test.serial("handles a request written after startup without another message", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-watch-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-watch-project";
    const path = await store(dataHome, directory, [
      { file: "x.md", title: "X", content: seededTopic("abc1111", "X body") },
      { file: "y.md", title: "Y", content: seededTopic("def2222", "Y body") },
    ]);
    const app = await fixture(
      directory,
      ({ system }) => isDreamSelector(system) ? { action: "none" } : saveDecisions(),
      { dream_variant: "deep" },
    );
    await app.message("ses_watch", "Initialize the session.");
    await settle();

    await Bun.write(join(path, ".dream.request"), JSON.stringify({ requestID: "req-watch", sessionID: "ses_watch" }));
    await until(async () => {
      const file = Bun.file(join(path, ".dream.status"));
      return await file.exists() && (await file.json() as { requestID?: string }).requestID === "req-watch";
    });
    const dreamCall = app.calls.filter(isDreamSelector);
    expect(dreamCall).toHaveLength(1);
    expect(dreamCall[0]!.variant).toBe("deep");
    expect(dreamCall[0]!.sessionVariant).toBe("deep");

    const status = await Bun.file(join(path, ".dream.status")).json();
    const manifest = await Bun.file(join(path, ".dreams", `${status.runID}.json`)).json();
    expect(manifest.variant).toBe("deep");

    await app.hooks.dispose!();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("merges, supersedes, and synthesizes across iterations with a decision-only manifest", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-run-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-run-project";
    const path = await store(dataHome, directory, [
      { file: "a.md", title: "Alpha plan", summary: "[recap|project|2026-08-01] Alpha summary", content: seededTopic("aaaa1111", "ALPHA_BODY_ONE shared duplicate fact") },
      { file: "b.md", title: "Alpha variant", summary: "[recap|project|2026-08-01] Alpha variant summary", content: seededTopic("bbbb2222", "ALPHA_BODY_TWO shared duplicate fact") },
      { file: "c.md", title: "Gamma outcome", summary: "[recap|project|2026-08-01] Gamma summary", content: seededTopic("cccc3333", "GAMMA_BODY outdated claim") },
      { file: "d.md", title: "Delta note", summary: "[recap|project|2026-08-01] Delta summary", content: seededTopic("dddd4444", "DELTA_BODY stable note") },
    ]);
    await Bun.write(join(path, ".dream.request"), JSON.stringify({ requestID: "req-big", sessionID: "ses_dreamer" }));

    const findPrefix = async (prefix: string) => (await readdir(path)).find((name) => name.startsWith(prefix))!;
    const selectorPrompts: string[] = [];
    const curatorPrompts: string[] = [];
    let selections = 0;
    let curations = 0;
    const app = await fixture(directory, async ({ system, prompt }) => {
      if (isDreamSelector(system)) {
        selectorPrompts.push(prompt);
        selections += 1;
        if (selections === 1) return { action: "merge", files: ["a.md", "b.md"], reason: "duplicate alpha recaps" };
        if (selections === 2) return { action: "supersede", files: [await findPrefix("merged-alpha-"), "c.md"], reason: "corrected gamma outcome" };
        if (selections === 3) return { action: "synthesize", files: [await findPrefix("superseding-gamma-"), "d.md"], reason: "shared stable pattern" };
        return { action: "none" };
      }
      if (isDreamCurator(system)) {
        curatorPrompts.push(prompt);
        curations += 1;
        if (curations === 1) return memoryExtraction({ title: "Merged alpha" });
        if (curations === 2) return memoryExtraction({ title: "Superseding gamma" });
        return memoryExtraction({ title: "Cross-topic insight" });
      }
      return saveDecisions();
    });

    await app.message("ses_witness", "Start dreaming.");
    await until(async () => {
      try {
        return (await Bun.file(join(path, ".dream.status")).json() as { state?: string }).state === "changed";
      } catch {
        return false;
      }
    });
    await app.hooks.dispose!();

    const status = await Bun.file(join(path, ".dream.status")).json();
    const manifest = await Bun.file(join(path, ".dreams", `${status.runID}.json`)).json();
    const merged = manifest.actions[0].output.file as string;
    const superseded = manifest.actions[1].output.file as string;
    const insight = manifest.actions[2].output.file as string;
    const names = await readdir(path);
    expect(superseded && insight).toBeTruthy();
    // Merge and supersede removed their sources; synthesis kept d.md.
    for (const gone of ["a.md", "b.md", "c.md"]) expect(names).not.toContain(gone);
    expect(names).toContain("d.md");

    const index = await Bun.file(join(path, "index.md")).text();
    expect(index).toContain("(d.md)");
    expect(index).not.toContain(`(${merged})`);
    expect(index).toContain(`(${superseded})`);
    expect(index).toContain(`(${insight})`);
    for (const gone of ["(a.md)", "(b.md)", "(c.md)"]) expect(index).not.toContain(gone);
    expect(index).toMatch(new RegExp(`- \\[Cross-topic insight\\]\\(${insight}\\) - \\[insight\\|project\\|\\d{4}-\\d{2}-\\d{2}\\] A durable project outcome\\.`));

    const insightContent = await Bun.file(join(path, insight)).text();
    expect(insightContent).toContain('type: "insight"');
    expect(insightContent).toContain('sessionId: "ses_dreamer"');
    // Dream outputs carry the plugin-owned run marker used by the TUI.
    expect(topicDreamRunId(insightContent)).toMatch(/^[0-9a-f-]{20,}$/);
    const sources = insightSources(insightContent);
    expect(sources).toEqual([
      `${superseded}@${(await Bun.file(join(path, superseded)).text()).match(/revision: "([^"]+)"/)![1]!}`,
      "d.md@dddd4444",
    ]);

    // The manifest records trigger, model, timestamps, per-action sources with
    // revisions, output metadata, and the model's reason. No old content.
    expect(status.requestID).toBe("req-big");
    expect(status.state).toBe("changed");
    expect(status.counts).toEqual({ merge: 1, supersede: 1, synthesize: 1 });
    expect(manifest.trigger).toBe("manual");
    expect(manifest.model).toBe("test/small");
    expect(manifest.sessionID).toBe("ses_dreamer");
    expect(manifest.state).toBe("changed");
    expect(manifest.changed).toBe(true);
    expect(manifest.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.actions).toHaveLength(3);
    expect(manifest.actions[0]).toEqual({
      action: "merge",
      reason: "duplicate alpha recaps",
      sources: [{ file: "a.md", revision: "aaaa1111" }, { file: "b.md", revision: "bbbb2222" }],
      output: { file: merged, revision: expect.any(String), title: "Merged alpha", type: "recap" },
    });
    expect(manifest.actions[1].action).toBe("supersede");
    expect(manifest.actions[1].sources).toEqual([{ file: merged, revision: manifest.actions[0].output.revision }, { file: "c.md", revision: "cccc3333" }]);
    expect(manifest.actions[2]).toEqual({
      action: "synthesize",
      reason: "shared stable pattern",
      sources: [{ file: superseded, revision: manifest.actions[1].output.revision }, { file: "d.md", revision: "dddd4444" }],
      output: { file: insight, revision: expect.any(String), title: "Cross-topic insight", type: "insight" },
    });
    expect(JSON.stringify(manifest)).not.toContain("ALPHA_BODY");

    expect(await Bun.file(join(path, ".dream.request")).exists()).toBe(false);

    // A successful run keeps additions added during the run and stamps
    // lastRunAt; dream writes themselves never counted.
    const state = await Bun.file(join(path, ".dream.json")).json();
    expect(state.additions).toBe(0);
    expect(typeof state.lastRunAt).toBe("number");

    // All dream workers carry the dream activity marker.
    for (const metadata of app.creations) {
      expect(metadata).toEqual({ memoryWorker: true, memoryActivity: "dream" });
    }

    // The selector receives the complete candidate index inside its untrusted
    // framing, evolving across iterations as transformations are applied.
    expect(selectorPrompts[0]).toContain("(a.md)");
    expect(selectorPrompts[0]).toContain("<candidate_index>\n");
    expect(selectorPrompts[0].endsWith("</candidate_index>")).toBe(true);
    expect(selectorPrompts[0]).toContain("untrusted data");
    expect(selectorPrompts[0]).toContain("Age or recency alone never justifies an action");
    expect(selectorPrompts[1]).toContain(`(${merged})`);
    expect(selectorPrompts[1]).toContain("(c.md)");
    expect(selectorPrompts[1]).not.toContain("(a.md)");
    expect(selectorPrompts[1]).not.toContain("(b.md)");
    expect(selectorPrompts[1]).not.toContain("ALPHA_BODY");
    expect(selectorPrompts[2]).toContain(`(${superseded})`);
    expect(selectorPrompts[2]).toContain("(d.md)");
    expect(selectorPrompts[2]).not.toContain(`(${merged})`);

    // The curator receives the operation prompt plus the complete selected
    // topic files.
    expect(curatorPrompts[0]).toContain("Combine the supplied memory topics");
    expect(curatorPrompts[0]).toContain('<memory_file path="a.md">');
    expect(curatorPrompts[0]).toContain('<memory_file path="b.md">');
    expect(curatorPrompts[0]).toContain("ALPHA_BODY_ONE");
    expect(curatorPrompts[0]).toContain("</memory_file>");
    expect(curatorPrompts[1]).toContain("Replace the supplied memory topics");
    expect(curatorPrompts[2]).toContain("Derive exactly one new concise insight");
    expect(curatorPrompts[2]).toContain("The parser migration shipped and the focused suite passes.");
    expect(curatorPrompts[2]).toContain("DELTA_BODY");
    expect(curatorPrompts[2]).toContain("non-authoritative");
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
    await Bun.write(join(path, ".dream.request"), JSON.stringify({ requestID: "req-stale", sessionID: "ses_dreamer" }));
    await Bun.write(join(path, ".dream.json"), JSON.stringify({ auto: true, additions: 3, since: Date.now() }));

    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<Extraction>();
    const app = await fixture(directory, ({ system }) => {
      if (isDreamSelector(system)) return { action: "merge", files: ["x.md", "y.md"], reason: "duplicate topics" };
      if (isDreamCurator(system)) {
        started.resolve();
        return gate.promise;
      }
      return saveDecisions();
    });

    await app.message("ses_stale", "Start dreaming.");
    await started.promise;
    // One source mutates on disk while the executor runs: the commit must
    // detect the stale snapshot and abort the whole run.
    await Bun.write(join(path, "x.md"), seededTopic("abc4567", "X_MUTATED_BODY"));
    gate.resolve(memoryExtraction({ title: "Merged xy" }));
    const statusPath = join(path, ".dream.status");
    await until(async () => {
      try {
        return (await Bun.file(statusPath).json() as { state?: string }).state === "failed";
      } catch {
        return false;
      }
    });
    await app.hooks.dispose!();

    const status = await Bun.file(statusPath).json();
    expect(status.requestID).toBe("req-stale");
    expect(status.message).toContain("changed");
    // Failed runs still get a decision-only audit manifest with no actions.
    const manifest = await Bun.file(join(path, ".dreams", `${status.runID}.json`)).json();
    expect(manifest.state).toBe("failed");
    expect(manifest.changed).toBe(false);
    expect(manifest.actions).toEqual([]);
    expect(manifest.error).toContain("changed");
    expect(await Bun.file(join(path, "x.md")).text()).toContain("X_MUTATED_BODY");
    expect(await Bun.file(join(path, "y.md")).text()).toContain("Y_SHARED_BODY");
    const index = await Bun.file(join(path, "index.md")).text();
    expect(index).toContain("(x.md)");
    expect(index).toContain("(y.md)");
    // Failed runs keep their progress and record a backoff timestamp instead.
    const state = await Bun.file(join(path, ".dream.json")).json();
    expect(state.additions).toBe(3);
    expect(state.lastRunAt).toBeUndefined();
    expect(typeof state.failAt).toBe("number");
    expect(await Bun.file(join(path, ".dream.request")).exists()).toBe(false);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("serializes concurrent instances through the separate dream lock", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-lock-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-lock-project";
    const path = await store(dataHome, directory, [
      { file: "x.md", title: "X topic", summary: "[recap|project|2026-08-01] X summary", content: seededTopic("abc1111", "X_LOCK_BODY") },
      { file: "y.md", title: "Y topic", summary: "[recap|project|2026-08-01] Y summary", content: seededTopic("def2222", "Y_LOCK_BODY") },
    ]);
    const statusPath = join(path, ".dream.status");
    const readStatus = async () => {
      const file = Bun.file(statusPath);
      return await file.exists() ? file.json() : undefined;
    };

    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = await fixture(directory, ({ system }) => {
      if (isDreamSelector(system)) {
        started.resolve();
        return release.promise.then(() => ({ action: "none" }));
      }
      return saveDecisions();
    });
    const second = await fixture(directory, ({ system }) => {
      if (isDreamSelector(system)) return { action: "none" };
      return saveDecisions();
    });

    await Bun.write(join(path, ".dream.request"), JSON.stringify({ requestID: "req-lock-1", sessionID: "ses_lock" }));
    await first.message("ses_first", "Go.");
    await started.promise;

    // A second server process must skip while the dream lock is held, leaving
    // the request file untouched for a later tick.
    await Bun.write(join(path, ".dream.request"), JSON.stringify({ requestID: "req-lock-2", sessionID: "ses_lock" }));
    await second.message("ses_second", "Go.");
    await Bun.sleep(150);
    expect(second.calls.filter(isDreamSelector)).toHaveLength(0);
    expect(await Bun.file(join(path, ".dream.request")).exists()).toBe(true);

    release.resolve();
    // The first instance rechecks after releasing its run, so the request that
    // arrived while locked is handled promptly without another message.
    await until(async () => (await readStatus())?.requestID === "req-lock-2");
    expect(first.calls.filter(isDreamSelector).length + second.calls.filter(isDreamSelector).length).toBe(2);
    await Promise.all([first.hooks.dispose!(), second.hooks.dispose!()]);
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("broadcasts upsert and tombstone deltas to all live sessions", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-delta-dream-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-delta-project";
    const path = await store(dataHome, directory, [
      { file: "x.md", title: "X topic", summary: "[recap|project|2026-08-01] X summary", content: seededTopic("abc1111", "X_DELTA_BODY") },
      { file: "y.md", title: "Y topic", summary: "[recap|project|2026-08-01] Y summary", content: seededTopic("def2222", "Y_DELTA_BODY") },
    ]);
    const app = await fixture(directory, ({ system }) => {
      if (isDreamSelector(system)) return { action: "merge", files: ["x.md", "y.md"], reason: "duplicate topics" };
      if (isDreamCurator(system)) return memoryExtraction({ title: "Unified story" });
      return saveDecisions();
    });

    // Two live sessions first, so their delta queues exist before the dream.
    await app.message("ses_one", "One.");
    await app.message("ses_two", "Two.");
    await Bun.write(join(path, ".dream.request"), JSON.stringify({ requestID: "req-broadcast", sessionID: "ses_three" }));
    await app.message("ses_three", "Three.");
    await until(async () => {
      try {
        return (await Bun.file(join(path, ".dream.status")).json() as { state?: string }).state === "changed";
      } catch {
        return false;
      }
    });
    await app.hooks.dispose!();

    const transform = (messages: FakeMessage[]) => app.hooks["experimental.chat.messages.transform"]!({} as never, { messages } as never);
    for (const sessionID of ["ses_one", "ses_two", "ses_three"]) {
      const message: FakeMessage = { info: { id: `msg-${sessionID}`, sessionID, role: "user" }, parts: [{ type: "text", text: "next" }] };
      await transform([message]);
      expect(message.parts).toHaveLength(2);
      const part = message.parts[1]!;
      expect(part.synthetic).toBe(true);
      expect(part.text).toContain("- [Unified story](");
      expect(part.text).toContain("Removed topics: x.md, y.md");
      expect(part.text).toContain("Discard any cached references");
    }
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("cleans up legacy same-type topics using frontmatter types without promotion", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-legacy-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-legacy-project";
    // Untyped frontmatter and untyped index lines: the effective type comes
    // from the topic bodies (defaulting to project), not index metadata.
    const path = await store(dataHome, directory, [
      { file: "old-a.md", title: "Old A", summary: "Old A summary", content: legacyTopic("aaa9999", "OLD_A_BODY stale variant") },
      { file: "old-b.md", title: "Old B", summary: "Old B summary", content: legacyTopic("bbb8888", "OLD_B_BODY stale variant") },
    ]);
    await Bun.write(join(path, ".dream.request"), JSON.stringify({ requestID: "req-legacy", sessionID: "ses_dreamer" }));
    const app = await fixture(directory, ({ system }) => {
      if (isDreamSelector(system)) return { action: "merge", files: ["old-a.md", "old-b.md"], reason: "legacy duplicates" };
      if (isDreamCurator(system)) return memoryExtraction({ title: "Merged legacy" });
      return saveDecisions();
    });

    await app.message("ses_legacy", "Start dreaming.");
    await until(async () => {
      try {
        return (await Bun.file(join(path, ".dream.status")).json() as { state?: string }).state === "changed";
      } catch {
        return false;
      }
    });
    await app.hooks.dispose!();

    const names = await readdir(path);
    for (const gone of ["old-a.md", "old-b.md"]) expect(names).not.toContain(gone);
    const merged = names.find((name) => name.startsWith("merged-legacy-"))!;
    const mergedContent = await Bun.file(join(path, merged)).text();
    // The retired type is preserved as-is, never promoted.
    expect(mergedContent).toContain('type: "project"');
    const manifest = await Bun.file(join(path, ".dreams", `${(await Bun.file(join(path, ".dream.status")).json()).runID}.json`)).json();
    expect(manifest.actions[0].output.type).toBe("project");
    // The selector saw the effective types rendered for legacy entries.
    expect(app.calls.find(isDreamSelector)!.prompt).toContain("[project|project|2026-08-01]");
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
    await Bun.write(join(path, ".dream.request"), JSON.stringify({ requestID: "req-keep", sessionID: "ses_dreamer" }));
    await Bun.write(join(path, ".dream.json"), JSON.stringify({ auto: true, additions: 4, since: Date.now() }));

    const curatorGate = Promise.withResolvers<Extraction>();
    const curatorStarted = Promise.withResolvers<void>();
    let classifications = 0;
    const app = await fixture(directory, ({ system }) => {
      if (isDreamSelector(system)) return { action: "merge", files: ["x.md", "y.md"], reason: "duplicate topics" };
      if (isDreamCurator(system)) {
        curatorStarted.resolve();
        return curatorGate.promise;
      }
      if (system.includes("classifier")) {
        classifications += 1;
        return saveDecisions(createDecision("a rule saved during the dream"));
      }
      return memoryExtraction();
    });

    await app.message("ses_keep", "Start dreaming.");
    await curatorStarted.promise;
    // An ordinary checkpoint save commits while the dream is parked mid-run.
    await app.message("ses_keep", "Remember something during the dream.");
    await app.message("ses_keep", "Second turn.");
    await until(() => classifications >= 1);
    await until(async () => {
      try {
        return ((await Bun.file(join(path, ".dream.json")).json()) as { additions?: number }).additions === 5;
      } catch {
        return false;
      }
    });
    curatorGate.resolve(memoryExtraction({ title: "Merged keep" }));
    await until(async () => {
      try {
        return (await Bun.file(join(path, ".dream.status")).json() as { state?: string }).state === "changed";
      } catch {
        return false;
      }
    });
    await app.hooks.dispose!();

    // Only the pre-dream baseline (4) is subtracted; the concurrent save (+1)
    // survives completion.
    const state = await Bun.file(join(path, ".dream.json")).json();
    expect(state.additions).toBe(1);
    expect(typeof state.lastRunAt).toBe("number");
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("fails a manual request while memory is disabled and stays silent for auto", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-dream-off-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-dream-off-project";
    const path = await store(dataHome, directory, [
      { file: "x.md", title: "X topic", summary: "[recap|project|2026-08-01] X summary", content: seededTopic("abc1111", "X_OFF_BODY") },
      { file: "y.md", title: "Y topic", summary: "[recap|project|2026-08-01] Y summary", content: seededTopic("def2222", "Y_OFF_BODY") },
    ]);
    await Bun.write(join(path, "settings.json"), JSON.stringify({ enabled: false }));
    const app = await fixture(directory, () => saveDecisions());

    // Manual: explicit failure status naming the disabled store; no mutation.
    await Bun.write(join(path, ".dream.request"), JSON.stringify({ requestID: "req-off", sessionID: "ses_off" }));
    await app.message("ses_off", "Trigger manual dream.");
    await until(async () => {
      try {
        return (await Bun.file(join(path, ".dream.status")).json() as { state?: string }).state === "failed";
      } catch {
        return false;
      }
    });
    const status = await Bun.file(join(path, ".dream.status")).json();
    expect(status.message).toContain("disabled");
    expect(await Bun.file(join(path, "x.md")).exists()).toBe(true);
    expect(await Bun.file(join(path, ".dream.request")).exists()).toBe(false);
    await app.hooks.dispose!();
    await rm(dataHome, { recursive: true, force: true });
  });
});

type Toast = { variant?: string; title?: string; message: string };

async function tuiFixture(
  directory: string,
  options: { route?: { name: string; params?: Record<string, unknown> } } = {},
) {
  const toasts: Toast[] = [];
  const handlers = new Map<string, Array<(event: never) => void>>();
  const disposers: Array<() => void | Promise<void>> = [];
  const layers: Array<{ commands: Array<Record<string, unknown>> }> = [];
  let dialogSelect: { options?: unknown; onSelect?: (option: { value: unknown }) => void } | undefined;
  const route = options.route ?? { name: "home" };
  const api = {
    keymap: { registerLayer: (layer: { commands: Array<Record<string, unknown>> }) => layers.push(layer) },
    route: {
      get current() {
        return route;
      },
    },
    event: {
      on: (type: string, handler: (event: never) => void) => {
        const list = handlers.get(type) ?? handlers.set(type, []).get(type)!;
        list.push(handler);
        return () => {
          list.splice(list.indexOf(handler), 1);
        };
      },
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose: (fn: () => void | Promise<void>) => {
        disposers.push(fn);
        return () => {};
      },
    },
    ui: {
      DialogSelect: (props: { options?: unknown; onSelect?: (option: { value: unknown }) => void }) => {
        dialogSelect = props;
        return props;
      },
      dialog: {
        replace: (render: () => { options?: unknown; onSelect?: (option: { value: unknown }) => void }) => {
          dialogSelect = render();
        },
      },
      toast: (toast: Toast) => toasts.push(toast),
    },
    state: { path: { directory } },
  };
  await MemoryTui.tui(api as never, undefined as never, {} as never);
  return {
    toasts,
    layers,
    command: (slashName: string) => {
      const command = layers.flatMap((layer) => layer.commands).find((item) => item.slashName === slashName) as { run?: () => void } | undefined;
      command?.run?.();
    },
    select: (value: unknown) => {
      if (!dialogSelect?.onSelect) return false;
      dialogSelect.onSelect({ value });
      return true;
    },
    sessionCreated: (info: { id: string; parentID?: string; metadata?: Record<string, unknown> }) => {
      for (const handler of [...handlers.get("session.created") ?? []]) {
        handler({ properties: { sessionID: info.id, info } } as never);
      }
    },
    dispose: () => Promise.all(disposers.map((dispose) => dispose())),
  };
}

describe("memory tui parsing helpers", () => {
  test("parses managed index entries and topic session ids", () => {
    const entries = managedIndexEntries(
      "# Project memory\n\n- [First](first.md) - One\n- [Second](second.md) - Two\n- [Typed](typed.md) - [reference|editor|2026-08-01] Ref summary\n- [Nested](nested/third.md) - No\nnot an entry\n",
    );
    expect([...entries.keys()]).toEqual(["first.md", "second.md", "typed.md"]);
    expect(entries.get("first.md")).toEqual({ title: "First", summary: "One" });
    // Metadata prefixes never leak into the displayed summary.
    expect(entries.get("typed.md")).toEqual({ title: "Typed", summary: "Ref summary" });

    expect(topicSessionId('---\nrevision: "abc"\ntype: "project"\nsessionId: "ses_x"\n---\n\nbody')).toBe("ses_x");
    expect(topicSessionId("---\nsessionId: ses_y\n---\n")).toBe("ses_y");
    expect(topicSessionId("no frontmatter")).toBeUndefined();
    expect(topicRevision('---\nrevision: "abc123"\nsessionId: "ses_x"\n---\n')).toBe("abc123");
    expect(topicRevision("no frontmatter")).toBeUndefined();
    expect(topicDreamRunId('---\ndreamRunId: "run-1"\n---\n')).toBe("run-1");
    expect(topicDreamRunId("no frontmatter")).toBeUndefined();

    expect(JSON.parse(toggledSettings({ enabled: true, custom: 3 }, "dream_auto"))).toEqual({ enabled: true, custom: 3, dream_auto: true });
    expect(JSON.parse(toggledSettings({ enabled: false, dream_auto: true }, "enabled"))).toEqual({ enabled: true, dream_auto: true });
    expect(dreamCountsMessage({ merge: 1, supersede: 2, synthesize: 1 })).toBe("1 merged, 2 superseded, 1 insight");
  });
});

describe("memory tui notifications", () => {
  test.serial("registers /dream and writes a session-scoped request", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-tui-dream-command-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-tui-dream-command";
    const memoryDirectory = join(dataHome, "opencode", "memory", tuiProjectKey(directory));
    const app = await tuiFixture(directory, { route: { name: "session", params: { sessionID: "ses_manual" } } });

    app.command("dream");
    const requestPath = join(memoryDirectory, ".dream.request");
    await until(async () => Bun.file(requestPath).exists());
    const request = await Bun.file(requestPath).json();
    expect(request.sessionID).toBe("ses_manual");
    expect(typeof request.requestID).toBe("string");
    expect(app.toasts.some((toast) => toast.message === "Dreaming...")).toBe(true);

    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

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
    await until(() => app.select({ type: "dreamToggle", enabled: false }));
    await until(async () => (await Bun.file(settingsPath).json() as { dream_auto?: boolean }).dream_auto === true);
    expect(await Bun.file(settingsPath).json()).toEqual({ enabled: false, custom: "keep", dream_auto: true });

    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("toasts one changed dream and suppresses its per-topic save", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-tui-dream-status-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-tui-dream-status";
    const memoryDirectory = join(dataHome, "opencode", "memory", tuiProjectKey(directory));
    await mkdir(memoryDirectory, { recursive: true });
    await Bun.write(join(memoryDirectory, "index.md"), "# Project memory\n");
    const app = await tuiFixture(directory, { route: { name: "session", params: { sessionID: "ses_parent" } } });
    app.command("dream");
    const requestPath = join(memoryDirectory, ".dream.request");
    await until(async () => Bun.file(requestPath).exists());
    const request = await Bun.file(requestPath).json();
    app.sessionCreated({ id: "ses_dream_worker", parentID: "ses_parent", metadata: { memoryWorker: true, memoryActivity: "dream" } });

    await Bun.write(join(memoryDirectory, "dreamed.md"), '---\nrevision: "abc123"\nsessionId: "ses_parent"\ndreamRunId: "run-new"\n---\n\nbody\n');
    await Bun.write(join(memoryDirectory, "index.md"), "# Project memory\n\n- [Dreamed](dreamed.md) - Dreamed summary\n");
    await Bun.write(join(memoryDirectory, ".dream.status"), JSON.stringify({
      requestID: request.requestID,
      runID: "run-new",
      state: "changed",
      counts: { merge: 1, supersede: 0, synthesize: 0 },
    }));
    await until(() => app.toasts.some((toast) => toast.message === "Dream complete: 1 merged"));
    await Bun.sleep(400);
    expect(app.toasts.some((toast) => toast.message === "Saved: Dreamed")).toBe(false);
    expect(app.toasts.filter((toast) => toast.message.startsWith("Dream complete:"))).toHaveLength(1);

    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("does not replay a persisted dream status in a new TUI", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-tui-dream-stale-status-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-tui-dream-stale-status";
    const memoryDirectory = join(dataHome, "opencode", "memory", tuiProjectKey(directory));
    await mkdir(memoryDirectory, { recursive: true });
    await Bun.write(join(memoryDirectory, "index.md"), "# Project memory\n");
    await Bun.write(join(memoryDirectory, ".dream.status"), JSON.stringify({ runID: "old-run", state: "changed", counts: { merge: 1 } }));
    const app = await tuiFixture(directory);

    await Bun.write(join(memoryDirectory, "index.md"), "# Project memory\n\n");
    await Bun.sleep(500);
    expect(app.toasts.some((toast) => toast.message.startsWith("Dream complete:"))).toBe(false);

    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("toasts one review per classifier and saves only for observed worker parents", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-tui-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-tui-project";
    const memoryDirectory = join(dataHome, "opencode", "memory", tuiProjectKey(directory));
    const app = await tuiFixture(directory);

    app.sessionCreated({ id: "ses_worker_1", parentID: "ses_parent", metadata: { memoryWorker: true, memoryActivity: "classification" } });
    app.sessionCreated({ id: "ses_worker_2", parentID: "ses_parent", metadata: { memoryWorker: true, memoryActivity: "extraction" } });
    app.sessionCreated({ id: "ses_worker_3", parentID: "ses_other", metadata: { memoryWorker: true, memoryActivity: "maintenance" } });
    app.sessionCreated({ id: "ses_child", parentID: "ses_parent" });
    expect(app.toasts.filter((toast) => toast.message === "Reviewing conversation...")).toHaveLength(1);
    app.sessionCreated({ id: "ses_worker_4", parentID: "ses_parent", metadata: { memoryWorker: true, memoryActivity: "classification" } });
    expect(app.toasts.filter((toast) => toast.message === "Reviewing conversation...")).toHaveLength(2);

    // The project directory appears after startup with a write from an
    // untracked session; the TUI must stay silent.
    await mkdir(memoryDirectory, { recursive: true });
    await Bun.write(join(memoryDirectory, "other.md"), '---\nsessionId: "ses_other_instance"\n---\n\nother\n');
    await Bun.write(join(memoryDirectory, "index.md"), "# Project memory\n\n- [Other](other.md) - Other topic\n");
    await Bun.sleep(600);
    expect(app.toasts.filter((toast) => toast.variant === "success")).toEqual([]);

    // A committed write attributed to the observed worker parent toasts once.
    await Bun.write(join(memoryDirectory, "saved.md"), '---\ntype: "project"\nsessionId: "ses_parent"\n---\n\nsaved\n');
    await Bun.write(
      join(memoryDirectory, "index.md"),
      "# Project memory\n\n- [Other](other.md) - Other topic\n- [Saved topic](saved.md) - Saved summary\n",
    );
    await until(() => app.toasts.filter((toast) => toast.message === "Saved: Saved topic").length === 1);
    await Bun.sleep(400);
    expect(app.toasts.filter((toast) => toast.variant === "success")).toHaveLength(1);
    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("toasts a first-ever save that commits before the directory attach runs", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-tui-first-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-tui-first";
    const memoryDirectory = join(dataHome, "opencode", "memory", tuiProjectKey(directory));
    const app = await tuiFixture(directory);
    app.sessionCreated({ id: "ses_worker", parentID: "ses_parent", metadata: { memoryWorker: true, memoryActivity: "classification" } });

    // Fully commit the first save before the root watcher callback can run.
    await mkdir(memoryDirectory, { recursive: true });
    await Bun.write(join(memoryDirectory, "first.md"), '---\ntype: "project"\nsessionId: "ses_parent"\n---\n\nfirst\n');
    await Bun.write(join(memoryDirectory, "index.md"), "# Project memory\n\n- [First ever](first.md) - First summary\n");
    await until(() => app.toasts.some((toast) => toast.message === "Saved: First ever"));
    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("does not toast for content that already exists at startup", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-tui-existing-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-tui-existing";
    const memoryDirectory = join(dataHome, "opencode", "memory", tuiProjectKey(directory));
    await mkdir(memoryDirectory, { recursive: true });
    await Bun.write(join(memoryDirectory, "index.md"), "# Project memory\n\n- [Existing](existing.md) - Existing\n");
    await Bun.write(join(memoryDirectory, "existing.md"), '---\nrevision: "old"\nsessionId: "ses_old"\n---\n\nold\n');

    const app = await tuiFixture(directory);
    await Bun.sleep(300);
    expect(app.toasts).toEqual([]);

    // Replacements of an existing tracked topic are detected via index diffs.
    app.sessionCreated({ id: "ses_worker", parentID: "ses_parent", metadata: { memoryWorker: true, memoryActivity: "classification" } });
    await Bun.write(join(memoryDirectory, "existing.md"), '---\nrevision: "new"\nsessionId: "ses_parent"\n---\n\nupdated\n');
    await Bun.write(join(memoryDirectory, "index.md"), "# Project memory\n\n- [Existing updated](existing.md) - Updated\n");
    await until(() => app.toasts.some((toast) => toast.message === "Saved: Existing updated"));
    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("detects same-title replacements by revision and ignores unchanged rewrites", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-tui-replace-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-tui-replace";
    const memoryDirectory = join(dataHome, "opencode", "memory", tuiProjectKey(directory));
    await mkdir(memoryDirectory, { recursive: true });
    const line = "# Project memory\n\n- [Stable title](topic.md) - Stable summary\n";
    await Bun.write(join(memoryDirectory, "index.md"), line);
    await Bun.write(join(memoryDirectory, "topic.md"), '---\nrevision: "rev-a"\ntype: "project"\nsessionId: "ses_old"\n---\n\nold body\n');

    const app = await tuiFixture(directory);
    app.sessionCreated({ id: "ses_worker", parentID: "ses_parent", metadata: { memoryWorker: true, memoryActivity: "classification" } });
    await Bun.sleep(300);
    expect(app.toasts.filter((toast) => toast.variant === "success")).toEqual([]);

    // Rewriting the exact same committed content is not a save.
    await Bun.write(join(memoryDirectory, "topic.md"), '---\nrevision: "rev-a"\ntype: "project"\nsessionId: "ses_old"\n---\n\nold body\n');
    await Bun.sleep(700);
    expect(app.toasts.filter((toast) => toast.variant === "success")).toEqual([]);

    // A new revision behind an unchanged index line is a committed replacement.
    await Bun.write(join(memoryDirectory, "topic.md"), '---\nrevision: "rev-b"\ntype: "project"\nsessionId: "ses_parent"\n---\n\nnew body\n');
    await Bun.write(join(memoryDirectory, "index.md"), line);
    await until(() => app.toasts.some((toast) => toast.message === "Saved: Stable title"));
    await Bun.sleep(300);
    expect(app.toasts.filter((toast) => toast.variant === "success")).toHaveLength(1);
    await app.dispose();
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("disposes watchers so later writes stay silent", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-tui-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-tui-dispose";
    const memoryDirectory = join(dataHome, "opencode", "memory", tuiProjectKey(directory));
    await mkdir(memoryDirectory, { recursive: true });
    await Bun.write(join(memoryDirectory, "index.md"), "# Project memory\n");

    const app = await tuiFixture(directory);
    app.sessionCreated({ id: "ses_worker", parentID: "ses_parent", metadata: { memoryWorker: true } });
    await app.dispose();

    await Bun.write(join(memoryDirectory, "late.md"), '---\nsessionId: "ses_parent"\n---\n\nlate\n');
    await Bun.write(join(memoryDirectory, "index.md"), "# Project memory\n\n- [Late](late.md) - Late\n");
    await Bun.sleep(400);
    expect(app.toasts.filter((toast) => toast.variant === "success")).toEqual([]);
    await rm(dataHome, { recursive: true, force: true });
  });
});
