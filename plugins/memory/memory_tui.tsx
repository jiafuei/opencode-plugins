import type { FSWatcher } from "node:fs";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { watch } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

// For manual configuration, add the package to `tui.json`:
//
// {
//   "plugin": ["@jiafuei/opencode-memory"]
// }

type Choice =
  | { type: "toggle"; enabled: boolean }
  | { type: "folder" }
  | { type: "file"; name: string };

const INDEX_FILE = "index.md";
const SETTINGS_FILE = "settings.json";
const INDEX_ENTRY = /^- \[([^\]]+)]\(([^)]+\.md)\) - (.+)$/;
const SESSION_ID = /^sessionId:\s*"?([^"\s]+)"?\s*$/m;
const REVISION = /^revision:\s*"?([^"\s]+)"?\s*$/m;
const PARENT_TTL_MS = 15 * 60_000;
const PARENT_LIMIT = 100;
const SAVE_DEBOUNCE_MS = 250;
const WRITE_SETTLE_MS = 50;

type TrackedEntry = { title: string; summary: string; revision?: string };

export function memoryProjectKey(directory: string): string {
  const resolvedDirectory = resolve(directory);
  return `${resolvedDirectory.toLowerCase().replace(/[^a-z._-]/g, "-")}-${Bun.hash.wyhash(resolvedDirectory).toString(16).padStart(8, "0").slice(0, 8)}`;
}

export function managedIndexEntries(content: string): Map<string, { title: string; summary: string }> {
  const entries = new Map<string, { title: string; summary: string }>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(INDEX_ENTRY);
    const file = match?.[2];
    if (!file || basename(file) !== file) continue;
    entries.set(file, { title: match[1]!, summary: match[3]! });
  }
  return entries;
}

export function topicSessionId(content: string): string | undefined {
  return content.match(SESSION_ID)?.[1];
}

export function topicRevision(content: string): string | undefined {
  return content.match(REVISION)?.[1];
}

function projectDirectory(directory: string): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "memory", memoryProjectKey(directory));
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, content);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function readEnabled(directory: string): Promise<boolean> {
  const file = Bun.file(join(directory, SETTINGS_FILE));
  if (!(await file.exists())) return true;
  try {
    return (await file.json() as { enabled?: boolean }).enabled !== false;
  } catch {
    return true;
  }
}

async function openInEditor(api: TuiPluginApi, target: string, cwd: string): Promise<void> {
  const editor = process.env.VISUAL ?? process.env.EDITOR;
  if (!editor) {
    api.ui.toast({ variant: "warning", title: "Memory", message: "Set VISUAL or EDITOR to open memory files" });
    return;
  }

  api.ui.dialog.clear();
  api.renderer.suspend();
  api.renderer.currentRenderBuffer.clear();
  try {
    const command = editor.split(" ").filter(Boolean);
    const child = Bun.spawn([...command, target], {
      cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`Editor exited with code ${exitCode}`);
  } finally {
    api.renderer.currentRenderBuffer.clear();
    api.renderer.resume();
    api.renderer.requestRender();
  }
}

async function showMemory(api: TuiPluginApi): Promise<void> {
  try {
    const directory = projectDirectory(api.state.path.directory);

    const enabled = await readEnabled(directory);
    const files = await stat(directory).then(() => true, () => false)
      ? (await readdir(directory))
        .filter((file) => file.endsWith(".md") && file !== INDEX_FILE)
        .sort((left, right) => left.localeCompare(right))
      : [];

    const choices: Array<{ title: string; description: string; value: Choice }> = [
      {
        title: `Auto-memory: ${enabled ? "enabled" : "disabled"}`,
        description: enabled ? "Disable recall and learning" : "Enable recall and learning",
        value: { type: "toggle", enabled },
      },
      {
        title: "Open memory folder",
        description: directory,
        value: { type: "folder" },
      },
      {
        title: INDEX_FILE,
        description: "Project memory index",
        value: { type: "file", name: INDEX_FILE },
      },
      ...files.map((name) => ({
        title: name,
        description: "Memory topic",
        value: { type: "file" as const, name },
      })),
    ];

    api.ui.dialog.replace(() => api.ui.DialogSelect<Choice>({
      title: "Project memory",
      placeholder: "Search memory",
      options: choices,
      onSelect: (option) => {
        void (async () => {
          if (option.value.type === "toggle") {
            await atomicWrite(join(directory, SETTINGS_FILE), `${JSON.stringify({ enabled: !option.value.enabled }, null, 2)}\n`);
            await showMemory(api);
            return;
          }
          const target = option.value.type === "folder" ? directory : join(directory, option.value.name);
          await mkdir(directory, { recursive: true });
          await openInEditor(api, target, directory);
        })().catch((error) => {
          api.ui.toast({
            variant: "error",
            title: "Memory",
            message: error instanceof Error ? error.message : String(error),
          });
        });
      },
    }));
  } catch (error) {
    api.ui.toast({
      variant: "error",
      title: "Memory",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const MemoryTuiPlugin: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [{
      name: "memory.open",
      title: "Project memory",
      category: "Project",
      namespace: "palette",
      slashName: "memory",
      run() {
        void showMemory(api);
      },
    }],
    bindings: [],
  });

  const directory = projectDirectory(api.state.path.directory);
  const memoryRoot = dirname(directory);
  // Only the shared memory root is created here; the per-project directory is
  // created lazily by the server's coordinated writes or by TUI write actions.
  await mkdir(memoryRoot, { recursive: true });

  const parents = new Map<string, number>();
  const watchers = new Set<FSWatcher>();
  let baseline = new Map<string, TrackedEntry>();
  const changedFiles = new Set<string>();
  let changedAll = false;
  let attaching = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const closeWatchers = () => {
    for (const watcher of watchers) watcher.close();
    watchers.clear();
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  };

  const readTopic = async (file: string) => {
    const topic = Bun.file(join(directory, file));
    if (!(await topic.exists())) return undefined;
    const text = await topic.text();
    return { revision: topicRevision(text), sessionId: topicSessionId(text) };
  };

  const readIndexEntries = async () => {
    const file = Bun.file(join(directory, INDEX_FILE));
    return managedIndexEntries(await file.exists() ? await file.text() : "");
  };

  const readBaseline = async () => {
    const tracked = new Map<string, TrackedEntry>();
    for (const [file, entry] of await readIndexEntries()) {
      tracked.set(file, { ...entry, revision: (await readTopic(file))?.revision });
    }
    return tracked;
  };

  // Diffs the committed index and flagged topic files against the baseline.
  // Candidates come from committed index membership only, so a topic written
  // but not yet indexed (or rolled back) never toasts on its own fs event.
  const processChanges = async () => {
    const entries = await readIndexEntries();
    const previous = baseline;
    const checkAll = changedAll;
    changedAll = false;
    const flagged = new Set(changedFiles);
    changedFiles.clear();

    const next = new Map<string, TrackedEntry>();
    const now = Date.now();
    for (const [file, entry] of entries) {
      const before = previous.get(file);
      const untouched = before !== undefined && before.title === entry.title && before.summary === entry.summary &&
        !checkAll && !flagged.has(file);
      if (untouched) {
        next.set(file, { ...entry, revision: before!.revision });
        continue;
      }
      const topic = await readTopic(file);
      next.set(file, { ...entry, revision: topic?.revision });
      if (!topic) continue;
      const seen = topic.sessionId === undefined ? undefined : parents.get(topic.sessionId);
      if (seen === undefined || now - seen > PARENT_TTL_MS) continue;

      const structural = !before || before.title !== entry.title || before.summary !== entry.summary;
      if (!structural && before!.revision !== undefined && before!.revision === topic.revision) continue;
      if (!structural) {
        // Same title/summary with a changed revision can be a replacement whose
        // index rewrite is still in flight; wait for the write pair to settle
        // so a rollback is never announced.
        await Bun.sleep(WRITE_SETTLE_MS);
        const settled = await readTopic(file);
        if (!settled || settled.revision !== topic.revision) {
          if (settled) next.set(file, { ...entry, revision: settled.revision });
          continue;
        }
      }
      api.ui.toast({ variant: "success", title: "Memory", message: `Saved: ${entry.title}` });
    }
    baseline = next;
  };

  const scheduleCheck = () => {
    if (disposed) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void processChanges().catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  };

  const attachProjectWatcher = () => {
    if (disposed || watchers.size) return;
    try {
      const watcher = watch(directory, { persistent: false }, (_eventType, filename) => {
        if (typeof filename === "string") {
          if (filename.endsWith(".md") && filename !== INDEX_FILE) changedFiles.add(filename);
        } else {
          changedAll = true;
        }
        scheduleCheck();
      });
      watcher.on("error", () => {
        watchers.delete(watcher);
        watcher.close();
      });
      watchers.add(watcher);
    } catch {
      // The directory disappeared between the existence check and the attach.
    }
  };

  const attachWhenCreated = () => {
    if (disposed) return;
    try {
      const watcher = watch(memoryRoot, { persistent: false }, () => {
        if (attaching) return;
        attaching = true;
        void (async () => {
          if (!(await stat(directory).then((info) => info.isDirectory(), () => false))) {
            attaching = false;
            return;
          }
          watcher.close();
          watchers.delete(watcher);
          attachProjectWatcher();
          // The directory was absent at startup, so everything that appears in
          // it is new during this TUI lifetime; diff against the empty startup
          // baseline even when content already exists at this point.
          await processChanges();
        })().catch(() => {});
      });
      watcher.on("error", () => {
        watchers.delete(watcher);
        watcher.close();
      });
      watchers.add(watcher);
    } catch {
      // The shared root disappeared; nothing to watch.
    }
  };

  if (await stat(directory).then(() => true, () => false)) {
    baseline = await readBaseline();
    attachProjectWatcher();
  } else {
    attachWhenCreated();
  }

  const unsubscribe = api.event.on("session.created", (event) => {
    const info = event.properties.info;
    if (!info.parentID || info.metadata?.memoryWorker !== true) return;
    const now = Date.now();
    parents.delete(info.parentID);
    parents.set(info.parentID, now);
    while (parents.size > PARENT_LIMIT) {
      const oldest = parents.keys().next().value;
      if (oldest === undefined) break;
      parents.delete(oldest);
    }
    // Every checkpoint runs exactly one classifier worker, so no dedupe is
    // needed; extraction and maintenance workers stay silent.
    if (info.metadata.memoryActivity !== "classification") return;
    api.ui.toast({ variant: "info", title: "Memory", message: "Reviewing conversation..." });
  });

  api.lifecycle.onDispose(() => {
    disposed = true;
    unsubscribe();
    closeWatchers();
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "memory",
  tui: MemoryTuiPlugin,
};

export default plugin;
