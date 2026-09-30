import { describe, expect, test } from "bun:test";
import { OAUTH_CREDENTIAL, setupPlugin } from "./test_harness.ts";

// Hook-level request capture: drives a native-provider /v1/messages request
// through the plugin's model.request / http.request / http.response hooks and
// inspects the request that would hit the wire.

const BASE_BODY = {
  model: "claude-sonnet-4-6",
  system: [{ type: "text", text: "You are a coding agent." }],
  messages: [{ role: "user", content: [{ type: "text", text: "hello world, this is the first user message" }] }],
  stream: true,
  max_tokens: 128000,
};

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
