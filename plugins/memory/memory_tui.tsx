/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createSignal, Show } from "solid-js";
import { MemoryRpc, type DreamStatus } from "./memory_rpc.ts";

type Choice =
  | { type: "toggle" }
  | { type: "dreamToggle" }
  | { type: "dreamNow" }
  | { type: "folder" }
  | { type: "file"; name: string };

const INDEX_FILE = "index.md";
const SETTINGS_FILE = "settings.json";

export function memoryProjectKey(directory: string): string {
  const resolvedDirectory = resolve(directory);
  return `${resolvedDirectory.toLowerCase().replace(/[^a-z._-]/g, "-")}-${Bun.hash.wyhash(resolvedDirectory).toString(16).padStart(8, "0").slice(0, 8)}`;
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
  const labels = [["synthesize", "synthesized"], ["prune", "pruned"]] as const;
  for (const [key, label] of labels) {
    const count = counts?.[key];
    if (typeof count === "number" && count > 0) parts.push(`${count} ${label}`);
  }
  return parts.join(", ");
}

export function isDreamingForSession(status: DreamStatus | undefined, sessionID: string): boolean {
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
  const raw: unknown = await file.exists() ? await file.json() : undefined;
  const settings = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { enabled: settings.enabled !== false, dream_auto: settings.dream_auto === true, raw };
}

async function openInEditor(ctx: Plugin.Context, target: string, cwd: string): Promise<void> {
  const editor = process.env.VISUAL ?? process.env.EDITOR;
  if (!editor) {
    ctx.ui.toast.show({ variant: "warning", title: "Memory", message: "Set VISUAL or EDITOR to open memory files" });
    return;
  }

  ctx.ui.dialog.clear();
  ctx.renderer.suspend();
  ctx.renderer.currentRenderBuffer.clear();
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
    ctx.renderer.currentRenderBuffer.clear();
    ctx.renderer.resume();
    ctx.renderer.requestRender();
  }
}

async function showMemory(ctx: Plugin.Context, directory: string, requestDream: () => Promise<void>): Promise<void> {
  const settings = await readSettings(directory);
  const files = await stat(directory).then(() => true, () => false)
    ? (await readdir(directory))
      .filter((file) => file.endsWith(".md") && file !== INDEX_FILE)
      .sort((left, right) => left.localeCompare(right))
    : [];

  const choice = await ctx.ui.dialog.select<Choice>({
    title: "Project memory",
    placeholder: "Search memory",
    options: [
      {
        title: `Auto-memory: ${settings.enabled ? "enabled" : "disabled"}`,
        description: settings.enabled ? "Disable recall and learning" : "Enable recall and learning",
        value: { type: "toggle" },
      },
      {
        title: `Auto-dream: ${settings.dream_auto ? "enabled" : "disabled"}`,
        description: settings.dream_auto ? "Disable periodic memory dreaming" : "Enable periodic memory dreaming",
        value: { type: "dreamToggle" },
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
    ],
  });
  if (!choice) return;
  if (choice.type === "toggle" || choice.type === "dreamToggle") {
    await atomicWrite(join(directory, SETTINGS_FILE), toggledSettings(settings.raw, choice.type === "toggle" ? "enabled" : "dream_auto"));
    await showMemory(ctx, directory, requestDream);
    return;
  }
  if (choice.type === "dreamNow") {
    await requestDream();
    await showMemory(ctx, directory, requestDream);
    return;
  }
  await mkdir(directory, { recursive: true });
  await openInEditor(ctx, choice.type === "folder" ? directory : join(directory, choice.name), directory);
}

function DreamSidebar(props: { ctx: Plugin.Context; sessionID: string; status: () => DreamStatus | undefined }) {
  const theme = props.ctx.theme;
  return (
    <Show when={isDreamingForSession(props.status(), props.sessionID)}>
      <box>
        <text fg={theme.text.base}><b>Memory</b></text>
        <text fg={theme.text.muted}>
          <span style={{ fg: theme.text.feedback.warning.base }}>•</span> Dreaming...
        </text>
      </box>
    </Show>
  );
}

function Commands(props: { ctx: Plugin.Context; open: () => void; dream: () => void }) {
  props.ctx.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "memory.open",
      title: "Project memory",
      group: "Project",
      palette: true,
      slash: { name: "memory" },
      run: props.open,
    }, {
      id: "memory.dream",
      title: "Dream now",
      group: "Project",
      palette: true,
      slash: { name: "dream" },
      run: props.dream,
    }],
  }));
  return null;
}

export default Plugin.define({
  id: "memory",
  setup(ctx) {
    const workspace = ctx.location?.directory ?? ctx.data.location.default().directory;
    const directory = projectDirectory(workspace);
    const memory = ctx.client.rpc(MemoryRpc);
    const [activeDream, setActiveDream] = createSignal<DreamStatus>();
    // The outstanding manual request this instance is waiting on.
    let outstandingRequestID: string | undefined;

    const toastError = (error: unknown) => {
      ctx.ui.toast.show({ variant: "error", title: "Memory", message: error instanceof Error ? error.message : String(error) });
    };

    // The current session, when the route has one, owns the sidebar indicator.
    const requestDream = async () => {
      const requestID = crypto.randomUUID();
      outstandingRequestID = requestID;
      const route = ctx.ui.router.current();
      const sessionID = route.type === "session" ? route.sessionID : undefined;
      await memory.dream({ requestID, sessionID }, { location: { directory: workspace } });
      ctx.ui.toast.show({ variant: "info", title: "Memory", message: "Dreaming..." });
    };

    // Review and save notifications only surface for sessions this TUI knows.
    const known = (sessionID: string) => ctx.data.session.get(sessionID) !== undefined;

    const unsubscribers = [
      memory.events.on("review", (event) => {
        if (known(event.data.sessionID)) ctx.ui.toast.show({ variant: "info", title: "Memory", message: "Reviewing conversation..." });
      }),
      memory.events.on("saved", (event) => {
        if (known(event.data.sessionID)) ctx.ui.toast.show({ variant: "success", title: "Memory", message: `Saved: ${event.data.title}` });
      }),
      memory.events.on("dream", (event) => {
        const status = event.data;
        setActiveDream(status.state === "running" && status.sessionID ? status : undefined);
        if (status.state === "running") return;
        const matchedRequest = status.requestID !== null && status.requestID === outstandingRequestID;
        if (matchedRequest) outstandingRequestID = undefined;
        // Changed runs get one completion toast regardless of trigger; no-ops
        // stay silent; failures warn only for this instance's own request.
        if (status.state === "changed") {
          ctx.ui.toast.show({ variant: "success", title: "Memory", message: `Dream complete: ${dreamCountsMessage(status.counts)}` });
        } else if (status.state === "failed" && matchedRequest) {
          ctx.ui.toast.show({ variant: "warning", title: "Memory", message: status.message ? `Dream failed: ${status.message}` : "Dream failed" });
        }
      }),
      ctx.ui.slot({
        append: "app",
        render: () => (
          <Commands
            ctx={ctx}
            open={() => void showMemory(ctx, directory, requestDream).catch(toastError)}
            dream={() => void requestDream().catch(toastError)}
          />
        ),
      }),
      ctx.ui.slot({
        append: "sidebar.content",
        render: (props) => <DreamSidebar ctx={ctx} sessionID={props.sessionID} status={activeDream} />,
      }),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  },
});
