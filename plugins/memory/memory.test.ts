import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import MemoryModule, { memoryProjectKey as serverProjectKey } from "./memory_server.tsx";
import { memoryProjectKey as tuiProjectKey } from "./memory_tui.tsx";

const originalDataHome = process.env.XDG_DATA_HOME;
afterEach(() => {
  if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalDataHome;
});

type WorkerCall = { parentID: string; system: string; prompt: string };

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

const projectExtraction = (title = "Stored project") => ({
  title,
  summary: "A durable project rule.",
  type: "project",
  content: "The project uses the established durable rule. The user accepted this decision after the focused implementation was verified.",
});

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

describe("memory persistence", () => {
  test.serial("creates typed memory with the originating session as last writer", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const structured = [
      { action: "create", target: null },
      {
        title: "Confirmed test approach",
        summary: "Use the confirmed focused test approach.",
        type: "feedback",
        content: "Use focused Bun tests before the full suite.\n\n**Why:** The user confirmed this catches failures quickly.\n\n**How to apply:** Run the affected plugin test first.",
      },
    ];
    let worker = 0;
    const workerPrompts: string[] = [];
    const client = {
      session: {
        create: async () => ({ data: { id: `worker-${worker}` } }),
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
    await plugin.dispose!();

    const memoryDirectory = join(dataHome, "opencode", "memory", serverProjectKey(directory));
    const topic = (await readdir(memoryDirectory)).find((name) => name.endsWith(".md") && name !== "index.md")!;
    const content = await Bun.file(join(memoryDirectory, topic)).text();
    expect(content).toContain('type: "feedback"');
    expect(content).toContain('sessionId: "ses_origin"');
    expect(content).toContain("**Why:**");
    expect(content).toContain("**How to apply:**");
    expect(workerPrompts[0]).toContain("bash: passed");
    expect(workerPrompts[0]).toContain("read: read");
    expect(workerPrompts[0]).not.toContain("command: bun test");
    expect(workerPrompts[0]).not.toContain("SUCCESS_EVIDENCE");
    expect(workerPrompts[0]).not.toContain("READ_EVIDENCE");
    expect(workerPrompts[0]).not.toContain("FAILED_EVIDENCE");
    expect(workerPrompts[0]).not.toContain("The focused Bun test is the confirmed approach.");
    expect(workerPrompts[1]).toContain("The focused Bun test is the confirmed approach.");
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
      if (system.includes("classifier")) return classifications++ === 0
        ? { action: "none", target: null }
        : { action: "replace", target: "legacy.md" };
      return projectExtraction("Updated legacy");
    });
    await app.message("ses_latest", "Load memory.");
    await app.message("ses_latest", "Update the established rule.");
    await until(() => app.calls.length >= 1);
    await Bun.sleep(10);
    await app.message("ses_latest", "Continue.");
    await app.message("ses_latest", "Apply the update.");
    await until(() => app.calls.length >= 3);
    await app.hooks.dispose!();

    const topic = await Bun.file(join(path, "legacy.md")).text();
    const index = await Bun.file(join(path, "index.md")).text();
    expect(topic).toContain('type: "project"');
    expect(topic).toContain('sessionId: "ses_latest"');
    expect(index).toContain("[Updated legacy](legacy.md)");
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
      if (system.includes("classifier")) return { action: "create", target: null };
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
    extraction.resolve(projectExtraction());
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
      return { action: "none", target: null };
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
    const app = await fixture(directory, () => ({ action: "none", target: null }));
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
        return projectExtraction("Consolidated topic");
      }
      return { action: "none", target: null };
    });
    await app.message("ses_maintenance_writer", "Use memory.");
    await consolidated.promise;
    await app.hooks.dispose!();

    expect(consolidationPrompt).toContain("COMPLETE_START_0");
    expect(consolidationPrompt).toContain("COMPLETE_END_0");
    expect(consolidationPrompt).toContain("COMPLETE_START_1");
    expect(consolidationPrompt).toContain("COMPLETE_END_1");
    const outputName = (await readdir(path)).find((name) => name.startsWith("consolidated-topic-"))!;
    expect(await Bun.file(join(path, outputName)).text()).toContain('sessionId: "ses_maintenance_writer"');
    await rm(dataHome, { recursive: true, force: true });
  });

  test.serial("coordinates two plugin instances without losing either index entry", async () => {
    const dataHome = await mkdtemp("/tmp/opencode-memory-test-");
    process.env.XDG_DATA_HOME = dataHome;
    const directory = "/tmp/memory-concurrent-project";
    const make = (title: string) => fixture(directory, ({ system }) => system.includes("classifier")
      ? { action: "create", target: null }
      : projectExtraction(title));
    const [first, second] = await Promise.all([make("First writer"), make("Second writer")]);
    await Promise.all([
      first.message("ses_first", "First.").then(() => first.message("ses_first", "Save first.")).then(() => first.message("ses_first", "Continue.")),
      second.message("ses_second", "First.").then(() => second.message("ses_second", "Save second.")).then(() => second.message("ses_second", "Continue.")),
    ]);
    await Promise.all([first.hooks.dispose!(), second.hooks.dispose!()]);

    const path = join(dataHome, "opencode", "memory", serverProjectKey(directory));
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
    ]);
    const app = await fixture(directory, () => ({ action: "none", target: null }));

    const output = { system: [] as string[] };
    await app.hooks["experimental.chat.system.transform"]!({ sessionID: "ses_index" } as never, output);
    expect(output.system).toHaveLength(1);
    expect(output.system[0]!.startsWith("<memory>\n")).toBe(true);
    expect(output.system[0]!.endsWith("\n</memory>")).toBe(true);
    expect(output.system[0]).toContain(path);
    expect(output.system[0]).toContain("[First](first.md) - First summary");
    expect(output.system[0]).toContain("[Second](second.md) - Second summary");
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
    const app = await fixture(directory, () => ({ action: "none", target: null }));
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
      return projectExtraction();
    });

    await app.message("ses_background", "First.");
    const triggering = app.message("ses_background", "Second.");
    await triggering;
    await started.promise;
    await app.message("ses_background", "Third while classification is pending.");
    classification.resolve({ action: "none", target: null });
    await app.hooks.dispose!();
    await rm(dataHome, { recursive: true, force: true });
  });
});
