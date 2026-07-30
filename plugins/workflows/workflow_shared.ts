import { homedir } from "node:os";
import { join, resolve } from "node:path";

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
  steering?: WorkerSteering[];
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
  planVersion?: number;
  planHistory?: Array<{ version: number; phases: PhaseSpec[] }>;
  revisions?: PlanRevision[];
  completedPhases?: string[];
  checkpointOccurrences?: Record<string, string>;
  consumedCheckpoints?: string[];
  pendingGuidance?: WorkflowGuidance[];
  guidanceGeneration?: number;
  frontier?: ExecutionFrontier;
  sealedPhases?: string[];
  coordinator?: CoordinatorState;
  coordinatorOperations?: CoordinatorOperation[];
  reservedWorkerIDs?: string[];
  reservedPhaseIDs?: string[];
  controlErrors?: Array<{ id: string; action: WorkflowControlAction; createdAt: number; rejectedAt: number; error: string; workerID?: string }>;
};
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

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TEMPLATE_REFERENCE = /^\s*workers\.([A-Za-z][A-Za-z0-9_-]{0,63})\.output((?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\s*$/;
export const DEFAULT_LIMITS: WorkflowLimits = { maxWorkers: 100, maxRevisions: 10, maxRunMs: 6 * 60 * 60 * 1000, maxConcurrency: 2 };
export const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 40_000] as const;
export const LEASE_HEARTBEAT_MS = 5_000;
export const LEASE_STALE_MS = 15_000;
export const TUI_PRESENCE_STALE_MS = 5_000;
export type WorkflowOptions = { retentionRuns: number; retentionDays: number; maxWorkers: number; maxRevisions: number; maxRunMs: number; maxConcurrency: number; coordinatorInputBytes: number };

export function normalizeWorkflowOptions(value: Record<string, unknown> | undefined = {}): WorkflowOptions {
  value ??= {};
  const integer = (key: string, fallback: number) => {
    const item = value[key];
    if (item === undefined) return fallback;
    if (!Number.isInteger(item) || Number(item) < 1) throw new Error(`workflows.${key} must be a positive integer`);
    return Number(item);
  };
  return { retentionRuns: integer("retention_runs", 10000), retentionDays: integer("retention_days", 99999999), maxWorkers: integer("max_workers", 100), maxRevisions: integer("max_revisions", 10), maxRunMs: integer("max_run_ms", 6 * 60 * 60 * 1000), maxConcurrency: integer("max_concurrency", 2), coordinatorInputBytes: integer("coordinator_input_bytes", 256 * 1024) };
}

export function workflowCeilings(options: WorkflowOptions): WorkflowLimits { return { maxWorkers: options.maxWorkers, maxRevisions: options.maxRevisions, maxRunMs: options.maxRunMs, maxConcurrency: options.maxConcurrency }; }

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function modelID(value: unknown, name: string): string {
  const result = text(value, name);
  if (!/^[^\s/]+\/\S+$/.test(result)) throw new Error(`${name} must be a "providerID/modelID" string such as "openai/gpt-1.0" or "anthropic/claude-sonnet-1.0"`);
  return result;
}

export function parseModelID(value: string): ModelRef {
  const separator = value.indexOf("/");
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function identifier(value: unknown, name: string): string {
  const result = text(value, name);
  if (!ID.test(result)) throw new Error(`${name} must use letters, numbers, _ or - and begin with a letter`);
  return result;
}

function limit(value: unknown, name: string, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value as number;
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

function worker(value: unknown, name: string, allowedAgents: Set<string>, registeredModels: ReadonlySet<string> | undefined, known: Set<string>, ids: Set<string>): WorkerSpec {
  const input = object(value, name);
  const id = identifier(input.id, `${name}.id`);
  if (ids.has(id)) throw new Error(`Worker id ${id} is not globally unique`);
  const agent = input.agent === undefined ? "general" : identifier(input.agent, `${name}.agent`);
  if (!allowedAgents.has(agent)) throw new Error(`Worker ${id} uses agent ${agent} outside allowedAgents`);
  const prompt = text(input.prompt, `${name}.prompt`);
  for (const dependency of templateDependencies(prompt)) {
    if (!known.has(dependency)) throw new Error(`Worker ${id} references missing, forward, or sibling worker ${dependency}`);
  }
  let selectedModel: string | undefined;
  if (input.modelID !== undefined) {
    selectedModel = modelID(input.modelID, `${name}.modelID`);
    if (registeredModels && !registeredModels.has(selectedModel)) throw new Error(`Worker ${id} uses unavailable model "${selectedModel}"`);
  }
  if (input.variant !== undefined && typeof input.variant !== "string") throw new Error(`${name}.variant must be a string`);
  if (input.schema !== undefined) object(input.schema, `${name}.schema`);
  ids.add(id);
  return {
    id,
    label: text(input.label, `${name}.label`),
    agent,
    ...(selectedModel ? { modelID: selectedModel } : {}),
    ...(input.variant === undefined ? {} : { variant: input.variant as string }),
    prompt,
    ...(input.schema === undefined ? {} : { schema: input.schema as Record<string, unknown> }),
  };
}

export function validateWorkflowSpec(value: unknown, registeredAgents?: ReadonlySet<string>, registeredModels?: ReadonlySet<string>, ceilings: WorkflowLimits = DEFAULT_LIMITS): WorkflowSpec {
  const input = object(value, "workflow");
  if (input.version !== 1) throw new Error("workflow.version must be 1");
  const allowedAgents = array(input.allowedAgents, "workflow.allowedAgents").map((item, index) => identifier(item, `workflow.allowedAgents[${index}]`));
  if (allowedAgents.length === 0 || new Set(allowedAgents).size !== allowedAgents.length) throw new Error("workflow.allowedAgents must contain unique agents");
  const unregisteredAgent = registeredAgents ? allowedAgents.find((agent) => !registeredAgents.has(agent)) : undefined;
  if (unregisteredAgent !== undefined) throw new Error(`workflow.allowedAgents contains unregistered agent "${unregisteredAgent}"`);
  const limitsInput = input.limits === undefined ? {} : object(input.limits, "workflow.limits");
  const limits = {
    maxWorkers: limit(limitsInput.maxWorkers, "workflow.limits.maxWorkers", ceilings.maxWorkers, ceilings.maxWorkers),
    maxRevisions: limit(limitsInput.maxRevisions, "workflow.limits.maxRevisions", ceilings.maxRevisions, ceilings.maxRevisions),
    maxRunMs: limit(limitsInput.maxRunMs, "workflow.limits.maxRunMs", ceilings.maxRunMs, ceilings.maxRunMs),
  };
  const allowedAgentSet = new Set(allowedAgents);
  const ids = new Set<string>();
  const known = new Set<string>();
  const phaseIDs = new Set<string>();
  const phases = array(input.phases, "workflow.phases").map((phaseValue, phaseIndex) => {
    const phase = object(phaseValue, `workflow.phases[${phaseIndex}]`);
    const id = identifier(phase.id, `workflow.phases[${phaseIndex}].id`);
    if (phaseIDs.has(id)) throw new Error(`Phase id ${id} is not unique`);
    phaseIDs.add(id);
    if (phase.checkpoint !== undefined && typeof phase.checkpoint !== "boolean") throw new Error(`workflow.phases[${phaseIndex}].checkpoint must be a boolean`);
    const groupIDs = new Set<string>();
    const steps = array(phase.steps, `workflow.phases[${phaseIndex}].steps`).map((stepValue, stepIndex) => {
      const step = object(stepValue, `workflow.phases[${phaseIndex}].steps[${stepIndex}]`);
      const name = `workflow.phases[${phaseIndex}].steps[${stepIndex}]`;
      if (step.type === "worker") {
        const result = { type: "worker" as const, worker: worker(step.worker, `${name}.worker`, allowedAgentSet, registeredModels, known, ids) };
        known.add(result.worker.id);
        return result;
      }
      if (step.type !== "parallel") throw new Error(`${name}.type must be worker or parallel`);
      const groupID = identifier(step.id, `${name}.id`);
      if (groupIDs.has(groupID)) throw new Error(`Parallel group id ${groupID} is not unique in phase ${id}`);
      groupIDs.add(groupID);
      const workers = array(step.workers, `${name}.workers`).map((item, workerIndex) =>
        worker(item, `${name}.workers[${workerIndex}]`, allowedAgentSet, registeredModels, known, ids),
      );
      if (workers.length === 0) throw new Error(`${name}.workers must not be empty`);
      for (const item of workers) known.add(item.id);
      return { type: "parallel" as const, id: groupID, ...(step.title === undefined ? {} : { title: text(step.title, `${name}.title`) }), workers };
    });
    if (steps.length === 0) throw new Error(`workflow.phases[${phaseIndex}].steps must not be empty`);
    return { id, title: text(phase.title, `workflow.phases[${phaseIndex}].title`), ...(phase.checkpoint === true ? { checkpoint: true } : {}), steps };
  });
  if (phases.length === 0) throw new Error("workflow.phases must not be empty");
  if (ids.size > limits.maxWorkers) throw new Error(`Workflow has ${ids.size} workers, exceeding maxWorkers ${limits.maxWorkers}`);
  return {
    version: 1,
    name: text(input.name, "workflow.name"),
    description: text(input.description, "workflow.description"),
    goal: text(input.goal, "workflow.goal"),
    allowedAgents,
    phases,
    limits,
  };
}

export function effectiveLimits(spec: WorkflowSpec, maxConcurrency: number = DEFAULT_LIMITS.maxConcurrency): WorkflowLimits {
  return { ...DEFAULT_LIMITS, ...spec.limits, maxConcurrency };
}

export function workersInOrder(spec: WorkflowSpec): WorkerSpec[] {
  return spec.phases.flatMap((phase) => phase.steps.flatMap((step) => step.type === "worker" ? [step.worker] : step.workers));
}

export function currentPlanWorkerIDs(run: WorkflowRun): string[] {
  return workersInOrder(run.spec).map((worker) => worker.id);
}

export function currentPlanProgress(run: WorkflowRun): { completed: number; total: number; running: number } {
  const ids = currentPlanWorkerIDs(run);
  return { completed: ids.filter((id) => run.workers[id]?.status === "completed").length, total: ids.length, running: ids.filter((id) => run.workers[id]?.status === "running").length };
}

export function queuedSteering(worker: WorkerState): WorkerSteering[] { return (worker.steering ?? []).filter((item) => item.status === "queued"); }

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
  if (worker) { worker.steering ??= []; worker.steering.push(item); }
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
  for (const item of worker.steering ?? []) if (selected.has(item.id)) { item.status = "finalized"; item.finalizedAt = now; }
}

export function requeueDeliveredSteering(worker: WorkerState, ids: string[]): void {
  const selected = new Set(ids);
  for (const item of worker.steering ?? []) if (selected.has(item.id) && item.status === "delivered") { item.status = "queued"; item.deliveredAt = undefined; }
}

export function workerTurnPrompt(hasResolvedTurn: boolean, turnInCycle: number, continuation: WorkerState["continuation"], followUp?: string): string {
  if (followUp) return followUp;
  if (!hasResolvedTurn) return "original";
  if (continuation === "resume") return "Continue the interrupted work. Return the requested final result.";
  return "Your prior attempt failed. Correct the issue and return the requested final result.";
}

export function utf8Prefix(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= maxBytes) return value;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let length = Math.max(0, maxBytes); length >= 0; length--) {
    try { return decoder.decode(bytes.subarray(0, length)); } catch {}
  }
  return "";
}

export function compactWorkerFailures(workers: Record<string, WorkerState>): Array<{ id: string; status: WorkerState["status"]; error?: string }> {
  return Object.values(workers).filter((worker) => ["failed", "skipped", "aborted"].includes(worker.status)).map((worker) => ({ id: worker.id, status: worker.status, ...(worker.error === undefined ? {} : { error: utf8Prefix(worker.error, 2_048) }) }));
}

export function coordinatorInput(payload: { outputs: Array<{ id: string; output: string }> }, outputs: Array<{ id: string; output: string }>, maxBytes: number): string | undefined {
  if (Buffer.byteLength(JSON.stringify(payload)) > maxBytes) return;
  for (const output of outputs) {
    let low = 0, high = Buffer.byteLength(output.output);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = { id: output.id, output: utf8Prefix(output.output, middle) };
      payload.outputs.push(candidate);
      const fits = Buffer.byteLength(JSON.stringify(payload)) <= maxBytes;
      payload.outputs.pop();
      if (fits) low = middle;
      else high = middle - 1;
    }
    const candidate = { id: output.id, output: utf8Prefix(output.output, low) };
    payload.outputs.push(candidate);
    if (Buffer.byteLength(JSON.stringify(payload)) > maxBytes) payload.outputs.pop();
  }
  return JSON.stringify(payload);
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

export function pendingWorkerBatches(workers: WorkerSpec[], states: Record<string, WorkerState>, concurrency: number): WorkerSpec[][] {
  const pending = workers.filter((worker) => states[worker.id]?.status === "pending" || states[worker.id]?.status === "interrupted");
  return Array.from({ length: Math.ceil(pending.length / concurrency) }, (_, index) => pending.slice(index * concurrency, index * concurrency + concurrency));
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
  if ((run.revisions?.length ?? 0) >= run.limits.maxRevisions) throw new Error(`Workflow reached maxRevisions ${run.limits.maxRevisions}`);
  const immutable = run.spec.phases.filter((phase) => run.completedPhases?.includes(phase.id) || run.sealedPhases?.includes(phase.id));
  const priorPending = run.spec.phases.filter((phase) => !run.completedPhases?.includes(phase.id) && !run.sealedPhases?.includes(phase.id));
  const candidate = validateWorkflowSpec({ ...run.spec, phases: [...immutable, ...(pending as PhaseSpec[])], limits: { maxWorkers: run.limits.maxWorkers, maxRevisions: run.limits.maxRevisions, maxRunMs: run.limits.maxRunMs } });
  const immutableIDs = new Set(immutable.flatMap((phase) => phase.steps.flatMap((step) => step.type === "worker" ? [step.worker.id] : step.workers.map((worker) => worker.id))));
  const historical = new Set(run.reservedWorkerIDs ?? Object.keys(run.workers));
  const reusable = new Set(priorPending.flatMap((phase) => phase.steps.flatMap((step) => step.type === "worker" ? [step.worker.id] : step.workers.map((worker) => worker.id))));
  for (const worker of workersInOrder(candidate)) if (!immutableIDs.has(worker.id) && historical.has(worker.id) && !reusable.has(worker.id)) throw new Error(`Worker id ${worker.id} was already used in plan history`);
  const allIDs = new Set([...historical, ...workersInOrder(candidate).map((worker) => worker.id)]);
  if (allIDs.size > run.limits.maxWorkers) throw new Error(`Workflow history has ${allIDs.size} workers, exceeding maxWorkers ${run.limits.maxWorkers}`);
  const reusablePhases = new Set(priorPending.map((phase) => phase.id));
  const reservedPhases = new Set(run.reservedPhaseIDs ?? run.spec.phases.map((phase) => phase.id));
  for (const phase of candidate.phases.slice(immutable.length)) if (reservedPhases.has(phase.id) && !reusablePhases.has(phase.id)) throw new Error(`Phase id ${phase.id} was already used in plan history`);
  if (candidate.allowedAgents.some((agent) => !run.spec.allowedAgents.includes(agent))) throw new Error("Revision expands allowedAgents");
  return candidate.phases.slice(immutable.length);
}

export function sealActivePhase(run: WorkflowRun): void {
  const frontier = run.frontier;
  if (!frontier?.phaseID || frontier.sealed) return;
  if (frontier.completedSteps === 0) return;
  initializePlanHistory(run, run.spec.phases);
  const phase = run.spec.phases.find((item) => item.id === frontier.phaseID)!;
  const removed = phase.steps.slice(frontier.completedSteps).flatMap((step) => step.type === "worker" ? [step.worker.id] : step.workers.map((worker) => worker.id));
  for (const id of removed) if (run.workers[id]?.status === "pending") run.workers[id]!.status = "retired";
  phase.steps = phase.steps.slice(0, frontier.completedSteps);
  frontier.sealed = true;
  frontier.generation++;
  run.sealedPhases ??= [];
  if (!run.sealedPhases.includes(phase.id)) run.sealedPhases.push(phase.id);
}

export function reconcileRevisionWorkers(run: WorkflowRun, before: PhaseSpec[], after: PhaseSpec[]): void {
  const beforeIDs = new Set(before.flatMap((phase) => phase.steps.flatMap((step) => step.type === "worker" ? [step.worker.id] : step.workers.map((worker) => worker.id))));
  const afterWorkers = after.flatMap((phase) => phase.steps.flatMap((step) => step.type === "worker" ? [step.worker] : step.workers));
  const afterIDs = new Set(afterWorkers.map((worker) => worker.id));
  for (const id of beforeIDs) if (!afterIDs.has(id) && run.workers[id]?.status === "pending") run.workers[id]!.status = "retired";
  for (const worker of afterWorkers) if (!run.workers[worker.id]) run.workers[worker.id] = { ...worker, status: "pending" };
  run.reservedWorkerIDs = [...new Set([...(run.reservedWorkerIDs ?? Object.keys(run.workers)), ...afterIDs])];
}

export function assertCoordinatorSource(run: WorkflowRun, operation: CoordinatorOperation): void {
  if ((run.planVersion ?? 1) !== operation.sourcePlanVersion || (run.frontier?.generation ?? 0) !== operation.sourceFrontierGeneration) throw new Error("Coordinator source plan or execution frontier changed");
}

export function initializePlanHistory(run: WorkflowRun, before: PhaseSpec[]): void {
  run.planVersion ??= 1;
  run.planHistory ??= [{ version: 1, phases: structuredClone(before) }];
}

export function coordinatorRetryable(error: unknown, policyFailure = false): boolean {
  return !policyFailure && retryClassification(error) !== "none";
}

export function pendingCoordinationReason(run: WorkflowRun): "repair" | "plan_change" | undefined {
  if (run.failure?.kind === "repair") return "repair";
  if (run.failure) return undefined;
  if (run.pendingGuidance?.length) return "plan_change";
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

export function pendingTemplateDependency(spec: WorkflowSpec, workers: Record<string, WorkerState>, skippedWorkerID: string): string | undefined {
  for (const worker of workersInOrder(spec)) {
    if (workers[worker.id]?.status === "pending" && templateDependencies(worker.prompt).includes(skippedWorkerID)) return worker.id;
  }
}

export function isLeaseStale(lease: Pick<WorkflowLease, "heartbeatAt">, now = Date.now()): boolean {
  return now - lease.heartbeatAt > LEASE_STALE_MS;
}

export function nextQueuedRun(runs: Iterable<WorkflowRun>): WorkflowRun | undefined {
  return [...runs].filter((run) => run.status === "queued").sort((left, right) => Number(right.replacement) - Number(left.replacement) || left.createdAt - right.createdAt || left.id.localeCompare(right.id))[0];
}

export function replacementControlDecision(observed: { token?: string; generation?: number }, current?: { token: string; generation: number; heartbeatAt: number }, now = Date.now()): "stop_owner" | "start" | "reject" {
  if (!current || isLeaseStale(current, now)) return "start";
  return current.token === observed.token && current.generation === observed.generation ? "stop_owner" : "reject";
}

export function pausesScheduling(status: WorkflowStatus): boolean {
  return status === "soft_pausing" || status === "soft_paused" || status === "hard_pausing" || status === "hard_paused" || status === "stopping" || status === "blocked" || status === "repair_required" || status === "stopped" || status === "interrupted";
}

export function shouldScheduleNextParallelBatch(status: WorkflowStatus, batchFailed: boolean): boolean {
  return status === "running" && !batchFailed;
}

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

export function selectCoordinatorChild(children: WorkflowChild[], runID: string): WorkflowChild | undefined {
  return children.find((child) => child.metadata?.workflowRunID === runID && child.metadata.workflowCoordinator === true);
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
export function leasePath(root: string): string { return join(root, "lease.json"); }

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
  for (const operation of run.coordinatorOperations ?? []) if (operation.sessionID) ids.add(operation.sessionID);
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

export function validateJsonSchema(schema: Record<string, unknown>, value: unknown, path = "output"): void {
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  const valid = types.length === 0 || types.some((type) =>
    type === "object" ? !!value && typeof value === "object" && !Array.isArray(value) :
    type === "array" ? Array.isArray(value) : type === "string" ? typeof value === "string" :
    type === "number" ? typeof value === "number" : type === "integer" ? Number.isInteger(value) :
    type === "boolean" ? typeof value === "boolean" : type === "null" ? value === null : false,
  );
  if (!valid) throw new Error(`${path} does not match schema type`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => stableJson(item) === stableJson(value))) throw new Error(`${path} is not an allowed value`);
  if ((schema.type === "object" || schema.properties || schema.required || schema.additionalProperties !== undefined) && value && typeof value === "object" && !Array.isArray(value)) {
    const input = value as Record<string, unknown>;
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, Record<string, unknown>> : {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) if (typeof key === "string" && !(key in input)) throw new Error(`${path}.${key} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(input)) if (!(key in properties)) throw new Error(`${path}.${key} is not allowed`);
    for (const [key, child] of Object.entries(properties)) if (key in input) validateJsonSchema(child, input[key], `${path}.${key}`);
  }
  if ((schema.type === "array" || schema.items) && Array.isArray(value) && schema.items && typeof schema.items === "object") {
    value.forEach((item, index) => validateJsonSchema(schema.items as Record<string, unknown>, item, `${path}[${index}]`));
  }
}
