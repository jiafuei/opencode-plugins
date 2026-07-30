import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import workflows from "./workflow_server.ts";
import { controlDirectory, runDirectory, statePath, tuiPresencePath, workflowProjectDirectory, type WorkflowRun } from "./workflow_shared.ts";

process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "workflow-server-test-"));

type ToolResult = { output: string };
type ServerHooks = {
  tool: { workflow: { execute: (args: { spec: unknown }, context: unknown) => Promise<ToolResult> } };
  dispose: () => Promise<void>;
};

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

const model = { providerID: "anthropic", modelID: "claude" };
const handoffResult = { summary: "done", completedWork: ["work"], evidence: [], changedFiles: [], verification: [], unresolvedIssues: [], recommendedNextAction: "none" };

async function createHarness(options: Record<string, unknown> = {}) {
  const projectID = `test-${crypto.randomUUID()}`;
  const directory = "/tmp/workflow-server-test-project";
  const root = workflowProjectDirectory(projectID, directory);
  const state = {
    sessions: 0,
    inFlight: 0,
    maxInFlight: 0,
    failChildren: false,
    agents: ["build", "general"],
    models: ["claude"],
    agentRefreshes: 0,
    modelRefreshes: 0,
    synthetic: [] as string[],
    syntheticBody: undefined as { agent?: string; model?: { providerID: string; modelID: string } } | undefined,
    created: [] as Array<{ agent?: string; model?: { providerID: string; id: string } }>,
    onPrompt: undefined as ((agent: string) => void) | undefined,
  };
  const client = {
    app: { log: async () => ({}), agents: async () => { state.agentRefreshes++; return { data: state.agents.map((name) => ({ name })) }; } },
    provider: { list: async () => { state.modelRefreshes++; return { data: { all: [{ id: "anthropic", models: Object.fromEntries(state.models.map((id) => [id, {}])) }], default: {}, connected: ["anthropic"] } }; } },
    session: {
      create: async (input: { body: { agent?: string; model?: { providerID: string; id: string } } }) => { state.created.push(input.body); return { data: { id: `session-${++state.sessions}` } }; },
      prompt: async (input: { body: { agent: string; format?: unknown; parts: Array<{ text: string }> } }) => {
        state.inFlight++;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        await Bun.sleep(50);
        state.inFlight--;
        state.onPrompt?.(input.body.agent);
        if (input.body.format) {
          const structured = input.body.agent === "workflow-coordinator-internal" ? { rationale: "keep the plan", phases: [] } : handoffResult;
          return { data: { info: { structured }, parts: [] } };
        }
        return { data: { info: {}, parts: [{ type: "text", text: `output:${input.body.agent}` }] } };
      },
      promptAsync: async (input: { body: { agent?: string; model?: { providerID: string; modelID: string }; parts: Array<{ text: string }> } }) => { state.synthetic.push(input.body.parts[0]!.text); state.syntheticBody = input.body; return { data: {} }; },
      abort: async () => ({ data: true }),
      children: async () => state.failChildren ? { error: { status: 500, message: "children unavailable" } } : { data: [] },
      delete: async () => ({ data: true }),
      get: async () => ({ data: { permission: [] } }),
      message: async (input: { path: { messageID: string } }) => input.path.messageID === "parent-message" ? { data: { info: { role: "assistant", providerID: model.providerID, modelID: model.modelID, agent: "parent-agent" } } } : { error: { status: 404 } },
    },
  };
  const server = workflows.server as unknown as (input: unknown, options?: Record<string, unknown>) => Promise<ServerHooks>;
  const hooks = await server({ client, project: { id: projectID }, directory }, options);
  disposers.push(() => hooks.dispose());

  const submit = async (spec: unknown) => {
    await Bun.write(tuiPresencePath(root), JSON.stringify({ heartbeatAt: Date.now() }));
    let runID = "";
    const context = {
      sessionID: "parent-session",
      messageID: "parent-message",
      abort: new AbortController().signal,
      metadata: (value: { metadata?: { workflowRunID?: string } }) => { runID = value.metadata?.workflowRunID ?? runID; },
    };
    const result = hooks.tool.workflow.execute({ spec }, context).then((value) => JSON.parse(value.output) as { runID: string; status: string });
    const id = await Promise.race([until(() => runID || undefined), result.then((value) => value.runID)]);
    return { id, result };
  };
  const control = async (value: Record<string, unknown>) => {
    await mkdir(controlDirectory(root), { recursive: true });
    const path = join(controlDirectory(root), `${Date.now()}-${crypto.randomUUID()}.json`);
    await Bun.write(`${path}.tmp`, JSON.stringify({ createdAt: Date.now(), ...value }));
    await rename(`${path}.tmp`, path);
  };
  const controlResult = (controlID: string) =>
    until(async () => await Bun.file(join(root, "control-results", `${controlID}.json`)).json().catch(() => undefined) as { status: string; error?: string } | undefined);
  const waitForRun = (id: string, ready: (run: WorkflowRun) => boolean) =>
    until(async () => {
      const run = await Bun.file(statePath(root, id)).json().catch(() => undefined) as WorkflowRun | undefined;
      return run && ready(run) ? run : undefined;
    });
  return { root, state, hooks, submit, control, controlResult, waitForRun };
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
  test("initializes while OpenCode client endpoints remain unresolved", async () => {
    const projectID = `test-${crypto.randomUUID()}`;
    const directory = "/tmp/workflow-server-test-project";
    const root = workflowProjectDirectory(projectID, directory);
    await mkdir(runDirectory(root, "broken"), { recursive: true });
    await Bun.write(statePath(root, "broken"), "{");
    const calls = { agents: 0, models: 0, sessions: 0, logs: 0 };
    const unresolved = () => new Promise<never>(() => {});
    const session = () => { calls.sessions++; return unresolved(); };
    const client = {
      app: {
        agents: () => { calls.agents++; return unresolved(); },
        log: () => { calls.logs++; return unresolved(); },
      },
      provider: { list: () => { calls.models++; return unresolved(); } },
      session: { create: session, prompt: session, promptAsync: session, abort: session, children: session, delete: session, get: session, message: session },
    };
    const server = workflows.server as unknown as (input: unknown) => Promise<ServerHooks>;
    const hooks = await Promise.race([server({ client, project: { id: projectID }, directory }), Bun.sleep(500).then(() => undefined)]);
    expect(hooks).toBeDefined();
    if (!hooks) return;
    disposers.push(() => hooks.dispose());
    expect(calls).toEqual({ agents: 0, models: 0, sessions: 0, logs: 0 });
  });

  test("refreshes agents and models before each workflow validation", async () => {
    const h = await createHarness();
    const context = { sessionID: "parent-session", messageID: "parent-message", abort: new AbortController().signal, metadata: () => {} };
    await Bun.write(tuiPresencePath(h.root), JSON.stringify({ heartbeatAt: Date.now() }));

    h.state.agents = ["general"];
    await expect(h.hooks.tool.workflow.execute({ spec: spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]) }, context)).rejects.toThrow("unregistered agent");
    expect([h.state.agentRefreshes, h.state.modelRefreshes]).toEqual([1, 1]);

    h.state.agents = ["build", "general"];
    h.state.models = ["sonnet"];
    await expect(h.hooks.tool.workflow.execute({ spec: spec([{ id: "p1", title: "Phase", steps: [{ type: "worker", worker: { ...worker("a"), modelID: "anthropic/claude" } }] }]) }, context)).rejects.toThrow("unavailable model");
    expect([h.state.agentRefreshes, h.state.modelRefreshes]).toEqual([2, 2]);
  });

  test("approves, renders templates across sequential workers, and completes with a synthetic handoff", async () => {
    const h = await createHarness();
    h.state.models = ["claude", "haiku"];
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [workerStep("a"), { type: "worker", worker: { ...worker("b", "use {{workers.a.output}}"), modelID: "anthropic/haiku" } }] }]));
    expect((await h.waitForRun(id, (run) => run.status === "pending")).limits.maxConcurrency).toBe(2);
    await h.control({ runID: id, action: "approve", controlID: "ctl-approve" });
    expect((await result).status).toBe("running");
    const run = await h.waitForRun(id, (item) => item.status === "completed");
    expect(run.workers.a!.status).toBe("completed");
    expect(run.workers.b!.prompt).toBe("use output:build");
    expect(h.state.created.filter((item) => item.agent === "build").map((item) => item.model)).toEqual([{ id: model.modelID, providerID: model.providerID }, { id: "haiku", providerID: "anthropic" }]);
    expect(h.state.syntheticBody).toMatchObject({ agent: "parent-agent", model });
    expect(run.handoff?.summary).toBe("done");
    expect(h.state.synthetic[0]).toContain(`<workflow_result run_id="${id}">`);
    expect((await h.controlResult("ctl-approve")).status).toBe("accepted");
  }, 15_000);

  test("resolves the waiting tool call when a pending plan is rejected", async () => {
    const h = await createHarness();
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]));
    await h.control({ runID: id, action: "reject", controlID: "ctl-reject" });
    expect((await result).status).toBe("rejected");
    const run = await h.waitForRun(id, (item) => item.status === "rejected");
    expect(run.terminalAt).toBeGreaterThan(0);
    expect((await h.controlResult("ctl-reject")).status).toBe("accepted");
  }, 15_000);

  test("aborting a hung tool call leaves a run that has advanced past pre-start untouched", async () => {
    const h = await createHarness();
    await Bun.write(tuiPresencePath(h.root), JSON.stringify({ heartbeatAt: Date.now() }));
    const controller = new AbortController();
    let runID = "";
    const context = { sessionID: "parent-session", messageID: "parent-message", abort: controller.signal, metadata: (value: { metadata?: { workflowRunID?: string } }) => { runID = value.metadata?.workflowRunID ?? runID; } };
    const result = h.hooks.tool.workflow.execute({ spec: spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]) }, context);
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

  test("blocks recoverably when handoff session recovery fails, then retries to completion", async () => {
    const h = await createHarness();
    h.state.onPrompt = (agent) => { if (agent === "build") h.state.failChildren = true; };
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", steps: [workerStep("a")] }]));
    await h.control({ runID: id, action: "approve" });
    await result;
    const blocked = await h.waitForRun(id, (item) => item.status === "blocked");
    expect(blocked.failure?.kind).toBe("handoff");
    expect(blocked.error).toContain("Handoff session recovery failed");
    h.state.onPrompt = undefined;
    h.state.failChildren = false;
    await h.control({ runID: id, action: "failure_retry", controlID: "ctl-retry" });
    const run = await h.waitForRun(id, (item) => item.status === "completed");
    expect(run.handoff?.summary).toBe("done");
    expect((await h.controlResult("ctl-retry")).status).toBe("accepted");
  }, 15_000);

  test("blocks recoverably when coordinator session recovery fails at a checkpoint", async () => {
    const h = await createHarness();
    h.state.onPrompt = (agent) => { if (agent === "build") h.state.failChildren = true; };
    const { id, result } = await h.submit(spec([{ id: "p1", title: "Phase", checkpoint: true, steps: [workerStep("a")] }]));
    await h.control({ runID: id, action: "approve" });
    await result;
    const blocked = await h.waitForRun(id, (item) => item.status === "blocked");
    expect(blocked.failure?.kind).toBe("coordinator");
    expect(blocked.error).toContain("Coordinator session recovery failed");
    expect(blocked.coordinator?.status).toBe("failed");
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
    await h.control({ runID: id, action: "stop", controlID: "ctl-stop" });
    const outcome = await h.controlResult("ctl-stop");
    expect(outcome.status).toBe("ignored");
    expect(outcome.error).toContain("interrupted");
    expect((await Bun.file(statePath(h.root, id)).json() as WorkflowRun).status).toBe("interrupted");
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
});
