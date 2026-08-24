import { describe, expect, test } from "bun:test";
import { AntigravityOAuthPlugin } from "./antigravity_oauth.ts";
import type { Config } from "@opencode-ai/plugin";

// Prevent live manifest discovery during plugin instantiation.
process.env.OPENCODE_ANTIGRAVITY_VERSION ??= "2.8.0";

const DAILY = "https://daily-cloudcode-pa.googleapis.com";
const SANDBOX = "https://daily-cloudcode-pa.sandbox.googleapis.com";

interface AuthStore {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function makeHarness(auth: AuthStore | undefined, options?: Record<string, unknown>) {
  const persistedBodies: Array<Record<string, unknown>> = [];
  let current = auth;
  const input = {
    client: {
      auth: {
        // Mirror OpenCode's real behavior: persisting updates what getAuth
        // subsequently returns.
        set: async ({ body }: { body: AuthStore }) => {
          persistedBodies.push({ ...body });
          current = { ...current, ...body } as AuthStore;
        },
      },
    },
    directory: "/tmp",
    worktree: "/tmp",
    project: { id: "p" },
    serverUrl: new URL("http://localhost:4096"),
    $: {},
    experimental_workspace: { register: () => {} },
  } as any;
  let cachedPlugin: Promise<Record<string, any>> | undefined;
  const pluginOnce = () => (cachedPlugin ??= AntigravityOAuthPlugin(input, options) as any);
  return {
    persistedBodies,
    getAuth: async () => current,
    setAuth(next: AuthStore | undefined) {
      current = next;
    },
    async loader() {
      const plugin = await pluginOnce();
      return (await plugin.auth!.loader!(async () => current, {} as any)) as any;
    },
    plugin: pluginOnce,
    persistedCount() {
      return persistedBodies.length;
    },
    lastPersistedBody(): Record<string, unknown> {
      return persistedBodies.at(-1)!;
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

const OAUTH_AUTH: AuthStore = {
  type: "oauth",
  access: "at-live",
  refresh: "rt",
  expires: Date.now() + 600_000,
  accountId: "proj-42",
};

async function readStream(response: Response): Promise<string> {
  return await new Response(response.body).text();
}

describe("config hook: provider registration", () => {
  test("registers the standalone provider backed by bundled @ai-sdk/google", async () => {
    const harness = await makeHarness(undefined);
    const config: Config = {};
    await (await harness.plugin()).config!(config);
    const provider = (config.provider as any)?.["google-antigravity"];
    expect(provider).toBeDefined();
    expect(provider.npm).toBe("@ai-sdk/google");
    expect(provider.name).toBe("Google Antigravity");
    expect(provider.options.baseURL).toBe(DAILY);
    for (const modelID of ["gemini-3.1-pro", "gemini-3-flash", "claude-opus-4-6", "gpt-oss-120b"]) {
      expect(provider.models[modelID]).toBeDefined();
    }
    expect(provider.models["claude-opus-4-6"].cost.input).toBe(0);
    // Effort variants map onto the captured budget tiers.
    expect(provider.models["gemini-3.1-pro"].variants.high.thinkingConfig.thinkingBudget).toBe(10001);
    expect(provider.models["gemini-3.7-flash"].variants.low.thinkingConfig.thinkingLevel).toBe("low");
  });

  test("preserves user-supplied provider and model settings", async () => {
    const harness = await makeHarness(undefined);
    const config = {
      provider: {
        "google-antigravity": {
          name: "My Antigravity",
          options: { baseURL: SANDBOX },
          models: {
            "gemini-3.1-pro": { name: "Custom Pro", variants: { high: { thinkingConfig: { thinkingBudget: 12345 } } } },
            "custom-model": { name: "Custom" },
          },
        },
      },
    } as unknown as Config;
    await (await harness.plugin()).config!(config);
    const provider = (config.provider as any)!["google-antigravity"];
    expect(provider.name).toBe("My Antigravity");
    expect(provider.options.baseURL).toBe(SANDBOX);
    // User model overrides win; defaults fill the rest.
    expect(provider.models["gemini-3.1-pro"].name).toBe("Custom Pro");
    expect(provider.models["gemini-3.1-pro"].variants.high.thinkingConfig.thinkingBudget).toBe(12345);
    expect(provider.models["gemini-3.1-pro"].variants.low).toBeDefined();
    expect(provider.models["custom-model"]).toBeDefined();
    expect(provider.models["claude-opus-4-6"]).toBeDefined();
  });
});

describe("auth loader fetch boundary", () => {
  test("rejects non-official origins without dispatching anything", async () => {
    const harness = await makeHarness(OAUTH_AUTH);
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

  test("non-OAuth stored credentials surface a clear error instead of private requests", async () => {
    const harness = await makeHarness({ type: "api" });
    const loader = await harness.loader();
    const mock = mockFetch(() => {
      throw new Error("must not be called");
    });
    try {
      await expect(
        loader.fetch(`${DAILY}/models/gemini-3.1-pro:streamGenerateContent?alt=sse`, { method: "POST", body: "{}" }),
      ).rejects.toThrow(/only supports Antigravity OAuth transport/);
      expect(mock.calls).toHaveLength(0);
    } finally {
      mock.restore();
    }
  });

  test("rewrites requests into the Cloud Code Assist envelope with native headers", async () => {
    const harness = await makeHarness(OAUTH_AUTH);
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
    const harness = await makeHarness(OAUTH_AUTH);
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
        "x-antigravity-opencode-session": "ses-1",
        "x-antigravity-opencode-invocation": "inv-1",
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
        "x-antigravity-opencode-session",
        "x-antigravity-opencode-invocation",
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
    const harness = await makeHarness(OAUTH_AUTH);
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
                  properties: { path: { type: "string", pattern: "^/" } },
                  required: ["path"],
                  additionalProperties: false,
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
        properties: { path: { type: "string" } },
        required: ["path"],
      });
    } finally {
      mock.restore();
    }
  });

  test("session chain advances across invocations and survives SDK retries", async () => {
    const harness = await makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() => sseResponse([{ response: { candidates: [], responseId: "r-1" } }]));
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
    const harness = await makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch((url) => {
      if (url.startsWith(DAILY)) return new Response("overloaded", { status: 503 });
      return sseResponse([{ response: { candidates: [] } }]);
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
    const harness = await makeHarness(OAUTH_AUTH);
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

  test("non-transient in-band errors surface instead of failing over", async () => {
    const harness = await makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() =>
      sseResponse([{ error: { code: 403, message: "permission denied", status: "PERMISSION_DENIED" } }]),
    );
    try {
      const target = streamTarget("gemini-2.5-pro", { contents: [] }, {});
      const response = await loader.fetch(target.url, target.init);
      await expect(readStream(response)).rejects.toThrow(/Cloud Code Assist stream error \(PERMISSION_DENIED\): permission denied/);
      expect(mock.calls).toHaveLength(1); // no sandbox attempt
    } finally {
      mock.restore();
    }
  });

  test("failed streams never poison session state or the last-good endpoint", async () => {
    const harness = await makeHarness(OAUTH_AUTH);
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
    const harness = await makeHarness(OAUTH_AUTH, { endpointMode: "production" });
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

  test("invalid plugin options fail during initialization", async () => {
    await expect(makeHarness(undefined, { endpointMode: "other" }).plugin()).rejects.toThrow(/endpointMode/);
    await expect(makeHarness(undefined, { firstEventTimeoutMs: 0 }).plugin()).rejects.toThrow(
      /finite positive number/,
    );
  });

  test("expired credentials refresh once, persist rotation, and keep the project", async () => {
    const harness = await makeHarness({ ...OAUTH_AUTH, access: "stale", refresh: "rt-old", expires: Date.now() - 1000 });    const loader = await harness.loader();

    const mock = mockFetch(async (url) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "fresh-at", refresh_token: "rt-new", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return sseResponse([{ response: { candidates: [] } }]);
    });
    try {
      const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
        "x-antigravity-opencode-session": "ses-r",
        "x-antigravity-opencode-invocation": "i-1",
      });
      await readStream(await loader.fetch(target.url, target.init));

      expect(harness.persistedCount()).toBe(1);
      expect(harness.lastPersistedBody()).toMatchObject({
        type: "oauth",
        access: "fresh-at",
        refresh: "rt-new",
        accountId: "proj-42", // the Cloud Code Assist project survives refresh
      });
      // The dispatched request carries the fresh bearer.
      const dispatched = mock.calls.find((call) => call.url.includes("v1internal"))!;
      expect(new Headers(dispatched.init.headers).get("authorization")).toBe("Bearer fresh-at");

      // A follow-up invocation does not refresh again.
      const second = streamTarget("gemini-2.5-pro", { contents: [] }, {
        "x-antigravity-opencode-session": "ses-r",
        "x-antigravity-opencode-invocation": "i-2",
      });
      await readStream(await loader.fetch(second.url, second.init));
      expect(harness.persistedCount()).toBe(1);
      expect(mock.calls.filter((call) => call.url.endsWith("/token"))).toHaveLength(1);
    } finally {
      mock.restore();
    }
  });

  test("incomplete stored credentials fail loudly instead of dispatching", async () => {
    const harness = await makeHarness({ type: "oauth", access: "at", refresh: "", expires: Date.now() + 600_000 });
    const loader = await harness.loader();
    await expect(
      loader.fetch(`${DAILY}/models/gemini-2.5-pro:streamGenerateContent?alt=sse`, { method: "POST", body: "{}" }),
    ).rejects.toThrow(/incomplete/);
  });

  test("project transitions reset the per-session identity chain", async () => {
    const harness = await makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(() => sseResponse([{ response: { candidates: [] } }]));
    try {
      const send = (invocation: string) => {
        const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
          "x-antigravity-opencode-session": "ses-proj",
          "x-antigravity-opencode-invocation": invocation,
        });
        return loader.fetch(target.url, target.init);
      };
      const readStep = (init: RequestInit) => Number(JSON.parse(String(init.body)).requestId.split("/").at(-1));
      await readStream(await send("t-1"));
      await readStream(await send("t-2"));
      expect(readStep(mock.calls[1]!.init)).toBe(3);

      // A different project id means a fresh login: the chain starts over.
      harness.setAuth({ ...OAUTH_AUTH, accountId: "proj-other" });
      await readStream(await send("t-3"));
      expect(JSON.parse(String(mock.calls[2]!.init.body)).project).toBe("proj-other");
      expect(readStep(mock.calls[2]!.init)).toBe(2);
    } finally {
      mock.restore();
    }
  });

  test("refresh is fenced against concurrent logout / re-login", async () => {
    const harness = await makeHarness({ ...OAUTH_AUTH, access: "stale", refresh: "rt-old", expires: Date.now() - 1000 });
    const loader = await harness.loader();

    // While the refresh request is in flight, a new login replaces stored auth.
    const mock = mockFetch(async (url) => {
      if (url === "https://oauth2.googleapis.com/token") {
        harness.setAuth({ type: "oauth", access: "at-new-login", refresh: "rt-fresh-login", expires: Date.now() + 600_000, accountId: "proj-42" });
        return new Response(JSON.stringify({ access_token: "rotated-at", refresh_token: "rotated-rt", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return sseResponse([{ response: { candidates: [] } }]);
    });
    try {
      const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
        "x-antigravity-opencode-session": "ses-fence",
        "x-antigravity-opencode-invocation": "i-1",
      });
      const response = await loader.fetch(target.url, target.init);
      await readStream(response);

      // The rotated tokens were never persisted over the newer login.
      expect(harness.persistedCount()).toBe(0);
      // And the dispatched request uses the latest persisted credential.
      const dispatched = mock.calls.find((call) => call.url.includes("v1internal"))!;
      expect(new Headers(dispatched.init.headers).get("authorization")).toBe("Bearer at-new-login");
    } finally {
      mock.restore();
    }
  });

  test("a concurrent re-login to another project resets the request chain", async () => {
    const harness = await makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const mock = mockFetch(async (url) => {
      if (url === "https://oauth2.googleapis.com/token") {
        harness.setAuth({
          type: "oauth",
          access: "at-other",
          refresh: "rt-other",
          expires: Date.now() + 600_000,
          accountId: "proj-other",
        });
        return new Response(JSON.stringify({ access_token: "discarded", expires_in: 3600 }), {
          headers: { "content-type": "application/json" },
        });
      }
      return sseResponse([{ response: { candidates: [], responseId: "r-old" } }]);
    });
    const send = async (invocation: string) => {
      const target = streamTarget("gemini-2.5-pro", { contents: [] }, {
        "x-antigravity-opencode-session": "ses-project-refresh",
        "x-antigravity-opencode-invocation": invocation,
      });
      await readStream(await loader.fetch(target.url, target.init));
    };
    try {
      await send("i-1");
      await send("i-2");
      harness.setAuth({ ...OAUTH_AUTH, access: "expired", expires: Date.now() - 1 });
      await send("i-3");

      const dispatched = mock.calls.filter((call) => call.url.includes("v1internal"));
      const envelope = JSON.parse(String(dispatched[2]!.init.body));
      expect(envelope.project).toBe("proj-other");
      expect(envelope.requestId).toMatch(/\/2$/);
      expect(envelope.request.labels.last_execution_id).toBeUndefined();
    } finally {
      mock.restore();
    }
  });

  test("non-stream responses unwrap and commit response identity after successful parse", async () => {
    const harness = await makeHarness(OAUTH_AUTH);
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
    const harness = await makeHarness(OAUTH_AUTH);
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
    const harness = await makeHarness(OAUTH_AUTH);
    const loader = await harness.loader();
    const plugin = await harness.plugin();
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
      await plugin.event!({
        event: { type: "session.deleted", properties: { info: { id: "ses-del" } } },
      } as any);
      await readStream(await send("c"));
      expect(stepOf(mock.calls[2]!.init)).toBe(beforeDelete[0]!); // fresh state starts over
    } finally {
      mock.restore();
    }
  });

  test("chat.headers marks only OAuth sessions of this provider", async () => {
    const harness = await makeHarness(undefined);
    const plugin = await harness.plugin();
    const hook = plugin["chat.headers"]!;
    const output = { headers: {} as Record<string, string> };
    await hook(
      {
        sessionID: "s-1",
        agent: "build",
        model: { id: "gemini-3.1-pro", providerID: "google-antigravity" },
        provider: { source: "custom", info: {} as any, options: { antigravityOAuth: true } },
        message: { id: "m-1" } as any,
      },
      output,
    );
    expect(output.headers["x-antigravity-opencode-session"]).toBe("s-1");
    expect(output.headers["x-antigravity-opencode-invocation"]).toMatch(/[0-9a-f-]{36}/);

    const untouched = { headers: {} as Record<string, string> };
    await hook(
      {
        sessionID: "s-2",
        agent: "build",
        model: { id: "claude-sonnet-4-6", providerID: "anthropic" },
        provider: { source: "custom", info: {} as any, options: { antigravityOAuth: true } },
        message: { id: "m-2" } as any,
      },
      untouched,
    );
    expect(Object.keys(untouched.headers)).toHaveLength(0);
  });
});
