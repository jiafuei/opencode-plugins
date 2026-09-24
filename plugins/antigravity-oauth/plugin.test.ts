import { describe, expect, test } from "bun:test";
import plugin from "./antigravity_oauth.ts";

// Prevent live manifest discovery during plugin instantiation.
process.env.OPENCODE_ANTIGRAVITY_VERSION ??= "2.8.0";

const DAILY = "https://daily-cloudcode-pa.googleapis.com";
const SANDBOX = "https://daily-cloudcode-pa.sandbox.googleapis.com";

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

/** Fake plugin context capturing registrations; `loader()` runs the SDK hook like core does. */
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
    aisdk: { hook: async (name: string, callback: any) => void (hooks[`aisdk.${name}`] = callback) },
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
    async loader() {
      await ready();
      const evt = {
        model: { providerID: "google-antigravity" },
        package: "@ai-sdk/google",
        options: {
          apiKey: current?.access,
          projectId: current?.metadata?.projectId,
          fetch: (input: any, init: any) => globalThis.fetch(input, init),
        },
      };
      hooks["aisdk.sdk"]!(evt);
      return { fetch: evt.options.fetch as (input: string, init?: RequestInit) => Promise<Response> };
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

function streamTarget(modelId: string, bodyArgs: Record<string, any>, headers: Record<string, string> = {}) {
  return {
    url: `${DAILY}/models/${modelId}:streamGenerateContent?alt=sse`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(bodyArgs),
    } as RequestInit,
  };
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
  test("registers the static catalog backed by @ai-sdk/google", async () => {
    const harness = makeHarness(undefined);
    let added: any;
    await harness.edit("provider", { add: (definition: unknown) => (added = definition) });
    expect(added.info).toMatchObject({
      id: "google-antigravity",
      integrationID: "google-antigravity",
      name: "Google Antigravity",
      activation: "auto",
      package: "aisdk:@ai-sdk/google",
      settings: { baseURL: DAILY },
    });
    expect(added.sourceConnection).toBeUndefined();
    const ids = added.models.map((model: any) => model.id);
    for (const modelID of ["gemini-3.1-pro", "gemini-3-flash", "claude-opus-4-6", "gpt-oss-120b"]) {
      expect(ids).toContain(modelID);
    }
  });

  test("an OAuth connection binds the discovered inventory to that connection", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    await harness.ready();
    const mock = mockFetch((url, init) => {
      expect(url).toBe(`${DAILY}/v1internal:fetchAvailableModels`);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer at-live");
      return Response.json({ models: { "claude-sonnet-4-6": {} } });
    });
    try {
      await harness.emit({ type: "credential.switched", data: { integrationID: "google-antigravity" } });
      await Bun.sleep(10);
      let added: any;
      await harness.edit("provider", { add: (definition: unknown) => (added = definition) });
      expect(added.models.map((model: any) => model.id)).toEqual(["claude-sonnet-4-6"]);
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
    expect(added.models.map((model: any) => model.id)).toContain("gemini-3.1-pro");
  });

  test("invalid plugin options fail during initialization", async () => {
    await expect(makeHarness(undefined, { endpointMode: "other" }).ready()).rejects.toThrow(/endpointMode/);
    await expect(makeHarness(undefined, { firstEventTimeoutMs: 0 }).ready()).rejects.toThrow(
      /finite positive number/,
    );
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
        paidTier: { id: "free-tier" },
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
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:51121/oauth-callback");
    expect(authorization.mode).toBe("auto");

    const mock = loginResponses();
    try {
      const response = await browserFetch(`http://127.0.0.1:51121/oauth-callback?code=code-1&state=${state}`);
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
      expect(browser.label(credential)).toBe("me@example.com");
      expect(mock.calls).toHaveLength(4);
    } finally {
      mock.restore();
    }

    // The callback always tears the listener down.
    await Bun.sleep(5);
    await expect(browserFetch("http://127.0.0.1:51121/oauth-callback")).rejects.toThrow();
  });

  test("paste method exchanges a complete failed-redirect URL", async () => {
    const { paste } = await methods();
    const authorization = await paste.authorize({});
    const state = new URL(authorization.url).searchParams.get("state");
    expect(authorization.instructions).toContain("cannot connect");

    const mock = loginResponses();
    try {
      const credential = await authorization.callback(
        `http://127.0.0.1:51121/oauth-callback?code=code-1&state=${state}&scope=profile`,
      );
      expect(credential).toMatchObject({ type: "oauth", methodID: "paste", access: "at", metadata: { projectId: "project-1" } });
      expect(mock.calls).toHaveLength(4);
    } finally {
      mock.restore();
    }
  });

  test("paste method reports invalid or stale redirect URLs", async () => {
    const { paste } = await methods();
    const authorization = await paste.authorize({});
    await expect(
      authorization.callback("http://127.0.0.1:51121/oauth-callback?code=old&state=another-attempt"),
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
    expect(search).toMatchObject({ id: "antigravity", name: "Google Antigravity" });
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

describe("SDK fetch boundary", () => {
  test("rejects non-official origins without dispatching anything", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() => {
      throw new Error("must not be called");
    });
    try {
      await expect(
        loader.fetch("https://evil.example.com/models/gemini-3.1-pro:streamGenerateContent?alt=sse", {
          method: "POST",
          body: "{}",
        }),
      ).rejects.toThrow(/Refusing to send/);
      expect(mock.calls).toHaveLength(0);
    } finally {
      mock.restore();
    }
  });

  test("rewrites requests into the Cloud Code Assist envelope with native headers", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();

    const args = {
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      systemInstruction: { parts: [{ text: "sys" }] },
      generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
    };
    const chunk = { response: { candidates: [], usageMetadata: {}, responseId: "resp-9" } };

    const mock = mockFetch((url) => {
      expect(url).toBe(`${DAILY}/v1internal:streamGenerateContent?alt=sse`);
      return sseResponse([chunk]);
    });
    try {
      const target = streamTarget("gemini-3.1-pro", args, {
        "x-antigravity-opencode-session": "ses-1",
        "x-antigravity-opencode-invocation": "inv-a",
      });
      const response = await loader.fetch(target.url, target.init);
      const call = mock.calls[0]!;
      const headers = new Headers(call.init.headers);
      expect(headers.get("authorization")).toBe("Bearer at-live");
      expect(headers.get("user-agent")).toMatch(/^antigravity\/hub\/2\.8\.0 \(aidev_client;/);
      expect(headers.get("accept")).toBe("text/event-stream");
      // Private routing markers never reach the wire.
      expect(headers.get("x-antigravity-opencode-session")).toBeNull();
      expect(headers.get("x-antigravity-opencode-invocation")).toBeNull();

      const wireBody = JSON.parse(String(call.init.body));
      expect(wireBody.project).toBe("proj-42");
      expect(wireBody.model).toBe("gemini-pro-agent"); // high effort routes to the agent wire id
      expect(wireBody.userAgent).toBe("antigravity");
      expect(wireBody.requestType).toBe("agent");
      expect(wireBody.requestId).toMatch(/^agent\/[0-9a-f-]{36}\/\d+\/[0-9a-f-]{36}\/2$/);
      expect(wireBody.request.systemInstruction.role).toBe("user");
      // Budget transport: the OpenCode level input is normalized natively.
      expect(wireBody.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 10001 });

      // SSE unwrapped incrementally: raw Gemini chunks reach the SDK parser.
      const output = await readStream(response);
      const dataLine = output.trim().split("\n").at(-1)!.replace(/^data:\s*/, "");
      expect(JSON.parse(dataLine)).toEqual(chunk.response);
    } finally {
      mock.restore();
    }
  });

  test("strips SDK, OpenCode session-routing, and plugin-private headers before dispatch", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() => sseResponse([{ response: { candidates: [] } }]));
    try {
      const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
        "x-goog-api-key": "leaked-key",
        "x-goog-api-client": "ai-sdk/google/3.0.73",
        "client-metadata": "ideType=IDE_UNSPECIFIED",
        "x-session-affinity": "ses-1",
        "X-Session-Id": "ses-1",
        "x-parent-session-id": "parent-1",
        "x-opencode-session": "ses-1",
        "x-antigravity-opencode-session": "ses-1",
        "x-antigravity-opencode-invocation": "inv-1",
        "x-custom-trace": "trace-1",
      });
      const response = await loader.fetch(target.url, target.init);
      await readStream(response);
      const headers = new Headers(mock.calls[0]!.init.headers);
      for (const leaked of [
        "x-goog-api-key",
        "x-goog-api-client",
        "client-metadata",
        "x-session-affinity",
        "x-session-id",
        "x-parent-session-id",
        "x-opencode-session",
        "x-antigravity-opencode-session",
        "x-antigravity-opencode-invocation",
        "x-custom-trace",
      ]) {
        expect(headers.get(leaked)).toBeNull();
      }
      // The OMP inference header set is intact.
      expect(headers.get("authorization")).toBe("Bearer at-live");
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("accept")).toBe("text/event-stream");
      expect(headers.get("user-agent")).toMatch(/^antigravity\/hub\//);
    } finally {
      mock.restore();
    }
  });

  test("converts parametersJsonSchema declarations to normalized CCA parameters", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() => sseResponse([{ response: { candidates: [] } }]));
    try {
      // Actual @ai-sdk/google 3.x tool shape.
      const args = {
        contents: [],
        tools: [
          {
            functionDeclarations: [
              {
                name: "read_file",
                description: "Read a file",
                parametersJsonSchema: {
                  type: "object",
                  properties: {
                    path: { type: "string", pattern: "^/" },
                    depth: { type: "integer", enum: [1, 2] },
                  },
                  required: ["path"],
                  additionalProperties: false,
                },
              },
              {
                name: "legacy_tool",
                parameters: {
                  type: "object",
                  properties: { enabled: { type: "boolean", enum: [true, false], format: "unsupported" } },
                },
              },
            ],
          },
        ],
      };
      const target = streamTarget("gemini-2.5-pro", args, {});
      const response = await loader.fetch(target.url, target.init);
      await readStream(response);
      const wireBody = JSON.parse(String(mock.calls[0]!.init.body));
      const declaration = wireBody.request.tools[0].functionDeclarations[0];
      expect(declaration.parametersJsonSchema).toBeUndefined();
      expect(declaration.parameters).toEqual({
        type: "object",
        properties: {
          path: { type: "string" },
          depth: { type: "integer", enum: ["1", "2"] },
        },
        required: ["path"],
      });
      expect(wireBody.request.tools[0].functionDeclarations[1].parameters).toEqual({
        type: "object",
        properties: { enabled: { type: "boolean", enum: ["true", "false"] } },
      });
    } finally {
      mock.restore();
    }
  });

  test("falls back to object parameters when the SDK supplies a scalar tool root", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() => sseResponse([{ response: { candidates: [] } }]));
    try {
      const target = streamTarget("gemini-2.5-pro", {
        contents: [],
        tools: [{ functionDeclarations: [{ name: "broken", parametersJsonSchema: { type: "string" } }] }],
      });
      await readStream(await loader.fetch(target.url, target.init));
      const declaration = JSON.parse(String(mock.calls[0]!.init.body)).request.tools[0].functionDeclarations[0];
      expect(declaration.parameters).toEqual({ type: "object", properties: {} });
    } finally {
      mock.restore();
    }
  });

  test("session chain advances across invocations and survives SDK retries", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() =>
      sseResponse([{ response: { candidates: [{ finishReason: "STOP" }], responseId: "r-1" } }]),
    );
    try {
      const request = (invocation: string) => {
        const target = streamTarget("claude-sonnet-4-6", { contents: [] }, {
          "x-antigravity-opencode-session": "ses-x",
          "x-antigravity-opencode-invocation": invocation,
        });
        return loader.fetch(target.url, target.init);
      };

      // Consume each stream fully so response-id commits land before the next
      // invocation's assertions.
      await readStream(await request("inv-1"));
      const firstEnvelope = JSON.parse(String(mock.calls[0]!.init.body));
      // A retry of the same logical invocation reuses the exact envelope.
      await readStream(await request("inv-1"));
      const retryEnvelope = JSON.parse(String(mock.calls[1]!.init.body));
      expect(retryEnvelope.requestId).toBe(firstEnvelope.requestId);
      expect(retryEnvelope.request.sessionId).toBe(firstEnvelope.request.sessionId);

      // The next logical invocation advances the step and carries the prior
      // response id.
      await readStream(await request("inv-2"));
      const secondEnvelope = JSON.parse(String(mock.calls[2]!.init.body));
      const stepOf = (requestId: string) => Number(requestId.split("/").at(-1));
      expect(stepOf(secondEnvelope.requestId)).toBe(stepOf(firstEnvelope.requestId) + 1);
      expect(secondEnvelope.request.labels.last_execution_id).toBe("r-1");
      expect(secondEnvelope.request.labels.used_claude).toBe("true");
      expect(secondEnvelope.request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED");
      // Reasoning Claude models carry the beta header.
      expect(new Headers(mock.calls[0]!.init.headers).get("anthropic-beta")).toBe(
        "interleaved-thinking-2025-05-14",
      );
    } finally {
      mock.restore();
    }
  });

  test("auto mode fails over to sandbox before streaming and remembers the winner", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch((url) => {
      if (url.startsWith(DAILY)) return new Response("overloaded", { status: 503 });
      return sseResponse([{ response: { candidates: [{ finishReason: "STOP" }] } }]);
    });
    try {
      const send = (invocation: string) => {
        const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
          "x-antigravity-opencode-session": "ses-fail",
          "x-antigravity-opencode-invocation": invocation,
        });
        return loader.fetch(target.url, target.init);
      };
      await readStream(await send("i-1"));
      expect(mock.calls[0]!.url.startsWith(DAILY)).toBe(true);
      expect(mock.calls[1]!.url.startsWith(SANDBOX)).toBe(true);

      // The last-good endpoint is consulted first on the following request.
      await readStream(await send("i-2"));
      expect(mock.calls[2]!.url.startsWith(SANDBOX)).toBe(true);
    } finally {
      mock.restore();
    }
  });

  test("transient in-band errors before the first event fail over without losing bytes", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const dailyEvent = { error: { code: 500, message: "internal", status: "INTERNAL" } };
    const sandboxEvents = [
      { response: { candidates: [], usageMetadata: {}, responseId: "r-9" } },
      { response: { candidates: [{ finishReason: "STOP" }], responseId: "r-9" } },
    ];
    const mock = mockFetch((url) => {
      if (url.startsWith(DAILY)) return sseResponse([dailyEvent]);
      return sseResponse(sandboxEvents);
    });
    try {
      const send = (invocation: string) => {
        const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
          "x-antigravity-opencode-session": "ses-probe",
          "x-antigravity-opencode-invocation": invocation,
        });
        return loader.fetch(target.url, target.init);
      };
      const output = await readStream(await send("p-1"));

      expect(mock.calls[0]!.url.startsWith(DAILY)).toBe(true);
      expect(mock.calls[1]!.url.startsWith(SANDBOX)).toBe(true);
      // The sandbox events arrive intact (and unwrapped) after failover.
      const dataLines = output.trim().split("\n").filter((line) => line.startsWith("data:"));
      expect(dataLines).toHaveLength(2);
      expect(JSON.parse(dataLines[0]!.slice(6))).toEqual(sandboxEvents[0]!.response);
      expect(JSON.parse(dataLines[1]!.slice(6))).toEqual(sandboxEvents[1]!.response);

      // Successful completion commits the winner as the session's endpoint.
      await readStream(await send("p-2"));
      expect(mock.calls[2]!.url.startsWith(SANDBOX)).toBe(true);
    } finally {
      mock.restore();
    }
  });

  test("truncated streams do not commit response identity or endpoint affinity", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    let firstRequest = true;
    const mock = mockFetch((url) => {
      if (firstRequest && url.startsWith(DAILY)) return new Response("overloaded", { status: 503 });
      if (firstRequest) {
        firstRequest = false;
        return sseResponse([{ response: { candidates: [], responseId: "truncated-id" } }]);
      }
      return sseResponse([{ response: { candidates: [{ finishReason: "STOP" }], responseId: "complete-id" } }]);
    });
    const send = (invocation: string) => {
      const target = streamTarget("gemini-3.8-flash", { contents: [] }, {
        "x-antigravity-opencode-session": "ses-truncated",
        "x-antigravity-opencode-invocation": invocation,
      });
      return loader.fetch(target.url, target.init);
    };
    try {
      await readStream(await send("i-1"));
      expect(mock.calls[0]!.url.startsWith(DAILY)).toBe(true);
      expect(mock.calls[1]!.url.startsWith(SANDBOX)).toBe(true);

      await readStream(await send("i-2"));
      expect(mock.calls[2]!.url.startsWith(DAILY)).toBe(true);
      const nextEnvelope = JSON.parse(String(mock.calls[2]!.init.body));
      expect(nextEnvelope.request.labels.last_execution_id).toBeUndefined();
    } finally {
      mock.restore();
    }
  });

  test("non-transient in-band errors surface instead of failing over", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() =>
      sseResponse([{ error: { code: 403, message: "permission denied", status: "PERMISSION_DENIED" } }]),
    );
    try {
      const target = streamTarget("gemini-2.5-pro", { contents: [] }, {});
      const response = await loader.fetch(target.url, target.init);
      await expect(readStream(response)).rejects.toThrow(/Cloud Code Assist error \(PERMISSION_DENIED\): permission denied/);
      expect(mock.calls).toHaveLength(1); // no sandbox attempt
    } finally {
      mock.restore();
    }
  });

  test("failed streams never poison session state or the last-good endpoint", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    let failing = true;
    const mock = mockFetch((url) => {
      if (!failing) return sseResponse([{ response: { candidates: [], responseId: "ok-1" } }]);
      return sseResponse([{ error: { code: 500, message: "boom", status: "INTERNAL" } }]);
    });
    try {
      const send = (invocation: string) => {
        const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
          "x-antigravity-opencode-session": "ses-poison",
          "x-antigravity-opencode-invocation": invocation,
        });
        return loader.fetch(target.url, target.init);
      };
      // Both endpoints fail in-band before the first event: the first send
      // probes daily (transient → fail over) and surfaces the sandbox
      // failure; nothing commits.
      await expect(readStream(await send("f-1"))).rejects.toThrow(/boom/);
      expect(mock.calls.map((call) => call.url.startsWith(DAILY))).toEqual([true, false]);

      // Recovery: nothing was committed, so the chain starts at daily again,
      // and a fresh envelope step is used for the retry of the same logical
      // invocation id (the failed attempt never advanced it).
      failing = false;
      const output = await readStream(await send("f-1"));
      expect(mock.calls[2]!.url.startsWith(DAILY)).toBe(true);
      const body = JSON.parse(String(mock.calls[2]!.init.body));
      expect(body.requestId).toMatch(/\/2$/);
      void output;
    } finally {
      mock.restore();
    }
  });

  test("pinned production mode never touches the sandbox endpoint", async () => {
    const harness = makeHarness(OAUTH_AUTH, { endpointMode: "production" });
    const loader = await harness.loader();
    const mock = mockFetch(() => new Response("boom", { status: 503 }));
    try {
      await loader.fetch(`${DAILY}/models/gemini-2.5-pro:streamGenerateContent?alt=sse`, {
        method: "POST",
        body: "{}",
      }).catch(() => {});
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0]!.url.startsWith(DAILY)).toBe(true);
    } finally {
      mock.restore();
    }
  });

  test("non-stream responses unwrap and commit response identity after successful parse", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() =>
      new Response(JSON.stringify({ response: { candidates: [], responseId: "ns-77", usageMetadata: {} } }), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "999" },
      }),
    );
    try {
      const response = await loader.fetch(`${DAILY}/models/gemini-2.5-pro:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": "leak",
          "x-session-affinity": "ses-ns",
          "x-antigravity-opencode-session": "ses-ns",
        },
        body: JSON.stringify({ contents: [] }),
      });
      const payload = JSON.parse(await response.text());
      expect(payload).toEqual({ candidates: [], responseId: "ns-77", usageMetadata: {} });
      // Stale entity headers dropped; SDK fingerprint stripped.
      expect(response.headers.get("content-length")).toBeNull();
      const headers = new Headers(mock.calls[0]!.init.headers);
      expect(headers.get("x-goog-api-key")).toBeNull();
      expect(headers.get("x-session-affinity")).toBeNull();
      // No Accept: text/event-stream on non-stream calls.
      expect(headers.get("accept")).toBeNull();

      // Commit-after-parse: the next stream request carries the id.
      const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
        "x-antigravity-opencode-session": "ses-ns",
        "x-antigravity-opencode-invocation": "i-1",
      });
      await readStream(await loader.fetch(target.url, target.init));
      const wireBody = JSON.parse(String(mock.calls[1]!.init.body));
      expect(wireBody.request.labels.last_execution_id).toBe("ns-77");
    } finally {
      mock.restore();
    }
  });

  test("non-stream in-band errors do not commit endpoint or response state", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    let failing = true;
    const mock = mockFetch((url) => {
      if (failing) {
        return new Response(JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "denied" } }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ response: { candidates: [] } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const send = () =>
      loader.fetch(`${DAILY}/models/gemini-2.5-pro:generateContent`, {
        method: "POST",
        headers: { "x-antigravity-opencode-session": "ses-ns-error" },
        body: JSON.stringify({ contents: [] }),
      });
    try {
      const failure = await send();
      expect(failure.status).toBe(403);
      expect(await failure.json()).toEqual({
        error: { code: 403, status: "PERMISSION_DENIED", message: "denied" },
      });
      expect(mock.calls).toHaveLength(1);

      failing = false;
      await expect(send()).resolves.toBeInstanceOf(Response);
      expect(mock.calls[1]!.url.startsWith(DAILY)).toBe(true);
    } finally {
      mock.restore();
    }
  });

  test("session deletion clears the identity chain", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() => sseResponse([{ response: { candidates: [] } }]));
    try {
      const send = (invocation: string) => {
        const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
          "x-antigravity-opencode-session": "ses-del",
          "x-antigravity-opencode-invocation": invocation,
        });
        return loader.fetch(target.url, target.init);
      };
      await readStream(await send("a"));
      await readStream(await send("b"));
      const stepOf = (init: RequestInit) => Number(JSON.parse(String(init.body)).requestId.split("/").at(-1));
      const beforeDelete = [stepOf(mock.calls[0]!.init), stepOf(mock.calls[1]!.init)];
      expect(beforeDelete[1]).toBe(beforeDelete[0]! + 1);
      await harness.emit({ type: "session.deleted", data: { sessionID: "ses-del" } });
      await readStream(await send("c"));
      expect(stepOf(mock.calls[2]!.init)).toBe(beforeDelete[0]!); // fresh state starts over
    } finally {
      mock.restore();
    }
  });

  test("credential switches reset the per-session identity chain", async () => {
    const harness = makeHarness(OAUTH_AUTH);
    const mock = mockFetch((url) =>
      url.includes("fetchAvailableModels")
        ? new Response("unavailable", { status: 503 })
        : sseResponse([{ response: { candidates: [], responseId: "r-old" } }]),
    );
    try {
      const send = async (invocation: string) => {
        const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
          "x-antigravity-opencode-session": "ses-proj",
          "x-antigravity-opencode-invocation": invocation,
        });
        await readStream(await (await harness.loader()).fetch(target.url, target.init));
      };
      await send("t-1");
      await send("t-2");
      harness.setCredential({ ...OAUTH_AUTH, access: "at-other", metadata: { projectId: "proj-other" } });
      await harness.emit({ type: "credential.switched", data: { integrationID: "google-antigravity" } });
      await send("t-3");

      const dispatched = mock.calls.filter((call) => call.url.includes("streamGenerateContent"));
      const envelope = JSON.parse(String(dispatched[2]!.init.body));
      expect(envelope.project).toBe("proj-other");
      expect(envelope.requestId).toMatch(/\/2$/);
      expect(envelope.request.labels.last_execution_id).toBeUndefined();
      expect(new Headers(dispatched[2]!.init.headers).get("authorization")).toBe("Bearer at-other");
    } finally {
      mock.restore();
    }
  });
});

describe("model.request hook", () => {
  test("marks each invocation with the session and a fresh invocation id", async () => {
    const harness = makeHarness(undefined);
    await harness.ready();
    const first = { sessionID: "s-1", headers: {} as Record<string, string> };
    const second = { sessionID: "s-1", headers: {} as Record<string, string> };
    harness.hooks["session.model.request"]!(first);
    harness.hooks["session.model.request"]!(second);
    expect(first.headers["x-antigravity-opencode-session"]).toBe("s-1");
    expect(first.headers["x-antigravity-opencode-invocation"]).toMatch(/[0-9a-f-]{36}/);
    expect(second.headers["x-antigravity-opencode-invocation"]).not.toBe(
      first.headers["x-antigravity-opencode-invocation"],
    );
  });
});
