/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { canContinueCoordinatorFailure, canDiscardRun, controlDirectory, currentPlanProgress, isLeaseStale, stableJson, startupActions, statePath, TUI_PRESENCE_STALE_MS, tuiPresencePath, type WorkerState, type WorkflowControlAction, type WorkflowRun, workflowProjectDirectory } from "./workflow_shared.ts";
import { WorkflowCoordination } from "./workflow_coordination.ts";

type Control = { runID: string; action: WorkflowControlAction; createdAt: number; guidance?: string; workerID?: string; controlID?: string; leaseToken?: string; leaseGeneration?: number; targetOwner?: string };
export type InspectorSelection = { runID: string; kind: "run" | "phase" | "group" | "worker"; id: string };

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, content);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function projectRoot(api: TuiPluginApi): Promise<string> {
  const current = await api.client.project.current();
  if (!current.data) throw new Error("Could not resolve the current project");
  return workflowProjectDirectory(current.data.id, api.state.path.directory);
}

type RunCacheEntry = { ino: number; mtimeMs: number; size: number; run: WorkflowRun };

async function readRuns(root: string, cache?: Map<string, RunCacheEntry>): Promise<WorkflowRun[]> {
  let ids: string[];
  try { ids = await readdir(join(root, "runs")); } catch { return []; }
  const runs = await Promise.all(ids.sort().map(async (id) => {
    const path = statePath(root, id);
    try {
      const info = await stat(path);
      const cached = cache?.get(id);
      if (cached?.ino === info.ino && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.run;
      const run = await Bun.file(path).json() as WorkflowRun;
      cache?.set(id, { ino: info.ino, mtimeMs: info.mtimeMs, size: info.size, run });
      return run;
    } catch { return undefined; }
  }));
  if (cache) for (const id of cache.keys()) if (!ids.includes(id)) cache.delete(id);
  return runs.filter((run): run is WorkflowRun => !!run).sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
}

async function sendControl(root: string, control: Control): Promise<string> {
  await mkdir(controlDirectory(root), { recursive: true });
  const submitted = { ...control, controlID: control.controlID ?? crypto.randomUUID() };
  const target = submitted.targetOwner ? `.${encodeURIComponent(submitted.targetOwner)}` : "";
  await atomicWrite(join(controlDirectory(root), `${submitted.createdAt}-${crypto.randomUUID()}.json${target}`), `${JSON.stringify(submitted)}\n`);
  return submitted.controlID;
}

function detail(run: WorkflowRun): string {
  const worker = (item: { id: string; label: string; agent: string; modelID?: string; variant?: string; prompt: string; schema?: Record<string, unknown> }) =>
    `${item.id}: ${item.label} [${item.agent}${item.modelID ? `, ${item.modelID}` : ""}${item.variant ? `, variant ${item.variant}` : ""}]\n${item.prompt}${item.schema ? `\nSchema: ${JSON.stringify(item.schema)}` : ""}`;
  return `Internal coordinator/handoff model: ${run.parentModel ? `${run.parentModel.providerID}/${run.parentModel.modelID}` : "originating parent model"}\n` + run.spec.phases.map((phase) => `${phase.title}\n${phase.steps.map((step) => step.type === "worker" ? worker(step.worker) : `${step.title ?? step.id}\n${step.workers.map(worker).join("\n")}`).join("\n")}`).join("\n");
}

export function failureControlActions(run: WorkflowRun): WorkflowControlAction[] {
  if (!run.failure) return [];
  if (run.failure.kind === "coordinator" || run.failure.kind === "repair") return ["coordinator_retry", ...(canContinueCoordinatorFailure(run) ? ["coordinator_continue" as const] : []), "failure_stop"];
  if (run.failure.kind === "handoff") return ["failure_retry", "failure_stop"];
  return ["failure_retry", "failure_skip", "failure_stop"];
}

export function inspectorControlActions(run: WorkflowRun, worker?: WorkerState): Array<WorkflowControlAction | "permission_mode"> {
  const actions: Array<WorkflowControlAction | "permission_mode"> = ["permission_mode"];
  if (run.status === "pending") actions.push("approve", "reject");
  if (run.status === "running") actions.push("soft_pause", "hard_pause");
  if (["interrupted", "soft_paused", "hard_paused", "stopped"].includes(run.status)) actions.push("resume");
  if (["running", "soft_pausing", "soft_paused", "hard_paused", "blocked", "repair_required"].includes(run.status)) actions.push("plan_change");
  if (worker?.status === "running") actions.push("steer");
  if (["running", "soft_pausing", "soft_paused", "hard_pausing", "hard_paused", "blocked", "repair_required"].includes(run.status)) actions.push("stop");
  if (canDiscardRun(run)) actions.push("discard");
  return [...actions, ...failureControlActions(run)];
}

export function transcriptReturn(selection: InspectorSelection): { name: string; params: Record<string, unknown> } {
  return { name: "workflows", params: { runID: selection.runID, kind: selection.kind, id: selection.id } };
}

export function transcriptSelection(runs: WorkflowRun[], params?: Record<string, unknown>): { run: WorkflowRun; worker: WorkerState } | undefined {
  const run = runs.find((item) => item.id === params?.runID);
  const worker = run?.workers[String(params?.workerID)];
  return run && worker?.childSessionID ? { run, worker } : undefined;
}

export function promptRightRun(runs: WorkflowRun[], lease?: { runID: string; heartbeatAt: number }): WorkflowRun | undefined {
  const visible = (run: WorkflowRun) => ["pending", "queued", "running", "soft_pausing", "soft_paused", "hard_pausing", "hard_paused", "stopping", "blocked", "repair_required"].includes(run.status);
  const leased = lease && !isLeaseStale(lease) ? runs.find((run) => run.id === lease.runID && visible(run)) : undefined;
  return leased ?? runs.find((run) => ["running", "soft_pausing", "soft_paused", "hard_pausing", "hard_paused", "stopping", "blocked", "repair_required"].includes(run.status)) ?? runs.find((run) => ["pending", "queued"].includes(run.status));
}

function elapsed(worker: WorkerState): string {
  if (!worker.startedAt) return "-";
  const seconds = Math.floor(((worker.endedAt ?? Date.now()) - worker.startedAt) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function Dashboard(props: { runs: () => WorkflowRun[]; api: TuiPluginApi; back: () => string | undefined; initial?: InspectorSelection; controls: (run: WorkflowRun, worker?: WorkerState) => void; steer: (run: WorkflowRun, worker: WorkerState) => void }) {
  const theme = () => props.api.theme.current;
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
        ...(run.coordinatorOperations ?? []).map((operation) => `Coordinator ${operation.id} ${operation.status}\n${operation.attempts.map((attempt) => `#${attempt.number} ${attempt.kind ?? "turn"} ${attempt.result ?? "running"}${attempt.error ? `: ${attempt.error}` : ""}`).join("\n")}`),
        ...(run.handoffAttempts?.length ? [`Handoff\n${run.handoffAttempts.map((attempt) => `#${attempt.number} ${attempt.kind ?? "turn"} ${attempt.result ?? "running"}${attempt.error ? `: ${attempt.error}` : ""}`).join("\n")}`] : []),
      ].join("\n\n") || "No coordinator or handoff attempts";
      const errors = [run.error ? `Error: ${run.error}` : "", ...(run.controlErrors ?? []).map((item) => `Control ${item.action} rejected: ${item.error}`)].filter(Boolean).join("\n");
      return `${summary}\nStatus: ${run.status}\nProgress: ${ids.filter((id) => run.workers[id]?.status === "completed").length}/${ids.length}, ${ids.filter((id) => run.workers[id]?.status === "running").length} running${errors ? `\n${errors}` : ""}\n${run.revisions?.map((revision) => `Revision ${revision.version} (${revision.reason})\n${revision.rationale}\nBefore:\n${stableJson(revision.before)}\nAfter:\n${stableJson(revision.after)}`).join("\n\n") ?? ""}`;
    }
    if (tab() === "Prompt") return worker.prompt;
    if (tab() === "Result") return worker.output === undefined ? "No accepted result" : stableJson(worker.output);
    if (tab() === "Attempts") return (worker.attempts ?? []).map((attempt) => `#${attempt.number} ${attempt.kind ?? "turn"} ${attempt.result ?? "running"}${attempt.steeringIDs?.length ? ` steering=${attempt.steeringIDs.join(",")}` : ""}${attempt.error ? `\n${attempt.error}` : ""}`).join("\n") + (worker.steering?.length ? `\n\nSteering\n${worker.steering.map((item) => `${item.status} ${item.id}: ${item.text}`).join("\n")}` : "");
    return `${worker.activity ?? worker.status}\nAgent: ${worker.agent}\nModel: ${worker.modelID ?? "parent model"}\nVariant: ${worker.variant ?? "model default"}\nElapsed: ${elapsed(worker)}  Attempts: ${worker.attempts?.filter((item) => item.kind === "turn").length ?? 0}  Tokens: ${worker.tokens?.total ?? 0} (cache read ${worker.tokens?.cacheRead ?? 0}, write ${worker.tokens?.cacheWrite ?? 0})\n${worker.steering?.map((item) => `${item.status}: ${item.text}`).join("\n") ?? ""}`;
  };
  const [width, setWidth] = createSignal(props.api.renderer.width);
  const [autoApprove, setAutoApprove] = createSignal<boolean | undefined>(undefined);
  const resizeTimer = setInterval(() => {
    if (props.api.renderer.width !== width()) setWidth(props.api.renderer.width);
    const command = props.api.keymap.getCommands({ visibility: "registered", filter: { name: "permission.mode" } })[0];
    const title = typeof command?.title === "string" ? command.title : "";
    setAutoApprove(title.startsWith("Disable") ? true : title.startsWith("Enable") ? false : undefined);
  }, 250);
  onCleanup(() => clearInterval(resizeTimer));
  const narrow = () => width() < 100;
  const isSelected = (kind: InspectorSelection["kind"], runID: string, id: string) => { const s = selection(); return s?.runID === runID && s?.kind === kind && s?.id === id; };
  const workerRow = (runID: string, worker: WorkerState, prefix: string) => {
    const sel = () => isSelected("worker", runID, worker.id);
    const statusFg = worker.status === "failed" ? theme().error : worker.status === "running" ? theme().warning : worker.status === "completed" ? theme().success : theme().textMuted;
    const meta = ` — ${worker.agent}/${worker.modelID ?? "parent"} · ${elapsed(worker)} · attempts ${worker.attempts?.filter((item) => item.kind === "turn").length ?? 0} · tokens ${worker.tokens?.total ?? 0}`;
    return <text wrapMode="none" bg={sel() ? theme().primary : undefined} onMouseDown={() => setSelection({ runID, kind: "worker", id: worker.id })}><span style={{ fg: sel() ? theme().selectedListItemText : theme().textMuted }}>{prefix}</span><span style={{ fg: sel() ? theme().selectedListItemText : statusFg }}>{worker.status}</span><span style={{ fg: sel() ? theme().selectedListItemText : theme().text }}> {worker.label}</span><span style={{ fg: sel() ? theme().selectedListItemText : theme().textMuted }}>{meta}</span></text>;
  };
  const [narrowInspector, setNarrowInspector] = createSignal(false);
  const rows = () => props.runs().flatMap((run) => [{ runID: run.id, kind: "run" as const, id: run.id }, ...run.spec.phases.flatMap((phase) => [{ runID: run.id, kind: "phase" as const, id: phase.id }, ...phase.steps.flatMap((step) => step.type === "worker" ? [{ runID: run.id, kind: "worker" as const, id: step.worker.id }] : [{ runID: run.id, kind: "group" as const, id: step.id }, ...step.workers.map((worker) => ({ runID: run.id, kind: "worker" as const, id: worker.id }))])])]);
  let treeScroll: { scrollTop: number; viewport: { height: number }; scrollTo: (top: number) => void } | undefined;
  const selectRow = (index: number) => {
    const next = Math.max(0, Math.min(rows().length - 1, index));
    setSelection(rows()[next]);
    if (!treeScroll) return;
    if (next < treeScroll.scrollTop) treeScroll.scrollTo(next);
    else if (next >= treeScroll.scrollTop + treeScroll.viewport.height) treeScroll.scrollTo(next - treeScroll.viewport.height + 1);
  };
  const key = (event: { name: string }) => {
    const names = ["Activity", "Prompt", "Result", "Attempts"] as const;
    if (/^[1-4]$/.test(event.name)) setTab(names[Number(event.name) - 1]!);
    if (event.name === "tab" && narrow()) setNarrowInspector(!narrowInspector());
    if ((event.name === "up" || event.name === "down") && (!narrow() || !narrowInspector())) { const index = Math.max(0, rows().findIndex((item) => item.runID === selection()?.runID && item.kind === selection()?.kind && item.id === selection()?.id)); selectRow(index + (event.name === "down" ? 1 : -1)); }
    if (event.name === "c") selectedRun() && props.controls(selectedRun()!, selectedWorker());
    if (event.name === "s" && selectedRun() && selectedWorker()?.status === "running") props.steer(selectedRun()!, selectedWorker()!);
    if (event.name === "a") props.api.keymap.dispatchCommand("permission.mode");
    if (event.name === "return") { if (narrow() && !narrowInspector()) setNarrowInspector(true); else if (selectedWorker()?.childSessionID) props.api.route.navigate("workflows-transcript", { runID: selectedRun()!.id, workerID: selectedWorker()!.id }); }
    if (event.name === "t" && selectedWorker()?.childSessionID) props.api.route.navigate("workflows-transcript", { runID: selectedRun()!.id, workerID: selectedWorker()!.id });
    if (event.name === "q" || event.name === "escape") { const sessionID = props.back() ?? selectedRun()?.parentSessionID ?? props.runs()[0]?.parentSessionID; props.api.route.navigate(sessionID ? "session" : "home", sessionID ? { sessionID } : undefined); }
  };
  return (
    <box flexDirection="column" padding={1} gap={1} flexGrow={1} minHeight={0} focusable focused onKeyDown={key}>
      <text wrapMode="none" flexShrink={0} fg={theme().text}><b>Workflows</b>  {narrow() ? (narrowInspector() ? "Inspector" : "Tree") : "Tree + Inspector"} · auto-approve <span style={{ fg: autoApprove() === true ? theme().warning : theme().textMuted }}>{autoApprove() === true ? "ON" : autoApprove() === false ? "off" : "unknown"}</span></text>
      <Show when={props.runs().length > 0} fallback={<text fg={theme().textMuted}>No workflow runs for this project.</text>}>
        <box flexDirection="row" gap={1} flexGrow={1} minHeight={0}>
          <Show when={!narrow() || !narrowInspector()}><box width={narrow() ? "100%" : "48%"} flexDirection="column" borderStyle="single" borderColor={theme().border} padding={1} minHeight={0}>
          <scrollbox ref={(element) => (treeScroll = element)} flexGrow={1} flexBasis={0} minHeight={0} verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}>
          <For each={props.runs()}>{(run) => (
            <box flexDirection="column">
              {(() => { const sel = () => isSelected("run", run.id, run.id); const statusFg = run.status === "completed" ? theme().success : ["failed", "rejected", "aborted", "blocked", "repair_required"].includes(run.status) ? theme().error : ["pending", "queued"].includes(run.status) ? theme().warning : theme().textMuted; return <text wrapMode="none" bg={sel() ? theme().primary : undefined} onMouseDown={() => setSelection({ runID: run.id, kind: "run", id: run.id })}><b><span style={{ fg: sel() ? theme().selectedListItemText : statusFg }}>{run.status.toUpperCase()}</span></b><span style={{ fg: sel() ? theme().selectedListItemText : theme().text }}> {run.spec.name}</span></text>; })()}
              <For each={run.spec.phases}>{(phase) => { const phaseSel = () => isSelected("phase", run.id, phase.id); return <box flexDirection="column">
                <text wrapMode="none" bg={phaseSel() ? theme().primary : undefined} fg={phaseSel() ? theme().selectedListItemText : theme().textMuted} onMouseDown={() => setSelection({ runID: run.id, kind: "phase", id: phase.id })}>  +- {phase.title}</text>
                <For each={phase.steps}>{(step) => step.type === "parallel" ? (() => { const groupSel = () => isSelected("group", run.id, step.id); return <box flexDirection="column"><text wrapMode="none" bg={groupSel() ? theme().primary : undefined} fg={groupSel() ? theme().selectedListItemText : theme().textMuted} onMouseDown={() => setSelection({ runID: run.id, kind: "group", id: step.id })}>  |  +- {step.title ?? step.id} [parallel]</text><For each={step.workers}>{(spec) => workerRow(run.id, run.workers[spec.id]!, "  |  |  ")}</For></box>; })() : workerRow(run.id, run.workers[step.worker.id]!, "  |  +- ")}</For>
              </box>; }}</For>
            </box>
          )}</For>
          </scrollbox>
          </box>
          </Show>
          <Show when={!narrow() || narrowInspector()}><box width={narrow() ? "100%" : "52%"} flexDirection="column" borderStyle="single" borderColor={theme().border} padding={1} minHeight={0}>
            <box flexDirection="row" gap={2} flexShrink={0}><For each={["Activity", "Prompt", "Result", "Attempts"] as const}>{(name) => <text fg={tab() === name ? theme().primary : theme().textMuted} onMouseDown={() => setTab(name)}>{tab() === name ? `[${name}]` : name}</text>}</For></box>
            <scrollbox flexGrow={1} flexBasis={0} minHeight={0} verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}><text fg={theme().textMuted}>{inspector()}</text></scrollbox>
          </box></Show>
        </box>
      </Show>
      <box flexDirection="column" borderStyle="single" borderColor={theme().borderActive} paddingX={1}>
        <text fg={theme().text}><b>Keyboard shortcuts</b></text>
        <text wrapMode="none" fg={theme().text}><span style={{ fg: theme().primary }}>[Up/Down]</span> select  <span style={{ fg: theme().primary }}>[Enter]</span> inspect/open  <span style={{ fg: theme().primary }}>[Tab]</span> switch pane  <span style={{ fg: theme().primary }}>[1-4]</span> inspector tabs</text>
        <text wrapMode="none" fg={theme().text}><span style={{ fg: theme().primary }}>[c]</span> controls  <span style={{ fg: theme().primary }}>[s]</span> steer  <span style={{ fg: theme().primary }}>[t]</span> transcript  <span style={{ fg: theme().primary }}>[a]</span> auto-approve ({autoApprove() === true ? "on" : autoApprove() === false ? "off" : "?"})  <span style={{ fg: theme().primary }}>[q/Esc]</span> back</text>
      </box>
      <text fg={theme().primary} onMouseDown={() => selectedRun() && props.controls(selectedRun()!, selectedWorker())}>[Open controls for selection]</text>
      <Show when={selectedWorker()?.childSessionID}><text fg={theme().primary} onMouseDown={() => props.api.route.navigate("workflows-transcript", { runID: selectedRun()!.id, workerID: selectedWorker()!.id })}>[Open read-only transcript]</text></Show>
    </box>
  );
}

function Transcript(props: { api: TuiPluginApi; run: WorkflowRun; worker: WorkerState }) {
  const messages = () => props.worker.childSessionID ? props.api.state.session.messages(props.worker.childSessionID) : [];
  return <box flexDirection="column" padding={1} flexGrow={1} minHeight={0} focusable focused onKeyDown={(event: { name: string }) => { if (event.name === "q" || event.name === "escape") props.api.route.navigate("workflows", { runID: props.run.id, kind: "worker", id: props.worker.id }); }}><text flexShrink={0} fg={props.api.theme.current.text}><b>Workflows transcript: {props.worker.label}</b> (read-only)</text><scrollbox flexGrow={1} flexBasis={0} minHeight={0} verticalScrollbarOptions={{ visible: true }} horizontalScrollbarOptions={{ visible: false }}><For each={messages()}>{(message) => <box flexDirection="column" marginTop={1}><text fg={props.api.theme.current.textMuted}>{message.role}</text><For each={props.api.state.part(message.id)}>{(part) => <text fg={props.api.theme.current.text}>{"text" in part ? String(part.text) : `[${part.type}] ${stableJson(part)}`}</text>}</For></box>}</For></scrollbox><text flexShrink={0} fg={props.api.theme.current.textMuted} marginTop={1}>q/back returns to the selected worker inspector. No prompt input is available.</text></box>;
}

function TranscriptNotFound(props: { api: TuiPluginApi; params?: Record<string, unknown> }) {
  return <box flexDirection="column" padding={1} focusable focused onKeyDown={(event: { name: string }) => { if (event.name === "q" || event.name === "escape" || event.name === "return") props.api.route.navigate("workflows", props.params?.runID ? { runID: props.params.runID, kind: "run", id: props.params.runID } : undefined); }}><text fg={props.api.theme.current.warning}><b>Workflow transcript not found</b></text><text fg={props.api.theme.current.textMuted}>The run, worker, or child session is no longer available. Press Enter, q, or Escape to go back.</text></box>;
}

function openSteering(api: TuiPluginApi, root: string, run: WorkflowRun, worker: WorkerState, coordination: WorkflowCoordination): void {
  const owner = coordination.current();
  const leaseRef = owner?.runID === run.id && !isLeaseStale(owner) ? { targetOwner: owner.ownerIdentity, leaseToken: owner.token, leaseGeneration: owner.generation } : {};
  api.ui.dialog.replace(() => <api.ui.DialogPrompt title={`Steer: ${worker.label}`} placeholder="Guidance delivered at the next safe turn" onConfirm={(guidance) => {
    if (!guidance.trim()) return;
    void sendControl(root, { runID: run.id, action: "steer", workerID: worker.id, controlID: crypto.randomUUID(), guidance: guidance.trim(), createdAt: Date.now(), ...leaseRef }).then(() => api.ui.dialog.clear());
  }} />);
}

async function openDashboard(api: TuiPluginApi, root: string, coordination: WorkflowCoordination, selectedRun?: WorkflowRun, selectedWorker?: WorkerState): Promise<void> {
  const lease = coordination.current();
  const current = await readRuns(root);
  const healthyLease = lease && !isLeaseStale(lease) ? lease : undefined;
  const ownsProject = !!healthyLease;
  const choices = current.filter((run) => !selectedRun || run.id === selectedRun.id).flatMap((run) => {
    const actions: Array<{ title: string; description: string; value: Control | "permission_mode" }> = [];
    const targetOwner = healthyLease?.runID === run.id ? healthyLease.ownerIdentity : undefined;
    const leaseRef = targetOwner ? { targetOwner, leaseToken: healthyLease!.token, leaseGeneration: healthyLease!.generation } : {};
    if (run.status === "pending") {
      if (ownsProject) {
        actions.push({ title: `Queue approved plan: ${run.spec.name}`, description: `${run.spec.goal}\n${detail(run)}`, value: { runID: run.id, action: "queue", createdAt: Date.now() } });
        actions.push({ title: `Replace current run: ${run.spec.name}`, description: "Stop the observed current run resumably, then start this approved plan.\n" + detail(run), value: { runID: run.id, action: "replace", createdAt: Date.now(), leaseToken: healthyLease?.token, leaseGeneration: healthyLease?.generation } });
      } else {
        actions.push({ title: `Approve: ${run.spec.name}`, description: `${run.spec.goal}\n${detail(run)}`, value: { runID: run.id, action: "approve", createdAt: Date.now() } });
      }
      actions.push({ title: `Reject: ${run.spec.name}`, description: detail(run), value: { runID: run.id, action: "reject", createdAt: Date.now() } });
    }
    if (["interrupted", "soft_paused", "hard_paused", "stopped"].includes(run.status)) actions.push({ title: `Resume: ${run.spec.name}`, description: detail(run), value: { runID: run.id, action: "resume", createdAt: Date.now(), ...leaseRef } });
    if (run.status === "running") {
      actions.push({ title: `Soft pause: ${run.spec.name}`, description: "Stop scheduling after active work finishes.", value: { runID: run.id, action: "soft_pause", createdAt: Date.now(), ...leaseRef } });
      actions.push({ title: `Hard pause: ${run.spec.name}`, description: "Interrupt active child sessions and preserve them for continuation.", value: { runID: run.id, action: "hard_pause", createdAt: Date.now(), ...leaseRef } });
    }
    const worker = selectedWorker && selectedWorker.id in run.workers ? run.workers[selectedWorker.id] : undefined;
    if (worker?.status === "running") actions.push({ title: `Steer: ${worker.label}`, description: "Append guidance for the next safe turn boundary. The current turn is never aborted.", value: { runID: run.id, action: "steer", workerID: worker.id, controlID: crypto.randomUUID(), createdAt: Date.now(), ...leaseRef } });
    if (["running", "soft_pausing", "soft_paused", "hard_paused", "blocked", "repair_required"].includes(run.status)) actions.push({ title: `Request plan change: ${run.spec.name}`, description: "Enter guidance after selecting this action. Active work reaches its safe worker/group boundary first.", value: { runID: run.id, action: "plan_change", createdAt: Date.now(), ...leaseRef } });
    if (["running", "soft_pausing", "soft_paused", "hard_pausing", "hard_paused", "blocked", "repair_required"].includes(run.status)) actions.push({ title: `Stop: ${run.spec.name}`, description: "Release the project lease and leave the run resumable.", value: { runID: run.id, action: "stop", createdAt: Date.now(), ...leaseRef } });
    if (canDiscardRun(run)) actions.push({ title: `Discard: ${run.spec.name}`, description: "Permanently delete this run and all child sessions after confirmation.", value: { runID: run.id, action: "discard", createdAt: Date.now(), ...leaseRef } });
    if (run.status === "blocked" && run.failure) {
      if (run.failure.kind === "coordinator" || run.failure.kind === "repair") {
        actions.push({ title: "Retry coordinator", description: run.failure.reason, value: { runID: run.id, action: "coordinator_retry", createdAt: Date.now(), ...leaseRef } });
        if (canContinueCoordinatorFailure(run)) actions.push({ title: "Continue existing pending plan", description: "Continue without the rejected revision.", value: { runID: run.id, action: "coordinator_continue", createdAt: Date.now(), ...leaseRef } });
      }
      if (run.failure.kind !== "coordinator" && run.failure.kind !== "repair") actions.push({ title: `Retry failed worker: ${run.failure.workerID}`, description: run.failure.reason, value: { runID: run.id, action: "failure_retry", createdAt: Date.now(), ...leaseRef } });
      if (!run.failure.kind || run.failure.kind === "worker") actions.push({ title: `Skip failed worker: ${run.failure.workerID}`, description: "Dependent templates trigger immediate coordinator repair.", value: { runID: run.id, action: "failure_skip", createdAt: Date.now(), ...leaseRef } });
      actions.push({ title: `Stop after failure: ${run.spec.name}`, description: run.failure.reason, value: { runID: run.id, action: "failure_stop", createdAt: Date.now(), ...leaseRef } });
    }
    return actions;
  });
  const permissionTitle = ((): unknown => api.keymap.getCommands({ visibility: "registered", filter: { name: "permission.mode" } })[0]?.title)();
  const autoApproveState = typeof permissionTitle === "string" ? (permissionTitle.startsWith("Disable") ? true : permissionTitle.startsWith("Enable") ? false : undefined) : undefined;
  choices.unshift({ title: "Toggle OpenCode auto-approve", description: autoApproveState === true ? "Currently ON. Dispatches permission.mode." : autoApproveState === false ? "Currently off. Dispatches permission.mode." : "Dispatches permission.mode. The public API does not expose a reliable current mode.", value: "permission_mode" });
  api.ui.dialog.replace(() => api.ui.DialogSelect<Control | "permission_mode">({
    title: "Workflow plans",
    placeholder: "Select an explicit workflow control",
    options: choices,
    onSelect: (option) => {
      if (option.value === "permission_mode") {
        api.keymap.dispatchCommand("permission.mode");
        api.ui.dialog.clear();
        return;
      }
      const control = option.value;
      if (control.action === "plan_change" || control.action === "steer") {
        api.ui.dialog.replace(() => <api.ui.DialogPrompt title={control.action === "steer" ? "Steer active worker" : "Request workflow plan change"} placeholder={control.action === "steer" ? "Guidance delivered at the next safe turn" : "Guidance for the coordinator"} onConfirm={(guidance) => {
          if (!guidance.trim()) return;
           void sendControl(root, { ...control, guidance: guidance.trim() }).then(() => { api.ui.dialog.clear(); api.ui.toast({ variant: "info", title: "Workflows", message: `${control.action} submitted; awaiting server confirmation` }); api.route.navigate("workflows", { runID: control.runID, kind: control.action === "steer" ? "worker" : "run", id: control.workerID ?? control.runID }); });
        }} />);
        return;
      }
      if (control.action === "discard") {
        api.ui.dialog.replace(() => api.ui.DialogSelect<Control | undefined>({ title: `Discard ${current.find((run) => run.id === control.runID)?.spec.name}?`, placeholder: "This permanently deletes persisted workflow data and owned child sessions", options: [{ title: "Discard permanently", value: control }, { title: "Cancel", value: undefined }], onSelect: (confirmation) => { if (confirmation.value) void sendControl(root, confirmation.value).then(() => api.ui.dialog.clear()); else api.ui.dialog.clear(); } }));
        return;
      }
      void sendControl(root, control).then(() => {
        api.ui.dialog.clear();
        api.ui.toast({ variant: "info", title: "Workflows", message: `${control.action} submitted; awaiting server confirmation` });
        api.route.navigate("workflows");
      }).catch((error) => api.ui.toast({ variant: "error", title: "Workflows", message: error instanceof Error ? error.message : String(error) }));
    },
  }));
}

const WorkflowTuiPlugin: TuiPlugin = async (api) => {
  const runCache = new Map<string, RunCacheEntry>();
  const [runs, setRuns] = createSignal<WorkflowRun[]>([]);
  const [blink, setBlink] = createSignal(false);
  const [lease, setLease] = createSignal<ReturnType<WorkflowCoordination["current"]>>();
  const presenceID = crypto.randomUUID();
  let lastSessionID: string | undefined;
  let root: string | undefined;
  let coordination: WorkflowCoordination | undefined;
  let initialized = false;
  let refreshing = false;
  let disposed = false;
  const blinkTimer = setInterval(() => setBlink((value) => !value), 600);
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let presenceTimer: ReturnType<typeof setInterval> | undefined;
  let initializationTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveInitialization: (() => void) | undefined;
  let presenceWrite: Promise<void> | undefined;
  let initialization = Promise.resolve();
  const refresh = async () => {
    const route = api.route.current;
    if (route.name === "session" && typeof (route as any).params?.sessionID === "string") lastSessionID = (route as any).params.sessionID;
    const currentRoot = root;
    const currentCoordination = coordination;
    if (!currentRoot || !currentCoordination || refreshing || disposed) return;
    refreshing = true;
    try {
    const next = await readRuns(currentRoot, runCache);
    if (disposed) return;
    let controlResults: string[] = [];
    try { controlResults = await readdir(join(currentRoot, "control-results")); } catch {}
    for (const file of controlResults.filter((name) => name.endsWith(".claimed"))) {
      const claim = file.match(/^(.*\.json)\.[0-9a-f-]+\.claimed$/i);
      if (!claim) continue;
      const source = join(currentRoot, "control-results", file);
      try {
        if (Date.now() - (await stat(source)).ctimeMs <= TUI_PRESENCE_STALE_MS) continue;
        await rename(source, join(currentRoot, "control-results", claim[1]!));
        controlResults.push(claim[1]!);
      } catch {}
    }
    for (const file of controlResults.filter((name) => name.endsWith(".json"))) {
      const source = join(currentRoot, "control-results", file);
      const path = `${source}.${presenceID}.claimed`;
      try {
        await rename(source, path);
        const result = await Bun.file(path).json() as { action: string; status: "accepted" | "ignored" | "rejected"; error?: string };
        api.ui.toast({ variant: result.status === "accepted" ? "success" : result.status === "ignored" ? "warning" : "error", title: `${result.action} ${result.status}`, message: result.error ?? "Workflow control processed" });
      } catch {} finally { await rm(path, { force: true }); }
    }
    if (disposed) return;
    setLease(currentCoordination.current());
    if (!initialized) {
      const pending = next.filter((run) => run.status === "pending");
      if (pending.length) {
        api.ui.toast({ variant: "warning", title: "Workflow approval required", message: pending.length === 1 ? pending[0]!.spec.name : `${pending.length} workflows are waiting`, duration: 10_000 });
        void api.attention.notify({ title: "Workflow approval required", message: pending.length === 1 ? pending[0]!.spec.name : `${pending.length} workflows are waiting`, notification: true, sound: { name: "question" } }).catch(() => {});
      }
    }
    if (initialized) {
      for (const run of next) {
        const previous = runs().find((item) => item.id === run.id);
        if (run.status === "pending" && !previous) {
          api.ui.toast({ variant: "warning", title: "Workflow approval required", message: run.spec.name, duration: 10_000 });
          void api.attention.notify({ title: "Workflow approval required", message: run.spec.name, notification: true, sound: { name: "question" } }).catch(() => {});
        }
        if (run.status === "completed" && previous?.status !== "completed") {
          api.ui.toast({ variant: "success", title: "Workflow completed", message: run.spec.name });
        }
        if (run.status === "soft_paused" && previous?.status !== "soft_paused") {
          const timeout = run.error?.startsWith("Run window reached");
          api.ui.toast({ variant: "warning", title: timeout ? "Workflow time limit reached" : "Workflow paused", message: run.error ?? run.spec.name });
          if (timeout) void api.attention.notify({ title: "Workflow time limit reached", message: run.spec.name, notification: true, sound: { name: "question" } }).catch(() => {});
        }
        if (run.status === "blocked" && previous?.status !== "blocked") {
          if (run.failure && api.route.current.name === "workflows") {
            const owner = currentCoordination.current();
            const targetOwner = owner?.runID === run.id && !isLeaseStale(owner) ? owner.ownerIdentity : undefined;
            const leaseRef = targetOwner ? { targetOwner, leaseToken: owner!.token, leaseGeneration: owner!.generation } : {};
            api.ui.dialog.replace(() => api.ui.DialogSelect<Control>({
              title: `Workflow failure: ${run.failure!.workerID}`,
              placeholder: "Choose a failure decision",
               options: failureControlActions(run).map((action) => ({ title: action === "coordinator_retry" ? "Retry coordinator" : action === "coordinator_continue" ? "Continue existing plan" : action === "failure_retry" ? "Retry" : action === "failure_skip" ? "Skip" : "Stop", description: run.failure!.reason, value: { runID: run.id, action, createdAt: Date.now(), ...leaseRef } })),
              onSelect: (option) => { void sendControl(currentRoot, option.value).then(() => api.ui.dialog.clear()).catch((error) => api.ui.toast({ variant: "error", title: "Workflows", message: error instanceof Error ? error.message : String(error) })); },
            }));
          } else {
            api.ui.toast({ variant: "warning", title: "Workflow paused for failure", message: run.error ?? run.spec.name });
          }
        }
        for (const worker of Object.values(run.workers)) for (const steering of worker.steering ?? []) {
          const prior = previous?.workers[worker.id]?.steering?.find((item) => item.id === steering.id);
          if (steering.status === "rejected" && prior?.status !== "rejected") api.ui.toast({ variant: "error", title: "Worker steering rejected", message: steering.error ?? "Worker is no longer steerable" });
        }
      }
    }
    setRuns(next);
    initialized = true;
    } finally { refreshing = false; }
  };
  api.keymap.registerLayer({
    commands: [{ name: "workflows.open", title: "Workflows", category: "Project", namespace: "palette", slashName: "workflows", run() { api.route.navigate("workflows"); } }],
    bindings: [],
  });
  api.route.register([
    { name: "workflows", render: ({ params }) => <Dashboard runs={runs} api={api} back={() => lastSessionID} initial={params?.runID ? params as InspectorSelection : undefined} controls={(run, worker) => {
      if (!root || !coordination) { api.ui.toast({ variant: "warning", title: "Workflows", message: "Workflow data is still initializing" }); return; }
      void openDashboard(api, root, coordination, run, worker).catch((error) => api.ui.toast({ variant: "error", title: "Workflows", message: error instanceof Error ? error.message : String(error) }));
    }} steer={(run, worker) => {
      if (!root || !coordination) { api.ui.toast({ variant: "warning", title: "Workflows", message: "Workflow data is still initializing" }); return; }
      openSteering(api, root, run, worker, coordination);
    }} /> },
    { name: "workflows-transcript", render: ({ params }) => { const selection = transcriptSelection(runs(), params); return selection ? <Transcript api={api} run={selection.run} worker={selection.worker} /> : <TranscriptNotFound api={api} params={params} />; } },
  ]);
  api.slots.register({
    order: 500,
    slots: {
      session_prompt_right(_ctx, props) {
        const visible = () => promptRightRun(runs().filter((run) => run.parentSessionID === props.session_id), lease());
        return <Show when={visible()}>{(run: () => WorkflowRun) => <text fg={run().status === "pending" ? (blink() ? api.theme.current.warning : api.theme.current.textMuted) : api.theme.current.warning} onMouseDown={() => api.route.navigate("workflows", { runID: run().id, kind: "run", id: run().id })}>WF {run().status === "completed" ? "completed" : ["pending", "queued"].includes(run().status) ? run().status : `${currentPlanProgress(run()).completed}/${currentPlanProgress(run()).total}`} | {currentPlanProgress(run()).running} running</text>}</Show>;
      },
    },
  });
  api.lifecycle.onDispose(async () => {
    disposed = true;
    clearInterval(blinkTimer);
    if (refreshTimer) clearInterval(refreshTimer);
    if (presenceTimer) clearInterval(presenceTimer);
    if (initializationTimer) {
      clearTimeout(initializationTimer);
      initializationTimer = undefined;
      resolveInitialization?.();
      resolveInitialization = undefined;
    }
    if (!coordination) return;
    await initialization;
    while (refreshing) await Bun.sleep(10);
    await presenceWrite;
    coordination?.close();
    coordination = undefined;
    if (!root) return;
    const presence = tuiPresencePath(root);
    const claimed = `${presence}.${presenceID}.dispose`;
    try {
      await rename(presence, claimed);
      const value = await Bun.file(claimed).json() as { processID?: string };
      if (value.processID !== presenceID) await rename(claimed, presence);
    } catch {}
    await rm(claimed, { force: true });
  });
  initialization = new Promise<void>((resolve) => {
    resolveInitialization = resolve;
    initializationTimer = setTimeout(() => {
      initializationTimer = undefined;
      void (async () => {
        const currentRoot = await projectRoot(api);
        if (disposed) return;
        const currentCoordination = new WorkflowCoordination(join(currentRoot, "coordination.sqlite"));
        if (disposed) { currentCoordination.close(); return; }
        root = currentRoot;
        coordination = currentCoordination;
        const writePresence = () => {
          if (disposed || presenceWrite) return presenceWrite ?? Promise.resolve();
          const write = atomicWrite(tuiPresencePath(currentRoot), `${JSON.stringify({ heartbeatAt: Date.now(), processID: presenceID })}\n`).catch(() => {});
          presenceWrite = write.finally(() => { presenceWrite = undefined; });
          return presenceWrite;
        };
        await writePresence();
        if (disposed) return;
        await refresh().catch(() => {});
        if (disposed) return;
        refreshTimer = setInterval(() => { void refresh().catch(() => {}); }, 500);
        presenceTimer = setInterval(() => { void writePresence(); }, 2_000);
        const interrupted = runs().filter((run) => startupActions(run).length > 0);
        if (!interrupted.length) return;
        type Recovery = { action: "resume" | "open" | "later" | "discard"; run?: WorkflowRun };
        api.ui.dialog.replace(() => api.ui.DialogSelect<Recovery>({
          title: "Interrupted workflows",
          placeholder: `${interrupted.length} interrupted workflow(s); choose one recovery action`,
          options: [
            ...interrupted.flatMap((run) => [{ title: `Resume: ${run.spec.name}`, description: detail(run), value: { action: "resume" as const, run } }, { title: `Discard: ${run.spec.name}`, description: "Requires a second permanent-delete confirmation", value: { action: "discard" as const, run } }]),
            { title: "Open dashboard", description: "Review all interrupted workflows without changing them", value: { action: "open" as const } },
            { title: "Decide later", description: "Keep runs interrupted until /workflows is opened", value: { action: "later" as const } },
          ],
          onSelect: (option) => {
            if (option.value.action === "resume") void sendControl(currentRoot, { runID: option.value.run!.id, action: "resume", createdAt: Date.now() }).then(() => api.ui.dialog.clear()).catch((error) => api.ui.toast({ variant: "error", title: "Workflows", message: error instanceof Error ? error.message : String(error) }));
            if (option.value.action === "open") { api.ui.dialog.clear(); api.route.navigate("workflows"); }
            if (option.value.action === "later") api.ui.dialog.clear();
            if (option.value.action === "discard") api.ui.dialog.replace(() => api.ui.DialogSelect<Control | undefined>({ title: `Discard ${option.value.run!.spec.name}?`, placeholder: "This permanently deletes persisted workflow data and owned child sessions", options: [{ title: "Discard permanently", value: { runID: option.value.run!.id, action: "discard", createdAt: Date.now() } }, { title: "Cancel", value: undefined }], onSelect: (confirmation) => { if (confirmation.value) void sendControl(currentRoot, confirmation.value).then(() => api.ui.dialog.clear()).catch((error) => api.ui.toast({ variant: "error", title: "Workflows", message: error instanceof Error ? error.message : String(error) })); else api.ui.dialog.clear(); } }));
          },
        }));
      })().catch((error) => {
        if (!disposed) api.ui.toast({ variant: "error", title: "Workflows failed to initialize", message: error instanceof Error ? error.message : String(error) });
      }).finally(() => {
        resolveInitialization = undefined;
        resolve();
      });
    }, 0);
  });
};

const plugin: TuiPluginModule & { id: string } = { id: "workflows", tui: WorkflowTuiPlugin };
export default plugin;
