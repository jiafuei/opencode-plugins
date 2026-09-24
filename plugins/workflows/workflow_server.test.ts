import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import workflows from "./workflow_server.ts";
import { runDirectory, statePath, workflowProjectDirectory, type WorkflowRun } from "./workflow_shared.ts";

process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "workflow-server-test-"));

type Tool = { execute: (input: any, context: any) => Promise<{ content: string }> };
type Message = { id: string; type: string; content?: Array<{ type: string; text?: string }> };

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });

async function until<T>(check: () => T | undefined | Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await Bun.sleep(25);
  }
  throw new Error("Timed out waiting for workflow condition");
}

const handoffResult = { summary: "done", completedWork: ["work"], evidence: [], changedFiles: [], verification: [], unresolvedIssues: [], recommendedNextAction: "none" };
const registration = { dispose: async () => {} };
const never = () => new Promise<never>(() => {});

async function createHarness(options: Record<string, unknown> = {}) {
  const projectID = `test-${crypto.randomUUID()}`;
  const directory = "/tmp/workflow-server-test-project";
  const root = workflowProjectDirectory(projectID, directory);
  const state = {
    inFlight: 0,
    maxInFlight: 0,
    failCreate: false,
    failGenerate: false,
    agents: ["build", "general"],
    models: ["claude"],
    agentRefreshes: 0,
    modelRefreshes: 0,
    synthetic: [] as Array<{ sessionID: string; id: string; text: string }>,
    created: [] as Array<{ id: string; agent?: string; model?: { providerID: string; id: string } }>,
    generated: [] as string[],
    onPrompt: undefined as ((sessionID: string) => Promise<void> | void) | undefined,
    promptDelay: undefined as ((text: string) => number) | undefined,
    workerOutput: undefined as ((text: string) => string) | undefined,
  };
  const tools = new Map<string, Tool>();
  const messages = new Map<string, Message[]>();
  let control: (input: Record<string, unknown>) => Promise<{ status: string; error?: string }> = never;
  let contextHook: (event: { sessionID: string; tools: Record<string, { input: unknown }> }) => void = () => {};
  const ctx = {
    options,
    location: { directory, project: { id: projectID } },
    rpc: { register: async (_definition: unknown, handlers: { control: typeof control }) => { control = handlers.control; return { ...registration, events: { emit: async () => {} } }; } },
    agent: { list: async () => { state.agentRefreshes++; return { data: state.agents.map((id) => ({ id })) }; } },
    model: { list: async () => { state.modelRefreshes++; return { data: state.models.map((id) => ({ providerID: "anthropic", id })) }; } },
    generate: {
      text: async ({ prompt }: { prompt: string }) => {
        state.generated.push(prompt);
        await Bun.sleep(20);
        if (state.failGenerate) throw new Error("permission denied for generation");
        return { text: JSON.stringify(prompt.startsWith("You are an internal workflow coordinator") ? { rationale: "keep the plan", phases: [] } : handoffResult) };
      },
    },
    event: { subscribe: () => ({ [Symbol.asyncIterator]: () => ({ next: never }) }) },
    command: { transform: async () => registration },
    tool: { transform: async (callback: (editor: { add: (tool: Tool & { name: string }) => void }) => void) => { callback({ add: (tool) => tools.set(tool.name, tool) }); return registration; } },
    session: {
      hook: async (_name: string, callback: typeof contextHook) => { contextHook = callback; return registration; },
      create: async (input: { id: string; agent?: string; model?: { providerID: string; id: string } }) => {
        if (state.failCreate) throw new Error("permission denied creating session");
        state.created.push(input);
        return { id: input.id };
      },
      get: async ({ sessionID }: { sessionID: string }) => sessionID === "parent-session"
        ? { id: sessionID, permissions: [], model: { providerID: "anthropic", id: "claude" } }
        : { id: sessionID, tokens: { input: 2, output: 3, reasoning: 1, cache: { read: 0, write: 0 } } },
      prompt: async (input: { sessionID: string; id: string; text: string }) => {
        state.inFlight++;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        await Bun.sleep(state.promptDelay?.(input.text) ?? 50);
        state.inFlight--;
        await state.onPrompt?.(input.sessionID);
        const agent = state.created.find((item) => item.id === input.sessionID)?.agent;
        messages.set(input.sessionID, [{ id: input.id, type: "user" }, { id: `${input.id}-reply`, type: "assistant", content: [{ type: "text", text: state.workerOutput?.(input.text) ?? `output:${agent}` }] }]);
        return {};
      },
      wait: async () => {},
      context: async ({ sessionID }: { sessionID: string }) => messages.get(sessionID) ?? [],
      synthetic: async (input: { sessionID: string; id: string; text: string }) => { state.synthetic.push(input); return {}; },
      interrupt: async () => ({ interrupted: true }),
    },
  };
  const cleanup = await workflows.setup(ctx as never);
  disposers.push(async () => { await cleanup?.(); });

  const context = (signal = new AbortController().signal, onRunID: (id: string) => void = () => {}) => ({ sessionID: "parent-session", messageID: "parent-message", signal, progress: async (value: { workflowRunID?: string }) => { if (value.workflowRunID) onRunID(value.workflowRunID); } });
  const submit = async (spec: unknown) => {
    let runID = "";
    const result = tools.get("workflow")!.execute({ spec }, context(undefined, (id) => { runID = id; })).then((value) => JSON.parse(value.content) as { runID: string; status: string });
    const id = await Promise.race([until(() => runID || undefined), result.then((value) => value.runID)]);
    return { id, result };
  };
  const waitForRun = (id: string, ready: (run: WorkflowRun) => boolean) =>
    until(async () => {
      const run = await Bun.file(statePath(root, id)).json().catch(() => undefined) as WorkflowRun | undefined;
      return run && ready(run) ? run : undefined;
    });
  return { root, state, tools, context, submit, control: (input: Record<string, unknown>) => control(input), contextHook: (event: Parameters<typeof contextHook>[0]) => contextHook(event), waitForRun };
}

const spec = (phases: unknown[]) => ({
  version: 1,
  name: "server-test",
  description: "server test workflow",
  goal: "exercise the workflow server",
  allowedAgents: ["build"],
  phases,
});
const worker = (id: string, prompt = `run ${id}`) => ({ id, label: id, agent: "build", prompt });
const workerStep = (id: string, prompt?: string) => ({ type: "worker", worker: worker(id, prompt) });

describe("workflow server", () => {
  test("passes complete large outputs and later results to the coordinator and handoff", async () => {
    const harness = await createHarness();
    const large = `${"Complete finding. ".repeat(20_000)}FINAL_QUALIFICATION`;
    harness.state.workerOutput = (prompt) => prompt === "run large" ? large : "LATE_VERIFICATION_RESULT";
    const submission = await harness.submit(spec([
      { id: "work", title: "Work", checkpoint: true, steps: [workerStep("large"), workerStep("verify")] },
    ]));
    await harness.control({ runID: submission.id, action: "approve" });
    const run = await harness.waitForRun(submission.id, (run) => run.status === "completed" || run.status === "blocked");
    expect(run.failure).toBeUndefined();
    expect(run.status).toBe("completed");
    expect(harness.state.generated).toHaveLength(2);
    for (const prompt of harness.state.generated) {
      expect(prompt).toContain(large);
      expect(prompt).toContain("LATE_VERIFICATION_RESULT");
    }
  }, 15_000);

  test("initializes while OpenCode endpoints remain unresolved", async () => {
    const projectID = `test-${crypto.randomUUID()}`;
    const directory = "/tmp/workflow-server-test-project";
    const root = workflowProjectDirectory(projectID, directory);
    await mkdir(runDirectory(root, "broken"), { recursive: true });
    await Bun.write(statePath(root, "broken"), "{");
    const calls = { agents: 0, models: 0, sessions: 0, generate: 0 };
    const registered = { dispose: async () => {} };
    const session = () => { calls.sessions++; return never(); };
    const ctx = {
      options: {},
      location: { directory, project: { id: projectID } },
      rpc: { register: async () => ({ ...registered, events: { emit: async () => {} } }) },
      agent: { list: () => { calls.agents++; return never(); } },
      model: { list: () => { calls.models++; return never(); } },
      generate: { text: () => { calls.generate++; return never(); } },
      event: { subscribe: () => ({ [Symbol.asyncIterator]: () => ({ next: never }) }) },
      command: { transform: async () => registered },
      tool: { transform: async () => registered },
      session: { hook: async () => registered, create: session, get: session, prompt: session, wait: session, context: session, synthetic: session, interrupt: session },
    };
    const cleanup = await Promise.race([workflows.setup(ctx as never), Bun.sleep(500).then(() => "timeout" as const)]);
    expect(cleanup).not.toBe("timeout");
    if (typeof cleanup === "function") disposers.push(async () => { await cleanup(); });
    expect(calls).toEqual({ agents: 0, models: 0, sessions: 0, generate: 0 });
  });

  test("refreshes agents and models before each workflow validation", async () => {
    const h = await createHarness();
    const workflow = h.tools.get("workflow")!;
    h.state.agents = ["general"];
    await expect(workflow.execute({ spec: spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]) }, h.context())).rejects.toThrow("unregistered agent");
    expect([h.state.agentRefreshes, h.state.modelRefreshes]).toEqual([1, 1]);

    h.state.agents = ["build", "general"];
    h.state.models = ["sonnet"];
    await expect(workflow.execute({ spec: spec([{ id: "p1", title: "Phase", steps: [{ type: "worker", worker: { ...worker("a"), modelID: "anthropic/claude" } }] }]) }, h.context())).rejects.toThrow("unavailable model");
    expect([h.state.agentRefreshes, h.state.modelRefreshes]).toEqual([2, 2]);
  });

  test("approves, renders templates across sequential workers, and completes with a synthetic handoff", async () => {
    const h = await createHarness();
    h.state.models = ["claude", "haiku"];
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [workerStep("a"), { type: "worker", worker: { ...worker("b", "use {{workers.a.output}}"), modelID: "anthropic/haiku" } }] }]));
    expect((await h.waitForRun(id, (run) => run.status === "pending")).limits.maxConcurrency).toBe(2);
    expect((await h.control({ runID: id, action: "approve" })).status).toBe("accepted");
    expect((await result).status).toBe("running");
    const run = await h.waitForRun(id, (item) => item.status === "completed");
    expect(run.workers.a!.status).toBe("completed");
    expect(run.workers.b!.prompt).toBe("use output:build");
    expect(run.workers.a!.tokens?.total).toBe(6);
    expect(h.state.created.map((item) => item.model)).toEqual([{ providerID: "anthropic", id: "claude" }, { providerID: "anthropic", id: "haiku" }]);
    expect(h.state.created.map((item) => item.id)).toEqual([run.workers.a!.childSessionID!, run.workers.b!.childSessionID!]);
    expect(run.handoff?.summary).toBe("done");
    expect(h.state.synthetic).toHaveLength(1);
    expect(h.state.synthetic[0]).toMatchObject({ sessionID: "parent-session", id: run.synthesisMessageID });
    expect(h.state.synthetic[0]!.text).toContain(`<workflow_result run_id="${id}">`);
    expect(h.state.synthetic[0]!.text).toContain(`run stats: {"workers":{"completed":2},"durationMs":`);
    expect(h.state.synthetic[0]!.text).toContain(`<handoff>`);
  }, 15_000);

  test("collects a schema worker's result through the submit tool visible only to that worker", async () => {
    const h = await createHarness();
    const schema = { type: "object", properties: { count: { type: "number" } } };
    h.state.onPrompt = async (sessionID) => {
      const tools = { workflow_submit: { input: {} } };
      h.contextHook({ sessionID, tools });
      expect(tools.workflow_submit.input).toMatchObject({ properties: { result: schema } });
      await h.tools.get("workflow_submit")!.execute({ result: { count: 3 } }, { sessionID });
    };
    const { id } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [{ type: "worker", worker: { ...worker("a"), schema } }] }]));
    await h.control({ runID: id, action: "approve" });
    const run = await h.waitForRun(id, (item) => item.status === "completed");
    expect(run.workers.a!.output).toEqual({ count: 3 });
    const parentTools: Record<string, { input: unknown }> = { workflow_submit: { input: {} } };
    h.contextHook({ sessionID: "parent-session", tools: parentTools });
    expect(parentTools.workflow_submit).toBeUndefined();
  }, 15_000);

  test("resolves the waiting tool call when a pending plan is rejected", async () => {
    const h = await createHarness();
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]));
    expect((await h.control({ runID: id, action: "reject" })).status).toBe("accepted");
    expect((await result).status).toBe("rejected");
    const run = await h.waitForRun(id, (item) => item.status === "rejected");
    expect(run.terminalAt).toBeGreaterThan(0);
  }, 15_000);

  test("aborting a hung tool call leaves a run that has advanced past pre-start untouched", async () => {
    const h = await createHarness();
    const controller = new AbortController();
    let runID = "";
    const result = h.tools.get("workflow")!.execute({ spec: spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]) }, h.context(controller.signal, (id) => { runID = id; }));
    const id = await until(() => runID || undefined);
    const started = await Bun.file(statePath(h.root, id)).json() as WorkflowRun;
    started.status = "completed";
    started.workers.a!.status = "completed";
    await Bun.write(statePath(h.root, id), JSON.stringify(started, null, 2));
    controller.abort();
    await expect(result).rejects.toThrow("aborted");
    const after = await Bun.file(statePath(h.root, id)).json() as WorkflowRun;
    expect(after.status).toBe("completed");
    expect(after.workers.a!.status).toBe("completed");
  }, 15_000);

  test("blocks recoverably when the final handoff fails, then retries to completion", async () => {
    const h = await createHarness();
    h.state.failGenerate = true;
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]));
    await h.control({ runID: id, action: "approve" });
    await result;
    const blocked = await h.waitForRun(id, (item) => item.status === "blocked");
    expect(blocked.failure?.kind).toBe("handoff");
    expect(blocked.error).toContain("Final handoff failed");
    h.state.failGenerate = false;
    expect((await h.control({ runID: id, action: "failure_retry" })).status).toBe("accepted");
    const run = await h.waitForRun(id, (item) => item.status === "completed");
    expect(run.handoff?.summary).toBe("done");
  }, 15_000);

  test("blocks recoverably when the coordinator fails at a checkpoint", async () => {
    const h = await createHarness();
    h.state.failGenerate = true;
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", checkpoint: true, steps: [workerStep("a")] }]));
    await h.control({ runID: id, action: "approve" });
    await result;
    const blocked = await h.waitForRun(id, (item) => item.status === "blocked");
    expect(blocked.failure?.kind).toBe("coordinator");
    expect(blocked.error).toContain("Coordinator failed");
    expect(blocked.coordinator?.status).toBe("failed");
  }, 15_000);

  test("blocks recoverably on a worker failure while the tool call stays decoupled from the run", async () => {
    const h = await createHarness();
    h.state.failCreate = true;
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]));
    await h.control({ runID: id, action: "approve" });
    expect((await result).status).toBe("running");
    const blocked = await h.waitForRun(id, (item) => item.status === "blocked");
    expect(blocked.failure?.workerID).toBe("a");
    expect(blocked.error).toContain("Worker a failed");
    expect(blocked.terminalAt).toBeUndefined();
    h.state.failCreate = false;
    expect((await h.control({ runID: id, action: "failure_retry" })).status).toBe("accepted");
    expect((await h.waitForRun(id, (item) => item.status === "completed")).handoff?.summary).toBe("done");
  }, 15_000);

  test("ignores stop for a lease-less resumable run instead of crashing", async () => {
    const h = await createHarness();
    const id = "interrupted-run";
    const run = {
      version: 1, id, parentSessionID: "parent-session", parentMessageID: "parent-message",
      createdAt: Date.now(), updatedAt: Date.now(), status: "interrupted",
      spec: spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]),
      limits: { maxWorkers: 100, maxRevisions: 10, maxRunMs: 21_600_000, maxConcurrency: 2 },
      workers: {},
    } as unknown as WorkflowRun;
    await mkdir(runDirectory(h.root, id), { recursive: true });
    await Bun.write(statePath(h.root, id), JSON.stringify(run));
    const outcome = await h.control({ runID: id, action: "stop" });
    expect(outcome.status).toBe("ignored");
    expect(outcome.error).toContain("interrupted");
    expect((await Bun.file(statePath(h.root, id)).json() as WorkflowRun).status).toBe("interrupted");
  }, 15_000);

  test("answers workflow_status from memory and disk without owning the lease", async () => {
    const h = await createHarness();
    const status = h.tools.get("workflow_status")!;
    const { id } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]));
    await h.waitForRun(id, (run) => run.status === "pending");
    const live = JSON.parse((await status.execute({ runID: id }, {})).content);
    expect(live).toMatchObject({ runID: id, name: "server-test", status: "pending", revisions: 0 });
    expect(live.phases).toEqual([{ id: "p1", title: "Phase", status: "pending" }]);
    // Written after startup, so it only exists on disk — the cross-process path.
    const foreign = { version: 1, id: "foreign-run", parentSessionID: "parent-session", parentMessageID: "parent-message", createdAt: 1, updatedAt: 1, status: "running", spec: spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]), limits: { maxWorkers: 100, maxRevisions: 10, maxRunMs: 21_600_000, maxConcurrency: 2 }, workers: {} };
    await mkdir(runDirectory(h.root, "foreign-run"), { recursive: true });
    await Bun.write(statePath(h.root, "foreign-run"), JSON.stringify(foreign));
    expect(JSON.parse((await status.execute({ runID: "foreign-run" }, {})).content)).toMatchObject({ runID: "foreign-run", status: "running" });
    await expect(status.execute({ runID: "missing-run" }, {})).rejects.toThrow("No workflow run found for missing-run");
  }, 15_000);

  test("runs a parallel group at the configured max_concurrency", async () => {
    const h = await createHarness({ max_concurrency: 3 });
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [{ type: "parallel", id: "group", workers: [worker("a"), worker("b"), worker("c")] }] }]));
    await h.control({ runID: id, action: "approve" });
    await result;
    const run = await h.waitForRun(id, (item) => item.status === "completed");
    expect(run.limits.maxConcurrency).toBe(3);
    expect(run.workers.c!.status).toBe("completed");
    expect(h.state.maxInFlight).toBe(3);
  }, 15_000);

  test("frees a concurrency slot as soon as a worker finishes", async () => {
    const h = await createHarness({ max_concurrency: 2 });
    h.state.promptDelay = (text) => text.includes("slow") ? 400 : 10;
    const workers = [worker("slow", "slow"), worker("quick", "quick"), worker("last", "last")];
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [{ type: "parallel", id: "group", workers }] }]));
    await h.control({ runID: id, action: "approve" });
    await result;
    const run = await h.waitForRun(id, (item) => item.status === "completed");
    // Fixed batches would hold "last" until the whole [slow, quick] batch drained; a pool starts it
    // the moment "quick" releases its slot, so it finishes long before "slow" does.
    expect(run.workers.last!.endedAt!).toBeLessThan(run.workers.slow!.endedAt!);
    expect(h.state.maxInFlight).toBe(2);
  }, 15_000);
});
