import { describe, expect, test } from "bun:test";
import {
  compactUrl,
  fingerprint,
  isCodexResponsesEndpoint,
  isResponsesEndpoint,
  planRequest,
  readCompactedWindow,
  splitEnvelope,
  type CompactionState,
  type ResponsesBody,
} from "./openai_compaction_shared.ts";
import plugin from "./openai_compaction.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENDPOINT = "https://api.openai.com/v1/responses";
const USER_MESSAGE_ID = "msg_019000000001ABCDEFGHIJKLMN";

function user(text: string) {
  return { role: "user", content: [{ type: "input_text", text }] };
}

function assistant(id: string, text: string) {
  return { type: "message", role: "assistant", id, content: [{ type: "output_text", text }] };
}

function toolCall(callID: string, name: string) {
  return { type: "function_call", call_id: callID, name, arguments: "{}" };
}

function toolResult(callID: string, output: string) {
  return { type: "function_call_output", call_id: callID, output };
}

function history(turns: number, filler = "x".repeat(400)) {
  return Array.from({ length: turns }, (_, index) => [
    user(`turn ${index} ${filler}`),
    assistant(`msg_${index}`, `reply ${index} ${filler}`),
    toolCall(`call_${index}`, "read"),
    toolResult(`call_${index}`, `${filler}${filler}`),
  ]).flat();
}

function body(input: unknown[], overrides: Partial<ResponsesBody> = {}): ResponsesBody {
  return { model: "gpt-5.5", input, stream: true, ...overrides };
}

function state(overrides: Partial<CompactionState> = {}): CompactionState {
  return {
    sessionID: "ses_1",
    model: "gpt-5.5",
    endpoint: ENDPOINT,
    compactedCount: 20,
    signature: "1:deadbeef",
    window: [{ type: "message", id: "compacted" }],
    ...overrides,
  };
}

describe("endpoints", () => {
  test("recognizes Responses endpoints and derives the direct compact URL", () => {
    expect(isResponsesEndpoint(ENDPOINT)).toBe(true);
    expect(isResponsesEndpoint("https://chatgpt.com/backend-api/codex/responses")).toBe(true);
    expect(isResponsesEndpoint("https://api.openai.com/v1/chat/completions")).toBe(false);
    expect(isCodexResponsesEndpoint("https://chatgpt.com/backend-api/codex/responses")).toBe(true);
    expect(compactUrl(ENDPOINT)).toBe("https://api.openai.com/v1/responses/compact");
  });

});

describe("payload parsing", () => {
  test("splits the leading prompt envelope from history", () => {
    const input = [{ role: "system", content: "be brief" }, user("hi"), assistant("msg_0", "hello")];
    const { envelope, history: rest } = splitEnvelope(input);
    expect(envelope).toHaveLength(1);
    expect(rest).toHaveLength(2);
  });

  test("reads the compacted window from a compact response", () => {
    expect(readCompactedWindow({ id: "resp_1", output: [{ type: "message" }] })).toHaveLength(1);
    expect(readCompactedWindow({ error: "nope" })).toBeUndefined();
  });
});

describe("fingerprint", () => {
  test("survives tool output pruning", () => {
    const before = [toolCall("call_0", "read"), toolResult("call_0", "a".repeat(5000))];
    const after = [toolCall("call_0", "read"), toolResult("call_0", "[compacted]")];
    expect(fingerprint(before)).toBe(fingerprint(after));
  });

  test("changes when history is reordered", () => {
    const items = [user("a"), assistant("msg_0", "b")];
    expect(fingerprint(items)).not.toBe(fingerprint([items[1], items[0]]));
  });
});

describe("planRequest", () => {
  const contextLimit = 1_000_000;
  const oversized = 1_000;

  test("passes through below the threshold", async () => {
    const plan = await planRequest({
      body: body([user("hi"), assistant("msg_0", "hello")]),
      state: undefined,
      endpoint: ENDPOINT,
      contextLimit,
      threshold: 0.7,
      latestTokens: 1_000,
    });
    expect(plan.type).toBe("passthrough");
  });

  test("compacts everything before the last user turn once oversized", async () => {
    const items = history(6);
    const plan = await planRequest({
      body: body([{ role: "system", content: "prompt" }, ...items]),
      state: undefined,
      endpoint: ENDPOINT,
      contextLimit: oversized,
      threshold: 0.7,
      latestTokens: 800,
    });
    if (plan.type !== "compact") throw new Error(`expected compact, got ${plan.type}`);
    expect(plan.instructions).toBe("prompt");
    expect(plan.keptTail).toEqual(items.slice(-4));
    expect(plan.compactedCount).toBe(items.length - 4);
  });

  test("replays a stored window on later turns", async () => {
    const items = history(6);
    const stored = state({ signature: fingerprint(items.slice(0, 20)) });
    const plan = await planRequest({
      body: body([{ role: "system", content: "prompt" }, ...items]),
      state: stored,
      endpoint: ENDPOINT,
      contextLimit: 1_000_000,
      threshold: 0.7,
      latestTokens: 1_000,
    });
    if (plan.type !== "replay") throw new Error(`expected replay, got ${plan.type}`);
    expect(plan.input).toEqual([{ role: "system", content: "prompt" }, ...stored.window, ...items.slice(20)]);
  });

  test("chains a second compaction on top of the stored window", async () => {
    const items = history(10);
    const window = [{ type: "message", id: "compacted" }];
    const plan = await planRequest({
      body: body(items),
      state: state({ signature: fingerprint(items.slice(0, 20)), window }),
      endpoint: ENDPOINT,
      contextLimit: oversized,
      threshold: 0.7,
      latestTokens: 800,
    });
    if (plan.type !== "compact") throw new Error(`expected compact, got ${plan.type}`);
    expect(plan.compactInput[0]).toBe(window[0]);
    expect(plan.keptTail).toEqual(items.slice(-4));
    expect(plan.fallbackInput).toEqual([...window, ...items.slice(20)]);
  });

  test("repeatedly compacts autonomous exchanges without another user message", () => {
    const first = [user("implement the feature"), toolCall("a", "read"), toolResult("a", "source")];
    const latest = [
      { type: "reasoning", id: "rs_1", encrypted_content: "reasoning" },
      assistant("msg_1", "Inspecting two files"),
      toolCall("b", "read"),
      toolCall("c", "read"),
      toolResult("c", "second file"),
      toolResult("b", "first file"),
    ];
    const items = [...first, ...latest];
    const request = { endpoint: ENDPOINT, contextLimit: oversized, threshold: 0.7, latestTokens: 800 };
    const plan = planRequest({ ...request, body: body(items), state: undefined });
    if (plan.type !== "compact") throw new Error(`expected compact, got ${plan.type}`);
    expect(plan.compactInput).toEqual(first);
    expect(plan.keptTail).toEqual(latest);

    const window = [user("implement the feature"), { type: "compaction", encrypted_content: "opaque" }];
    const stored = state({ compactedCount: plan.compactedCount, signature: plan.signature, window });
    const unchanged = planRequest({ ...request, body: body(items), state: stored });
    expect(unchanged.type).toBe("replay");
    if (unchanged.type === "replay") expect(unchanged.reason).toBe("no_compactable_history");

    const next = [toolCall("d", "edit"), toolResult("d", "updated")];
    const again = planRequest({ ...request, body: body([...items, ...next]), state: stored });
    if (again.type !== "compact") throw new Error(`expected compact, got ${again.type}`);
    expect(again.compactInput).toEqual([...window, ...latest]);
    expect(again.keptTail).toEqual(next);
    expect(again.compactedCount).toBe(items.length);
    expect(again.signature).toBe(fingerprint(items));
  });

  test("does not split unresolved parallel calls and supports history without user messages", () => {
    const first = [toolCall("a", "read"), toolResult("a", "source")];
    const latest = [
      { type: "reasoning", id: "rs_1", encrypted_content: "reasoning" },
      toolCall("b", "read"),
      toolCall("c", "read"),
      toolResult("b", "first file"),
      assistant("msg_1", "Waiting for the other result"),
      toolResult("c", "second file"),
    ];
    const request = { endpoint: ENDPOINT, contextLimit: oversized, threshold: 0.7, latestTokens: 800 };
    const plan = planRequest({ ...request, body: body([...first, ...latest]), state: undefined });
    if (plan.type !== "compact") throw new Error(`expected compact, got ${plan.type}`);
    expect(plan.compactInput).toEqual(first);
    expect(plan.keptTail).toEqual(latest);

    const single = planRequest({ ...request, body: body([user("start"), ...latest]), state: undefined });
    expect(single.type).toBe("passthrough");
    if (single.type === "passthrough") expect(single.reason).toBe("no_compactable_history");
  });

  test("never cuts the kept tail into the opaque window", async () => {
    const items = [...history(5), user("only recent turn")];
    const window = [{ type: "message", id: "compacted" }];
    const plan = await planRequest({
      body: body(items),
      state: state({
        compactedCount: items.length - 1,
        signature: fingerprint(items.slice(0, items.length - 1)),
        window,
      }),
      endpoint: ENDPOINT,
      contextLimit: 10,
      threshold: 0.7,
      latestTokens: 10,
    });
    if (plan.type !== "replay") throw new Error(`expected replay, got ${plan.type}`);
    expect(plan.input).toEqual([...window, items.at(-1)]);
  });

  test("drops stale state when history no longer matches", async () => {
    expect(
      (
        await planRequest({
          body: body(history(6)),
          state: state({ signature: "1:deadbeef" }),
          endpoint: ENDPOINT,
          contextLimit: 1_000_000,
          threshold: 0.7,
          latestTokens: 1_000,
        })
      ).type,
    ).toBe("passthrough");
  });

  test("skips compaction when the model has no known context limit", async () => {
    expect(
      (
        await planRequest({
          body: body(history(10)),
          state: undefined,
          endpoint: ENDPOINT,
          contextLimit: 0,
          threshold: 0.7,
          latestTokens: 100_000,
        })
      ).type,
    ).toBe("passthrough");
  });

  test("uses an absolute token threshold without a known context limit", async () => {
    expect(
      (
        await planRequest({
          body: body(history(6)),
          state: undefined,
          endpoint: ENDPOINT,
          contextLimit: 0,
          threshold: 1_000,
          latestTokens: 1_000,
        })
      ).type,
    ).toBe("compact");
  });

});

describe("plugin", () => {
  type Call = { url: string; init: RequestInit };
  type PartUpdate = {
    url: string;
    path: { sessionID: string; messageID: string; partID: string };
    query: { directory: string };
    body: {
      id: string;
      sessionID: string;
      messageID: string;
      type: "text";
      text: string;
      synthetic: true;
      ignored: true;
    };
  };
  async function createHarness(
    overrides: {
      compact?: () => Response;
      main?: () => Response;
      contextLimit?: number;
      latestTokens?: number;
      latestProviderID?: string;
      latestModelID?: string;
      messagesFail?: boolean;
      threshold?: number | `${number}%`;
      providerID?: string;
      additionalProviders?: string[];
      endpoint?: string;
    } = {},
  ) {
    const dataHome = join(tmpdir(), `openai-compaction-${Bun.hash.wyhash(`${Math.random()}`).toString(16)}`);
    process.env.XDG_DATA_HOME = dataHome;
    const calls: Call[] = [];
    const partUpdates: PartUpdate[] = [];
    const stub = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, init: init ?? {} });
      const streamingCompact = requestBody?.input?.at(-1)?.type === "compaction_trigger";
      if (url.endsWith("/compact") || streamingCompact) {
        return (
          overrides.compact?.() ??
          (streamingCompact
            ? new Response(
                [
                  'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"compacted"}}',
                  'data: {"type":"response.completed","response":{"status":"completed"}}',
                  "",
                ].join("\n\n"),
                { status: 200, headers: { "content-type": "text/event-stream" } },
              )
            : new Response(JSON.stringify({ id: "resp_1", output: [{ type: "message", id: "compacted" }] }), {
                status: 200,
              }))
        );
      }
      return overrides.main?.() ?? new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;

    const previous = globalThis.fetch;
    globalThis.fetch = stub;
    const hooks = (await plugin.server(
      {
        client: {
          app: { log: async () => {} },
          session: {
            messages: async () => {
              if (overrides.messagesFail) throw new Error("messages unavailable");
              return {
                data: [
                  {
                    info: {
                      id: "msg_previous",
                      sessionID: "ses_1",
                      role: "assistant",
                      providerID: overrides.latestProviderID ?? overrides.providerID ?? "openai",
                      modelID: overrides.latestModelID ?? "gpt-5.5",
                      mode: "build",
                      tokens: {
                        input: overrides.latestTokens ?? 1_000_000,
                        output: 0,
                        reasoning: 0,
                        cache: { read: 0, write: 0 },
                      },
                    },
                    parts: [],
                  },
                ],
              };
            },
            _client: {
              patch: async (input: PartUpdate) => {
                partUpdates.push(input);
                return { data: input.body };
              },
            },
          },
          tui: { showToast: async () => {} },
        },
        project: { id: "proj" },
        directory: dataHome,
      } as never,
      {
        threshold: overrides.threshold ?? 0.1,
        additionalProviders: overrides.additionalProviders,
      },
    )) as {
      "chat.headers": (input: unknown, output: { headers: Record<string, string> }) => Promise<void>;
      "experimental.session.compaction.decide": (
        input: unknown,
        output: { action: "compact" | "continue" },
      ) => Promise<void>;
      event: (input: { event: unknown }) => Promise<void>;
      dispose: () => Promise<void>;
    };
    const patched = globalThis.fetch;

    const headers: Record<string, string> = {};
    await hooks["chat.headers"](
      {
        sessionID: "ses_1",
        agent: "build",
        message: { id: USER_MESSAGE_ID, model: { variant: "high" } },
        model: {
          providerID: overrides.providerID ?? "openai",
          id: "gpt-5.5",
          limit: { context: overrides.contextLimit ?? 1_000 },
        },
      },
      { headers },
    );

    const send = (input: unknown[]) =>
      patched(overrides.endpoint ?? ENDPOINT, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body(input)),
      });

    return {
      calls,
      partUpdates,
      headers,
      send,
      emit: hooks.event,
      decide: async () => {
        const output = { action: "compact" as "compact" | "continue" };
        await hooks["experimental.session.compaction.decide"]({
          sessionID: "ses_1",
          agent: "build",
          model: { providerID: "openai", id: "gpt-5.5" },
          tokens: { input: 1_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }, output);
        return output.action;
      },
      dataHome,
      dispose: async () => {
        await hooks.dispose();
        globalThis.fetch = previous;
      },
    };
  }

  function sent(call: Call | undefined): Call {
    if (!call) throw new Error("expected a request");
    return call;
  }

  const sentInput = (call: Call | undefined) => JSON.parse(sent(call).init.body as string).input as unknown[];

  const stateFile = (harness: { dataHome: string }) =>
    Bun.file(join(harness.dataHome, "opencode", "openai-compaction", "proj", "ses_1.json"));

  test("allows built-in compaction when native compaction cannot advance", async () => {
    const harness = await createHarness();
    try {
      const items = [user("start"), toolCall("a", "read"), toolResult("a", "source")];
      await harness.send(items);
      expect(harness.calls).toHaveLength(1);
      expect(await harness.decide()).toBe("compact");

      await harness.send([...items, toolCall("b", "edit"), toolResult("b", "updated")]);
      expect(harness.calls).toHaveLength(3);
      expect(await harness.decide()).toBe("continue");
    } finally {
      await harness.dispose();
    }
  });

  test("compacts requests from configured additional providers", async () => {
    const endpoint = "https://openai-compatible.example/v1/responses";
    const harness = await createHarness({
      providerID: "openai-compatible",
      additionalProviders: ["openai-compatible"],
      endpoint,
    });
    await harness.send(history(6));

    expect(harness.calls).toHaveLength(2);
    expect(sent(harness.calls[0]).url).toBe(compactUrl(endpoint));
    await harness.dispose();
  });

  test("uses streaming V2 compaction for the ChatGPT Codex endpoint", async () => {
    const endpoint = "https://chatgpt.com/backend-api/codex/responses";
    const harness = await createHarness({ endpoint });
    const items = history(6);
    await harness.send(items);

    expect(harness.calls).toHaveLength(2);
    const [compactCall, sentCall] = harness.calls;
    expect(sent(compactCall).url).toBe(endpoint);
    const compactBody = JSON.parse(sent(compactCall).init.body as string);
    expect(compactBody.input.at(-1)).toEqual({ type: "compaction_trigger" });
    expect(sentInput(sentCall)).toEqual([
      ...items.slice(0, -4).filter((item) => "role" in item && item.role === "user"),
      { type: "compaction", encrypted_content: "compacted" },
      ...items.slice(-4),
    ]);
    await harness.dispose();
  });

  test("leaves unconfigured providers untouched", async () => {
    const harness = await createHarness({
      providerID: "openai-compatible",
      endpoint: "https://openai-compatible.example/v1/responses",
    });
    const items = history(6);
    await harness.send(items);

    expect(harness.calls).toHaveLength(1);
    expect(sentInput(harness.calls[0])).toEqual(items);
    await harness.dispose();
  });

  test("rejects invalid percentage thresholds", async () => {
    await expect(plugin.server({} as never, { threshold: "101%" } as never)).rejects.toThrow(
      "OpenAI compaction threshold must be a positive number or a percentage in (0%, 100%]",
    );
  });

  test("waits until the latest OpenCode count reaches the threshold", async () => {
    const harness = await createHarness({ contextLimit: 1_000, threshold: 0.5, latestTokens: 449 });
    const items = history(6);
    await harness.send(items);

    expect(harness.calls).toHaveLength(1);
    expect(sentInput(harness.calls[0])).toEqual(items);
    await harness.dispose();
  });

  test("uses message updates as the latest OpenCode count", async () => {
    const harness = await createHarness({ contextLimit: 1_000, threshold: 0.5, latestTokens: 0 });
    await harness.emit({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_latest",
            sessionID: "ses_1",
            role: "assistant",
            providerID: "openai",
            modelID: "gpt-5.5",
            mode: "build",
            tokens: { input: 350, output: 50, reasoning: 25, cache: { read: 75, write: 0 } },
          },
        },
      },
    });
    await harness.send(history(6));

    expect(harness.calls).toHaveLength(2);
    await harness.dispose();
  });

  test("passes through when the latest OpenCode count cannot be loaded", async () => {
    const harness = await createHarness({
      contextLimit: 1_000,
      threshold: 0.5,
      messagesFail: true,
    });
    await harness.send(history(6));

    expect(harness.calls).toHaveLength(1);
    await harness.dispose();
  });

  test("uses the latest OpenCode count after a model switch", async () => {
    const harness = await createHarness({
      contextLimit: 1_000,
      threshold: 0.5,
      latestTokens: 100,
      latestModelID: "gpt-5.4",
    });
    await harness.send(history(6));

    expect(harness.calls).toHaveLength(1);
    await harness.dispose();
  });

  test("compacts an oversized request and replays the window on the next turn", async () => {
    // Sized so the full history is over the threshold but the replayed window plus
    // the kept tail is under it, i.e. the next turn replays instead of recompacting.
    const harness = await createHarness({ contextLimit: 10_000 });
    const items = history(6);
    await harness.send(items);

    const [compactCall, sentCall] = harness.calls;
    expect(sent(compactCall).url).toBe(compactUrl(ENDPOINT));
    expect(sentInput(sentCall)).toEqual([{ type: "message", id: "compacted" }, ...items.slice(-4)]);
    expect(harness.partUpdates).toHaveLength(2);
    expect(harness.partUpdates[1]?.body.text).toBe("--- Context compacted ---");
    expect(new Headers(sent(sentCall).init.headers).get("x-opencode-openai-compaction")).toBeNull();
    expect(await stateFile(harness).exists()).toBe(true);

    await harness.emit({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_compacted",
            sessionID: "ses_1",
            role: "assistant",
            providerID: "openai",
            modelID: "gpt-5.5",
            mode: "build",
            tokens: { input: 700, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    });
    const next = [...items, user("what did we decide?")];
    harness.calls.length = 0;
    await harness.send(next);
    expect(harness.calls).toHaveLength(1);
    expect(sentInput(harness.calls[0])).toEqual([
      { type: "message", id: "compacted" },
      ...next.slice(items.length - 4),
    ]);
    await harness.dispose();
  });

  test("sends the original request when the compact endpoint fails", async () => {
    const harness = await createHarness({ compact: () => new Response("nope", { status: 404 }) });
    const items = history(6);
    await harness.send(items);

    expect(harness.calls).toHaveLength(2);
    expect(sentInput(harness.calls[1])).toEqual(items);
    expect(harness.partUpdates.at(-1)?.body.text).toBe("--- Context compaction failed ---");

    harness.calls.length = 0;
    await harness.send(items);
    expect(harness.calls).toHaveLength(1);
    expect(sentInput(harness.calls[0])).toEqual(items);
    await harness.dispose();
  });

  test("stops rewriting after the provider rejects a freshly compacted payload", async () => {
    const harness = await createHarness({ main: () => new Response("bad request", { status: 400 }) });
    const items = history(6);
    await harness.send(items);

    expect(harness.calls).toHaveLength(2);
    expect(await stateFile(harness).exists()).toBe(false);

    harness.calls.length = 0;
    await harness.send(items);
    expect(harness.calls).toHaveLength(1);
    expect(sentInput(harness.calls[0])).toEqual(items);
    await harness.dispose();
  });

  test("leaves untagged requests untouched", async () => {
    const harness = await createHarness();
    await globalThis.fetch(ENDPOINT, { method: "POST", body: JSON.stringify(body(history(6))) });
    expect(harness.calls).toHaveLength(1);
    expect(sentInput(harness.calls[0])).toHaveLength(24);
    await harness.dispose();
  });

  test("restores the original fetch on dispose", async () => {
    const before = globalThis.fetch;
    const harness = await createHarness();
    expect(globalThis.fetch).not.toBe(before);
    await harness.dispose();
    expect(globalThis.fetch).toBe(before);
  });
});
