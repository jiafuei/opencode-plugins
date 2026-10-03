import { describe, expect, mock, test } from "bun:test";
import plugin from "./server.ts";
import { ANTIGRAVITY_DAILY_ENDPOINT as DAILY, ANTIGRAVITY_SANDBOX_ENDPOINT as SANDBOX, COMPACTION_PROMPT, WIRE_MODEL_HEADER } from "./wire.ts";

// Route the native-framed transports through the global fetch the tests mock.
mock.module("./transport.ts", () => {
  const viaGlobalFetch = ((url: string, init: RequestInit) => globalThis.fetch(url, init)) as typeof fetch;
  return { goFetch: viaGlobalFetch, nodeFetch: viaGlobalFetch, go2Fetch: viaGlobalFetch };
});

interface StoredCredential {
  type: string;
  methodID?: string;
  access: string;
  refresh: string;
  expires: number;
  metadata?: Record<string, unknown>;
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** Fake plugin context capturing registrations; `send()` runs the session HTTP hooks like core does. */
function makeHarness(credential: StoredCredential | undefined, options: Record<string, unknown> = {}) {
  let current = credential;
  const hooks: Record<string, (evt: any) => unknown> = {};
  const transforms: Record<string, (editor: any) => void> = {};
  const pending: unknown[] = [];
  let wake: (() => void) | undefined;
  let reloaded!: () => void;
  const firstReload = new Promise<void>((resolve) => (reloaded = resolve));
  const ctx = {
    options,
    integration: {
      transform: async (callback: any) => void (transforms.integration = callback),
      connection: {
        active: async () => (current ? { type: "credential", id: "cred-1", label: "", method: "oauth" } : undefined),
        resolve: async () => current,
      },
    },
    provider: {
      transform: async (callback: any) => void (transforms.provider = callback),
      reload: async () => reloaded(),
    },
    websearch: {
      transform: async (callback: any) => void (transforms.websearch = callback),
      reload: async () => {},
    },
    rpc: { register: async () => {} },
    session: { hook: async (name: string, callback: any) => void (hooks[`session.${name}`] = callback) },
    event: {
      subscribe: async function* () {
        while (true) {
          while (pending.length) yield pending.shift();
          await new Promise<void>((resolve) => (wake = resolve));
        }
      },
    },
  } as any;

  let setup: Promise<void> | undefined;
  const ready = () =>
    (setup ??= (async () => {
      // Startup discovery must not reach the network.
      const original = globalThis.fetch;
      globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
      try {
        await plugin.setup(ctx);
        await firstReload;
      } finally {
        globalThis.fetch = original;
      }
    })());

  return {
    ready,
    hooks,
    setCredential(next: StoredCredential | undefined) {
      current = next;
    },
    async emit(event: unknown) {
      pending.push(event);
      wake?.();
      await Bun.sleep(0);
    },
    /** Run a registered transform against a recording editor. */
    async edit(name: string, editor: Record<string, unknown>) {
      await ready();
      transforms[name]!(editor);
    },
    /** Dispatch a native Gemini request through the http.request/http.response hooks. */
    async send(sessionID: string, request: Request, kind = "primary"): Promise<Response> {
      await ready();
      const before = { sessionID, kind, request };
      await hooks["session.http.request"]!(before);
      const sent = before.request;
      const after = {
        sessionID,
        kind,
        request: sent,
        response: await fetch(sent.url, { method: sent.method, headers: sent.headers, body: await sent.clone().text() }),
      };
      await hooks["session.http.response"]!(after);
      return after.response;
    },
  };
}

/** Install a global fetch mock recording calls and scripting responses. */
function mockFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): { calls: RecordedCall[]; restore: () => void } {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    return await handler(String(url), init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

/** A request as OpenCode's native Gemini client issues it for a model/variant overlay. */
function nativeRequest(wireModelId: string, body: Record<string, any>, headers: Record<string, string> = {}) {
  const modelId = wireModelId.replace(/-(low|medium|high)$/, "");
  return new Request(`${DAILY}/models/${modelId}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": "at-live",
      [WIRE_MODEL_HEADER]: wireModelId,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const OAUTH_AUTH: StoredCredential = {
  type: "oauth",
  methodID: "browser",
  access: "at-live",
  refresh: "rt",
  expires: Date.now() + 600_000,
  metadata: { projectId: "proj-42" },
};

async function readStream(response: Response): Promise<string> {
  return await new Response(response.body).text();
}

describe("provider registration", () => {
  test("registers the static catalog backed by the native Gemini client", async () => {
    const harness = makeHarness(undefined);
    let added: any;
    await harness.edit("provider", { add: (definition: unknown) => (added = definition) });
    expect(added.info).toMatchObject({
      id: "google-antigravity",
      integrationID: "google-antigravity",
      name: "Google Antigravity",
      activation: "auto",
      package: "@opencode/ai/providers/google",
      settings: { baseURL: DAILY },
    });
    expect(added.sourceConnection).toBeUndefined();
  });

  test("an OAuth connection binds the discovered inventory to that connection", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    await harness.ready();
    const entry = (displayName: string) => ({ displayName, maxTokens: 1_000_000, maxOutputTokens: 128_000 });
    const mock = mockFetch((url, init) => {
      expect(url).toBe(`${DAILY}/v1internal:fetchAvailableModels`);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer at-live");
      expect(JSON.parse(String(init.body))).toEqual({ project: "proj-42" });
      return Response.json({
        models: {
          "claude-x-low": entry("Claude X (Low)"),
          "claude-x-high": entry("Claude X (High)"),
          "tab-only": entry("Tab"),
        },
        agentModelSorts: [{ groups: [{ modelIds: ["claude-x-high", "claude-x-low", "missing"] }] }],
      });
    });
    try {
      await harness.emit({ type: "credential.switched", data: { integrationID: "google-antigravity" } });
      await Bun.sleep(10);
      let added: any;
      await harness.edit("provider", { add: (definition: unknown) => (added = definition) });
      // Only the native agent picker's models are offered.
      expect(added.models.map((model: any) => model.id)).toEqual(["claude-x"]);
      expect(added.models[0].variants.map((variant: any) => variant.id)).toEqual(["low", "high"]);
      expect(added.sourceConnection).toMatchObject({ type: "credential", id: "cred-1" });
    } finally {
      mock.restore();
    }
  });

  test("failed discovery keeps the static catalog", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    let added: any;
    await harness.edit("provider", { add: (definition: unknown) => (added = definition) });
    expect(added.sourceConnection).toBeUndefined();
    expect(added.models.map((model: any) => model.id)).toContain("claude-opus-5-5");
  });
});

describe("OAuth methods", () => {
  const methods = async () => {
    const registered: any[] = [];
    await makeHarness(undefined).edit("integration", {
      update: () => {},
      method: { update: (input: unknown) => registered.push(input) },
    });
    return {
      browser: registered.find((entry) => entry.method.id === "browser"),
      paste: registered.find((entry) => entry.method.id === "paste"),
    };
  };
  const loginResponses = () => {
    let call = 0;
    return mockFetch(() => {
      call++;
      if (call === 1) return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
      if (call === 2) return Response.json({ email: "me@example.com" });
      return Response.json({
        currentTier: { id: "free-tier" },
        cloudaicompanionProject: "project-1",
      });
    });
  };

  test("browser method binds the callback server before returning", async () => {
    const { browser } = await methods();
    const browserFetch = globalThis.fetch;
    const authorization = await browser.authorize({});
    const url = new URL(authorization.url);
    const state = url.searchParams.get("state");
    // Native flow: localhost on an ephemeral port.
    const redirect = new URL(url.searchParams.get("redirect_uri")!);
    expect(redirect.hostname).toBe("localhost");
    expect(redirect.pathname).toBe("/oauth-callback");
    expect(authorization.mode).toBe("auto");
    const callbackUrl = `http://127.0.0.1:${redirect.port}/oauth-callback`;

    const mock = loginResponses();
    try {
      const response = await browserFetch(`${callbackUrl}?code=code-1&state=${state}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Sign-in complete");
      const credential = await authorization.callback;
      expect(credential).toMatchObject({
        type: "oauth",
        methodID: "browser",
        access: "at",
        refresh: "rt",
        metadata: { projectId: "project-1", email: "me@example.com" },
      });
    } finally {
      mock.restore();
    }

    // The callback always tears the listener down.
    await Bun.sleep(5);
    await expect(browserFetch(callbackUrl)).rejects.toThrow();
  });

  test("paste method exchanges a complete failed-redirect URL", async () => {
    const { paste } = await methods();
    const authorization = await paste.authorize({});
    const url = new URL(authorization.url);
    const state = url.searchParams.get("state");

    const mock = loginResponses();
    try {
      const credential = await authorization.callback(
        `${url.searchParams.get("redirect_uri")}?code=code-1&state=${state}&scope=profile`,
      );
      expect(credential).toMatchObject({ type: "oauth", methodID: "paste", access: "at", metadata: { projectId: "project-1" } });
    } finally {
      mock.restore();
    }
  });

  test("paste method reports invalid or stale redirect URLs", async () => {
    const { paste } = await methods();
    const authorization = await paste.authorize({});
    await expect(
      authorization.callback("http://localhost:50000/oauth-callback?code=old&state=another-attempt"),
    ).rejects.toThrow(/paste-code login failed: .*matching redirect URL from this login attempt/);
  });

  test("refresh rotates tokens and keeps the project metadata", async () => {
    const { browser } = await methods();
    const mock = mockFetch(() => Response.json({ access_token: "fresh-at", refresh_token: "rt-new", expires_in: 3600 }));
    try {
      await expect(browser.refresh({ ...OAUTH_AUTH, refresh: "rt-old" })).resolves.toMatchObject({
        type: "oauth",
        methodID: "browser",
        access: "fresh-at",
        refresh: "rt-new",
        metadata: { projectId: "proj-42" },
      });
    } finally {
      mock.restore();
    }
  });
});

describe("web search provider", () => {
  const provider = async (credential: StoredCredential | undefined) => {
    const harness = makeHarness(credential);
    const added: any[] = [];
    await harness.edit("websearch", { add: (definition: unknown) => added.push(definition) });
    return added[0];
  };

  test("is only offered while an OAuth connection exists", async () => {
    expect(await provider(undefined)).toBeUndefined();
  });

  test("dispatches the captured native web search operation", async () => {
    const search = await provider(OAUTH_AUTH);
    const mock = mockFetch(() =>
      Response.json({
        response: {
          candidates: [
            {
              content: { parts: [{ thoughtSignature: "opaque" }, { text: "Grounded answer. More." }] },
              groundingMetadata: {
                groundingChunks: [
                  { web: { title: "Example", uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/source" } },
                  { web: { uri: "https://example.org/other" } },
                ],
                groundingSupports: [
                  { segment: { text: "Grounded answer." }, groundingChunkIndices: [0] },
                  { segment: { text: "More." }, groundingChunkIndices: [0] },
                ],
              },
            },
          ],
        },
      }),
    );
    try {
      const signal = new AbortController().signal;
      const results = await search.execute({ query: "latest news" }, { signal });
      expect(mock.calls[0]!.url).toBe(`${DAILY}/v1internal:generateContent`);
      expect(mock.calls[0]!.init.signal).toBe(signal);
      const headers = new Headers(mock.calls[0]!.init.headers);
      expect(headers.get("authorization")).toBe("Bearer at-live");
      expect(headers.get("user-agent")).toBe("antigravity/ide/2.5.5 (aidev_client; os_type=windows; arch=amd64)");
      expect(JSON.parse(String(mock.calls[0]!.init.body))).toMatchObject({
        project: "proj-42",
        model: "gemini-3.1-flash-lite",
        userAgent: "antigravity",
        requestType: "web_search",
        request: {
          contents: [{ role: "user", parts: [{ text: "latest news" }] }],
          systemInstruction: {
            role: "user",
            parts: [{ text: expect.stringContaining("You MUST perform a web search") }],
          },
          generationConfig: { candidateCount: 1 },
          tools: [{ googleSearch: { enhancedContent: { imageSearch: { maxResultCount: 5 } } } }],
        },
      });
      expect(results).toEqual([
        {
          url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/source",
          title: "Example",
          content: "Grounded answer. More.",
          time: {},
        },
        { url: "https://example.org/other", time: {} },
      ]);
    } finally {
      mock.restore();
    }
  });

  test("surfaces native web search in-band errors", async () => {
    const search = await provider(OAUTH_AUTH);
    const mock = mockFetch(() =>
      Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota exhausted" } }),
    );
    try {
      await expect(search.execute({ query: "latest news" }, { signal: new AbortController().signal })).rejects.toThrow(
        /Cloud Code Assist error \(RESOURCE_EXHAUSTED\): quota exhausted/,
      );
    } finally {
      mock.restore();
    }
  });
});

describe("session HTTP hooks", () => {
  test("rewrites native Gemini requests into the Cloud Code Assist envelope and unwraps SSE", async () => {
    const harness = makeHarness(OAUTH_AUTH, { trajectoryAcls: true, metrics: true });
    const args = {
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      systemInstruction: { parts: [{ text: "sys" }] },
      generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
      tools: [],
    };
    const chunk = {
      response: { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP" }], responseId: "resp-9" },
      traceId: "trace-9",
    };
    const mock = mockFetch((url) => (url.includes("streamGenerateContent") ? sseResponse([chunk]) : Response.json({})));
    try {
      const response = await harness.send(
        "ses-1",
        nativeRequest("claude-opus-5-5-high", args, { "x-opencode-session": "ses-1", "x-custom-trace": "trace-1" }),
      );
      // The trajectory's ACL is granted before its first agent request.
      expect(mock.calls[0]!.url).toBe(`${DAILY}/v1internal:writeTrajectoryAcls`);
      const call = mock.calls[1]!;
      expect(call.url).toBe(`${DAILY}/v1internal:streamGenerateContent?alt=sse`);
      // Only the native inference header set reaches the wire.
      const headers = new Headers(call.init.headers);
      expect([...headers.keys()].sort()).toEqual(["accept-encoding", "authorization", "content-type", "user-agent"]);
      expect(headers.get("accept-encoding")).toBe("gzip");
      expect(headers.get("authorization")).toBe("Bearer at-live");
      expect(headers.get("user-agent")).toMatch(/^antigravity\/ide\/[\d.]+ \(aidev_client; os_type=windows; arch=amd64\)$/);

      const wireBody = JSON.parse(String(call.init.body));
      expect(wireBody).toMatchObject({ project: "proj-42", model: "claude-opus-5-5-high", userAgent: "antigravity", requestType: "agent" });
      expect(wireBody.requestId).toMatch(/^agent\/[0-9a-f-]{36}\/\d+\/[0-9a-f-]{36}\/2$/);
      expect(wireBody.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 0, thinkingLevel: "HIGH" });
      expect(wireBody.request.labels.model_enum).toBe("MODEL_PLACEHOLDER_M402");
      expect(JSON.parse(String(mock.calls[0]!.init.body))).toEqual({ trajectoryId: wireBody.request.labels.trajectory_id });

      // Raw Gemini chunks reach the native parser.
      const output = await readStream(response);
      const dataLine = output.trim().split("\n").at(-1)!.replace(/^data:\s*/, "");
      expect(JSON.parse(dataLine)).toEqual(chunk.response);

      // The completed stream is reported like the native client's metrics.
      expect(mock.calls).toHaveLength(3);
      expect(mock.calls[2]!.url).toBe(`${DAILY}/v1internal:recordCodeAssistMetrics`);
      const metrics = JSON.parse(String(mock.calls[2]!.init.body));
      expect(metrics).toMatchObject({
        project: "proj-42",
        metadata: { ideType: "ANTIGRAVITY", ideVersion: "2.5.5", platform: "WINDOWS_AMD64" },
        metrics: [{
          conversationOffered: {
            status: "ACTION_STATUS_NO_ERROR",
            traceId: "trace-9",
            isAgentic: true,
            initiationMethod: "AGENT",
            trajectoryId: wireBody.request.labels.trajectory_id,
            language: "unspecified",
          },
        }],
      });
      expect(metrics.metrics[0].conversationOffered.streamingLatency.totalLatency).toMatch(/^\d+(\.\d{3}|\.\d{6}|\.\d{9})?s$/);
      expect(metrics.metrics[0].timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3}|\.\d{6}|\.\d{9})?Z$/);
    } finally {
      mock.restore();
    }
  });

  test("models outside the current catalog fail loudly", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    await expect(harness.send("ses-1", nativeRequest("claude-opus-4-6-thinking", { contents: [] }))).rejects.toThrow(
      /not in the current model catalog/,
    );
  });

  test("auto mode moves a session to the other endpoint after a failure and stays there", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const mock = mockFetch((url) => {
      if (url.startsWith(DAILY)) return new Response("overloaded", { status: 503 });
      return sseResponse([{ response: { candidates: [{ finishReason: "STOP" }] } }]);
    });
    try {
      const send = () => harness.send("ses-fail", nativeRequest("gemini-3.8-flash-low", { contents: [], tools: [] }));
      expect((await send()).status).toBe(503);
      await readStream(await send()); // core's retry
      await readStream(await send());
      const generations = mock.calls.filter((call) => call.url.includes("streamGenerateContent"));
      expect(generations.map((call) => new URL(call.url).origin)).toEqual([DAILY, SANDBOX, SANDBOX]);
    } finally {
      mock.restore();
    }
  });

  test("side calls are off by default", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const chunk = { response: { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP" }] }, traceId: "t" };
    const mock = mockFetch(() => sseResponse([chunk]));
    try {
      await readStream(await harness.send("ses-quiet", nativeRequest("gemini-3.8-flash-low", { contents: [], tools: [] })));
      expect(mock.calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1internal:streamGenerateContent"]);
    } finally {
      mock.restore();
    }
  });

  test("a rejected trajectory ACL does not block generation and is retried", async () => {
    const harness = makeHarness(OAUTH_AUTH, { trajectoryAcls: true });
    const mock = mockFetch((url) => (url.includes("writeTrajectoryAcls") ? new Response("denied", { status: 403 }) : sseResponse([])));
    try {
      await readStream(await harness.send("ses-acl", nativeRequest("gemini-3.8-flash-low", { contents: [] })));
      await readStream(await harness.send("ses-acl", nativeRequest("gemini-3.8-flash-low", { contents: [] })));
      expect(mock.calls.map((call) => new URL(call.url).pathname)).toEqual([
        "/v1internal:writeTrajectoryAcls",
        "/v1internal:streamGenerateContent",
        "/v1internal:writeTrajectoryAcls",
        "/v1internal:streamGenerateContent",
      ]);
    } finally {
      mock.restore();
    }
  });

  test("pinned production mode never touches the sandbox endpoint", async () => {
    const harness = makeHarness(OAUTH_AUTH, { endpointMode: "production" });
    const mock = mockFetch(() => new Response("boom", { status: 503 }));
    try {
      await harness.send("ses-pin", nativeRequest("gemini-3.8-flash-low", { contents: [], tools: [] }));
      await harness.send("ses-pin", nativeRequest("gemini-3.8-flash-low", { contents: [], tools: [] }));
      expect(mock.calls.map((call) => new URL(call.url).origin)).toEqual([DAILY, DAILY]);
    } finally {
      mock.restore();
    }
  });

  test("compaction continues the primary trajectory and execution, like the native client", async () => {
    const harness = makeHarness(OAUTH_AUTH, { trajectoryAcls: true });
    let attempts = 0;
    const mock = mockFetch((url) => {
      if (url.includes("writeTrajectoryAcls")) return new Response("{}");
      return attempts++ === 0 ? new Response("retry", { status: 503 }) : sseResponse([]);
    });
    const turn = (text: string) => ({ role: "user", parts: [{ text }] });
    const send = async (contents: unknown[]) => {
      await readStream(await harness.send("ses-compact", nativeRequest("gemini-3.8-flash-low", { contents })));
      const call = mock.calls.filter((call) => call.url.includes("streamGenerateContent")).at(-1)!;
      return { url: call.url, body: JSON.parse(String(call.init.body)) };
    };
    try {
      await send([turn("first")]);
      const before = await send([turn("first"), turn("second")]);
      const labels = before.body.request.labels;
      expect(labels.last_execution_id).toBeDefined();

      await harness.emit({ type: "session.compaction.ended", data: { sessionID: "ses-compact", reason: "auto" } });
      const window = [turn("second"), turn("# Resuming from a compaction\n\nsummary")];
      const after = await send(window);
      expect(after.body.request.contents[1]).toEqual(window[1]);
      expect(after.body.request.labels).toMatchObject({
        trajectory_id: labels.trajectory_id,
        last_execution_id: labels.last_execution_id,
      });
      expect(Number(after.body.request.labels.last_step_index)).toBeGreaterThanOrEqual(Number(labels.last_step_index));
      expect(after.body.request.sessionId).toBe(before.body.request.sessionId);
      expect(new URL(after.url).origin).toBe(SANDBOX);
      expect(mock.calls.filter((call) => call.url.includes("writeTrajectoryAcls"))).toHaveLength(1);

      // The next new turn starts an execution as usual.
      const next = await send([...window, turn("third")]);
      expect(next.body.request.labels.last_execution_id).not.toBe(labels.last_execution_id);
    } finally {
      mock.restore();
    }
  });

  test("native compaction sends the native prompt and installs the native resume window", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const mock = mockFetch(() => sseResponse([]));
    const turn = (text: string) => ({ role: "user", parts: [{ text }] });
    const message = (role: string, text: string) => ({ role, content: [{ type: "text", text }] });
    const resume = (requests: string[]) => ({
      role: "user",
      content: [{
        type: "text",
        text: `# Resuming from a compaction\n\nYou are continuing work on the task described above, but you have lost access to the full conversation history, and need to resume work efficiently using the progress summary below:\n\n# User Requests\nThe following were user requests from the truncated conversation in chronological order:\n${requests.map((text, index) => `${index + 1}. ${text}`).join("\n")}\n\n<summary>S</summary>`,
        metadata: { requests },
      }],
    });
    const compact = async (messages: unknown[], retained: unknown[]) => {
      const event: Record<string, any> = {
        sessionID: "ses-native",
        messages,
        retained,
        send: async () => {
          const contents = [turn("a"), { role: "model", parts: [{ text: "ok" }] }, turn("b")];
          await readStream(await harness.send("ses-native", nativeRequest("gemini-3.8-flash-medium", { contents }), "compaction"));
          return { content: [{ type: "reasoning", text: "hmm" }, { type: "text", text: "<summary>S</summary>" }] };
        },
      };
      await harness.hooks["session.experimental.compaction.native"]!(event);
      return event.result.replacement;
    };
    try {
      await readStream(await harness.send("ses-native", nativeRequest("gemini-3.8-flash-medium", { contents: [turn("a")] })));
      const primary = JSON.parse(String(mock.calls.at(-1)!.init.body));
      const first = await compact(
        [message("user", "a"), message("assistant", "ok"), message("user", "b")],
        [message("user", "a"), message("user", "b")],
      );
      const body = JSON.parse(String(mock.calls.at(-1)!.init.body));
      expect(body).toMatchObject({ model: "gemini-3.8-flash-medium", requestType: "checkpoint" });
      expect(body.request.sessionId).toBe(primary.request.sessionId);
      expect(body.request.contents[0]).toEqual(primary.request.contents[0]);
      expect(body.request.contents.at(-1)).toEqual({ role: "user", parts: [{ text: COMPACTION_PROMPT }] });
      expect(first).toEqual([message("user", "b"), resume(["a", "b"])]);

      // Earlier requests come from the previous resume message, never the resume text itself.
      const latest = {
        role: "user",
        content: [{ type: "text", text: "c" }, { type: "media", media: { source: { type: "url", url: "https://x/c.png", mediaType: "image/png" } } }],
      };
      const second = await compact([...first, message("assistant", "ok"), latest], [latest]);
      expect(second).toEqual([latest, resume(["a", "b", "c"])]);

      // Compacting again before another user request keeps that window's latest request.
      expect(await compact([...second, message("assistant", "more")], [])).toEqual(second);
    } finally {
      mock.restore();
    }
  });

  test("session deletion and credential switches reset the identity chain", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const mock = mockFetch((url) =>
      url.includes("fetchAvailableModels") ? new Response("unavailable", { status: 503 }) : sseResponse([{ response: { candidates: [] } }]),
    );
    const turn = (text: string) => ({ role: "user", parts: [{ text }] });
    try {
      const send = async (sessionID: string, contents: unknown[], access = "at-live") => {
        await readStream(await harness.send(sessionID, nativeRequest("gemini-3.8-flash-low", { contents, tools: [] }, { "x-goog-api-key": access })));
        const dispatched = mock.calls.filter((call) => call.url.includes("streamGenerateContent")).at(-1)!;
        return { envelope: JSON.parse(String(dispatched.init.body)), headers: new Headers(dispatched.init.headers) };
      };
      const first = await send("ses-a", [turn("a")]);
      const second = await send("ses-a", [turn("a"), turn("b")]);
      expect(second.envelope.request.labels.trajectory_id).toBe(first.envelope.request.labels.trajectory_id);
      expect(second.envelope.request.labels.last_execution_id).toBeDefined();

      await harness.emit({ type: "session.deleted", data: { sessionID: "ses-a" } });
      const afterDelete = await send("ses-a", [turn("a"), turn("b")]);
      expect(afterDelete.envelope.request.labels.trajectory_id).not.toBe(first.envelope.request.labels.trajectory_id);
      expect(afterDelete.envelope.request.labels.last_execution_id).toBeUndefined();

      harness.setCredential({ ...OAUTH_AUTH, access: "at-other", metadata: { projectId: "proj-other" } });
      await harness.emit({ type: "credential.switched", data: { integrationID: "google-antigravity" } });
      await Bun.sleep(10);
      const afterSwitch = await send("ses-a", [turn("a")], "at-other");
      expect(afterSwitch.envelope.project).toBe("proj-other");
      expect(afterSwitch.envelope.request.labels.trajectory_id).not.toBe(afterDelete.envelope.request.labels.trajectory_id);
      expect(afterSwitch.headers.get("authorization")).toBe("Bearer at-other");
    } finally {
      mock.restore();
    }
  });
});
