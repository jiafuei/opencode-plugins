import { tool } from "@opencode-ai/plugin";
import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, content);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

/** Resolves early when the signal aborts, so retry backoff never outlives a cancelled run. */
export async function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await Promise.race([Bun.sleep(delayMs), new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))]);
}

export type ModelRef = { providerID: string; modelID: string };

export type WorkerSpec = {
  id: string;
  label: string;
  agent: string;
  modelID?: string;
  variant?: string;
  prompt: string;
  schema?: Record<string, unknown>;
};

export type WorkerStep = { type: "worker"; worker: WorkerSpec };
export type ParallelStep = { type: "parallel"; id: string; title?: string; workers: WorkerSpec[] };
export type PhaseSpec = { id: string; title: string; checkpoint?: boolean; steps: Array<WorkerStep | ParallelStep> };
export type WorkflowSpec = {
  version: 1;
  name: string;
  description: string;
  goal: string;
  allowedAgents: string[];
  phases: PhaseSpec[];
  limits?: { maxWorkers?: number; maxRevisions?: number; maxRunMs?: number };
};

export type WorkflowLimits = { maxWorkers: number; maxRevisions: number; maxRunMs: number; maxConcurrency: number };
export type PlanDiffEntry = { kind: "added" | "removed" | "reordered" | "changed"; node: "phase" | "worker"; id: string; before?: string; after?: string };
export type WorkflowGuidance = { id: string; generation: number; text: string; createdAt: number };
export type ExecutionFrontier = { generation: number; phaseID?: string; completedSteps: number; sealed: boolean };
export type PlanRevision = { version: number; operationID: string; reason: "checkpoint" | "plan_change" | "repair"; checkpointOccurrenceID?: string; guidance: WorkflowGuidance[]; rationale: string; before: PhaseSpec[]; after: PhaseSpec[]; diff: PlanDiffEntry[]; acceptedAt: number };
export type CoordinatorOperation = { id: string; sourcePlanVersion: number; sourceFrontierGeneration: number; reason: PlanRevision["reason"]; checkpointOccurrenceID?: string; guidanceIDs: string[]; sessionID?: string; attempts: WorkerAttempt[]; input: string; output?: unknown; rationale?: string; status: "creating" | "running" | "accepted" | "failed"; error?: string; terminalKind?: "creation" | "turn" | "policy" };
export type CoordinatorState = { operationID?: string; status: "idle" | "running" | "failed"; reason?: PlanRevision["reason"]; error?: string };
export type WorkerAttempt = {
  number: number;
  kind?: "creation" | "turn";
  startedAt: number;
  endedAt?: number;
  delayMs?: number;
  error?: string;
  result?: "created" | "retrying" | "completed" | "superseded" | "failed" | "interrupted";
  messageID?: string;
  output?: unknown;
  steeringIDs?: string[];
  retryCycle?: number;
};
export type WorkerSteering = { id: string; text: string; createdAt: number; status: "queued" | "delivered" | "finalized" | "rejected"; deliveredAt?: number; finalizedAt?: number; error?: string };
export type TokenUsage = { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number };
export type WorkerState = {
  id: string;
  label: string;
  agent: string;
  modelID?: string;
  variant?: string;
  prompt: string;
  schema?: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "aborted" | "interrupted" | "skipped" | "retired";
  childSessionID?: string;
  output?: unknown;
  error?: string;
  attempts?: WorkerAttempt[];
  continuation?: "resume" | "retry";
  startedAt?: number;
  endedAt?: number;
  activity?: string;
  steering: WorkerSteering[];
  tokens?: TokenUsage;
  automaticRetries?: number;
  creationRetries?: number;
};
export type WorkflowStatus = "pending" | "queued" | "running" | "soft_pausing" | "soft_paused" | "hard_pausing" | "hard_paused" | "stopping" | "blocked" | "repair_required" | "stopped" | "completed" | "rejected" | "failed" | "aborted" | "interrupted";
export type WorkflowControlAction = "approve" | "queue" | "replace" | "reject" | "soft_pause" | "hard_pause" | "resume" | "stop" | "discard" | "parent_deleted" | "failure_retry" | "failure_skip" | "failure_stop" | "plan_change" | "coordinator_retry" | "coordinator_continue" | "steer";
export type WorkflowRun = {
  version: 1;
  id: string;
  parentSessionID: string;
  parentMessageID: string;
  parentModel?: ModelRef;
  parentAgent?: string;
  parentVariant?: string;
  parentDeletedAt?: number;
  createdAt: number;
  updatedAt: number;
  terminalAt?: number;
  status: WorkflowStatus;
  originalSpec?: unknown;
  spec: WorkflowSpec;
  limits: WorkflowLimits;
  workers: Record<string, WorkerState>;
  handoffSessionID?: string;
  handoff?: WorkflowHandoff;
  error?: string;
  failure?: { workerID: string; reason: string; kind?: "worker" | "handoff" | "repair" | "coordinator" };
  windowStartedAt?: number;
  replacement?: boolean;
  handoffAttempts?: WorkerAttempt[];
  synthesisMessageID?: string;
  synthesisQueuedAt?: number;
  planVersion: number;
  planHistory: Array<{ version: number; phases: PhaseSpec[] }>;
  revisions: PlanRevision[];
  completedPhases: string[];
  checkpointOccurrences: Record<string, string>;
  consumedCheckpoints: string[];
  pendingGuidance: WorkflowGuidance[];
  guidanceGeneration: number;
  frontier: ExecutionFrontier;
  sealedPhases: string[];
  coordinator: CoordinatorState;
  coordinatorOperations: CoordinatorOperation[];
  reservedWorkerIDs: string[];
  reservedPhaseIDs: string[];
  controlErrors?: Array<{ id: string; action: WorkflowControlAction; createdAt: number; rejectedAt: number; error: string; workerID?: string }>;
};

type HydratedField =
  | "planVersion" | "planHistory" | "revisions" | "completedPhases" | "sealedPhases" | "checkpointOccurrences"
  | "consumedCheckpoints" | "pendingGuidance" | "guidanceGeneration" | "frontier" | "coordinator"
  | "coordinatorOperations" | "reservedWorkerIDs" | "reservedPhaseIDs";

/** A run as it may exist on disk: written before the adaptive-planning fields existed. */
export type PersistedRun = Omit<WorkflowRun, HydratedField> & Partial<Pick<WorkflowRun, HydratedField>>;

// Adaptive-planning fields are always written at run creation, so every read site can treat them as
// present. Runs persisted before those fields existed are normalized here, once, as they are loaded.
export function hydrateRun(run: PersistedRun): WorkflowRun {
  run.planVersion ??= 1;
  run.planHistory ??= [{ version: 1, phases: structuredClone(run.spec.phases) }];
  run.revisions ??= [];
  run.completedPhases ??= [];
  run.sealedPhases ??= [];
  run.checkpointOccurrences ??= {};
  run.consumedCheckpoints ??= [];
  run.pendingGuidance ??= [];
  run.guidanceGeneration ??= 0;
  run.frontier ??= { generation: 0, completedSteps: 0, sealed: false };
  run.coordinator ??= { status: "idle" };
  run.coordinatorOperations ??= [];
  run.reservedWorkerIDs ??= Object.keys(run.workers);
  run.reservedPhaseIDs ??= run.spec.phases.map((phase) => phase.id);
  for (const worker of Object.values(run.workers)) worker.steering ??= [];
  return run as WorkflowRun;
}
export type WorkflowLease = { runID: string; ownerIdentity: string; heartbeatAt: number };
export type WorkflowHandoff = {
  summary: string;
  completedWork: string[];
  evidence: Array<{ claim: string; source: string }>;
  changedFiles: string[];
  verification: string[];
  unresolvedIssues: string[];
  recommendedNextAction: string;
};

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const TEMPLATE_REFERENCE = /^\s*workers\.([A-Za-z][A-Za-z0-9_-]*)\.output((?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\s*$/;
const NONEMPTY_TEXT = tool.schema.string({ message: "must be a non-empty string" }).refine((value) => !!value.trim(), { message: "must be a non-empty string" });
const TEXT = tool.schema.string({ message: "must be a string" });
const IDENTIFIER = tool.schema.string({ message: "must use letters, numbers, _ or - and begin with a letter" }).refine((value) => ID.test(value), { message: "must use letters, numbers, _ or - and begin with a letter" });
const MODEL_ID = tool.schema.string({ message: 'must be a "providerID/modelID" string such as "openai/gpt-1.0" or "anthropic/claude-sonnet-1.0"' }).refine((value) => /^[^\s/]+\/\S+$/.test(value), { message: 'must be a "providerID/modelID" string such as "openai/gpt-1.0" or "anthropic/claude-sonnet-1.0"' });
export const WORKER_SCHEMA = tool.schema.object({
  id: IDENTIFIER.describe("Globally unique across the workflow; letters, digits, _ or -, starting with a letter"),
  label: NONEMPTY_TEXT,
  agent: IDENTIFIER.optional().default("general").describe("Defaults to 'general'; must be listed in allowedAgents"),
  modelID: MODEL_ID.optional().describe('"providerID/modelID"; must be an available model. Omit to inherit the originating session model. Set it explicitly on workers that check other workers, so verification does not repeat the same model\'s mistakes.'),
  variant: TEXT.optional(),
  prompt: NONEMPTY_TEXT.describe("Self-contained instructions; the worker sees no conversation history. May embed earlier workers' outputs as {{workers.<id>.output}} (append .field for schema outputs; \\{{ for a literal). Forward and same-step sibling references are rejected. When the worker produces bulk data, name the exact file path it must write to."),
  schema: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().describe("JSON Schema for the worker's structured output. Results are passed intact to coordinators and the final handoff. For bulk results, write an artifact and return {path, count, notes}."),
});
export const WORKFLOW_SPEC_SCHEMA = tool.schema.object({
  version: tool.schema.literal(1),
  name: NONEMPTY_TEXT,
  description: NONEMPTY_TEXT.describe("One line shown in the approval dialog and run tree"),
  goal: NONEMPTY_TEXT.describe("The complete objective AND the condition that ends the run, in a few full sentences — this is the only context a checkpoint coordinator gets besides worker outputs: it has no tools and no conversation history, so everything it must know between phases belongs here. A workflow that repeats until exhausted must state its stopping rule here or it will not converge."),
  allowedAgents: tool.schema.array(IDENTIFIER).min(1, { message: "must contain at least one agent" }).describe("Unique registered agents workers may use; also bounds anything a checkpoint coordinator adds later"),
  phases: tool.schema.array(tool.schema.object({
    id: IDENTIFIER,
    title: NONEMPTY_TEXT,
    checkpoint: tool.schema.boolean().optional().describe("After this phase, a coordinator sees its outputs and rewrites ALL remaining phases. This is the only way to express work whose shape is unknown up front — fan-out over a list this phase discovers, or repeat-until-exhausted. There is no loop construct; end the discovering phase with a checkpoint and let the coordinator write the phases that consume it."),
    steps: tool.schema.array(tool.schema.discriminatedUnion("type", [
      tool.schema.object({ type: tool.schema.literal("worker"), worker: WORKER_SCHEMA }),
      tool.schema.object({ type: tool.schema.literal("parallel"), id: IDENTIFIER, title: NONEMPTY_TEXT.optional(), workers: tool.schema.array(WORKER_SCHEMA).min(1, { message: "must not be empty" }) }),
    ])).min(1, { message: "must not be empty" }),
  })).min(1, { message: "must not be empty" }),
  limits: tool.schema.object({
    maxWorkers: tool.schema.number().int().min(1).optional().describe("Total worker budget. A checkpoint coordinator may only add (maxWorkers - workers already listed) workers, so a spec with checkpoints must set this well above its own worker count or the expansion silently has no room."),
    maxRevisions: tool.schema.number().int().min(1).optional().describe("Coordinator revisions allowed; each checkpoint consumes one"),
    maxRunMs: tool.schema.number().int().min(1).optional(),
  }).optional(),
});
export const DEFAULT_LIMITS: WorkflowLimits = { maxWorkers: 100, maxRevisions: 10, maxRunMs: 6 * 60 * 60 * 1000, maxConcurrency: 2 };
export const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 40_000] as const;
export const LEASE_HEARTBEAT_MS = 5_000;
export const LEASE_STALE_MS = 15_000;
export const TUI_PRESENCE_STALE_MS = 5_000;
export type WorkflowOptions = { retentionRuns: number; retentionDays: number; maxWorkers: number; maxRevisions: number; maxRunMs: number; maxConcurrency: number };

export function normalizeWorkflowOptions(value: Record<string, unknown> | undefined = {}): WorkflowOptions {
  value ??= {};
  const integer = (key: string, fallback: number) => {
    const item = value[key];
    if (item === undefined) return fallback;
    if (!Number.isInteger(item) || Number(item) < 1) throw new Error(`workflows.${key} must be a positive integer`);
    return Number(item);
  };
  return { retentionRuns: integer("retention_runs", 10000), retentionDays: integer("retention_days", 99999999), maxWorkers: integer("max_workers", 100), maxRevisions: integer("max_revisions", 10), maxRunMs: integer("max_run_ms", 6 * 60 * 60 * 1000), maxConcurrency: integer("max_concurrency", 2) };
}

export function workflowCeilings(options: WorkflowOptions): WorkflowLimits { return { maxWorkers: options.maxWorkers, maxRevisions: options.maxRevisions, maxRunMs: options.maxRunMs, maxConcurrency: options.maxConcurrency }; }

export function parseModelID(value: string): ModelRef {
  const separator = value.indexOf("/");
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
}

function templateReferences(prompt: string): Array<{ start: number; end: number; id: string; suffix: string }> {
  const references: Array<{ start: number; end: number; id: string; suffix: string }> = [];
  for (let cursor = 0; cursor < prompt.length;) {
    const start = prompt.indexOf("{{", cursor);
    if (start < 0) break;
    if (prompt[start - 1] === "\\") { cursor = start + 2; continue; }
    const end = prompt.indexOf("}}", start + 2);
    const expression = prompt.slice(start + 2, end < 0 ? undefined : end);
    if (!/^\s*workers\./.test(expression)) { cursor = end < 0 ? prompt.length : end + 2; continue; }
    if (end < 0) throw new Error("Unclosed workflow template reference; use \\{{ for literal workflow syntax");
    const reference = expression.match(TEMPLATE_REFERENCE);
    if (!reference) throw new Error("Invalid workflow template reference; expected {{workers.workerId.output.path}} or use \\{{ for a literal");
    references.push({ start, end: end + 2, id: reference[1]!, suffix: reference[2]! });
    cursor = end + 2;
  }
  return references;
}

export function templateDependencies(prompt: string): string[] {
  const dependencies: string[] = [];
  const seen = new Set<string>();
  for (const reference of templateReferences(prompt)) {
    const id = reference.id;
    if (!seen.has(id)) {
      seen.add(id);
      dependencies.push(id);
    }
  }
  return dependencies;
}

export function validateWorkflowSpec(value: unknown, registeredAgents?: ReadonlySet<string>, registeredModels?: ReadonlySet<string>, ceilings: WorkflowLimits = DEFAULT_LIMITS): WorkflowSpec {
  return checkWorkflowPlan(WORKFLOW_SPEC_SCHEMA.parse(value), registeredAgents, registeredModels, ceilings);
}

function checkWorkflowPlan(spec: WorkflowSpec, registeredAgents?: ReadonlySet<string>, registeredModels?: ReadonlySet<string>, ceilings: WorkflowLimits = DEFAULT_LIMITS): WorkflowSpec {
  const problems: string[] = [];
  const fail = () => {
    if (problems.length === 1) throw new Error(problems[0]!);
    if (problems.length > 1) throw new Error(`workflow spec has ${problems.length} problems:\n${problems.map((problem, index) => `${index + 1}. ${problem}`).join("\n")}`);
  };
  const allowedAgents = new Set(spec.allowedAgents);
  if (allowedAgents.size !== spec.allowedAgents.length) problems.push("workflow.allowedAgents must contain unique agents");
  if (registeredAgents) for (const agent of allowedAgents) if (!registeredAgents.has(agent)) problems.push(`workflow.allowedAgents contains unregistered agent "${agent}"`);
  const limits = {
    maxWorkers: spec.limits?.maxWorkers ?? ceilings.maxWorkers,
    maxRevisions: spec.limits?.maxRevisions ?? ceilings.maxRevisions,
    maxRunMs: spec.limits?.maxRunMs ?? ceilings.maxRunMs,
  };
  if (limits.maxWorkers > ceilings.maxWorkers) problems.push(`workflow.limits.maxWorkers must be an integer from 1 to ${ceilings.maxWorkers}`);
  if (limits.maxRevisions > ceilings.maxRevisions) problems.push(`workflow.limits.maxRevisions must be an integer from 1 to ${ceilings.maxRevisions}`);
  if (limits.maxRunMs > ceilings.maxRunMs) problems.push(`workflow.limits.maxRunMs must be an integer from 1 to ${ceilings.maxRunMs}`);

  const workerIDs = new Set<string>();
  const known = new Set<string>();
  const phaseIDs = new Set<string>();
  const checkWorker = (worker: WorkerSpec) => {
    if (workerIDs.has(worker.id)) problems.push(`Worker id ${worker.id} is not globally unique`);
    else workerIDs.add(worker.id);
    if (!allowedAgents.has(worker.agent)) problems.push(`Worker ${worker.id} uses agent ${worker.agent} outside allowedAgents`);
    if (worker.modelID && registeredModels && !registeredModels.has(worker.modelID)) problems.push(`Worker ${worker.id} uses unavailable model "${worker.modelID}"`);
    try {
      for (const reference of templateReferences(worker.prompt)) {
        if (!known.has(reference.id)) {
          problems.push(`Worker ${worker.id} references missing, forward, or sibling worker ${reference.id}`);
          continue;
        }
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  };

  for (const phase of spec.phases) {
    if (phaseIDs.has(phase.id)) problems.push(`Phase id ${phase.id} is not unique`);
    else phaseIDs.add(phase.id);
    const groupIDs = new Set<string>();
    for (const step of phase.steps) {
      if (step.type === "parallel") {
        if (groupIDs.has(step.id)) problems.push(`Parallel group id ${step.id} is not unique in phase ${phase.id}`);
        else groupIDs.add(step.id);
      }
      const workers = step.type === "worker" ? [step.worker] : step.workers;
      for (const worker of workers) checkWorker(worker);
      for (const worker of workers) known.add(worker.id);
    }
  }
  if (workerIDs.size > limits.maxWorkers) problems.push(`Workflow has ${workerIDs.size} workers, exceeding maxWorkers ${limits.maxWorkers}`);
  fail();
  return { ...spec, limits };
}

export function effectiveLimits(spec: WorkflowSpec, maxConcurrency: number = DEFAULT_LIMITS.maxConcurrency): WorkflowLimits {
  return { ...DEFAULT_LIMITS, ...spec.limits, maxConcurrency };
}

export function workersInPhases(phases: PhaseSpec[]): WorkerSpec[] {
  return phases.flatMap((phase) => phase.steps.flatMap((step) => step.type === "worker" ? [step.worker] : step.workers));
}

export function workerIDsInPhases(phases: PhaseSpec[]): string[] {
  return workersInPhases(phases).map((worker) => worker.id);
}

export function workersInOrder(spec: WorkflowSpec): WorkerSpec[] {
  return workersInPhases(spec.phases);
}

export function currentPlanProgress(run: WorkflowRun): { completed: number; total: number; running: number } {
  const ids = workerIDsInPhases(run.spec.phases);
  return { completed: ids.filter((id) => run.workers[id]?.status === "completed").length, total: ids.length, running: ids.filter((id) => run.workers[id]?.status === "running").length };
}

/** Compact read-only projection for the workflow_status tool: no prompts, outputs, or attempts. */
export function runStatusView(run: WorkflowRun): Record<string, unknown> {
  const phaseStatus = (phaseID: string): "completed" | "active" | "pending" =>
    run.completedPhases.includes(phaseID) || run.sealedPhases.includes(phaseID) ? "completed" : run.frontier.phaseID === phaseID ? "active" : "pending";
  return {
    runID: run.id,
    name: run.spec.name,
    description: run.spec.description,
    status: run.status,
    ...(run.error === undefined ? {} : { error: run.error }),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    planVersion: run.planVersion,
    revisions: run.revisions.length,
    goal: run.spec.goal,
    phases: run.spec.phases.map((phase) => ({ id: phase.id, title: phase.title, ...(phase.checkpoint ? { checkpoint: true } : {}), status: phaseStatus(phase.id) })),
    workers: Object.values(run.workers).map((worker) => ({
      id: worker.id,
      label: worker.label,
      agent: worker.agent,
      status: worker.status,
      ...(worker.activity === undefined ? {} : { activity: worker.activity }),
      ...(worker.error === undefined ? {} : { error: worker.error }),
      ...(worker.startedAt === undefined ? {} : { startedAt: worker.startedAt }),
      ...(worker.endedAt === undefined ? {} : { endedAt: worker.endedAt }),
    })),
    ...(run.failure === undefined ? {} : { failure: { workerID: run.failure.workerID, reason: run.failure.reason } }),
    ...(run.handoff === undefined ? {} : { handoff: true }),
  };
}

/** Compact scale/health summary for the parent synthesis message; absent statuses are simply omitted. */
export function runStats(run: WorkflowRun, now = Date.now()): Record<string, unknown> {
  const workers: Record<string, number> = {};
  for (const worker of Object.values(run.workers)) workers[worker.status] = (workers[worker.status] ?? 0) + 1;
  return {
    workers,
    durationMs: Math.max(0, now - run.createdAt),
    tokens: Object.values(run.workers).reduce((sum, worker) => sum + (worker.tokens?.total ?? 0), 0),
    planVersion: run.planVersion,
    revisions: run.revisions.length,
  };
}

export function queuedSteering(worker: WorkerState): WorkerSteering[] { return worker.steering.filter((item) => item.status === "queued"); }

export function acceptWorkerSteering(run: WorkflowRun, workerID: string, text: string, createdAt: number, id: string = crypto.randomUUID()): WorkerSteering {
  const worker = run.workers[workerID];
  const existing = worker?.steering?.find((item) => item.id === id);
  if (existing) return existing;
  const item: WorkerSteering = { id, text, createdAt, status: "queued" };
  if (!worker || worker.status !== "running") {
    item.status = "rejected";
    item.finalizedAt = Date.now();
    item.error = "Worker is no longer steerable";
  }
  if (worker) worker.steering.push(item);
  return item;
}

export function steeringFollowUp(worker: WorkerState, now = Date.now()): { ids: string[]; prompt: string } | undefined {
  const pending = queuedSteering(worker);
  if (!pending.length) return;
  for (const item of pending) { item.status = "delivered"; item.deliveredAt = now; }
  return { ids: pending.map((item) => item.id), prompt: `Apply all of the following user guidance to the work, then return a complete replacement final result.\n\n${pending.map((item, index) => `${index + 1}. ${item.text}`).join("\n")}` };
}

export function finalizeDeliveredSteering(worker: WorkerState, ids: string[], now = Date.now()): void {
  const selected = new Set(ids);
  for (const item of worker.steering) if (selected.has(item.id)) { item.status = "finalized"; item.finalizedAt = now; }
}

export function requeueDeliveredSteering(worker: WorkerState, ids: string[]): void {
  const selected = new Set(ids);
  for (const item of worker.steering) if (selected.has(item.id) && item.status === "delivered") { item.status = "queued"; item.deliveredAt = undefined; }
}

export function workerTurnPrompt(hasResolvedTurn: boolean, turnInCycle: number, continuation: WorkerState["continuation"], followUp?: string, priorError?: string): string {
  if (followUp) return followUp;
  if (!hasResolvedTurn) return "original";
  if (continuation === "resume") return "Continue the interrupted work. Return the requested final result.";
  return priorError ? `Your prior attempt failed with this error:\n\n${priorError}\n\nCorrect the issue and return the requested final result.` : "Your prior attempt failed. Correct the issue and return the requested final result.";
}

export function compactWorkerFailures(workers: Record<string, WorkerState>): Array<{ id: string; status: WorkerState["status"]; error?: string }> {
  return Object.values(workers).filter((worker) => ["failed", "skipped", "aborted"].includes(worker.status)).map((worker) => ({ id: worker.id, status: worker.status, error: worker.error }));
}

export function acceptCoordinatorResult(run: Pick<WorkflowRun, "status" | "failure" | "error">): void {
  run.failure = undefined;
  if (run.status === "running") run.error = undefined;
}

export function finalizeSoftPause(run: Pick<WorkflowRun, "status">): boolean {
  if (run.status !== "soft_pausing") return false;
  run.status = "soft_paused";
  return true;
}

export function isPendingControlFilename(name: string): boolean {
  if (name.endsWith(".claimed") || name.endsWith(".tmp")) return false;
  return name.endsWith(".json") || /\.json\.[^.]+$/.test(name);
}

export function pendingWorkers(workers: WorkerSpec[], states: Record<string, WorkerState>): WorkerSpec[] {
  return workers.filter((worker) => states[worker.id]?.status === "pending" || states[worker.id]?.status === "interrupted");
}

export function promptResponseError(info: { error?: unknown }): void { if (info.error !== undefined) throw info.error; }

export function tokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return;
  const input = value as Record<string, unknown>;
  const cache = input.cache && typeof input.cache === "object" ? input.cache as Record<string, unknown> : {};
  const result = { input: Number(input.input ?? 0), output: Number(input.output ?? 0), reasoning: Number(input.reasoning ?? 0), cacheRead: Number(input.cacheRead ?? cache.read ?? 0), cacheWrite: Number(input.cacheWrite ?? cache.write ?? 0), total: 0 };
  result.total = result.input + result.output + result.reasoning;
  return result;
}

export function addTokenUsage(current: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined {
  if (!next) return current;
  return { input: (current?.input ?? 0) + next.input, output: (current?.output ?? 0) + next.output, reasoning: (current?.reasoning ?? 0) + next.reasoning, cacheRead: (current?.cacheRead ?? 0) + next.cacheRead, cacheWrite: (current?.cacheWrite ?? 0) + next.cacheWrite, total: (current?.total ?? 0) + next.total };
}

export function planDiff(before: PhaseSpec[], after: PhaseSpec[]): PlanDiffEntry[] {
  const flatten = (phases: PhaseSpec[]) => {
    let workerIndex = 0;
    return phases.flatMap((phase, phaseIndex) => [
      { node: "phase" as const, id: phase.id, index: phaseIndex, value: stableJson(phase) },
      ...phase.steps.flatMap((step) => (step.type === "worker" ? [step.worker] : step.workers).map((worker) => ({ node: "worker" as const, id: worker.id, index: workerIndex++, value: stableJson(worker) }))),
    ]);
  };
  const left = new Map(flatten(before).map((item) => [`${item.node}:${item.id}`, item]));
  const right = new Map(flatten(after).map((item) => [`${item.node}:${item.id}`, item]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return keys.flatMap((key): PlanDiffEntry[] => {
    const a = left.get(key), b = right.get(key);
    if (!a) return [{ kind: "added", node: b!.node, id: b!.id, after: b!.value }];
    if (!b) return [{ kind: "removed", node: a.node, id: a.id, before: a.value }];
    if (a.value !== b.value) return [{ kind: "changed", node: a.node, id: a.id, before: a.value, after: b.value }];
    if (a.index !== b.index) return [{ kind: "reordered", node: a.node, id: a.id, before: String(a.index), after: String(b.index) }];
    return [];
  });
}

export function validatePlanRevision(run: WorkflowRun, pending: unknown): PhaseSpec[] {
  const frozen = (phase: PhaseSpec) => run.completedPhases.includes(phase.id) || run.sealedPhases.includes(phase.id);
  const immutable = run.spec.phases.filter(frozen);
  const priorPending = run.spec.phases.filter((phase) => !frozen(phase));
  const candidate = checkWorkflowPlan({ ...run.spec, phases: [...immutable, ...tool.schema.array(WORKFLOW_SPEC_SCHEMA.shape.phases.element).parse(pending)], limits: { maxWorkers: run.limits.maxWorkers, maxRevisions: run.limits.maxRevisions, maxRunMs: run.limits.maxRunMs } }, undefined, undefined, run.limits);
  const immutableIDs = new Set(workerIDsInPhases(immutable));
  const historical = new Set(run.reservedWorkerIDs);
  const reusable = new Set(workerIDsInPhases(priorPending));
  for (const worker of workersInOrder(candidate)) if (!immutableIDs.has(worker.id) && historical.has(worker.id) && !reusable.has(worker.id)) throw new Error(`Worker id ${worker.id} was already used in plan history`);
  const allIDs = new Set([...historical, ...workerIDsInPhases(candidate.phases)]);
  if (allIDs.size > run.limits.maxWorkers) throw new Error(`Workflow history has ${allIDs.size} workers, exceeding maxWorkers ${run.limits.maxWorkers}`);
  const reusablePhases = new Set(priorPending.map((phase) => phase.id));
  const reservedPhases = new Set(run.reservedPhaseIDs);
  for (const phase of candidate.phases.slice(immutable.length)) if (reservedPhases.has(phase.id) && !reusablePhases.has(phase.id)) throw new Error(`Phase id ${phase.id} was already used in plan history`);
  return candidate.phases.slice(immutable.length);
}

export function sealActivePhase(run: WorkflowRun): void {
  const frontier = run.frontier;
  if (!frontier.phaseID || frontier.sealed) return;
  if (frontier.completedSteps === 0) return;
  const phase = run.spec.phases.find((item) => item.id === frontier.phaseID)!;
  for (const id of workerIDsInPhases([{ ...phase, steps: phase.steps.slice(frontier.completedSteps) }])) {
    if (run.workers[id]?.status === "pending") run.workers[id]!.status = "retired";
  }
  phase.steps = phase.steps.slice(0, frontier.completedSteps);
  frontier.sealed = true;
  frontier.generation++;
  if (!run.sealedPhases.includes(phase.id)) run.sealedPhases.push(phase.id);
}

export function reconcileRevisionWorkers(run: WorkflowRun, before: PhaseSpec[], after: PhaseSpec[]): void {
  const beforeIDs = new Set(workerIDsInPhases(before));
  const afterWorkers = workersInPhases(after);
  const afterIDs = new Set(afterWorkers.map((worker) => worker.id));
  for (const id of beforeIDs) if (!afterIDs.has(id) && run.workers[id]?.status === "pending") run.workers[id]!.status = "retired";
  for (const worker of afterWorkers) if (!run.workers[worker.id]) run.workers[worker.id] = { ...worker, status: "pending", steering: [] };
  run.reservedWorkerIDs = [...new Set([...run.reservedWorkerIDs, ...afterIDs])];
}

export function assertCoordinatorSource(run: WorkflowRun, operation: CoordinatorOperation): void {
  if (run.planVersion !== operation.sourcePlanVersion || run.frontier.generation !== operation.sourceFrontierGeneration) throw new Error("Coordinator source plan or execution frontier changed");
}

export function coordinatorRetryable(error: unknown, policyFailure = false): boolean {
  return !policyFailure && retryClassification(error) !== "none";
}

export function pendingCoordinationReason(run: WorkflowRun): "repair" | "plan_change" | undefined {
  if (run.failure?.kind === "repair") return "repair";
  if (run.failure) return undefined;
  if (run.pendingGuidance.length) return "plan_change";
}

export async function drainPendingCoordination(run: WorkflowRun, coordinate: (reason: "repair" | "plan_change") => Promise<boolean>): Promise<boolean> {
  while (true) {
    const reason = pendingCoordinationReason(run);
    if (!reason) return true;
    if (!await coordinate(reason)) return false;
  }
}

export function canContinueCoordinatorFailure(run: WorkflowRun): boolean {
  if (run.failure?.kind !== "repair") return true;
  return !Object.values(run.workers).some((worker) => worker.status === "skipped" && pendingTemplateDependency(run.spec, run.workers, worker.id));
}

export function stableJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") return Object.fromEntries(Object.keys(input as object).sort().map((key) => [key, normalize((input as Record<string, unknown>)[key])]));
    return input;
  };
  return JSON.stringify(normalize(value), null, 2);
}

export function renderTemplate(prompt: string, outputs: Record<string, unknown>): string {
  const literal = (value: string) => value.replaceAll("\\{{", "{{").replaceAll("\\}}", "}}");
  let result = "";
  let cursor = 0;
  for (const reference of templateReferences(prompt)) {
    result += literal(prompt.slice(cursor, reference.start));
    const { id, suffix } = reference;
    if (!(id in outputs)) throw new Error(`Template output ${id} is unavailable`);
    let value: unknown = outputs[id];
    for (const part of suffix.split(".").filter(Boolean)) {
      if (!value || typeof value !== "object" || !(part in (value as Record<string, unknown>))) throw new Error(`Template output ${id}${suffix} is unavailable`);
      value = (value as Record<string, unknown>)[part];
    }
    result += value && typeof value === "object" ? stableJson(value) : String(value ?? "");
    cursor = reference.end;
  }
  return result + literal(prompt.slice(cursor));
}

// OpenCode reports turn failures as NamedError objects shaped { name, data: { message, statusCode, isRetryable } },
// so the retryable fields live under data, not at the top level.
export function retryClassification(error: unknown): "transient" | "structured" | "none" {
  let text = String(error);
  if (error && typeof error === "object") {
    const input = error as { name?: unknown; message?: unknown; isRetryable?: unknown; status?: unknown; statusCode?: unknown; data?: unknown; error?: unknown };
    const data = (input.data && typeof input.data === "object" ? input.data : {}) as { message?: unknown; isRetryable?: unknown; status?: unknown; statusCode?: unknown };
    if (input.isRetryable === true || data.isRetryable === true) return "transient";
    const status = Number(input.status ?? input.statusCode ?? data.status ?? data.statusCode);
    if (status === 408 || status === 429 || status >= 500 && status <= 599) return "transient";
    if (status === 401 || status === 403) return "none";
    if (typeof input.name === "string") {
      if (/abort|cancel|permission|reject|denied|auth/i.test(input.name)) return "none";
      if (/structured|schema|json|malformed/i.test(input.name)) return "structured";
      if (/timeout|network|provider|runtime/i.test(input.name)) return "transient";
    }
    if (input.error && input.error !== error) return retryClassification(input.error);
    const described = data.message ?? input.message;
    text = error instanceof Error ? error.message : typeof described === "string" ? described : JSON.stringify(error);
  }
  const message = text.toLowerCase();
  if (/\babort|\bcancel|permission|denied|reject|workflow (?:stop|pause)/.test(message)) return "none";
  if (/structured|schema|json|malformed/.test(message)) return "structured";
  return /provider|runtime|timeout|timed out|network|fetch failed|econnreset|econnrefused|temporar|overload|rate limit|\b5\d\d\b/.test(message) ? "transient" : "none";
}

export function retryDelay(attemptNumber: number): number | undefined {
  return RETRY_DELAYS_MS[attemptNumber - 1];
}

export type RetryDecision = { kind: "interrupt" | "fail" } | { kind: "retry"; delayMs: number };

/**
 * The three-way outcome every retry loop shares: an interrupted run keeps its session for resume, an
 * unretryable or exhausted error is terminal, anything else waits out a backoff. Callers keep their own
 * bookkeeping — worker state, handoff attempts and coordinator operations record attempts differently.
 */
export function retryDecision(error: unknown, retriesSoFar: number, interrupted: boolean): RetryDecision {
  if (interrupted) return { kind: "interrupt" };
  const delayMs = retryClassification(error) === "none" ? undefined : retryDelay(retriesSoFar + 1);
  return delayMs === undefined ? { kind: "fail" } : { kind: "retry", delayMs };
}

/**
 * Starts an attempt record. A turn whose message ID was never resolved is reused so a resumed run
 * continues that same turn instead of opening a duplicate one.
 */
export function beginAttempt(attempts: WorkerAttempt[], kind: "creation" | "turn"): WorkerAttempt {
  const last = attempts.at(-1);
  const attempt: WorkerAttempt = { number: attempts.length + 1, kind, startedAt: Date.now() };
  if (kind === "turn") attempt.messageID = last?.kind === "turn" && !last.result ? last.messageID : workflowMessageID();
  attempts.push(attempt);
  return attempt;
}

export function pendingTemplateDependency(spec: WorkflowSpec, workers: Record<string, WorkerState>, skippedWorkerID: string): string | undefined {
  for (const worker of workersInOrder(spec)) {
    if (workers[worker.id]?.status === "pending" && templateDependencies(worker.prompt).includes(skippedWorkerID)) return worker.id;
  }
}

export function isLeaseStale(lease: Pick<WorkflowLease, "heartbeatAt">, now = Date.now()): boolean {
  return now - lease.heartbeatAt > LEASE_STALE_MS;
}

export function replacementControlDecision(observed: { token?: string; generation?: number }, current?: { token: string; generation: number; heartbeatAt: number }, now = Date.now()): "stop_owner" | "start" | "reject" {
  if (!current || isLeaseStale(current, now)) return "start";
  return current.token === observed.token && current.generation === observed.generation ? "stop_owner" : "reject";
}

const RESUMABLE = new Set<WorkflowStatus>(["interrupted", "soft_paused", "hard_paused", "stopped"]);
const CONTROLLABLE = new Set<WorkflowStatus>(["running", "soft_pausing", "soft_paused", "hard_pausing", "hard_paused", "stopping", "blocked", "repair_required"]);
const ACCEPTS_PLAN_CHANGE = new Set<WorkflowStatus>(["running", "soft_pausing", "soft_paused", "hard_paused", "blocked", "repair_required"]);

/** Can be restarted from persisted state through the resume control. */
export function isResumable(status: WorkflowStatus): boolean { return RESUMABLE.has(status); }
/** Owns or wants the project lease, so stop/pause controls apply. */
export function isControllable(status: WorkflowStatus): boolean { return CONTROLLABLE.has(status); }
/** Has pending work a coordinator revision could still change. */
export function acceptsPlanChange(status: WorkflowStatus): boolean { return ACCEPTS_PLAN_CHANGE.has(status); }

export function isWorkflowControlAction(value: unknown): value is WorkflowControlAction {
  return typeof value === "string" && ["approve", "queue", "replace", "reject", "soft_pause", "hard_pause", "resume", "stop", "discard", "parent_deleted", "failure_retry", "failure_skip", "failure_stop", "plan_change", "coordinator_retry", "coordinator_continue", "steer"].includes(value);
}

export function quiescenceStatus(action: "hard_pause" | "stop", quiesced: boolean): WorkflowStatus {
  return action === "hard_pause" ? quiesced ? "hard_paused" : "hard_pausing" : quiesced ? "stopped" : "stopping";
}

export function failureDecisionStatus(action: "retry" | "skip", hasDependent: boolean): WorkflowStatus {
  return action === "skip" && hasDependent ? "repair_required" : "soft_paused";
}

// OpenCode derives the current user/assistant message by max ID and exits its prompt loop only when
// lastUser.id < lastAssistant.id, so message IDs must keep its ascending encoding: 6 bytes of
// (milliseconds << 12 | counter) as hex, then 14 random base62 characters.
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let messageTimestamp = 0;
let messageCounter = 0;

export function workflowMessageID(now = Date.now()): string {
  if (now !== messageTimestamp) {
    messageTimestamp = now;
    messageCounter = 0;
  }
  messageCounter++;
  const value = BigInt(now) * 0x1000n + BigInt(messageCounter);
  const time = Array.from({ length: 6 }, (_, index) => Number((value >> BigInt(40 - 8 * index)) & 0xffn).toString(16).padStart(2, "0")).join("");
  const random = Array.from(crypto.getRandomValues(new Uint8Array(14)), (byte) => BASE62[byte % 62]).join("");
  return `msg_${time}${random}`;
}

export type WorkflowChild = { id: string; metadata?: Record<string, unknown> };

export function selectWorkflowChild(children: WorkflowChild[], runID: string, workerID?: string): WorkflowChild | undefined {
  return children.find((child) => child.metadata?.workflowRunID === runID && (workerID ? child.metadata.workflowWorkerID === workerID : child.metadata.workflowHandoff === true));
}

export function selectCoordinatorOperationChild(children: WorkflowChild[], runID: string, operationID: string): WorkflowChild | undefined {
  return children.find((child) => child.metadata?.workflowRunID === runID && child.metadata.workflowCoordinatorOperationID === operationID);
}

export function assertLeaseOwnership(owns: boolean): void {
  if (!owns) throw new Error("Workflow lease ownership lost before external side effect");
}

export function workflowProjectDirectory(projectID: string, directory: string): string {
  const projectKey = projectID === "global" ? `global-${Bun.hash.wyhash(resolve(directory)).toString(16)}` : projectID.replace(/[^a-zA-Z0-9._-]/g, "-");
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "workflows", projectKey);
}

export function runDirectory(root: string, runID: string): string { return join(root, "runs", runID); }
export function statePath(root: string, runID: string): string { return join(runDirectory(root, runID), "state.json"); }
export function eventPath(root: string, runID: string): string { return join(runDirectory(root, runID), "events.ndjson"); }
export function controlDirectory(root: string): string { return join(root, "controls"); }

export function isTerminal(status: WorkflowRun["status"]): boolean {
  return status === "completed" || status === "rejected" || status === "failed" || status === "aborted";
}

const RETAINABLE = new Set<WorkflowStatus>(["completed", "rejected", "failed", "aborted"]);
export function retentionCandidates(runs: WorkflowRun[], retentionRuns: number, retentionDays: number, now = Date.now()): WorkflowRun[] {
  const terminal = runs.filter((run) => RETAINABLE.has(run.status)).sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return terminal.filter((run, index) => index >= retentionRuns || (run.terminalAt ?? run.updatedAt) <= cutoff);
}

export function ownedChildSessionIDs(run: WorkflowRun, children: WorkflowChild[]): string[] {
  const ids = new Set<string>();
  for (const worker of Object.values(run.workers)) if (worker.childSessionID) ids.add(worker.childSessionID);
  if (run.handoffSessionID) ids.add(run.handoffSessionID);
  for (const operation of run.coordinatorOperations) if (operation.sessionID) ids.add(operation.sessionID);
  for (const child of children) if (child.metadata?.workflowRunID === run.id) ids.add(child.id);
  ids.delete(run.parentSessionID);
  return [...ids].sort();
}

export function tuiPresenceFresh(value: unknown, now = Date.now()): boolean {
  if (!value || typeof value !== "object" || typeof (value as { heartbeatAt?: unknown }).heartbeatAt !== "number") return false;
  const age = now - Number((value as { heartbeatAt: number }).heartbeatAt);
  return age >= -1_000 && age <= TUI_PRESENCE_STALE_MS;
}
export function tuiPresencePath(root: string): string { return join(root, "tui-presence.json"); }
export function startupActions(run: WorkflowRun): Array<"resume" | "open" | "later" | "discard"> { return run.status === "interrupted" ? ["resume", "open", "later", "discard"] : []; }
export function canDiscardRun(run: WorkflowRun): boolean { return run.status === "interrupted" || run.status === "stopped" || isTerminal(run.status); }
export function abortForParentDeletion(run: WorkflowRun): boolean {
  if (isTerminal(run.status)) return false;
  run.status = "aborted";
  run.terminalAt ??= Date.now();
  run.error = "Originating parent session was deleted";
  return true;
}

export function sessionAlreadyDeleted(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object") {
    const item = error as { status?: unknown; statusCode?: unknown; name?: unknown; error?: unknown };
    if (Number(item.status ?? item.statusCode) === 404 || typeof item.name === "string" && /not.?found/i.test(item.name)) return true;
    if (item.error && item.error !== error) return sessionAlreadyDeleted(item.error);
  }
  return /session.*not.?found|not.?found.*session/i.test(error instanceof Error ? error.message : String(error));
}

export function pendingChildCleanup(ids: string[], deleted: string[]): string[] {
  const completed = new Set(deleted);
  return ids.filter((id) => !completed.has(id));
}

export function parentDeletionRoute(local: { token: string; generation: number } | undefined, current: WorkflowLease & { token: string; generation: number } | undefined, now = Date.now()): "handle" | "acquire" | { targetOwner: string; leaseToken: string; leaseGeneration: number } {
  if (local && current && local.token === current.token && local.generation === current.generation && !isLeaseStale(current, now)) return "handle";
  if (current && !isLeaseStale(current, now)) return { targetOwner: current.ownerIdentity, leaseToken: current.token, leaseGeneration: current.generation };
  return "acquire";
}
