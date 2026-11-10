import { expect, test } from "bun:test";
import { OAUTH_CREDENTIAL, setupPlugin } from "./test_harness.ts";

const MODEL = { providerID: "anthropic", id: "claude-opus-5-5" };

test("rejects unsupported spoofingProfile option values at the boundary", async () => {
  await expect(setupPlugin({ spoofingProfile: "deskmate" })).rejects.toThrow(/spoofingProfile/);
});

test("API-key requests pass through untouched and keep catalog costs", async () => {
  const { hooks, modelTransform } = await setupPlugin({}, { type: "key", key: "sk-ant-api" });
  const modelEvent = { sessionID: "ses_test", kind: "primary", headers: {} };
  await hooks["model.request"]!(modelEvent);
  const request = new Request("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": "sk-ant-api" }, body: "{}" });
  const event = { sessionID: "ses_test", request };
  await hooks["http.request"]!(event);
  expect(modelEvent.headers).toEqual({});
  expect(event.request).toBe(request);
  expect(request.bodyUsed).toBe(false);

  const updates: string[] = [];
  modelTransform({ list: () => [MODEL], update: (_: string, id: string) => updates.push(id) });
  expect(updates).toEqual([]);
});

test("a switch to the OAuth credential reloads models and zeroes Anthropic costs", async () => {
  const { state, modelTransform, emit } = await setupPlugin({}, null);
  state.credential = OAUTH_CREDENTIAL;
  await emit({ type: "credential.switched", data: { integrationID: "anthropic", credentialID: "cred_1" } });
  expect(state.reloads).toBe(1);
  const draft = { cost: [{ input: 3, output: 15 }] };
  modelTransform({ list: () => [MODEL], update: (_: string, __: string, update: (model: typeof draft) => void) => update(draft) });
  expect(draft.cost).toEqual([]);
});
