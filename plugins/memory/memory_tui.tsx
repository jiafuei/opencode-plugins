/** @jsxImportSource @opentui/solid */
import type { FSWatcher } from "node:fs";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { watch } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createSignal } from "solid-js";

// For manual configuration, add the package to `tui.json`:
//
// {
//   "plugin": ["@jiafuei/opencode-memory"]
// }

type Choice =
  | { type: "toggle"; enabled: boolean }
  | { type: "dreamToggle"; enabled: boolean }
  | { type: "dreamNow" }
  | { type: "folder" }
  | { type: "file"; name: string };

export type DreamStatusFile = {
  requestID?: string | null;
  runID?: string;
  state?: "running" | "changed" | "noop" | "failed";
  sessionID?: string;
  startedAt?: string;
  finishedAt?: string;
  counts?: Record<string, unknown>;
  message?: string;
};

const INDEX_FILE = "index.md";
const SETTINGS_FILE = "settings.json";
const DREAM_REQUEST_FILE = ".dream.request";
const DREAM_STATUS_FILE = ".dream.status";
const INDEX_ENTRY = /^- \[([^\]]+)]\(([^)]+\.md)\) - (.+)$/;
const INDEX_METADATA = /^\[[a-z]+\|[^|\]]+\|\d{4}-\d{2}-\d{2}\]\s*/;
const SESSION_ID = /^sessionId:\s*"?([^"\s]+)"?\s*$/m;
const REVISION = /^revision:\s*"?([^"\s]+)"?\s*$/m;
const DREAM_RUN_ID = /^dreamRunId:\s*"?([^"\s]+)"?\s*$/m;
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
    const summary = match[3]!.replace(INDEX_METADATA, "");
    entries.set(file, { title: match[1]!, summary });
  }
  return entries;
}

export function topicSessionId(content: string): string | undefined {
  return content.match(SESSION_ID)?.[1];
}

export function topicRevision(content: string): string | undefined {
  return content.match(REVISION)?.[1];
}

// Plugin-owned marker on dream-produced topics; such topics never emit the
// ordinary per-topic "Saved" toast (the run's completion toast covers them).
export function topicDreamRunId(content: string): string | undefined {
  return content.match(DREAM_RUN_ID)?.[1];
}

// Toggles one known settings flag while preserving every other field the file
// may carry. `enabled` defaults to true when absent; `dream_auto` to false.
export function toggledSettings(current: unknown, key: "enabled" | "dream_auto"): string {
  const settings = current && typeof current === "object" ? { ...(current as Record<string, unknown>) } : {};
  settings[key] = !(settings[key] ?? (key === "enabled"));
  return `${JSON.stringify(settings, null, 2)}\n`;
}

// Concise operation counts for the dream completion toast.
export function dreamCountsMessage(counts: Record<string, unknown> | undefined): string {
  const parts: string[] = [];
  const labels = [["merge", "merged", "merged"], ["supersede", "superseded", "superseded"], ["synthesize", "insight", "insights"]] as const;
  for (const [key, one, many] of labels) {
    const count = counts?.[key];
    if (typeof count === "number" && count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
  }
  return parts.join(", ");
}

export function isDreamingForSession(status: DreamStatusFile | undefined, sessionID: string): boolean {
  return status?.state === "running" && status.sessionID === sessionID;
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

async function readSettings(directory: string): Promise<{ enabled: boolean; dream_auto: boolean; raw: unknown }> {
  const file = Bun.file(join(directory, SETTINGS_FILE));
  let raw: unknown;
  if (await file.exists()) {
    try {
      raw = await file.json();
    } catch {
      raw = undefined;
    }
  }
  const settings = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { enabled: settings.enabled !== false, dream_auto: settings.dream_auto === true, raw };
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

async function showMemory(api: TuiPluginApi, requestDream: () => Promise<void>): Promise<void> {
  try {
    const directory = projectDirectory(api.state.path.directory);

    const settings = await readSettings(directory);
    const files = await stat(directory).then(() => true, () => false)
      ? (await readdir(directory))
        .filter((file) => file.endsWith(".md") && file !== INDEX_FILE)
        .sort((left, right) => left.localeCompare(right))
      : [];

    const choices: Array<{ title: string; description: string; value: Choice }> = [
      {
        title: `Auto-memory: ${settings.enabled ? "enabled" : "disabled"}`,
        description: settings.enabled ? "Disable recall and learning" : "Enable recall and learning",
        value: { type: "toggle", enabled: settings.enabled },
      },
      {
        title: `Auto-dream: ${settings.dream_auto ? "enabled" : "disabled"}`,
        description: settings.dream_auto ? "Disable periodic memory dreaming" : "Enable periodic memory dreaming",
        value: { type: "dreamToggle", enabled: settings.dream_auto },
      },
      {
        title: "Dream now",
        description: "Run one memory dreaming pass now",
        value: { type: "dreamNow" },
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
            await atomicWrite(join(directory, SETTINGS_FILE), toggledSettings(settings.raw, "enabled"));
            await showMemory(api, requestDream);
            return;
          }
          if (option.value.type === "dreamToggle") {
            await atomicWrite(join(directory, SETTINGS_FILE), toggledSettings(settings.raw, "dream_auto"));
            await showMemory(api, requestDream);
            return;
          }
          if (option.value.type === "dreamNow") {
            await requestDream();
            await showMemory(api, requestDream);
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
  const directory = projectDirectory(api.state.path.directory);
  const memoryRoot = dirname(directory);
  const [activeDream, setActiveDream] = createSignal<DreamStatusFile>();

  // Manual dream request state: the outstanding request this instance is
  // waiting on, and the last status run already rendered (dedupe).
  let outstandingRequestID: string | undefined;
  let lastStatusRunID: string | undefined;

  // A persisted status predates this TUI instance. Seed the dedupe marker so
  // an unrelated later filesystem event cannot replay its completion toast.
  const existingStatus = Bun.file(join(directory, DREAM_STATUS_FILE));
  if (await existingStatus.exists()) {
    try {
      const status = await existingStatus.json() as DreamStatusFile;
      if (status.state === "running" && typeof status.sessionID === "string") {
        setActiveDream(status);
      } else if (typeof status.runID === "string") {
        lastStatusRunID = status.runID;
      }
    } catch {}
  }

  // Writes the plugin-owned request file the server polls for. The current
  // session ID is included when the TUI route has one; otherwise the server
  // falls back to its most recently active live session.
  const requestDream = async () => {
    await mkdir(directory, { recursive: true });
    outstandingRequestID = crypto.randomUUID();
    const route = api.route.current;
    const sessionID = route.name === "session" ? route.params?.sessionID : undefined;
    await atomicWrite(join(directory, DREAM_REQUEST_FILE), `${JSON.stringify({
      requestID: outstandingRequestID,
      ...(sessionID ? { sessionID } : {}),
      requestedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    api.ui.toast({ variant: "info", title: "Memory", message: "Dreaming..." });
  };

  const processStatus = async () => {
    const file = Bun.file(join(directory, DREAM_STATUS_FILE));
    if (!(await file.exists())) return;
    let status: DreamStatusFile;
    try {
      status = await file.json();
    } catch {
      return;
    }
    if (!status || typeof status.runID !== "string") return;
    setActiveDream(status.state === "running" && typeof status.sessionID === "string" ? status : undefined);
    if (status.state === "running") return;
    if (status.runID === lastStatusRunID) return;
    lastStatusRunID = status.runID;
    const matchedRequest = Boolean(status.requestID && status.requestID === outstandingRequestID);
    if (matchedRequest) outstandingRequestID = undefined;
    // Changed runs get one completion toast regardless of trigger; no-ops stay
    // silent; failures warn only for this instance's own manual request.
    if (status.state === "changed") {
      api.ui.toast({ variant: "success", title: "Memory", message: `Dream complete: ${dreamCountsMessage(status.counts)}` });
    } else if (status.state === "failed" && matchedRequest) {
      api.ui.toast({ variant: "warning", title: "Memory", message: status.message ? `Dream failed: ${status.message}` : "Dream failed" });
    }
  };

  api.keymap.registerLayer({
    commands: [{
      name: "memory.open",
      title: "Project memory",
      category: "Project",
      namespace: "palette",
      slashName: "memory",
      run() {
        void showMemory(api, requestDream);
      },
    }, {
      name: "memory.dream",
      title: "Dream now",
      category: "Project",
      namespace: "palette",
      slashName: "dream",
      run() {
        void requestDream().catch((error) => {
          api.ui.toast({ variant: "error", title: "Memory", message: error instanceof Error ? error.message : String(error) });
        });
      },
    }],
    bindings: [],
  });

  api.slots.register({
    order: 300,
    slots: {
      sidebar_content(_ctx, props) {
        if (!isDreamingForSession(activeDream(), props.session_id)) return;
        return (
          <box>
            <text fg={api.theme.current.text}><b>Memory</b></text>
            <text fg={api.theme.current.textMuted}>
              <span style={{ fg: api.theme.current.warning }}>•</span> Dreaming...
            </text>
          </box>
        );
      },
    },
  });

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
    return { revision: topicRevision(text), sessionId: topicSessionId(text), dreamRunId: topicDreamRunId(text) };
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
      // Dream-produced topics never emit the ordinary save toast; their run's
      // completion status covers them regardless of event ordering.
      if (topic.dreamRunId) continue;
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
      void processStatus().catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  };

  const attachProjectWatcher = () => {
    if (disposed || watchers.size) return;
    try {
      const watcher = watch(directory, { persistent: false }, (_eventType, filename) => {
        if (typeof filename === "string") {
          if (filename === DREAM_STATUS_FILE) {
            scheduleCheck();
            return;
          }
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
