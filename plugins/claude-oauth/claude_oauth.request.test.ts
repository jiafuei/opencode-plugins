import { describe, expect, test } from "bun:test";
import { OAUTH_CREDENTIAL, setupPlugin } from "./test_harness.ts";

// Hook-level request capture: drives a native-provider /v1/messages request
// through the plugin's model.request / http.request / http.response hooks and
// inspects the request that would hit the wire.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const BASE_BODY = {
  model: "claude-sonnet-4-6",
  system: [{ type: "text", text: "You are a coding agent." }],
  messages: [{ role: "user", content: [{ type: "text", text: "hello world, this is the first user message" }] }],
  stream: true,
  max_tokens: 128000,
};

describe("request capture: Cowork OAuth streaming request", () => {
  test("reaches the wire fingerprinted as Claude Code", async () => {
    const { send } = await setupPlugin({ spoofingProfile: "cowork" });
    const { request, bodyText } = await send(BASE_BODY);

    expect(request.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    const headers = Object.fromEntries(request.headers);
    expect(headers["authorization"]).toBe("Bearer test-access-token");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["x-session-affinity"]).toBeUndefined();
    expect(headers["x-session-id"]).toBeUndefined();
    expect(headers["x-opencode-session"]).toBeUndefined();
    expect(headers["user-agent"]).toBe("claude-cli/2.1.246 (external, claude-desktop)");
    expect(headers["x-app"]).toBe("cli");
    expect(headers["x-client-request-id"]).toMatch(UUID);
    expect(headers["x-claude-code-session-id"]).toMatch(UUID);
    const betas = headers["anthropic-beta"]!.split(",");
    expect(betas).toContain("oauth-2025-04-20");
    for (const agentBeta of ["effort-2025-11-24", "fallback-credit-2026-06-01", "claude-code-20250219"]) {
      expect(betas).not.toContain(agentBeta);
    }

    const body = JSON.parse(bodyText);
    expect(body.system[0].text).toContain("x-anthropic-billing-header:");
    expect(body.system[0].text).not.toContain("cch=00000");
    expect(body.system[0].text).toContain("cc_entrypoint=claude-desktop;");
    expect(bodyText).not.toContain("cc_prev_req=");
    const userId = JSON.parse(body.metadata.user_id);
    expect(userId.session_id).toBe(headers["x-claude-code-session-id"]);
    expect(userId.account_uuid).toBe("acct-test-123");
  });

  test("tool names are cloaked on the way out and restored from the SSE stream", async () => {
    const { send } = await setupPlugin({ spoofingProfile: "cowork" });
    const sse = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"_get_weather","input":{}}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
    ].join("\n\n") + "\n\n";
    const { bodyText, response } = await send(
      {
        ...BASE_BODY,
        tools: [
          { name: "get_weather", input_schema: { type: "object" } },
          { name: "web_search", type: "web_search_20250305" },
        ],
        tool_choice: { type: "tool", name: "get_weather" },
      },
      () => new Response(sse, { headers: { "content-type": "text/event-stream", "content-length": "1" } }),
    );
    const body = JSON.parse(bodyText);
    expect(body.tools.map((tool: any) => tool.name)).toEqual(["_get_weather", "web_search"]);
    expect(body.tool_choice).toEqual({ type: "tool", name: "_get_weather" });
    expect(response.headers.get("content-length")).toBeNull();
    const text = await response.text();
    expect(text).toContain('"name":"get_weather"');
    expect(text).not.toContain("_get_weather");
  });

  test("derives restart-stable Cowork UUIDs", async () => {
    const plugins: Awaited<ReturnType<typeof setupPlugin>>[] = [];
    const sessionId = async (raw: string) => {
      const plugin = await setupPlugin({ spoofingProfile: "cowork" });
      plugins.push(plugin);
      const { request } = await plugin.send(BASE_BODY, undefined, raw);
      return { plugin, id: request.headers.get("x-claude-code-session-id")! };
    };
    try {
      const coworkA = await sessionId("ses-a");
      const coworkA2 = await sessionId("ses-a");
      const coworkB = await sessionId("ses-b");
      expect(coworkA.id).toBe(coworkA2.id);
      expect(coworkB.id).not.toBe(coworkA.id);
      await coworkA.plugin.emit({ type: "session.deleted", data: { sessionID: "ses-a" } });
      expect((await sessionId("ses-a")).id).toBe(coworkA.id);
    } finally {
      for (const plugin of plugins) plugin.cleanup?.();
    }
  });
});

test("rejects unsupported spoofingProfile option values at the boundary", async () => {
  await expect(setupPlugin({ spoofingProfile: "deskmate" })).rejects.toThrow(/spoofingProfile/);
});

describe("non-OAuth connections", () => {
  test("API-key requests pass through untouched and keep catalog costs", async () => {
    const { send, modelTransform } = await setupPlugin({}, { type: "key", key: "sk-ant-api" });
    const { request, bodyText } = await send(BASE_BODY);
    expect(request.headers.get("x-api-key")).toBe("sk-ant-api");
    expect(request.headers.get("x-claude-code-session-id")).toBeNull();
    expect(JSON.parse(bodyText)).toEqual(BASE_BODY);

    const updates: string[] = [];
    modelTransform({ list: () => [{ providerID: "anthropic", id: "claude-sonnet-4-6" }], update: (_: string, id: string) => updates.push(id) });
    expect(updates).toEqual([]);
  });

  test("OAuth zeroes anthropic costs; credential switches reload models", async () => {
    const { state, modelTransform, emit } = await setupPlugin({}, null);
    const draft = { cost: [{ input: 3, output: 15 }] };
    const editor = {
      list: () => [{ providerID: "anthropic", id: "claude-sonnet-4-6" }],
      update: (_: string, __: string, update: (model: typeof draft) => void) => update(draft),
    };
    modelTransform(editor);
    expect(draft.cost).toHaveLength(1);

    state.credential = OAUTH_CREDENTIAL;
    await emit({ type: "credential.switched", data: { integrationID: "anthropic", credentialID: "cred_1" } });
    expect(state.reloads).toBe(1);
    modelTransform(editor);
    expect(draft.cost).toEqual([]);
  });
});
