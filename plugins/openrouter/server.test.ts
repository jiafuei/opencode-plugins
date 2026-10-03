import { expect, test } from "bun:test";
import OpenRouter from "./server.ts";

async function instance(storage: Map<string, unknown>, directory = "/work/app") {
  let hook: (event: any) => Promise<void>;
  let open: (input: { sessionID?: string }) => Promise<{ url: string }>;
  const sessions: Record<string, unknown> = {
    parent: { id: "parent", title: "Parent", location: { directory: "/work/app" } },
    child: { id: "child", parentID: "parent", title: "Child", location: { directory: "/work/app" } },
    other: { id: "other", location: { directory: "/work/app/worktree" } },
  };
  const dispose = await OpenRouter.setup({
    location: { directory },
    storage: {
      get: async (key: string) => structuredClone(storage.get(key)),
      set: async (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => sessions[sessionID],
      hook: async (name: string, callback: typeof hook, scope: unknown) => {
        expect(name).toBe("http.request");
        expect(scope).toEqual({ providerID: "openrouter" });
        hook = callback;
      },
    },
    model: { list: async () => [{
      id: "vendor/model", providerID: "openrouter", name: "Model",
      settings: { provider: { allow_fallbacks: true, max_price: { prompt: 3, completion: 4 } } },
      body: { provider: { require_parameters: true } },
      variants: [{ id: "fast", settings: { provider: { max_price: { completion: 2 } } } }],
    }] },
    rpc: { register: async (_definition: unknown, handlers: { open: typeof open }) => { open = handlers.open; } },
  } as never);
  const { url } = await open!({});
  const address = new URL(url);
  return {
    dispose: dispose!,
    url,
    api: (path: string, input: Record<string, unknown>) => fetch(new URL(`/api/${path}`, address), {
      method: "POST",
      headers: { authorization: `Bearer ${address.hash.slice(1)}`, "content-type": "application/json" },
      body: JSON.stringify({ scope: "global", modelID: "", previewModelID: "vendor/model", ...input }),
    }),
    send: async (sessionID: string, kind = "primary", modelID = "vendor/model") => {
      const event = {
        sessionID, kind, model: { id: modelID, providerID: "openrouter" },
        request: new Request("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST", headers: { authorization: "Bearer existing-connection", "content-type": "application/json" },
          body: JSON.stringify({ model: modelID, messages: [{ role: "user", content: "Hello" }], stream: true, provider: { order: ["original"], only: ["original"], allow_fallbacks: true } }),
        }),
      };
      await hook!(event);
      expect(event.request.headers.get("authorization")).toBe("Bearer existing-connection");
      const body = await event.request.json();
      expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
      expect(body.stream).toBe(true);
      return body.provider;
    },
  };
}

test("saved routing applies across request kinds, scopes, models, child sessions, and plugin restarts", async () => {
  const storage = new Map<string, unknown>();
  let app = await instance(storage);
  try {
    const edits = [
      { patch: { zdr: { mode: "set", value: true }, order: { mode: "set", value: ["a"] }, only: { mode: "remove" } } },
      { modelID: "vendor/model", patch: { data_collection: { mode: "set", value: "deny" } } },
      { scope: "folder", patch: { order: { mode: "append", value: ["a", "b"] }, allow_fallbacks: { mode: "set", value: false } } },
      { scope: "session", sessionID: "parent", patch: { order: { mode: "append", value: ["c"] } } },
      { scope: "session", sessionID: "child", modelID: "vendor/model", patch: { order: { mode: "append", value: ["b", "d"] }, zdr: { mode: "set", value: false } } },
    ];
    for (const edit of edits) expect((await app.api("settings", edit)).status).toBe(200);
    await app.dispose();
    app = await instance(storage, "/different/plugin/location");
    for (const kind of ["primary", "title", "compaction", "generate"]) {
      expect(await app.send("child", kind)).toEqual({ order: ["a", "b", "c", "d"], allow_fallbacks: false, zdr: false, data_collection: "deny" });
    }
    expect(await app.send("parent")).toEqual({ order: ["a", "b", "c"], allow_fallbacks: false, zdr: true, data_collection: "deny" });
    expect(await app.send("other")).toEqual({ order: ["a"], allow_fallbacks: true, zdr: true, data_collection: "deny" });
    expect(await app.send("child", "primary", "another/model")).toEqual({ order: ["a", "b", "c"], allow_fallbacks: false, zdr: true });
    // Clearing an override restores inheritance on the very next call.
    expect((await app.api("settings", { scope: "session", sessionID: "child", modelID: "vendor/model", patch: {} })).status).toBe(200);
    expect((await app.send("child")).zdr).toBe(true);
  } finally { await app.dispose(); }
});

test("local UI API previews unsaved settings without persisting them, validates edits, and requires its launch token", async () => {
  const storage = new Map<string, unknown>();
  const app = await instance(storage);
  try {
    const page = await fetch(app.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Effective settings");
    expect((await fetch(new URL("/api/context", app.url))).status).toBe(401);
    const draft = await app.api("preview", {
      variant: "fast",
      patch: { max_price: { mode: "remove" }, allow_fallbacks: { mode: "set", value: false }, sort: { mode: "set", value: { by: "price", partition: "none" } } },
    });
    expect(draft.status).toBe(200);
    expect((await draft.json()).provider).toEqual({ allow_fallbacks: false, require_parameters: true, sort: { by: "price", partition: "none" } });
    expect(storage.size).toBe(0);
    const baseline = await (await app.api("settings", { variant: "fast" })).json();
    expect(baseline.provider.max_price).toEqual({ prompt: 3, completion: 2 });
    expect((await app.api("settings", { patch: { zdr: { mode: "set", value: "yes" } } })).status).toBe(400);
    expect(storage.size).toBe(0);
    const sent = await app.send("parent");
    expect(sent).toEqual({ order: ["original"], only: ["original"], allow_fallbacks: true });
  } finally { await app.dispose(); }
});
