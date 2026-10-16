/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createSignal, Show } from "solid-js";
import { MemoryRpc, type DreamStatus } from "./rpc.ts";

type Choice =
  | { type: "toggle"; key: "enabled" | "dream_auto" }
  | { type: "dreamNow" }
  | { type: "topic"; file: string }
  | { type: "view"; file: string }
  | { type: "edit"; file: string }
  | { type: "history" }
  | { type: "back" };

// Concise operation counts for the dream completion toast.
export function dreamCountsMessage(counts: Record<string, unknown> | undefined): string {
  const parts: string[] = [];
  const labels = [["synthesize", "synthesized"], ["prune", "pruned"]] as const;
  for (const [key, label] of labels) {
    const count = counts?.[key];
    if (count) parts.push(`${count} ${label}`);
  }
  return parts.join(", ");
}

export function isDreamingForSession(status: DreamStatus | undefined, sessionID: string): boolean {
  return status?.state === "running" && status.sessionID === sessionID;
}

async function openInEditor(ctx: Plugin.Context, target: string, cwd: string): Promise<void> {
  const editor = process.env.VISUAL ?? process.env.EDITOR;
  if (!editor) {
    ctx.ui.toast.show({ variant: "warning", title: "Memory", message: "Set VISUAL or EDITOR to edit memory topics" });
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

function Commands(props: { ctx: Plugin.Context; open: () => void; dream: () => void; web: () => void }) {
  props.ctx.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "memory.open",
      title: "Global and project memory",
      group: "Project",
      palette: true,
      slash: { name: "memory" },
      run: props.open,
    }, {
      id: "memory.web",
      title: "Memory web dashboard",
      group: "Project",
      palette: true,
      slash: { name: "memory-web" },
      run: props.web,
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
    const location = { location: { directory: workspace } };
    const memory = ctx.client.rpc(MemoryRpc);
    const [activeDream, setActiveDream] = createSignal<DreamStatus>();
    // The outstanding manual request this instance is waiting on.
    let outstandingRequestID: string | undefined;

    const toastError = (error: unknown) => {
      ctx.ui.toast.show({ variant: "error", title: "Memory", message: error instanceof Error ? error.message : String(error) });
    };

    const currentSession = () => {
      const route = ctx.ui.router.current();
      return route.type === "session" ? route.sessionID : undefined;
    };

    const openDashboard = async () => {
      const { url } = await memory.dashboard({}, location);
      ctx.ui.toast.show({ variant: "info", title: "Memory dashboard", message: url, duration: 15_000 });
      const command = process.platform === "darwin" ? ["open", url]
        : process.platform === "win32" ? ["rundll32", "url.dll,FileProtocolHandler", url]
        : ["xdg-open", url];
      const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
      if (await child.exited !== 0) throw new Error(`Could not open a browser. Open this URL manually: ${url}`);
    };

    // The current session, when the route has one, owns the sidebar indicator.
    const requestDream = async () => {
      const requestID = crypto.randomUUID();
      outstandingRequestID = requestID;
      await memory.dream({ requestID, sessionID: currentSession() }, location);
      ctx.ui.toast.show({ variant: "info", title: "Memory", message: "Dreaming..." });
    };

    const showMemory = async (focus?: string, history = false): Promise<void> => {
      const state = await memory.state({}, location);
      const topic = state.topics.find((entry) => entry.file === focus);
      const description = (entry: typeof state.topics[number]) => {
        const parent = state.topics.find((other) => other.file === entry.parent);
        return `[${entry.scope} · ${entry.type} · ${entry.status}] ${parent ? `In ${parent.title} · ` : ""}${entry.summary}`;
      };
      const related = topic ? [
        ...topic.children.map((file) => ({ file, relation: "Source" })),
        ...(topic.parent ? [{ file: topic.parent, relation: "Parent summary" }] : []),
        ...(topic.supersededBy ? [{ file: topic.supersededBy, relation: "Replacement" }] : []),
        ...topic.supersedes.map((file) => ({ file, relation: "Earlier version" })),
      ].flatMap(({ file, relation }) => {
        const entry = state.topics.find((other) => other.file === file);
        return entry ? [{ title: `${relation}: ${entry.title}`, description: description(entry), value: { type: "topic" as const, file } }] : [];
      }) : [];
      const choice = await ctx.ui.dialog.select<Choice>({
        title: topic ? topic.title : history ? "Memory · retained history" : "Memory · active topics",
        placeholder: topic ? "Read this memory or navigate related records" : "Filter topics",
        options: topic ? [
          { title: "Back to topics", value: { type: "back" } },
          { title: "View memory", description: description(topic), value: { type: "view", file: topic.file } },
          ...(topic.children.length === 0 && (topic.status === "active" || topic.status === "consolidated") ? [{
            title: "Edit file in place",
            description: "No previous version is saved; dependent summaries retire. Use /memory-web for a versioned correction.",
            value: { type: "edit" as const, file: topic.file },
          }] : []),
          ...related,
        ] : [
          {
            title: `Auto-memory: ${state.enabled ? "enabled" : "disabled"}`,
            description: state.enabled ? "Disable memory in this project, including global recall here" : "Enable memory in this project, including global recall here",
            value: { type: "toggle", key: "enabled" },
          },
          {
            title: `Auto-dream: ${state.dream_auto ? "enabled" : "disabled"}`,
            description: state.dream_auto ? "Disable all automatic dreaming" : "Enable automatic dreaming",
            value: { type: "toggle", key: "dream_auto" },
          },
          {
            title: "Dream now",
            description: "Run one memory dreaming pass now",
            value: { type: "dreamNow" },
          },
          {
            title: history ? "Show active topics only" : "Show retained history",
            description: "Consolidated details, superseded versions, and retired summaries",
            value: { type: "history" },
          },
          ...state.topics.filter((entry) => history || entry.status === "active").map((entry) => ({
            title: entry.title,
            description: description(entry),
            value: { type: "topic" as const, file: entry.file },
          })),
        ],
      });
      if (!choice) return;
      if (choice.type === "back" || choice.type === "history") {
        await showMemory(undefined, choice.type === "history" ? !history : history);
        return;
      }
      if (choice.type === "toggle") {
        await memory.toggle({ key: choice.key }, location);
        await showMemory(undefined, history);
        return;
      }
      if (choice.type === "dreamNow") {
        await requestDream();
        await showMemory(undefined, history);
        return;
      }
      if (choice.type === "topic") {
        await showMemory(choice.file, history);
        return;
      }
      const entry = state.topics.find((entry) => entry.file === choice.file)!;
      if (choice.type === "view") {
        const { content } = await memory.read({ id: entry.file }, location);
        await new Promise<void>((resolve) => {
          ctx.ui.dialog.set({ size: "large", centered: true });
          ctx.ui.dialog.show(() => {
            ctx.keymap.layer(() => ({
              mode: "modal",
              commands: [{ bind: "return", title: "Back to memory", run: () => ctx.ui.dialog.clear() }],
            }));
            return (
              <box flexDirection="column" height={Math.max(8, Math.floor(ctx.renderer.height * 0.7))} paddingX={2} paddingBottom={1} gap={1}>
                <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
                  <text fg={ctx.theme.text.base}><b>{entry.title}</b></text>
                  <text fg={ctx.theme.text.muted} onMouseUp={() => ctx.ui.dialog.clear()}>esc</text>
                </box>
                <text fg={ctx.theme.text.muted} flexShrink={0}>{`${entry.scope} · ${entry.type} · ${entry.status} · read-only`}</text>
                <scrollbox focused flexGrow={1} flexBasis={0} minHeight={0} verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}>
                  <text fg={ctx.theme.text.base} wrapMode="word">{content ?? "The body file is missing."}</text>
                </scrollbox>
                <text fg={ctx.theme.text.muted} flexShrink={0}>↑/↓ scroll · Enter or Esc returns to this memory</text>
              </box>
            );
          }, resolve);
        });
        await showMemory(choice.file, history);
        return;
      }
      await openInEditor(ctx, entry.path, workspace);
      await showMemory(choice.file, history);
    };

    // Review and save notifications only surface for sessions this TUI knows.
    const known = (sessionID: string) => ctx.data.session.get(sessionID) !== undefined;

    const unsubscribers = [
      memory.events.on("error", (event) => toastError(event.data.message)),
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
            open={() => void showMemory().catch(toastError)}
            dream={() => void requestDream().catch(toastError)}
            web={() => void openDashboard().catch(toastError)}
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
