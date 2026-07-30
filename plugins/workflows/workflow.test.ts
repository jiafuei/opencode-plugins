import { describe, expect, test } from "bun:test";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import {
  DEFAULT_LIMITS,
  effectiveLimits,
  drainPendingCoordination,
  eventPath,
  failureDecisionStatus,
  isLeaseStale,
  isTerminal,
  isWorkflowControlAction,
  nextQueuedRun,
  pausesScheduling,
  planDiff,
  reconcileRevisionWorkers,
  sealActivePhase,
  selectCoordinatorOperationChild,
  assertCoordinatorSource,
  assertLeaseOwnership,
  coordinatorRetryable,
  currentPlanWorkerIDs,
  initializePlanHistory,
  pendingCoordinationReason,
  pendingTemplateDependency,
  quiescenceStatus,
  renderTemplate,
  retryClassification,
  retryDelay,
  shouldScheduleNextParallelBatch,
  selectWorkflowChild,
  stableJson,
  statePath,
  validateWorkflowSpec,
  validateJsonSchema,
  validatePlanRevision,
  canContinueCoordinatorFailure,
  type CoordinatorOperation,
  type ParallelStep,
  type PhaseSpec,
  type WorkerState,
  type WorkerStep,
  type WorkflowRun,
  type WorkflowSpec,
  type WorkflowStatus,
  workflowMessageID,
  workersInOrder,
  acceptWorkerSteering,
  currentPlanProgress,
  finalizeDeliveredSteering,
  queuedSteering,
  steeringFollowUp,
  tokenUsage,
  workerTurnPrompt,
  promptResponseError,
  requeueDeliveredSteering,
  replacementControlDecision,
  abortForParentDeletion,
  canDiscardRun,
  normalizeWorkflowOptions,
  ownedChildSessionIDs,
  retentionCandidates,
  startupActions,
  tuiPresenceFresh,
  workflowCeilings,
  pendingChildCleanup,
  sessionAlreadyDeleted,
  parentDeletionRoute,
  acceptCoordinatorResult,
  compactWorkerFailures,
  coordinatorInput,
  finalizeSoftPause,
  isPendingControlFilename,
  pendingWorkerBatches,
  utf8Prefix,
  workflowProjectDirectory,
} from "./workflow_shared.ts";
import { WorkflowCoordination } from "./workflow_coordination.ts";
import workflowTui, { failureControlActions, inspectorControlActions, promptRightRun, transcriptReturn, transcriptSelection } from "./workflow_tui.tsx";

const agents = new Set(["build", "explore"]);
const models = new Set(["openai/gpt-5"]);
type FixturePhase = Omit<PhaseSpec, "steps"> & { steps: [WorkerStep, ParallelStep] | [] };
const base: Omit<WorkflowSpec, "phases"> & { phases: [FixturePhase] | [] } = {
  version: 1,
  name: "Review",
  description: "Review a change",
  goal: "Find issues",
  allowedAgents: ["build", "explore"],
  phases: [{
    id: "review",
    title: "Review",
    steps: [
      { type: "worker", worker: { id: "scan", label: "Scan", agent: "explore", prompt: "Inspect the repository" } },
      { type: "parallel", id: "checks", workers: [
        { id: "audit", label: "Audit", agent: "build", modelID: "openai/gpt-5", prompt: "Use {{workers.scan.output.findings}}" },
        { id: "test", label: "Test", agent: "build", prompt: "Test {{workers.scan.output}}" },
      ] },
    ],
  }],
};

describe("workflow spec", () => {
  test("normalizes valid deterministic work", () => {
    const spec = validateWorkflowSpec(base, agents, models);
    expect(spec.limits).toEqual({ maxWorkers: DEFAULT_LIMITS.maxWorkers, maxRevisions: DEFAULT_LIMITS.maxRevisions, maxRunMs: DEFAULT_LIMITS.maxRunMs });
    expect(workersInOrder(spec).map((worker) => worker.id)).toEqual(["scan", "audit", "test"]);
    expect(effectiveLimits(spec).maxConcurrency).toBe(2);
    expect(effectiveLimits(spec, 4).maxConcurrency).toBe(4);
  });

  test("defaults workers to general and preserves model configuration", () => {
    const input = structuredClone(base);
    input.allowedAgents.push("general");
    delete (input.phases[0]!.steps[0]!.worker as { agent?: string }).agent;
    input.phases[0]!.steps[0]!.worker.modelID = "openai/gpt-5";
    input.phases[0]!.steps[0]!.worker.variant = "high";
    const spec = validateWorkflowSpec(input, new Set([...agents, "general"]), models);
    expect((spec.phases[0]!.steps[0] as WorkerStep).worker).toMatchObject({ agent: "general", modelID: "openai/gpt-5", variant: "high" });

    input.allowedAgents = ["build", "explore"];
    expect(() => validateWorkflowSpec(input, new Set([...agents, "general"]), models)).toThrow("general outside allowedAgents");
  });

  test("rejects invalid worker model and variant configuration", () => {
    const unavailableModel = structuredClone(base);
    unavailableModel.phases[0]!.steps[0]!.worker.modelID = "other/model";
    expect(() => validateWorkflowSpec(unavailableModel, agents, models)).toThrow("unavailable model");
    const malformedModel = structuredClone(base);
    malformedModel.phases[0]!.steps[0]!.worker.modelID = "gpt-5";
    expect(() => validateWorkflowSpec(malformedModel, agents, models)).toThrow('"providerID/modelID"');
    const invalidVariant = structuredClone(base);
    (invalidVariant.phases[0]!.steps[0]!.worker as unknown as { variant: unknown }).variant = 1;
    expect(() => validateWorkflowSpec(invalidVariant, agents, models)).toThrow("variant must be a string");
  });

  test("rejects duplicate ids and sibling template references", () => {
    const duplicate = structuredClone(base);
    duplicate.phases[0]!.steps[1]!.workers[1]!.id = "scan";
    expect(() => validateWorkflowSpec(duplicate, agents, models)).toThrow("not globally unique");
    const sibling = structuredClone(base);
    sibling.phases[0]!.steps[1]!.workers[0]!.prompt = "Use {{workers.test.output}}";
    expect(() => validateWorkflowSpec(sibling, agents, models)).toThrow("forward, or sibling");
  });

  test("rejects malformed templates even alongside a valid reference", () => {
    const malformed = structuredClone(base);
    malformed.phases[0]!.steps[1]!.workers[0]!.prompt = "Use {{workers.scan.output}} and {{workers.scan.result}}";
    expect(() => validateWorkflowSpec(malformed, agents, models)).toThrow("Invalid workflow template reference");
  });

  test("allows unrelated brace syntax and escaped workflow references", () => {
    const literal = structuredClone(base);
    literal.phases[0]!.steps[0]!.worker.prompt = "Inspect ${{ github.ref }} and {{ jinja_value }}";
    literal.phases[0]!.steps[1]!.workers[0]!.prompt = "Explain \\{{workers.scan.output}} literally";
    expect(() => validateWorkflowSpec(literal, agents, models)).not.toThrow();
    expect(renderTemplate("${{ github.ref }} \\{{workers.scan.output}} {{workers.scan.output}}", { scan: "done" })).toBe("${{ github.ref }} {{workers.scan.output}} done");
    literal.phases[0]!.steps[1]!.workers[0]!.prompt = "Use {{workers.scan.output";
    expect(() => validateWorkflowSpec(literal, agents, models)).toThrow("Unclosed workflow template reference");
  });

  test("requires non-empty phases and step arrays", () => {
    const emptySteps = structuredClone(base);
    emptySteps.phases[0]!.steps = [];
    expect(() => validateWorkflowSpec(emptySteps, agents, models)).toThrow("steps must not be empty");
    const emptyPhases = structuredClone(base);
    emptyPhases.phases = [];
    expect(() => validateWorkflowSpec(emptyPhases, agents, models)).toThrow("phases must not be empty");
  });

  test("rejects unavailable allowlist entries and hard-limit overflow", () => {
    const unavailable = structuredClone(base);
    unavailable.allowedAgents = ["missing"];
    expect(() => validateWorkflowSpec(unavailable, agents, models)).toThrow("unregistered");
    const limits = structuredClone(base);
    limits.limits = { maxWorkers: 101 };
    expect(() => validateWorkflowSpec(limits, agents, models)).toThrow("1 to 100");
  });
});

describe("Stage 4 steering and inspector", () => {
  const run = (): WorkflowRun => {
    const spec = validateWorkflowSpec(base, agents, models);
    return { version: 1, id: "run", parentSessionID: "parent", parentMessageID: "message", createdAt: 1, updatedAt: 1, status: "running", spec, limits: effectiveLimits(spec), workers: Object.fromEntries(workersInOrder(spec).map((worker) => [worker.id, { ...worker, status: worker.id === "scan" ? "running" : "pending" }])) };
  };

  test("accepts only at the active boundary and rejects late steering durably", () => {
    const current = run();
    expect(acceptWorkerSteering(current, "scan", "check docs", 10, "s1").status).toBe("queued");
    expect(acceptWorkerSteering(current, "scan", "duplicate delivery", 10, "s1").text).toBe("check docs");
    expect(current.workers.scan!.steering).toHaveLength(1);
    current.workers.scan!.status = "completed";
    const late = acceptWorkerSteering(current, "scan", "too late", 11, "s2");
    expect(late.status).toBe("rejected");
    expect(late.error).toContain("no longer steerable");
    expect(current.workers.scan!.steering).toHaveLength(2);
  });

  test("drains multiple items together and drains arrivals during follow-up again", () => {
    const worker = run().workers.scan!;
    acceptWorkerSteering({ workers: { scan: worker } } as unknown as WorkflowRun, "scan", "one", 1, "s1");
    acceptWorkerSteering({ workers: { scan: worker } } as unknown as WorkflowRun, "scan", "two", 2, "s2");
    const first = steeringFollowUp(worker, 3)!;
    expect(first.ids).toEqual(["s1", "s2"]);
    expect(first.prompt).toContain("1. one");
    acceptWorkerSteering({ workers: { scan: worker } } as unknown as WorkflowRun, "scan", "three", 4, "s3");
    finalizeDeliveredSteering(worker, first.ids, 5);
    expect(steeringFollowUp(worker, 6)!.ids).toEqual(["s3"]);
  });

  test("models same-session superseded follow-ups and token telemetry", () => {
    const worker = run().workers.scan!;
    worker.childSessionID = "child";
    acceptWorkerSteering({ workers: { scan: worker } } as unknown as WorkflowRun, "scan", "revise", 1, "s1");
    const follow = steeringFollowUp(worker)!;
    worker.attempts = [{ number: 1, kind: "turn", startedAt: 1, endedAt: 2, result: "superseded", output: "old" }, { number: 2, kind: "turn", startedAt: 2, result: "completed", steeringIDs: follow.ids, output: "new" }];
    expect(worker.childSessionID).toBe("child");
    expect(worker.attempts[0]!.output).toBe("old");
    expect(tokenUsage({ input: 2, output: 3, reasoning: 1 })?.total).toBe(6);
  });

  test("uses original prompt once, then corrective retry and resume prompts", () => {
    expect(workerTurnPrompt(false, 1, undefined)).toBe("original");
    expect(workerTurnPrompt(false, 2, "retry")).toBe("original");
    expect(workerTurnPrompt(false, 1, "resume")).toBe("original");
    expect(workerTurnPrompt(true, 2, undefined)).toContain("prior attempt failed");
    expect(workerTurnPrompt(true, 1, "retry")).toContain("prior attempt failed");
    expect(workerTurnPrompt(true, 1, "resume")).toContain("Continue the interrupted work");
  });

  test("throws authoritative response errors before output handling", () => {
    const error = { name: "PermissionDenied", status: 403 };
    expect(() => promptResponseError({ error })).toThrow();
    expect(retryClassification(error)).toBe("none");
    expect(() => promptResponseError({})).not.toThrow();
  });

  test("requeues delivered steering after failed or interrupted follow-up", () => {
    const worker = run().workers.scan!;
    acceptWorkerSteering({ workers: { scan: worker } } as unknown as WorkflowRun, "scan", "preserve", 1, "s1");
    const delivered = steeringFollowUp(worker)!;
    requeueDeliveredSteering(worker, delivered.ids);
    expect(worker.steering![0]).toMatchObject({ id: "s1", status: "queued", deliveredAt: undefined });
    expect(steeringFollowUp(worker)!.ids).toEqual(["s1"]);
  });

  test("keeps automatic retry cycle progress until explicit reset", () => {
    const worker = run().workers.scan!;
    worker.automaticRetries = 5;
    worker.status = "interrupted";
    expect(retryDelay(worker.automaticRetries + 1)).toBeUndefined();
    worker.automaticRetries = 0;
    expect(retryDelay(worker.automaticRetries + 1)).toBe(5_000);
  });

  test("starts replacement when observed owner vanished and rejects a different owner", () => {
    expect(replacementControlDecision({ token: "old", generation: 1 })).toBe("start");
    expect(replacementControlDecision({ token: "old", generation: 1 }, { token: "new", generation: 2, heartbeatAt: 100 }, 101)).toBe("reject");
    expect(replacementControlDecision({ token: "same", generation: 2 }, { token: "same", generation: 2, heartbeatAt: 100 }, 101)).toBe("stop_owner");
  });

  test("derives current-plan progress without retired history", () => {
    const current = run();
    current.workers.old = { id: "old", label: "Old", agent: "build", prompt: "old", status: "completed" };
    current.workers.audit!.status = "completed";
    current.workers.test!.status = "retired";
    expect(currentPlanProgress(current)).toEqual({ completed: 1, total: 3, running: 1 });
  });

  test("derives inspector controls and transcript return selection", () => {
    const current = run();
    expect(inspectorControlActions(current, current.workers.scan!)).toContain("steer");
    expect(inspectorControlActions(current)).toContain("permission_mode");
    const selection = { runID: "run", kind: "worker" as const, id: "scan" };
    expect(transcriptReturn(selection)).toEqual({ name: "workflows", params: selection });
    expect(queuedSteering(current.workers.scan!)).toEqual([]);
    expect(transcriptSelection([current], { runID: "missing", workerID: "scan" })).toBeUndefined();
    expect(transcriptSelection([current], { runID: "run", workerID: "scan" })).toBeUndefined();
    current.workers.scan!.childSessionID = "child";
    expect(transcriptSelection([current], { runID: "run", workerID: "scan" })?.worker.id).toBe("scan");
  });

  test("selects lease owner before other active and pending prompt statuses", () => {
    const pending = run(); pending.id = "pending"; pending.status = "pending";
    const active = run(); active.id = "active";
    const leased = run(); leased.id = "leased"; leased.status = "soft_paused";
    expect(promptRightRun([pending, active, leased], { runID: "leased", heartbeatAt: Date.now() })?.id).toBe("leased");
    expect(promptRightRun([pending, active])?.id).toBe("active");
    active.status = "completed"; pending.status = "failed"; leased.status = "stopped";
    expect(promptRightRun([pending, active, leased])).toBeUndefined();
  });

  test("does not count cache telemetry as generated token total", () => {
    expect(tokenUsage({ input: 2, output: 3, reasoning: 1, cache: { read: 10, write: 20 } })).toEqual({ input: 2, output: 3, reasoning: 1, cacheRead: 10, cacheWrite: 20, total: 6 });
  });
});

describe("Stage 3 adaptive planning", () => {
  const run = (): WorkflowRun => {
    const spec = validateWorkflowSpec({ ...structuredClone(base), phases: [
      { id: "done", title: "Done", checkpoint: true, steps: [{ type: "worker", worker: { id: "scan", label: "Scan", agent: "explore", prompt: "scan" } }] },
      { id: "todo", title: "Todo", steps: [{ type: "worker", worker: { id: "audit", label: "Audit", agent: "build", prompt: "{{workers.scan.output}}" } }] },
    ] }, agents, models);
    return { version: 1, id: "run", parentSessionID: "parent", parentMessageID: "message", createdAt: 1, updatedAt: 1, status: "running", spec, limits: effectiveLimits(spec), workers: Object.fromEntries(workersInOrder(spec).map((worker) => [worker.id, { ...worker, status: worker.id === "scan" ? "completed" : "pending" }])), completedPhases: ["done"], sealedPhases: [], checkpointOccurrences: { done: "checkpoint-1" }, consumedCheckpoints: ["checkpoint-1"], planVersion: 1, planHistory: [{ version: 1, phases: structuredClone(spec.phases) }], revisions: [], reservedWorkerIDs: ["scan", "audit"], reservedPhaseIDs: ["done", "todo"], frontier: { generation: 1, completedSteps: 0, sealed: false }, pendingGuidance: [] };
  };

  test("keeps completed work immutable and enforces allowlists and limits", () => {
    const current = run();
    const valid = [{ id: "replacement", title: "Replacement", steps: [{ type: "worker", worker: { id: "newAudit", label: "Audit", agent: "build", prompt: "{{workers.scan.output}}" } }] }];
    expect(validatePlanRevision(current, valid).map((phase) => phase.id)).toEqual(["replacement"]);
    const agent = structuredClone(valid); agent[0]!.steps[0]!.worker.agent = "other";
    expect(() => validatePlanRevision(current, agent)).toThrow("outside allowedAgents");
    current.reservedWorkerIDs!.push("retired");
    const duplicate = structuredClone(valid); duplicate[0]!.steps[0]!.worker.id = "retired";
    expect(() => validatePlanRevision(current, duplicate)).toThrow("plan history");
    current.limits.maxWorkers = 1;
    expect(() => validatePlanRevision(current, valid)).toThrow("exceeding maxWorkers");
    expect(current.spec.phases[0]!.id).toBe("done");
  });

  test("produces deterministic added, removed, reordered, and changed diffs", () => {
    const before = [{ id: "p", title: "Old", steps: [{ type: "worker", worker: { id: "a", label: "A", agent: "build", prompt: "a" } }, { type: "worker", worker: { id: "b", label: "B", agent: "build", prompt: "b" } }] }] as never;
    const after = [{ id: "p", title: "New", steps: [{ type: "worker", worker: { id: "b", label: "B", agent: "build", prompt: "b" } }, { type: "worker", worker: { id: "c", label: "C", agent: "build", prompt: "c" } }] }] as never;
    const diff = planDiff(before, after);
    expect(diff).toEqual(planDiff(before, after));
    expect(diff.map((item) => `${item.kind}:${item.id}`)).toEqual(["changed:p", "removed:a", "reordered:b", "added:c"]);
  });

  test("enforces ten revisions and repair continue restrictions", () => {
    const current = run();
    current.revisions = Array.from({ length: 10 }, (_, index) => ({ version: index + 2, operationID: `op-${index}`, reason: "checkpoint", guidance: [], rationale: "x", before: [], after: [], diff: [], acceptedAt: index }));
    expect(() => validatePlanRevision(current, [])).toThrow("maxRevisions 10");
    current.failure = { workerID: "scan", kind: "repair", reason: "dependency" };
    current.workers.scan!.status = "skipped";
    expect(canContinueCoordinatorFailure(current)).toBe(false);
    (current.spec.phases[1]!.steps[0] as WorkerStep).worker.prompt = "independent";
    expect(canContinueCoordinatorFailure(current)).toBe(true);
  });

  test("recognizes checkpoint and queued guidance state explicitly", () => {
    const current = run();
    current.pendingGuidance = [{ id: "g1", generation: 1, text: "replace the audit", createdAt: 1 }];
    expect(current.consumedCheckpoints).toEqual(["checkpoint-1"]);
    expect(current.pendingGuidance[0]!.text).toBe("replace the audit");
    expect(isWorkflowControlAction("plan_change")).toBe(true);
    expect(isWorkflowControlAction("coordinator_retry")).toBe(true);
  });

  test("seals an active phase prefix and retires its unstarted suffix", () => {
    const current = run();
    current.completedPhases = [];
    const phase = current.spec.phases.find((item) => item.id === "todo")!;
    phase.steps.push({ type: "worker", worker: { id: "later", label: "Later", agent: "build", prompt: "later" } });
    current.workers.later = { id: "later", label: "Later", agent: "build", prompt: "later", status: "pending" };
    current.frontier = { generation: 2, phaseID: "todo", completedSteps: 1, sealed: false };
    sealActivePhase(current);
    expect(current.sealedPhases).toEqual(["todo"]);
    expect(current.workers.later!.status).toBe("retired");
    expect(current.spec.phases.find((phase) => phase.id === "todo")!.steps).toHaveLength(1);
    expect(current.planHistory![0]!.phases.find((phase) => phase.id === "todo")!.steps).toHaveLength(1);
  });

  test("reconciles retained, removed, and added workers with reserved IDs", () => {
    const current = run();
    const before = current.spec.phases.slice(1);
    const after = [{ id: "next", title: "Next", steps: [{ type: "worker", worker: { id: "newWorker", label: "New", agent: "build", prompt: "new" } }] }] as never;
    reconcileRevisionWorkers(current, before, after);
    expect(current.workers.audit!.status).toBe("retired");
    expect(current.workers.newWorker!.status).toBe("pending");
    expect(current.reservedWorkerIDs).toContain("audit");
    expect(current.reservedWorkerIDs).toContain("newWorker");
    current.spec.phases = [...current.spec.phases.slice(0, 1), ...after];
    expect(currentPlanWorkerIDs(current)).not.toContain("audit");
  });

  test("uses exact coordinator operation metadata and monotonic sources", () => {
    const children = [{ id: "old", metadata: { workflowRunID: "run", workflowCoordinatorOperationID: "old" } }, { id: "exact", metadata: { workflowRunID: "run", workflowCoordinatorOperationID: "op" } }];
    expect(selectCoordinatorOperationChild(children, "run", "op")?.id).toBe("exact");
    const current = run();
    const operation: CoordinatorOperation = { id: "op", sourcePlanVersion: 1, sourceFrontierGeneration: 1, reason: "plan_change", guidanceIDs: ["g1"], attempts: [], input: "", status: "running" };
    expect(() => assertCoordinatorSource(current, operation)).not.toThrow();
    current.frontier!.generation++;
    expect(() => assertCoordinatorSource(current, operation)).toThrow("frontier changed");
  });

  test("prohibits completed phase ID reuse and keeps checkpoint occurrence consumed", () => {
    const current = run();
    const reused = [{ id: "done", title: "Again", checkpoint: true, steps: [{ type: "worker", worker: { id: "again", label: "Again", agent: "build", prompt: "again" } }] }];
    expect(() => validatePlanRevision(current, reused)).toThrow("Phase id done is not unique");
    expect(current.checkpointOccurrences!.done).toBe("checkpoint-1");
    expect(current.consumedCheckpoints).toEqual(["checkpoint-1"]);
  });

  test("does not clear newer guidance and does not retry policy failures", () => {
    const current = run();
    current.pendingGuidance = [{ id: "g1", generation: 1, text: "one", createdAt: 1 }, { id: "g2", generation: 2, text: "two", createdAt: 2 }];
    const included = new Set(["g1"]);
    current.pendingGuidance = current.pendingGuidance.filter((item) => !included.has(item.id));
    expect(current.pendingGuidance.map((item) => item.id)).toEqual(["g2"]);
    expect(coordinatorRetryable(new Error("provider timeout"))).toBe(true);
    expect(coordinatorRetryable(new Error("agent outside allowedAgents"), true)).toBe(false);
  });

  test("drains guidance arriving during coordination before worker scheduling", async () => {
    const current = run();
    current.failure = undefined;
    current.pendingGuidance = [{ id: "g1", generation: 1, text: "first", createdAt: 1 }];
    const events: string[] = [];
    const drained = await drainPendingCoordination(current, async (reason) => {
      const captured = current.pendingGuidance!.map((item) => item.id);
      events.push(`${reason}:${captured.join(",")}`);
      if (captured.includes("g1")) current.pendingGuidance!.push({ id: "g2", generation: 2, text: "newer", createdAt: 2 });
      current.pendingGuidance = current.pendingGuidance!.filter((item) => !captured.includes(item.id));
      return true;
    });
    if (drained) events.push("worker-scheduled");
    expect(events).toEqual(["plan_change:g1", "plan_change:g2", "worker-scheduled"]);
  });

  test("initializes true version-one history before mutation", () => {
    const current = run();
    current.planHistory = undefined;
    const before = structuredClone(current.spec.phases);
    initializePlanHistory(current, before);
    current.spec.phases.pop();
    expect(current.planHistory![0]!.phases).toEqual(before);
  });

  test("prioritizes repair and unresolved worker failures over guidance", () => {
    const current = run();
    current.pendingGuidance = [{ id: "g", generation: 1, text: "change", createdAt: 1 }];
    current.failure = { workerID: "scan", kind: "worker", reason: "failed" };
    expect(pendingCoordinationReason(current)).toBeUndefined();
    current.failure = { workerID: "scan", kind: "repair", reason: "repair" };
    expect(pendingCoordinationReason(current)).toBe("repair");
  });

  test("derives failure modal actions by failure kind", () => {
    const current = run();
    current.failure = { workerID: "audit", kind: "worker", reason: "failed" };
    expect(failureControlActions(current)).toEqual(["failure_retry", "failure_skip", "failure_stop"]);
    current.failure = { workerID: "handoff", kind: "handoff", reason: "failed" };
    expect(failureControlActions(current)).toEqual(["failure_retry", "failure_stop"]);
    current.failure = { workerID: "coordinator", kind: "coordinator", reason: "failed" };
    expect(failureControlActions(current)).toEqual(["coordinator_retry", "coordinator_continue", "failure_stop"]);
  });

  test("fails lease fencing immediately before external side effects", () => {
    expect(() => assertLeaseOwnership(true)).not.toThrow();
    expect(() => assertLeaseOwnership(false)).toThrow("before external side effect");
  });
});

describe("templates and state helpers", () => {
  test("renders object output as stable pretty JSON", () => {
    expect(renderTemplate("{{workers.scan.output}}", { scan: { z: [2, 1], a: true } })).toBe('{\n  "a": true,\n  "z": [\n    2,\n    1\n  ]\n}');
    expect(stableJson({ z: 1, a: { d: 2, b: 3 } })).toBe('{\n  "a": {\n    "b": 3,\n    "d": 2\n  },\n  "z": 1\n}');
    expect(renderTemplate("Result: {{workers.scan.output}}", { scan: "\\{{preserved}}" })).toBe("Result: \\{{preserved}}");
  });

  test("enforces additionalProperties even without an explicit object type", () => {
    expect(() => validateJsonSchema({ additionalProperties: false }, { unexpected: true })).toThrow("not allowed");
  });

  test("uses stable persistence paths and terminal state derivation", () => {
    expect(statePath("/data/workflows/project", "run-1")).toBe("/data/workflows/project/runs/run-1/state.json");
    expect(eventPath("/data/workflows/project", "run-1")).toBe("/data/workflows/project/runs/run-1/events.ndjson");
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("interrupted")).toBe(false);
  });

  test("marks skipped template dependencies for Stage 3 repair", () => {
    const spec = validateWorkflowSpec(base, agents, models);
    const workers: Record<string, WorkerState> = Object.fromEntries(workersInOrder(spec).map((worker) => [worker.id, { ...worker, status: "pending" }]));
    workers.scan!.status = "skipped";
    expect(pendingTemplateDependency(spec, workers, "scan")).toBe("audit");
  });
});

describe("Stage 5 lifecycle and release", () => {
  const run = (id: string, status: WorkflowRun["status"], updatedAt: number): WorkflowRun => ({ version: 1, id, parentSessionID: "parent", parentMessageID: "message", createdAt: updatedAt, updatedAt, status, spec: validateWorkflowSpec(base, agents, models), limits: DEFAULT_LIMITS, workers: {} });

  test("returns before project lookup starts and disposes without opening SQLite", async () => {
    const calls: string[] = [];
    let dispose: (() => void | Promise<void>) | undefined;
    const projectID = `tui-dispose-${crypto.randomUUID()}`;
    const api = {
      client: { project: { current: async () => { calls.push("project"); return { data: { id: projectID } }; } } },
      state: { path: { directory: "/tmp" } },
      keymap: { registerLayer: () => { calls.push("keymap"); return () => {}; } },
      route: { register: () => { calls.push("route"); return () => {}; } },
      slots: { register: () => { calls.push("slots"); return "workflows"; } },
      lifecycle: { onDispose: (callback: () => void | Promise<void>) => { calls.push("dispose"); dispose = callback; return () => {}; } },
    } as unknown as TuiPluginApi;

    await workflowTui.tui(api, undefined, {} as never);
    expect(calls).toEqual(["keymap", "route", "slots", "dispose"]);

    await dispose!();
    await Bun.sleep(0);
    expect(await Bun.file(`${workflowProjectDirectory(projectID, "/tmp")}/coordination.sqlite`).exists()).toBe(false);
  });

  test("selects retention by age or count and protects every nonterminal status", () => {
    const now = 40 * 86_400_000;
    const values = [run("new", "completed", now), run("second", "aborted", now - 1), run("overflow", "rejected", now - 2), run("old", "failed", 1), run("active", "running", 1), run("stopped", "stopped", 1), run("interrupted", "interrupted", 1)];
    expect(retentionCandidates(values, 2, 30, now).map((item) => item.id).sort()).toEqual(["old", "overflow"]);
    const rewritten = run("rewritten", "completed", now);
    rewritten.terminalAt = 1;
    expect(retentionCandidates([rewritten], 30, 30, now).map((item) => item.id)).toEqual(["rewritten"]);
  });

  test("collects persisted and metadata-reconciled children but never the parent", () => {
    const current = run("run", "completed", 1);
    current.workers = { one: { id: "one", label: "One", agent: "build", prompt: "x", status: "completed", childSessionID: "worker" } };
    current.handoffSessionID = "handoff";
    current.coordinatorOperations = [{ id: "op", sourcePlanVersion: 1, sourceFrontierGeneration: 1, reason: "checkpoint", guidanceIDs: [], attempts: [], input: "", status: "accepted", sessionID: "coordinator" }];
    expect(ownedChildSessionIDs(current, [{ id: "retry", metadata: { workflowRunID: "run" } }, { id: "parent", metadata: { workflowRunID: "run" } }, { id: "other", metadata: { workflowRunID: "other" } }])).toEqual(["coordinator", "handoff", "retry", "worker"]);
  });

  test("normalizes options and enforces plugin ceilings", () => {
    expect(normalizeWorkflowOptions()).toMatchObject({ retentionRuns: 10_000, retentionDays: 99_999_999, maxWorkers: 100, maxRevisions: 10, maxRunMs: 21_600_000, maxConcurrency: 2, coordinatorInputBytes: 262_144 });
    expect(workflowCeilings(normalizeWorkflowOptions({ max_concurrency: 5 })).maxConcurrency).toBe(5);
    const options = normalizeWorkflowOptions({ max_workers: 2, max_revisions: 3, max_run_ms: 1000 });
    const tooLarge = structuredClone(base); tooLarge.limits = { maxWorkers: 3 };
    expect(() => validateWorkflowSpec(tooLarge, agents, models, workflowCeilings(options))).toThrow("1 to 2");
    expect(() => normalizeWorkflowOptions({ retention_runs: 0 })).toThrow("positive integer");
  });

  test("checks TUI freshness and derives startup/manual actions", () => {
    expect(tuiPresenceFresh({ heartbeatAt: 1000 }, 5999)).toBe(true);
    expect(tuiPresenceFresh({ heartbeatAt: 1000 }, 6001)).toBe(false);
    expect(tuiPresenceFresh({ heartbeatAt: 7001 }, 5999)).toBe(false);
    const interrupted = run("run", "interrupted", 1);
    expect(startupActions(interrupted)).toEqual(["resume", "open", "later", "discard"]);
    expect(canDiscardRun(interrupted)).toBe(true);
    expect(canDiscardRun(run("active", "running", 1))).toBe(false);
  });

  test("terminally aborts only a nonterminal run after parent deletion", () => {
    const current = run("run", "running", 1);
    expect(abortForParentDeletion(current)).toBe(true);
    expect(current).toMatchObject({ status: "aborted", error: "Originating parent session was deleted" });
    expect(abortForParentDeletion(current)).toBe(false);
  });

  test("routes parent deletion to the exact healthy cross-process owner", () => {
    const path = `/tmp/opencode/workflow-parent-delete-${crypto.randomUUID()}.sqlite`;
    const owner = new WorkflowCoordination(path), observer = new WorkflowCoordination(path);
    const lease = owner.acquire("run", "owner", 100)!;
    const observed = observer.current()!;
    expect(parentDeletionRoute(undefined, observed, 101)).toEqual({ targetOwner: "owner", leaseToken: lease.token, leaseGeneration: lease.generation });
    expect(parentDeletionRoute(lease, observed, 101)).toBe("handle");
    expect(parentDeletionRoute(undefined, observed, 20_000)).toBe("acquire");
    owner.close(); observer.close();
  });

  test("maintenance claims serialize and can be retried after cleanup failure", () => {
    const path = `/tmp/opencode/workflow-maintenance-${crypto.randomUUID()}.sqlite`;
    const first = new WorkflowCoordination(path), second = new WorkflowCoordination(path);
    const claim = first.claimMaintenance("run", "one", 100)!;
    expect(claim.ownerIdentity).toBe("one");
    expect(second.claimMaintenance("run", "two", 101)).toBeUndefined();
    expect(first.releaseMaintenance(claim)).toBe(true);
    expect(second.claimMaintenance("run", "two", 102)).toBeDefined();
    first.close(); second.close();
  });

  test("lease acquisition and maintenance are mutually exclusive across connections", () => {
    const path = `/tmp/opencode/workflow-exclusion-${crypto.randomUUID()}.sqlite`;
    const cleaner = new WorkflowCoordination(path), runner = new WorkflowCoordination(path);
    const claim = cleaner.claimMaintenance("run", "cleaner", 100)!;
    expect(runner.acquire("run", "runner", 101)).toBeUndefined();
    expect(cleaner.renewMaintenance({ ...claim, token: "wrong" }, 200)).toBe(false);
    expect(cleaner.renewMaintenance(claim, 20_000)).toBe(true);
    expect(runner.acquire("run", "runner", 20_001)).toBeUndefined();
    expect(cleaner.releaseMaintenance(claim)).toBe(true);
    const lease = runner.acquire("run", "runner", 20_002)!;
    expect(cleaner.claimMaintenance("run", "cleaner", 20_003)).toBeUndefined();
    expect(runner.release(lease)).toBe(true);
    cleaner.close(); runner.close();
  });

  test("partial child cleanup progress and not-found deletion are retry-idempotent", () => {
    const ids = ["first", "second", "third"];
    expect(pendingChildCleanup(ids, ["first"])).toEqual(["second", "third"]);
    expect(pendingChildCleanup(ids, ["first", "second"])).toEqual(["third"]);
    expect(sessionAlreadyDeleted({ status: 404, name: "SessionNotFound" })).toBe(true);
    expect(sessionAlreadyDeleted(new Error("session not found"))).toBe(true);
    expect(sessionAlreadyDeleted({ status: 500 })).toBe(false);
  });
});

describe("Stage 2 reliability helpers", () => {
  test("classifies only transient and structured retry failures with fixed backoff", () => {
    expect(retryClassification(new Error("provider timeout"))).toBe("transient");
    expect(retryClassification(new Error("output does not match schema type"))).toBe("structured");
    expect(retryClassification(new Error("permission denied"))).toBe("none");
    expect(retryClassification(new Error("workflow stop requested"))).toBe("none");
    expect([1, 2, 3, 4, 5].map(retryDelay)).toEqual([5_000, 10_000, 20_000, 30_000, 40_000]);
    expect(retryDelay(6)).toBeUndefined();
  });

  test("keeps pause boundaries and selects queued runs deterministically", () => {
    expect(pausesScheduling("soft_pausing")).toBe(true);
    expect(pausesScheduling("running")).toBe(false);
    const queue = [
      { id: "later", status: "queued", createdAt: 20 },
      { id: "first-b", status: "queued", createdAt: 10 },
      { id: "first-a", status: "queued", createdAt: 10 },
      { id: "active", status: "running", createdAt: 1 },
    ] as unknown as WorkflowRun[];
    expect(nextQueuedRun(queue)?.id).toBe("first-a");
    expect(shouldScheduleNextParallelBatch("running", false)).toBe(true);
    expect(shouldScheduleNextParallelBatch("soft_pausing", false)).toBe(false);
    expect(shouldScheduleNextParallelBatch("running", true)).toBe(false);
  });

  test("preserves quiescing coordinator state and finalizes soft pauses", () => {
    const run = { status: "hard_pausing", failure: { workerID: "x", reason: "x" }, error: "Hard pause requested" } as WorkflowRun;
    acceptCoordinatorResult(run);
    expect(run).toMatchObject({ status: "hard_pausing", error: "Hard pause requested", failure: undefined });
    run.status = "running"; acceptCoordinatorResult(run);
    expect(run.error).toBeUndefined();
    run.status = "soft_pausing";
    expect(finalizeSoftPause(run)).toBe(true);
    expect(run.status as WorkflowStatus).toBe("soft_paused");
  });

  test("builds byte-exact coordinator input with compact failures and valid UTF-8", () => {
    const failed = { id: "bad", label: "Bad", agent: "build", prompt: "secret", status: "failed", error: "boom", output: "body", attempts: [{ number: 1, startedAt: 1 }] } as WorkerState;
    expect(compactWorkerFailures({ bad: failed })).toEqual([{ id: "bad", status: "failed", error: "boom" }]);
    failed.error = "x".repeat(3_000);
    expect(Buffer.byteLength(compactWorkerFailures({ bad: failed })[0]!.error!)).toBe(2_048);
    expect(utf8Prefix("a😀b", 4)).toBe("a");
    const payload = { marker: "😀", outputs: [] as Array<{ id: string; output: string }> };
    const input = coordinatorInput(payload, [{ id: "one", output: "😀😀😀" }], 54)!;
    expect(Buffer.byteLength(input)).toBeLessThanOrEqual(54);
    expect(input).not.toContain("�");
    const oversized = { marker: "too large", outputs: [] };
    expect(coordinatorInput(oversized, [], 2)).toBeUndefined();
  });

  test("ignores claimed controls while preserving owner suffixes", () => {
    expect(isPendingControlFilename("1.json.owner")).toBe(true);
    expect(isPendingControlFilename("1.json.owner.claimed")).toBe(false);
    expect(isPendingControlFilename("1.json.owner.tmp")).toBe(false);
    expect(isPendingControlFilename("1.json.uuid.tmp")).toBe(false);
  });

  test("filters pending workers before configurable-concurrency batching", () => {
    const workers = ["done1", "pending1", "done2", "pending2", "pending3"].map((id) => ({ id } as never));
    const states = Object.fromEntries(workers.map((worker: { id: string }) => [worker.id, { status: worker.id.startsWith("pending") ? "pending" : "completed" }])) as Record<string, WorkerState>;
    expect(pendingWorkerBatches(workers, states, 2).map((batch) => batch.map((worker) => worker.id))).toEqual([["pending1", "pending2"], ["pending3"]]);
    expect(pendingWorkerBatches(workers, states, 3).map((batch) => batch.map((worker) => worker.id))).toEqual([["pending1", "pending2", "pending3"]]);
  });

  test("recovers only stale leases", () => {
    const lease = { runID: "run", ownerIdentity: "123:abc", heartbeatAt: 10_000 };
    expect(isLeaseStale(lease, 24_999)).toBe(false);
    expect(isLeaseStale(lease, 25_001)).toBe(true);
  });

  test("recognizes controls so unknown claimed files can be discarded", () => {
    expect(isWorkflowControlAction("stop")).toBe(true);
    expect(isWorkflowControlAction("unknown")).toBe(false);
  });

  test("requires quiescence before hard pause and stop become resumable", () => {
    expect(quiescenceStatus("hard_pause", false)).toBe("hard_pausing");
    expect(quiescenceStatus("hard_pause", true)).toBe("hard_paused");
    expect(quiescenceStatus("stop", false)).toBe("stopping");
    expect(quiescenceStatus("stop", true)).toBe("stopped");
  });

  test("moves worker retry and non-dependent skip out of blocked state", () => {
    expect(failureDecisionStatus("retry", false)).toBe("soft_paused");
    expect(failureDecisionStatus("skip", false)).toBe("soft_paused");
    expect(failureDecisionStatus("skip", true)).toBe("repair_required");
  });

  test("creates ascending OpenCode-compatible message IDs", () => {
    expect(workflowMessageID()).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    const now = Date.now();
    expect(workflowMessageID(now) < workflowMessageID(now)).toBe(true);
    expect(workflowMessageID(now) < workflowMessageID(now + 1)).toBe(true);
    expect(workflowMessageID(now) > workflowMessageID(now - 1000)).toBe(true);
  });

  test("reconciles worker and handoff children by metadata", () => {
    const children = [
      { id: "other", metadata: { workflowRunID: "other", workflowWorkerID: "scan" } },
      { id: "worker", metadata: { workflowRunID: "run", workflowWorkerID: "scan" } },
      { id: "handoff", metadata: { workflowRunID: "run", workflowHandoff: true } },
    ];
    expect(selectWorkflowChild(children, "run", "scan")?.id).toBe("worker");
    expect(selectWorkflowChild(children, "run")?.id).toBe("handoff");
  });

  test("fences lease contention, takeover, ownership loss, and token release", () => {
    const path = `/tmp/opencode/workflow-${crypto.randomUUID()}.sqlite`;
    const first = new WorkflowCoordination(path);
    const second = new WorkflowCoordination(path);
    const lease1 = first.acquire("run-1", "owner-1", 1)!;
    expect(second.acquire("run-2", "owner-2", 10_000)).toBeUndefined();
    expect(second.acquire("run-1", "owner-2", 10_000)).toBeUndefined();
    const lease2 = second.acquire("run-2", "owner-2", 20_000)!;
    expect(lease2.generation).toBe(lease1.generation + 1);
    expect(first.heartbeat(lease1, 20_001)).toBe(false);
    expect(() => first.fenced(lease1, () => {})).toThrow("ownership lost");
    expect(first.release(lease1)).toBe(false);
    expect(second.owns(lease2)).toBe(true);
    second.enqueue("missing", 1);
    second.enqueue("valid", 2);
    expect(second.nextQueued()).toBe("missing");
    second.dequeue("missing");
    expect(second.nextQueued()).toBe("valid");
    first.close();
    second.close();
  });

  test("classifies structured SDK errors before message fallback", () => {
    expect(retryClassification({ name: "ProviderError", isRetryable: true, status: 400 })).toBe("transient");
    expect(retryClassification({ name: "PermissionDenied", status: 403, message: "timeout" })).toBe("none");
    expect(retryClassification({ statusCode: 503 })).toBe("transient");
  });

  test("classifies OpenCode NamedError turn failures from their data payload", () => {
    expect(retryClassification({ name: "APIError", data: { message: "overloaded", isRetryable: true } })).toBe("transient");
    expect(retryClassification({ name: "APIError", data: { message: "server error", statusCode: 529 } })).toBe("transient");
    expect(retryClassification({ name: "APIError", data: { message: "bad request", statusCode: 400, isRetryable: false } })).toBe("none");
    expect(retryClassification({ name: "StructuredOutputError", data: { message: "Model did not produce structured output", retries: 0 } })).toBe("structured");
    expect(retryClassification({ name: "MessageAbortedError", data: { message: "aborted" } })).toBe("none");
    expect(retryClassification({ name: "ProviderAuthError", data: { providerID: "anthropic", message: "missing key" } })).toBe("none");
    expect(retryClassification(new TypeError("fetch failed"))).toBe("transient");
  });
});
