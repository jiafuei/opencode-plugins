/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { join } from "node:path";
import { createSignal, Show } from "solid-js";
import { MemoryRpc, type DreamStatus } from "./rpc.ts";

type Choice =
  | { type: "toggle"; key: "enabled" | "dream_auto" }
  | { type: "dreamNow" }
  | { type: "topic"; file: string };

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

    // The current session, when the route has one, owns the sidebar indicator.
    const requestDream = async () => {
      const requestID = crypto.randomUUID();
      outstandingRequestID = requestID;
      await memory.dream({ requestID, sessionID: currentSession() }, location);
      ctx.ui.toast.show({ variant: "info", title: "Memory", message: "Dreaming..." });
    };

    // Choosing a topic opens its markdown file directly in the editor.
    const showMemory = async (): Promise<void> => {
      const state = await memory.state({}, location);
      const choice = await ctx.ui.dialog.select<Choice>({
        title: "Project memory",
        placeholder: "Search memory",
        options: [
          {
            title: `Auto-memory: ${state.enabled ? "enabled" : "disabled"}`,
            description: state.enabled ? "Disable recall and learning" : "Enable recall and learning",
            value: { type: "toggle", key: "enabled" },
          },
          {
            title: `Auto-dream: ${state.dream_auto ? "enabled" : "disabled"}`,
            description: state.dream_auto ? "Disable periodic memory dreaming" : "Enable periodic memory dreaming",
            value: { type: "toggle", key: "dream_auto" },
          },
          {
            title: "Dream now",
            description: "Run one memory dreaming pass now",
            value: { type: "dreamNow" },
          },
          ...state.topics.map((topic) => ({
            title: topic.title,
            description: topic.summary,
            value: { type: "topic" as const, file: topic.file },
          })),
        ],
      });
      if (!choice) return;
      if (choice.type === "toggle") {
        await memory.toggle({ key: choice.key }, location);
        await showMemory();
        return;
      }
      if (choice.type === "dreamNow") {
        await requestDream();
        await showMemory();
        return;
      }
      await openInEditor(ctx, join(state.directory, choice.file), workspace);
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
            open={() => void showMemory().catch(toastError)}
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
