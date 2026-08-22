import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import MemoryModule, { indexLine, memoryProjectKey as serverProjectKey, parseIndexLine } from "./memory_server.tsx";
import MemoryTui, { managedIndexEntries, memoryProjectKey as tuiProjectKey, topicRevision, topicSessionId } from "./memory_tui.tsx";

const originalDataHome = process.env.XDG_DATA_HOME;
afterEach(() => {
  if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalDataHome;
});

type WorkerCall = { parentID: string; system: string; prompt: string };
type FakeMessage = { info: { id: string; sessionID: string; role: string }; parts: Array<{ type?: string; id?: string; synthetic?: boolean; text: string }> };

async function fixture(directory: string, respond: (call: WorkerCall) => unknown) {
  const calls: WorkerCall[] = [];
  let parentID = "";
  const client = {
    session: {
      create: async (options: { body: { parentID: string } }) => {
        parentID = options.body.parentID;
        return { data: { id: crypto.randomUUID() } };
      },
      prompt: async (options: { body: { system: string; parts: { text: string }[] } }) => {
        const call = { parentID, system: options.body.system, prompt: options.body.parts[0]!.text };
        calls.push(call);
        return { data: { info: { structured: await respond(call) } } };
      },
      abort: async () => ({ data: true }),
      delete: async () => ({ data: true }),
    },
    app: { log: async () => ({}) },
  };
  const hooks = await MemoryModule.server!({ client, directory } as never, { interval: 2 } as never);
  await hooks.config!({ small_model: "test/small" } as never);
  return {
    hooks,
    calls,
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

async function until(condition: () => boolean | Promise<boolean>) {
  while (!(await condition())) await new Promise<void>((resolve) => setImmediate(resolve));
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

    expect(parseIndexLine("- [Nested](nested/e.md) - s")).toBeUndefined();

    // Rendering scrubs separator characters and CR/LF so generated scope stays
    // a parseable one-liner.
    const scrubbed = indexLine({ title: "T", file: "t.md", summary: "S", metadata: { type: "recap", scope: "a|b[c]\nd\re", updated: "2026-08-23" } });
    expect(scrubbed).toContain("[recap|a b c  d e|2026-08-23]");
    expect(parseIndexLine(scrubbed)!.metadata.scope).toBe("a b c  d e");
  });
});

describe("memory persistence", () => {
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
    const workerMetadata: unknown[] = [];
    const client = {
      session: {
        create: async (options: { body: { metadata?: unknown } }) => {
          workerMetadata.push(options.body.metadata);
          return { data: { id: `worker-${worker}` } };
        },
        prompt: async (options: { body: { parts: { text: string }[] } }) => {
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
    // Extraction is constrained to the decision subject.
    expect(workerPrompts[1]).toContain("<subject>");
    expect(workerPrompts[1]).toContain("confirmed focused test approach");
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

type Toast = { variant?: string; title?: string; message: string };

async function tuiFixture(directory: string) {
  const toasts: Toast[] = [];
  const handlers = new Map<string, Array<(event: never) => void>>();
  const disposers: Array<() => void | Promise<void>> = [];
  const api = {
    keymap: { registerLayer: () => {} },
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
    ui: { toast: (toast: Toast) => toasts.push(toast) },
    state: { path: { directory } },
  };
  await MemoryTui.tui(api as never, undefined as never, {} as never);
  return {
    toasts,
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
  });
});

describe("memory tui notifications", () => {
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
