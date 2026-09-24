/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import type { Destination, Route } from "@opencode/plugin/tui/context";
import { useTerminalDimensions } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import { acceptsPlanChange, canContinueCoordinatorFailure, canDiscardRun, currentPlanProgress, isControllable, isResumable, stableJson, startupActions, type WorkerState, type WorkflowControlAction, WorkflowRpc, type WorkflowRun } from "./workflow_shared.ts";

type Control = { runID: string; action: WorkflowControlAction; guidance?: string; workerID?: string };
export type InspectorSelection = { runID: string; kind: "run" | "phase" | "group" | "worker"; id: string };

function detail(run: WorkflowRun): string {
  const worker = (item: { id: string; label: string; agent: string; modelID?: string; variant?: string; prompt: string; schema?: Record<string, unknown> }) =>
    `${item.id}: ${item.label} [${item.agent}${item.modelID ? `, ${item.modelID}` : ""}${item.variant ? `, variant ${item.variant}` : ""}]\n${item.prompt}${item.schema ? `\nSchema: ${JSON.stringify(item.schema)}` : ""}`;
  return `Internal coordinator/handoff model: ${run.parentModel ? `${run.parentModel.providerID}/${run.parentModel.id}` : "default model"}\n` + run.spec.phases.map((phase) => `${phase.title}\n${phase.steps.map((step) => step.type === "worker" ? worker(step.worker) : `${step.title ?? step.id}\n${step.workers.map(worker).join("\n")}`).join("\n")}`).join("\n");
}

export type FailureOption = { action: WorkflowControlAction; title: string; description: string };

export function failureControlOptions(run: WorkflowRun): FailureOption[] {
  const failure = run.failure;
  if (!failure) return [];
  const stop: FailureOption = { action: "failure_stop", title: `Stop after failure: ${run.spec.name}`, description: failure.reason };
  if (failure.kind === "coordinator" || failure.kind === "repair") return [
    { action: "coordinator_retry", title: "Retry coordinator", description: failure.reason },
    ...(canContinueCoordinatorFailure(run) ? [{ action: "coordinator_continue" as const, title: "Continue existing pending plan", description: "Continue without the rejected revision." }] : []),
    stop,
  ];
  if (failure.kind === "handoff") return [{ action: "failure_retry", title: "Retry final handoff", description: failure.reason }, stop];
  return [
    { action: "failure_retry", title: `Retry failed worker: ${failure.workerID}`, description: failure.reason },
    { action: "failure_skip", title: `Skip failed worker: ${failure.workerID}`, description: "Dependent templates trigger immediate coordinator repair." },
    stop,
  ];
}

export function transcriptSelection(runs: WorkflowRun[], params?: Record<string, unknown>): { run: WorkflowRun; worker: WorkerState } | undefined {
  const run = runs.find((item) => item.id === params?.runID);
  const worker = run?.workers[String(params?.workerID)];
  return run && worker?.childSessionID ? { run, worker } : undefined;
}

export function promptRightRun(runs: WorkflowRun[]): WorkflowRun | undefined {
  return runs.find((run) => isControllable(run.status)) ?? runs.find((run) => ["pending", "queued"].includes(run.status));
}

function elapsed(worker: WorkerState): string {
  if (!worker.startedAt) return "-";
  const seconds = Math.floor(((worker.endedAt ?? Date.now()) - worker.startedAt) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function Dashboard(props: { ctx: Plugin.Context; runs: () => WorkflowRun[]; back: (run?: WorkflowRun) => void; transcript: (run: WorkflowRun, worker: WorkerState) => void; initial?: InspectorSelection; controls: (run: WorkflowRun, worker?: WorkerState) => void; steer: (run: WorkflowRun, worker: WorkerState) => void }) {
  const theme = () => props.ctx.theme;
  const selectedFg = () => theme().text.action.primary.focused;
  const selectedBg = () => theme().background.action.primary.focused;
  const first = () => props.runs()[0];
  const [selection, setSelection] = createSignal<InspectorSelection | undefined>(props.initial ?? (first() ? { runID: first()!.id, kind: "run", id: first()!.id } : undefined));
  const [tab, setTab] = createSignal<"Activity" | "Prompt" | "Result" | "Attempts">("Activity");
  const selectedRun = () => props.runs().find((run) => run.id === selection()?.runID);
  const selectedWorker = () => selection()?.kind === "worker" ? selectedRun()?.workers[selection()!.id] : undefined;
  const inspector = () => {
    const run = selectedRun(); const worker = selectedWorker();
    if (!run) return "No selection";
    if (!worker) {
      const selected = selection();
      const phase = run.spec.phases.find((item) => item.id === selected?.id);
      const group = run.spec.phases.flatMap((item) => item.steps).find((item) => item.type === "parallel" && item.id === selected?.id);
      const ids = phase ? phase.steps.flatMap((step) => step.type === "worker" ? [step.worker.id] : step.workers.map((item) => item.id)) : group?.type === "parallel" ? group.workers.map((item) => item.id) : Object.keys(run.workers);
      const summary = selected?.kind === "phase" ? `Phase ${phase?.title ?? selected.id}` : selected?.kind === "group" ? `Parallel group ${group?.type === "parallel" ? group.title ?? group.id : selected.id}` : run.spec.goal;
      if (selected?.kind === "run" && tab() === "Prompt") return `${run.spec.goal}\n\n${detail(run)}`;
      if (selected?.kind === "run" && tab() === "Result") return run.handoff ? stableJson(run.handoff) : run.error ? `No final handoff\n\n${run.error}` : "No final handoff yet";
      if (selected?.kind === "run" && tab() === "Attempts") return [
        ...run.coordinatorOperations.map((operation) => `Coordinator ${operation.id} ${operation.status}\n${operation.attempts.map((attempt) => `#${attempt.number} ${attempt.kind ?? "turn"} ${attempt.result ?? "running"}${attempt.error ? `: ${attempt.error}` : ""}`).join("\n")}`),
        ...(run.handoffAttempts?.length ? [`Handoff\n${run.handoffAttempts.map((attempt) => `#${attempt.number} ${attempt.kind ?? "turn"} ${attempt.result ?? "running"}${attempt.error ? `: ${attempt.error}` : ""}`).join("\n")}`] : []),
      ].join("\n\n") || "No coordinator or handoff attempts";
      return `${summary}\nStatus: ${run.status}\nProgress: ${ids.filter((id) => run.workers[id]?.status === "completed").length}/${ids.length}, ${ids.filter((id) => run.workers[id]?.status === "running").length} running${run.error ? `\nError: ${run.error}` : ""}\n${run.revisions.map((revision) => `Revision ${revision.version} (${revision.reason})\n${revision.rationale}\nBefore:\n${stableJson(revision.before)}\nAfter:\n${stableJson(revision.after)}`).join("\n\n")}`;
    }
    if (tab() === "Prompt") return worker.prompt;
    if (tab() === "Result") return worker.output === undefined ? "No accepted result" : stableJson(worker.output);
    if (tab() === "Attempts") return (worker.attempts ?? []).map((attempt) => `#${attempt.number} ${attempt.kind ?? "turn"} ${attempt.result ?? "running"}${attempt.steeringIDs?.length ? ` steering=${attempt.steeringIDs.join(",")}` : ""}${attempt.error ? `\n${attempt.error}` : ""}`).join("\n") + (worker.steering?.length ? `\n\nSteering\n${worker.steering.map((item) => `${item.status} ${item.id}: ${item.text}`).join("\n")}` : "");
    return `${worker.activity ?? worker.status}\nAgent: ${worker.agent}\nModel: ${worker.modelID ?? "parent model"}\nVariant: ${worker.variant ?? "model default"}\nElapsed: ${elapsed(worker)}  Attempts: ${worker.attempts?.filter((item) => item.kind === "turn").length ?? 0}  Tokens: ${worker.tokens?.total ?? 0} (cache read ${worker.tokens?.cacheRead ?? 0}, write ${worker.tokens?.cacheWrite ?? 0})\n${worker.steering?.map((item) => `${item.status}: ${item.text}`).join("\n") ?? ""}`;
  };
  const dimensions = useTerminalDimensions();
  const narrow = () => dimensions().width < 100;
  const isSelected = (kind: InspectorSelection["kind"], runID: string, id: string) => { const s = selection(); return s?.runID === runID && s?.kind === kind && s?.id === id; };
  const workerRow = (runID: string, worker: WorkerState, prefix: string) => {
    const sel = () => isSelected("worker", runID, worker.id);
    const statusFg = () => worker.status === "failed" ? theme().text.feedback.error.base : worker.status === "running" ? theme().text.feedback.warning.base : worker.status === "completed" ? theme().text.feedback.success.base : theme().text.muted;
    const meta = () => ` — ${worker.agent}/${worker.modelID ?? "parent"} · ${elapsed(worker)} · attempts ${worker.attempts?.filter((item) => item.kind === "turn").length ?? 0} · tokens ${worker.tokens?.total ?? 0}`;
    return <text wrapMode="none" bg={sel() ? selectedBg() : undefined} onMouseDown={() => setSelection({ runID, kind: "worker", id: worker.id })}><span style={{ fg: sel() ? selectedFg() : theme().text.muted }}>{prefix}</span><span style={{ fg: sel() ? selectedFg() : statusFg() }}>{worker.status}</span><span style={{ fg: sel() ? selectedFg() : theme().text.base }}> {worker.label}</span><span style={{ fg: sel() ? selectedFg() : theme().text.muted }}>{meta()}</span></text>;
  };
  const [narrowInspector, setNarrowInspector] = createSignal(false);
  const rows = () => props.runs().flatMap((run) => [{ runID: run.id, kind: "run" as const, id: run.id }, ...run.spec.phases.flatMap((phase) => [{ runID: run.id, kind: "phase" as const, id: phase.id }, ...phase.steps.flatMap((step) => step.type === "worker" ? [{ runID: run.id, kind: "worker" as const, id: step.worker.id }] : [{ runID: run.id, kind: "group" as const, id: step.id }, ...step.workers.map((worker) => ({ runID: run.id, kind: "worker" as const, id: worker.id }))])])]);
  let treeScroll: { scrollTop: number; viewport: { height: number }; scrollTo: (top: number) => void } | undefined;
  const move = (offset: number) => {
    if (narrow() && narrowInspector()) return;
    const index = Math.max(0, rows().findIndex((item) => item.runID === selection()?.runID && item.kind === selection()?.kind && item.id === selection()?.id));
    const next = Math.max(0, Math.min(rows().length - 1, index + offset));
    setSelection(rows()[next]);
    if (!treeScroll) return;
    if (next < treeScroll.scrollTop) treeScroll.scrollTo(next);
    else if (next >= treeScroll.scrollTop + treeScroll.viewport.height) treeScroll.scrollTo(next - treeScroll.viewport.height + 1);
  };
  const openTranscript = () => { const worker = selectedWorker(); if (worker?.childSessionID) props.transcript(selectedRun()!, worker); };
  props.ctx.keymap.layer(() => ({
    commands: [
      { bind: "up", title: "select", group: "Workflows", run: () => move(-1) },
      { bind: "down", title: "select", group: "Workflows", run: () => move(1) },
      ...(["Activity", "Prompt", "Result", "Attempts"] as const).map((name, index) => ({ bind: String(index + 1), title: name, group: "Workflows", run: () => { setTab(name); } })),
      { bind: "tab", title: "switch pane", group: "Workflows", run: () => { if (narrow()) setNarrowInspector(!narrowInspector()); } },
      { bind: "return", title: "inspect/open", group: "Workflows", run: () => { if (narrow() && !narrowInspector()) setNarrowInspector(true); else openTranscript(); } },
      { bind: "c", title: "controls", group: "Workflows", run: () => { if (selectedRun()) props.controls(selectedRun()!, selectedWorker()); } },
      { bind: "s", title: "steer", group: "Workflows", run: () => { if (selectedRun() && selectedWorker()?.status === "running") props.steer(selectedRun()!, selectedWorker()!); } },
      { bind: "t", title: "transcript", group: "Workflows", run: openTranscript },
      { bind: "q,escape", title: "back", group: "Workflows", run: () => props.back(selectedRun()) },
    ],
  }));
  return (
    <box flexDirection="column" padding={1} gap={1} flexGrow={1} minHeight={0}>
      <text wrapMode="none" flexShrink={0} fg={theme().text.base}><b>Workflows</b>  {narrow() ? (narrowInspector() ? "Inspector" : "Tree") : "Tree + Inspector"}</text>
      <Show when={props.runs().length > 0} fallback={<text fg={theme().text.muted}>No workflow runs for this project.</text>}>
        <box flexDirection="row" gap={1} flexGrow={1} minHeight={0}>
          <Show when={!narrow() || !narrowInspector()}><box width={narrow() ? "100%" : "48%"} flexDirection="column" borderStyle="single" borderColor={theme().border.base} padding={1} minHeight={0}>
          <scrollbox ref={(element) => (treeScroll = element)} flexGrow={1} flexBasis={0} minHeight={0} verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}>
          <For each={props.runs()}>{(run) => (
            <box flexDirection="column">
              {(() => { const sel = () => isSelected("run", run.id, run.id); const statusFg = () => run.status === "completed" ? theme().text.feedback.success.base : ["failed", "rejected", "aborted", "blocked", "repair_required"].includes(run.status) ? theme().text.feedback.error.base : ["pending", "queued"].includes(run.status) ? theme().text.feedback.warning.base : theme().text.muted; return <text wrapMode="none" bg={sel() ? selectedBg() : undefined} onMouseDown={() => setSelection({ runID: run.id, kind: "run", id: run.id })}><b><span style={{ fg: sel() ? selectedFg() : statusFg() }}>{run.status.toUpperCase()}</span></b><span style={{ fg: sel() ? selectedFg() : theme().text.base }}> {run.spec.name}</span></text>; })()}
              <For each={run.spec.phases}>{(phase) => { const phaseSel = () => isSelected("phase", run.id, phase.id); return <box flexDirection="column">
                <text wrapMode="none" bg={phaseSel() ? selectedBg() : undefined} fg={phaseSel() ? selectedFg() : theme().text.muted} onMouseDown={() => setSelection({ runID: run.id, kind: "phase", id: phase.id })}>  +- {phase.title}</text>
                <For each={phase.steps}>{(step) => step.type === "parallel" ? (() => { const groupSel = () => isSelected("group", run.id, step.id); return <box flexDirection="column"><text wrapMode="none" bg={groupSel() ? selectedBg() : undefined} fg={groupSel() ? selectedFg() : theme().text.muted} onMouseDown={() => setSelection({ runID: run.id, kind: "group", id: step.id })}>  |  +- {step.title ?? step.id} [parallel]</text><For each={step.workers}>{(spec) => workerRow(run.id, run.workers[spec.id]!, "  |  |  ")}</For></box>; })() : workerRow(run.id, run.workers[step.worker.id]!, "  |  +- ")}</For>
              </box>; }}</For>
            </box>
          )}</For>
          </scrollbox>
          </box>
          </Show>
          <Show when={!narrow() || narrowInspector()}><box width={narrow() ? "100%" : "52%"} flexDirection="column" borderStyle="single" borderColor={theme().border.base} padding={1} minHeight={0}>
            <box flexDirection="row" gap={2} flexShrink={0}><For each={["Activity", "Prompt", "Result", "Attempts"] as const}>{(name) => <text fg={tab() === name ? theme().text.action.primary.base : theme().text.muted} onMouseDown={() => setTab(name)}>{tab() === name ? `[${name}]` : name}</text>}</For></box>
            <scrollbox flexGrow={1} flexBasis={0} minHeight={0} verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}><text fg={theme().text.muted}>{inspector()}</text></scrollbox>
          </box></Show>
        </box>
      </Show>
      <box flexDirection="column" borderStyle="single" borderColor={theme().text.action.primary.base} paddingX={1}>
        <text fg={theme().text.base}><b>Keyboard shortcuts</b></text>
        <text wrapMode="none" fg={theme().text.base}><span style={{ fg: theme().text.action.primary.base }}>[Up/Down]</span> select  <span style={{ fg: theme().text.action.primary.base }}>[Enter]</span> inspect/open  <span style={{ fg: theme().text.action.primary.base }}>[Tab]</span> switch pane  <span style={{ fg: theme().text.action.primary.base }}>[1-4]</span> inspector tabs</text>
        <text wrapMode="none" fg={theme().text.base}><span style={{ fg: theme().text.action.primary.base }}>[c]</span> controls  <span style={{ fg: theme().text.action.primary.base }}>[s]</span> steer  <span style={{ fg: theme().text.action.primary.base }}>[t]</span> transcript  <span style={{ fg: theme().text.action.primary.base }}>[q/Esc]</span> back</text>
      </box>
      <text fg={theme().text.action.primary.base} onMouseDown={() => selectedRun() && props.controls(selectedRun()!, selectedWorker())}>[Open controls for selection]</text>
      <Show when={selectedWorker()?.childSessionID}><text fg={theme().text.action.primary.base} onMouseDown={openTranscript}>[Open read-only transcript]</text></Show>
    </box>
  );
}

function Transcript(props: { ctx: Plugin.Context; worker: WorkerState; back: () => void }) {
  const sessionID = props.worker.childSessionID!;
  const theme = () => props.ctx.theme;
  void props.ctx.data.session.message.sync(sessionID);
  props.ctx.keymap.layer(() => ({ commands: [{ bind: "q,escape", title: "back", group: "Workflows", run: props.back }] }));
  const body = (message: ReturnType<Plugin.Context["data"]["session"]["message"]["list"]>[number]): string => {
    if (message.type === "assistant") return message.content.map((part) => part.type === "tool" ? `[tool ${part.name}] ${part.state.status}` : part.type === "reasoning" ? `[reasoning] ${part.text}` : part.text).join("\n") + (message.error ? `\n[error] ${message.error.message}` : "");
    return "text" in message ? String(message.text) : `[${message.type}]`;
  };
  return <box flexDirection="column" padding={1} flexGrow={1} minHeight={0}><text flexShrink={0} fg={theme().text.base}><b>Workflows transcript: {props.worker.label}</b> (read-only)</text><scrollbox flexGrow={1} flexBasis={0} minHeight={0} verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}><For each={props.ctx.data.session.message.list(sessionID)}>{(message) => <box flexDirection="column" marginTop={1}><text fg={theme().text.muted}>{message.type}</text><text fg={theme().text.base}>{body(message)}</text></box>}</For></scrollbox><text flexShrink={0} fg={theme().text.muted} marginTop={1}>q/back returns to the selected worker inspector. No prompt input is available.</text></box>;
}

function TranscriptNotFound(props: { ctx: Plugin.Context; back: () => void }) {
  props.ctx.keymap.layer(() => ({ commands: [{ bind: "q,escape,return", title: "back", group: "Workflows", run: props.back }] }));
  return <box flexDirection="column" padding={1}><text fg={props.ctx.theme.text.feedback.warning.base}><b>Workflow transcript not found</b></text><text fg={props.ctx.theme.text.muted}>The run, worker, or child session is no longer available. Press Enter, q, or Escape to go back.</text></box>;
}

export default Plugin.define({
  id: "workflows",
  setup(ctx) {
    const rpc = ctx.client.rpc(WorkflowRpc);
    const location = () => ({ directory: (ctx.location ?? ctx.data.location.default()).directory });
    const [runs, setRuns] = createSignal<WorkflowRun[]>([]);
    const [blink, setBlink] = createSignal(false);
    const [previous, setPrevious] = createSignal<Route>();
    const blinkTimer = setInterval(() => setBlink((value) => !value), 600);
    const failure = (error: unknown) => ctx.ui.toast.show({ variant: "error", title: "Workflows", message: error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : String(error) });
    const approvalNeeded = (message: string) => {
      ctx.ui.toast.show({ variant: "warning", title: "Workflow approval required", message, duration: 10_000 });
      void ctx.attention.notify({ title: "Workflow approval required", message, notification: true, sound: { name: "question" } });
    };

    const navigate = (destination: Destination) => {
      const current = ctx.ui.router.current();
      // The router exposes a mutable store; retain the route we came from before entering the dashboard.
      if (current.type !== "plugin" || !current.name.startsWith("workflows")) setPrevious({ ...current });
      ctx.ui.dialog.clear();
      ctx.ui.router.navigate(destination);
    };
    const openDashboard = (data?: InspectorSelection) => navigate({ type: "plugin", name: "workflows", data });

    const send = async (control: Control) => {
      const result = await rpc.control(control, { location: location() });
      ctx.ui.toast.show({ variant: result.status === "accepted" ? "success" : result.status === "ignored" ? "warning" : "error", title: `${control.action} ${result.status}`, message: result.error ?? "Workflow control processed" });
    };

    const steer = async (run: WorkflowRun, worker: WorkerState) => {
      const guidance = await ctx.ui.dialog.prompt({ title: `Steer: ${worker.label}`, placeholder: "Guidance delivered at the next safe turn" });
      if (guidance?.trim()) await send({ runID: run.id, action: "steer", workerID: worker.id, guidance: guidance.trim() });
    };

    const discard = async (run: WorkflowRun) => {
      if (await ctx.ui.dialog.confirm({ title: `Discard ${run.spec.name}?`, message: "This permanently deletes the persisted workflow data. Its worker sessions are kept.", label: { confirm: "Discard permanently" } })) await send({ runID: run.id, action: "discard" });
    };

    const controls = async (selected: WorkflowRun, selectedWorker?: WorkerState) => {
      const run = runs().find((item) => item.id === selected.id) ?? selected;
      const actions: Array<{ title: string; description: string; value: Control }> = [];
      const action = (value: WorkflowControlAction, title: string, description: string) => actions.push({ title, description, value: { runID: run.id, action: value } });
      if (run.status === "pending") {
        action("approve", `Approve: ${run.spec.name}`, `Starts now, or queues behind the active workflow.\n${run.spec.goal}\n${detail(run)}`);
        action("replace", `Replace current run: ${run.spec.name}`, "Stop the current run resumably, then start this approved plan.\n" + detail(run));
        action("reject", `Reject: ${run.spec.name}`, detail(run));
      }
      if (isResumable(run.status)) action("resume", `Resume: ${run.spec.name}`, detail(run));
      if (run.status === "running") {
        action("soft_pause", `Soft pause: ${run.spec.name}`, "Stop scheduling after active work finishes.");
        action("hard_pause", `Hard pause: ${run.spec.name}`, "Interrupt active worker sessions and preserve them for continuation.");
      }
      const worker = selectedWorker && run.workers[selectedWorker.id];
      if (worker?.status === "running") actions.push({ title: `Steer: ${worker.label}`, description: "Append guidance for the next safe turn boundary. The current turn is never aborted.", value: { runID: run.id, action: "steer", workerID: worker.id } });
      if (acceptsPlanChange(run.status)) action("plan_change", `Request plan change: ${run.spec.name}`, "Enter guidance after selecting this action. Active work reaches its safe worker/group boundary first.");
      if (isControllable(run.status)) action("stop", `Stop: ${run.spec.name}`, "Release the project lease and leave the run resumable.");
      if (canDiscardRun(run)) action("discard", `Discard: ${run.spec.name}`, "Permanently delete this run's workflow data after confirmation.");
      if (run.status === "blocked") for (const option of failureControlOptions(run)) action(option.action, option.title, option.description);
      const control = await ctx.ui.dialog.select({ title: "Workflow plans", placeholder: "Select an explicit workflow control", options: actions });
      if (!control) return;
      if (control.action === "steer") return steer(run, worker!);
      if (control.action === "discard") return discard(run);
      if (control.action === "plan_change") {
        const guidance = await ctx.ui.dialog.prompt({ title: "Request workflow plan change", placeholder: "Guidance for the coordinator" });
        if (guidance?.trim()) await send({ ...control, guidance: guidance.trim() });
        return;
      }
      await send(control);
    };

    const upsert = (run: WorkflowRun) => {
      const prior = runs().find((item) => item.id === run.id);
      setRuns([run, ...runs().filter((item) => item.id !== run.id)].sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)));
      if (run.status === "pending" && !prior) approvalNeeded(run.spec.name);
      if (run.status === "completed" && prior?.status !== "completed") ctx.ui.toast.show({ variant: "success", title: "Workflow completed", message: run.spec.name });
      if (run.status === "soft_paused" && prior?.status !== "soft_paused") {
        const timeout = run.error?.startsWith("Run window reached");
        ctx.ui.toast.show({ variant: "warning", title: timeout ? "Workflow time limit reached" : "Workflow paused", message: run.error ?? run.spec.name });
        if (timeout) void ctx.attention.notify({ title: "Workflow time limit reached", message: run.spec.name, notification: true, sound: { name: "question" } });
      }
      if (run.status === "blocked" && prior?.status !== "blocked") {
        const route = ctx.ui.router.current();
        if (run.failure && route.type === "plugin" && route.name === "workflows") {
          void ctx.ui.dialog.select({
            title: `Workflow failure: ${run.failure.workerID}`,
            placeholder: "Choose a failure decision",
            options: failureControlOptions(run).map((option) => ({ title: option.title, description: option.description, value: { runID: run.id, action: option.action } })),
          }).then((control) => control && send(control)).catch(failure);
        } else {
          ctx.ui.toast.show({ variant: "warning", title: "Workflow paused for failure", message: run.error ?? run.spec.name });
        }
      }
      for (const worker of Object.values(run.workers)) for (const steering of worker.steering) {
        const before = prior?.workers[worker.id]?.steering.find((item) => item.id === steering.id);
        if (steering.status === "rejected" && before && before.status !== "rejected") ctx.ui.toast.show({ variant: "error", title: "Worker steering rejected", message: steering.error ?? "Worker is no longer steerable" });
      }
    };

    const ours = (event: { location?: { directory: string } }) => event.location?.directory === location().directory;
    const unsubscribe = [
      rpc.events.on("updated", (event) => { if (ours(event)) upsert(event.data.run); }),
      rpc.events.on("removed", (event) => { if (ours(event)) setRuns(runs().filter((run) => run.id !== event.data.runID)); }),
    ];

    const initialize = async () => {
      setRuns([...(await rpc.list({}, { location: location() })).runs]);
      const pending = runs().filter((run) => run.status === "pending");
      if (pending.length) approvalNeeded(pending.length === 1 ? pending[0]!.spec.name : `${pending.length} workflows are waiting`);
      const interrupted = runs().filter((run) => startupActions(run).length > 0);
      if (!interrupted.length) return;
      type Recovery = { action: "resume" | "open" | "later" | "discard"; run?: WorkflowRun };
      const choice = await ctx.ui.dialog.select<Recovery>({
        title: "Interrupted workflows",
        placeholder: `${interrupted.length} interrupted workflow(s); choose one recovery action`,
        options: [
          ...interrupted.flatMap((run) => [{ title: `Resume: ${run.spec.name}`, description: detail(run), value: { action: "resume" as const, run } }, { title: `Discard: ${run.spec.name}`, description: "Requires a second permanent-delete confirmation", value: { action: "discard" as const, run } }]),
          { title: "Open dashboard", description: "Review all interrupted workflows without changing them", value: { action: "open" as const } },
          { title: "Decide later", description: "Keep runs interrupted until /workflows is opened", value: { action: "later" as const } },
        ],
      });
      if (choice?.action === "resume") await send({ runID: choice.run!.id, action: "resume" });
      if (choice?.action === "open") openDashboard();
      if (choice?.action === "discard") await discard(choice.run!);
    };
    void initialize().catch(failure);

    const back = (run?: WorkflowRun) => {
      ctx.ui.router.navigate(previous() ?? (run ? { type: "session", sessionID: run.parentSessionID } : { type: "home" }));
    };
    ctx.ui.router.register({
      name: "workflows",
      render: ({ data }) => <Dashboard ctx={ctx} runs={runs} back={back} initial={data?.runID ? data as InspectorSelection : undefined}
        transcript={(run, worker) => navigate({ type: "plugin", name: "workflows-transcript", data: { runID: run.id, workerID: worker.id } })}
        controls={(run, worker) => void controls(run, worker).catch(failure)}
        steer={(run, worker) => void steer(run, worker).catch(failure)} />,
    });
    ctx.ui.router.register({
      name: "workflows-transcript",
      render: ({ data }) => {
        const selection = transcriptSelection(runs(), data);
        const backToInspector = () => ctx.ui.router.navigate({ type: "plugin", name: "workflows", data: selection ? { runID: selection.run.id, kind: "worker", id: selection.worker.id } : undefined });
        return selection ? <Transcript ctx={ctx} worker={selection.worker} back={backToInspector} /> : <TranscriptNotFound ctx={ctx} back={backToInspector} />;
      },
    });
    ctx.ui.slot({
      append: "app",
      render() {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "workflows.open",
            title: "Workflows",
            group: "Project",
            slash: { name: "workflows" },
            palette: true,
            run() {
              // Re-list so runs written by other processes of this project appear.
              void rpc.list({}, { location: location() }).then((result) => setRuns([...result.runs])).catch(failure);
              openDashboard();
            },
          }],
        }));
        return null;
      },
    });
    ctx.ui.slot({
      append: "prompt.footer.status",
      render(input) {
        const visible = () => promptRightRun(runs().filter((run) => run.parentSessionID === input.sessionID));
        // Paused, blocked and stopping runs need naming: a bare progress count reads as healthy progress.
        const label = (run: WorkflowRun) => {
          if (run.status === "completed" || ["pending", "queued"].includes(run.status)) return run.status;
          const progress = currentPlanProgress(run);
          const stalled = run.status !== "running" ? ` ${run.status}` : "";
          return `${progress.completed}/${progress.total}${stalled} | ${progress.running} running`;
        };
        return <Show when={visible()}>{(run: () => WorkflowRun) => <text fg={run().status === "pending" ? (blink() ? ctx.theme.text.feedback.warning.base : ctx.theme.text.muted) : ["blocked", "repair_required"].includes(run().status) ? ctx.theme.text.feedback.error.base : ctx.theme.text.feedback.warning.base} onMouseDown={() => openDashboard({ runID: run().id, kind: "run", id: run().id })}>WF {label(run())}</text>}</Show>;
      },
    });

    return () => {
      clearInterval(blinkTimer);
      for (const stop of unsubscribe) stop();
    };
  },
});
