import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { Tool } from "@opencode/plugin";
import plugin from "./server.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  mock.restore();
});

async function setup(allow: string[] = [], name = "search") {
  type Evaluation = {
    source: { id: string };
    action: string;
    resources: string[];
    effect: "allow" | "ask" | "deny";
  };
  let evaluate: (event: Evaluation) => void = () => {};
  let clear: (input: { sessionID: string }) => Promise<{ cleared: number }> = async () => ({ cleared: 0 });
  let effect: Evaluation["effect"] = "allow";
  const permission = mock(async (input: Omit<Evaluation, "effect">) => {
    evaluate({ ...input, effect });
    if (effect === "deny") throw new Error("Denied");
  });
  const backend = mock(async () => ({ output: { value: 42 } }));
  const tool: Tool.Info & { id: string } = {
    id: "docs_search",
    name,
    description: "Search docs",
    input: { type: "object" },
    options: { namespace: "docs", codemode: true },
    execute: async (_input, context) => {
      await permission({ source: { id: context.id }, action: "docs_search", resources: ["*"] });
      return backend();
    },
  };
  const cleanup = await plugin.setup({
    options: { allow },
    permission: {
      hook: async (_name: string, hook: typeof evaluate) => { evaluate = hook; },
      assert: permission,
    },
    tool: {
      transform: async (transform: (editor: unknown) => void) => transform({
        list: () => [tool],
        update: (_id: string, update: (draft: typeof tool) => void) => update(tool),
      }),
    },
    rpc: {
      register: async (_rpc: unknown, handlers: { clear: typeof clear }) => { clear = handlers.clear; },
    },
    event: { subscribe: async function* () {} },
  } as never);
  if (cleanup) cleanups.push(cleanup);
  let id = 0;
  return {
    backend,
    permission,
    clear,
    policy: (value: Evaluation["effect"]) => { effect = value; },
    call: (input = {}, sessionID = "session-a", agent = "build", callID = `call-${++id}`) => tool.execute(input, {
      sessionID, agent, id: callID, messageID: "message", signal: new AbortController().signal,
    } as never),
  };
}

test("allow patterns, argument normalization, session isolation, TTL, and manual clear", async () => {
  const uncached = await setup();
  await uncached.call();
  await uncached.call();
  expect(uncached.backend).toHaveBeenCalledTimes(2);

  let now = 1000;
  spyOn(Date, "now").mockImplementation(() => now);
  const cache = await setup(["docs.searc?"]);
  const first = await cache.call({ query: "api", page: 1 });
  (first.output as { value: number }).value = 0;
  expect((await cache.call({ page: 1, query: "api" })).output).toEqual({ value: 42 });
  expect(cache.backend).toHaveBeenCalledTimes(1);
  await cache.call({ page: 1, query: "api" }, "session-b");
  await cache.call({ page: 1, query: "api" }, "session-a", "review");
  expect(cache.backend).toHaveBeenCalledTimes(3);

  now += 300_000;
  await cache.call({ query: "api", page: 1 });
  expect(cache.backend).toHaveBeenCalledTimes(4);
  expect(await cache.clear({ sessionID: "session-a" })).toEqual({ cleared: 1 });
  await cache.call({ query: "api", page: 1 });
  expect(cache.backend).toHaveBeenCalledTimes(5);
});

test("errors and approvals are not cached; hits respect changed permissions", async () => {
  const cache = await setup(["docs_*"]);
  cache.backend.mockRejectedValueOnce(new Error("Backend unavailable"));
  await expect(cache.call()).rejects.toThrow("Backend unavailable");
  await cache.call();
  await cache.call();
  expect(cache.backend).toHaveBeenCalledTimes(2);
  cache.policy("deny");
  await expect(cache.call()).rejects.toThrow("Denied");
  expect(cache.backend).toHaveBeenCalledTimes(2);

  await cache.clear({ sessionID: "session-a" });
  cache.policy("ask");
  await cache.call();
  await cache.call();
  expect(cache.backend).toHaveBeenCalledTimes(4);
});

test("clearing during a backend request prevents that request from refilling the cache", async () => {
  const cache = await setup(["docs_search"]);
  let finish!: (result: { output: { value: number } }) => void;
  cache.backend.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = cache.call();
  // Let the executor finish its permission check and enter the backend.
  await Promise.resolve();
  await cache.clear({ sessionID: "session-a" });
  finish({ output: { value: 42 } });
  await pending;
  await cache.call();
  expect(cache.backend).toHaveBeenCalledTimes(2);
});

test("overlapping Code Mode calls sharing an ID cannot lose permission checks", async () => {
  const cache = await setup(["docs_search"]);
  const check = cache.permission.getMockImplementation()!;
  const evaluateFirst = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const finishSecond = Promise.withResolvers<{ output: { value: number } }>();
  cache.permission.mockImplementationOnce(async (input) => {
    await evaluateFirst.promise;
    await check(input);
  });
  cache.backend.mockImplementationOnce(() => {
    secondStarted.resolve();
    return finishSecond.promise;
  });

  const first = cache.call({ query: "first" }, "session-a", "build", "shared");
  const second = cache.call({ query: "second" }, "session-a", "build", "shared");
  await secondStarted.promise;
  cache.policy("ask");
  evaluateFirst.resolve();
  await first;
  finishSecond.resolve({ output: { value: 42 } });
  await second;

  cache.policy("deny");
  await expect(cache.call({ query: "first" })).rejects.toThrow("Denied");
  await expect(cache.call({ query: "second" })).rejects.toThrow("Denied");
  expect(cache.backend).toHaveBeenCalledTimes(2);
});

test("allow patterns match normalized Code Mode tool names", async () => {
  const cache = await setup(["docs.repo_get_issue"], "repo/get_issue");
  await cache.call();
  await cache.call();
  expect(cache.backend).toHaveBeenCalledTimes(1);
});
