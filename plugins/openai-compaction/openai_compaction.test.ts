import { describe, expect, test } from "bun:test";
import {
  compactUrl,
  fingerprint,
  isResponsesEndpoint,
  lastUserTurnIndex,
  planRequest,
  precedingMessageID,
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
  test("recognizes both OpenAI Responses endpoints", () => {
    expect(isResponsesEndpoint(ENDPOINT)).toBe(true);
    expect(isResponsesEndpoint("https://chatgpt.com/backend-api/codex/responses")).toBe(true);
    expect(isResponsesEndpoint("https://api.openai.com/v1/chat/completions")).toBe(false);
  });

  test("derives the compact url for both endpoints", () => {
    expect(compactUrl(ENDPOINT)).toBe("https://api.openai.com/v1/responses/compact");
    expect(compactUrl("https://chatgpt.com/backend-api/codex/responses")).toBe(
      "https://chatgpt.com/backend-api/codex/responses/compact",
    );
  });

  test("creates an indicator id before the active user message", () => {
    const id = precedingMessageID(USER_MESSAGE_ID);
    expect(id).toMatch(/^msg_[0-9a-f]{12}[0-9a-zA-Z]{14}$/);
    expect(id! < USER_MESSAGE_ID).toBe(true);
    expect(precedingMessageID("not-a-message-id")).toBeUndefined();
  });
});

describe("payload parsing", () => {
  test("splits the leading prompt envelope from history", () => {
    const input = [{ role: "system", content: "be brief" }, user("hi"), assistant("msg_0", "hello")];
    const { envelope, history: rest } = splitEnvelope(input);
    expect(envelope).toHaveLength(1);
    expect(rest).toHaveLength(2);
  });

  test("treats OAuth payloads as envelope-free", () => {
    const { envelope, history: rest } = splitEnvelope([user("hi"), assistant("msg_0", "hello")]);
    expect(envelope).toHaveLength(0);
    expect(rest).toHaveLength(2);
  });

  test("finds the last user turn", () => {
    expect(lastUserTurnIndex([user("a"), assistant("msg_0", "b"), user("c"), assistant("msg_1", "d")])).toBe(2);
    expect(lastUserTurnIndex([assistant("msg_0", "b")])).toBe(-1);
  });

  test("reads the compacted window from a compact response", () => {
    expect(readCompactedWindow({ id: "resp_1", output: [{ type: "message" }] })).toHaveLength(1);
    expect(readCompactedWindow({ output: [] })).toBeUndefined();
    expect(readCompactedWindow({ error: "nope" })).toBeUndefined();
  });
});

describe("fingerprint", () => {
  test("survives tool output pruning", () => {
    const before = [toolCall("call_0", "read"), toolResult("call_0", "a".repeat(5000))];
    const after = [toolCall("call_0", "read"), toolResult("call_0", "[compacted]")];
    expect(fingerprint(before)).toBe(fingerprint(after));
  });

  test("changes when items are inserted or reordered", () => {
    const items = [user("a"), assistant("msg_0", "b")];
    expect(fingerprint(items)).not.toBe(fingerprint([...items, user("c")]));
    expect(fingerprint(items)).not.toBe(fingerprint([items[1], items[0]]));
  });
});

describe("planRequest", () => {
  const contextLimit = 1_000_000;
  const oversized = 1_000;

  test("passes through below the threshold", () => {
    const plan = planRequest({
      body: body([user("hi"), assistant("msg_0", "hello")]),
      state: undefined,
      endpoint: ENDPOINT,
      contextLimit,
      threshold: 0.7,
    });
    expect(plan.type).toBe("passthrough");
  });

  test("compacts everything before the last user turn once oversized", () => {
    const items = history(6);
    const plan = planRequest({
      body: body([{ role: "system", content: "prompt" }, ...items]),
      state: undefined,
      endpoint: ENDPOINT,
      contextLimit: oversized,
      threshold: 0.7,
    });
    if (plan.type !== "compact") throw new Error(`expected compact, got ${plan.type}`);
    expect(plan.instructions).toBe("prompt");
    expect(plan.compactInput).toHaveLength(items.length - 4);
    expect(plan.keptTail).toEqual(items.slice(-4));
    expect(plan.compactedCount).toBe(items.length - 4);
    expect(plan.signature).toBe(fingerprint(items.slice(0, items.length - 4)));
    expect(plan.fallbackInput).toBeUndefined();
  });

  test("uses body instructions when there is no envelope", () => {
    const plan = planRequest({
      body: body(history(6), { instructions: "codex prompt" }),
      state: undefined,
      endpoint: ENDPOINT,
      contextLimit: oversized,
      threshold: 0.7,
    });
    if (plan.type !== "compact") throw new Error(`expected compact, got ${plan.type}`);
    expect(plan.instructions).toBe("codex prompt");
  });

  test("replays a stored window on later turns", () => {
    const items = history(6);
    const stored = state({ signature: fingerprint(items.slice(0, 20)) });
    const plan = planRequest({
      body: body([{ role: "system", content: "prompt" }, ...items]),
      state: stored,
      endpoint: ENDPOINT,
      contextLimit: 1_000_000,
      threshold: 0.7,
    });
    if (plan.type !== "replay") throw new Error(`expected replay, got ${plan.type}`);
    expect(plan.input).toEqual([{ role: "system", content: "prompt" }, ...stored.window, ...items.slice(20)]);
  });

  test("chains a second compaction on top of the stored window", () => {
    const items = history(10);
    const window = [{ type: "message", id: "compacted" }];
    const plan = planRequest({
      body: body(items),
      state: state({ signature: fingerprint(items.slice(0, 20)), window }),
      endpoint: ENDPOINT,
      contextLimit: oversized,
      threshold: 0.7,
    });
    if (plan.type !== "compact") throw new Error(`expected compact, got ${plan.type}`);
    expect(plan.compactInput[0]).toBe(window[0]);
    expect(plan.compactInput).toHaveLength(1 + (items.length - 4 - 20));
    expect(plan.keptTail).toEqual(items.slice(-4));
    expect(plan.compactedCount).toBe(items.length - 4);
    expect(plan.fallbackInput).toEqual([...window, ...items.slice(20)]);
  });

  test("never cuts the kept tail into the opaque window", () => {
    const items = [...history(5), user("only recent turn")];
    const window = [{ type: "message", id: "compacted" }];
    const plan = planRequest({
      body: body(items),
      state: state({
        compactedCount: items.length - 1,
        signature: fingerprint(items.slice(0, items.length - 1)),
        window,
      }),
      endpoint: ENDPOINT,
      contextLimit: 10,
      threshold: 0.7,
    });
    if (plan.type !== "replay") throw new Error(`expected replay, got ${plan.type}`);
    expect(plan.input).toEqual([...window, items.at(-1)]);
  });

  test("drops stale state when history no longer matches", () => {
    expect(
      planRequest({
        body: body(history(6)),
        state: state({ signature: "1:deadbeef" }),
        endpoint: ENDPOINT,
        contextLimit: 1_000_000,
        threshold: 0.7,
      }).type,
    ).toBe("passthrough");
  });

  test("drops state when the history is shorter than the compacted prefix", () => {
    const items = history(6);
    expect(
      planRequest({
        body: body(items.slice(0, 8)),
        state: state({ signature: fingerprint(items.slice(0, 20)) }),
        endpoint: ENDPOINT,
        contextLimit: 1_000_000,
        threshold: 0.7,
      }).type,
    ).toBe("passthrough");
  });

  test("drops state after a model or endpoint switch", () => {
    const items = history(6);
    const stored = state({ signature: fingerprint(items.slice(0, 20)) });
    expect(
      planRequest({
        body: body(items, { model: "gpt-5.4" }),
        state: stored,
        endpoint: ENDPOINT,
        contextLimit: 1_000_000,
        threshold: 0.7,
      }).type,
    ).toBe("passthrough");
    expect(
      planRequest({
        body: body(items),
        state: stored,
        endpoint: "https://chatgpt.com/backend-api/codex/responses",
        contextLimit: 1_000_000,
        threshold: 0.7,
      }).type,
    ).toBe("passthrough");
  });

  test("skips compaction when the model has no known context limit", () => {
    expect(
      planRequest({ body: body(history(10)), state: undefined, endpoint: ENDPOINT, contextLimit: 0, threshold: 0.7 })
        .type,
    ).toBe("passthrough");
  });
});

describe("plugin", () => {
  type Call = { url: string; init: RequestInit };
  type Indicator = {
    path: { id: string };
    query: { directory: string };
    body: {
      messageID: string;
      model: { providerID: string; modelID: string };
      agent: string;
      variant?: string;
      noReply: true;
      parts: Array<{ type: "text"; text: string; ignored: true }>;
    };
  };

  async function createHarness(
    overrides: {
      compact?: () => Response;
      main?: () => Response;
      indicator?: (input: Indicator) => Promise<{ data?: unknown; error?: unknown }>;
      contextLimit?: number;
    } = {},
  ) {
    const dataHome = join(tmpdir(), `openai-compaction-${Bun.hash.wyhash(`${Math.random()}`).toString(16)}`);
    process.env.XDG_DATA_HOME = dataHome;
    const calls: Call[] = [];
    const indicators: Indicator[] = [];
    const stub = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init: init ?? {} });
      if (url.endsWith("/compact")) {
        return (
          overrides.compact?.() ??
          new Response(JSON.stringify({ id: "resp_1", output: [{ type: "message", id: "compacted" }] }), {
            status: 200,
          })
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
            prompt: async (input: Indicator) => {
              indicators.push(input);
              return overrides.indicator?.(input) ?? { data: {} };
            },
          },
        },
        project: { id: "proj" },
        directory: dataHome,
      } as never,
      { threshold: 0.1 },
    )) as {
      "chat.headers": (input: unknown, output: { headers: Record<string, string> }) => Promise<void>;
      dispose: () => Promise<void>;
    };
    const patched = globalThis.fetch;

    const headers: Record<string, string> = {};
    await hooks["chat.headers"](
      {
        sessionID: "ses_1",
        agent: "build",
        message: { id: USER_MESSAGE_ID, model: { variant: "high" } },
        model: { providerID: "openai", id: "gpt-5.5", limit: { context: overrides.contextLimit ?? 1_000 } },
      },
      { headers },
    );

    const send = (input: unknown[]) =>
      patched(ENDPOINT, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body(input)),
      });

    return {
      calls,
      indicators,
      headers,
      send,
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

  test("compacts an oversized request and replays the window on the next turn", async () => {
    // Sized so the full history is over the threshold but the replayed window plus
    // the kept tail is under it, i.e. the next turn replays instead of recompacting.
    const harness = await createHarness({ contextLimit: 10_000 });
    const items = history(6);
    await harness.send(items);

    const [compactCall, sentCall] = harness.calls;
    expect(sent(compactCall).url).toBe(compactUrl(ENDPOINT));
    expect(sentInput(compactCall)).toHaveLength(items.length - 4);
    expect(sentInput(sentCall)).toEqual([{ type: "message", id: "compacted" }, ...items.slice(-4)]);
    expect(harness.indicators).toHaveLength(1);
    expect(harness.indicators[0]).toMatchObject({
      path: { id: "ses_1" },
      body: {
        model: { providerID: "openai", modelID: "gpt-5.5" },
        agent: "build",
        variant: "high",
        noReply: true,
        parts: [{ type: "text", text: "Compacting context...", ignored: true }],
      },
    });
    expect(harness.indicators[0]!.body.messageID < USER_MESSAGE_ID).toBe(true);
    expect(harness.headers["x-opencode-openai-compaction"]).toBe("ses_1");
    expect(new Headers(sent(sentCall).init.headers).get("x-opencode-openai-compaction")).toBeNull();
    expect(await stateFile(harness).exists()).toBe(true);

    const next = [...items, user("what did we decide?")];
    harness.calls.length = 0;
    await harness.send(next);
    expect(harness.calls).toHaveLength(1);
    expect(harness.indicators).toHaveLength(1);
    expect(sentInput(harness.calls[0])).toEqual([
      { type: "message", id: "compacted" },
      ...next.slice(items.length - 4),
    ]);
    await harness.dispose();
  });

  test("continues compaction when the indicator message fails", async () => {
    const harness = await createHarness({ indicator: async () => { throw new Error("indicator failed"); } });
    await harness.send(history(6));
    expect(harness.indicators).toHaveLength(1);
    expect(harness.calls).toHaveLength(2);
    expect(sent(harness.calls[0]).url).toBe(compactUrl(ENDPOINT));
    await harness.dispose();
  });

  test("sends the original request when the compact endpoint fails", async () => {
    const harness = await createHarness({ compact: () => new Response("nope", { status: 404 }) });
    const items = history(6);
    await harness.send(items);

    expect(harness.calls).toHaveLength(2);
    expect(sentInput(harness.calls[1])).toEqual(items);

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
