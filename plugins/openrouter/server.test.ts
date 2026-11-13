import { expect, test } from "bun:test";
import { Model, Plugin, Provider } from "@opencode/plugin";
import type { ModelEditor } from "@opencode/plugin/promise/model";
import OpenRouter from "./server.ts";

async function instance(storage: Map<string, unknown>, directory = "/work/app", plugin = OpenRouter) {
  const hooks = new Map<string, (event: any) => Promise<void>>();
  let open: (input: Record<string, never>) => Promise<{ url: string }>;
  let transform: (editor: ModelEditor) => void;
  const source = [{
    ...Model.Info.default(Provider.ID.make("openrouter"), Model.ID.make("vendor/model")),
    name: "Model",
    settings: { provider: { allow_fallbacks: true, max_price: { prompt: 3, completion: 4 } } },
    body: { provider: { require_parameters: true } },
    variants: [{ id: "fast", settings: { provider: { max_price: { completion: 2 } } } }],
  }, {
    ...Model.Info.default(Provider.ID.make("openrouter"), Model.ID.make("vendor/locked")),
    name: "Config-disabled model",
    enabled: false,
  }];
  let models = structuredClone(source);
  const reload = async () => {
    models = structuredClone(source);
    transform({
      list: () => models,
      update: (_providerID, modelID, update) => {
        const model = models.find((model) => model.id === modelID)!;
        update(model);
      },
    } as ModelEditor);
  };
  const sessions: Record<string, unknown> = {
    main: { id: "main", location: { directory: "/work/app" } },
    other: { id: "other", location: { directory: "/work/app/worktree" } },
  };
  const dispose = await plugin.setup({
    location: { directory },
    storage: {
      get: async (key: string) => structuredClone(storage.get(key)),
      set: async (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => sessions[sessionID],
      hook: async (name: string, callback: (event: any) => Promise<void>, scope: unknown) => {
        expect(scope).toEqual({ providerID: "openrouter" });
        hooks.set(name, callback);
      },
    },
    model: {
      list: async () => ({ location: { directory }, data: models.filter((model) => model.enabled) }),
      transform: async (callback) => {
        transform = callback;
        await reload();
        return { dispose: async () => {} };
      },
      reload,
    } satisfies Pick<Plugin.Context["model"], "list" | "transform" | "reload">,
    rpc: { register: async (_definition: unknown, handlers: { open: typeof open }) => { open = handlers.open; } },
  } as never);
  const { url } = await open!({});
  const address = new URL(url);
  return {
    dispose: dispose!,
    url,
    models: () => models.filter((model) => model.enabled),
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
      await hooks.get("model.request")!(event);
      await hooks.get("http.request")!(event);
      expect(event.request.headers.get("authorization")).toBe("Bearer existing-connection");
      const body = await event.request.json() as { provider: Record<string, unknown>; [key: string]: unknown };
      expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
      expect(body.stream).toBe(true);
      return body.provider;
    },
  };
}

test("saved routing applies across request kinds, scopes, models, and plugin restarts", async () => {
  const storage = new Map<string, unknown>();
  let app = await instance(storage);
  try {
    const edits = [
      { patch: { zdr: { mode: "set", value: true }, order: { mode: "set", value: ["a"] }, only: { mode: "remove" } } },
      { modelID: "vendor/model", patch: { data_collection: { mode: "set", value: "deny" } } },
      { scope: "folder", patch: { order: { mode: "append", value: ["a", "b"] }, allow_fallbacks: { mode: "set", value: false } } },
      { scope: "folder", modelID: "vendor/model", patch: { order: { mode: "append", value: ["c"] }, zdr: { mode: "set", value: false } } },
    ];
    for (const edit of edits) expect((await app.api("settings", edit)).status).toBe(200);
    await app.dispose();
    app = await instance(storage, "/different/plugin/location");
    for (const kind of ["primary", "title", "compaction", "generate"]) {
      expect(await app.send("main", kind)).toEqual({ order: ["a", "b", "c"], allow_fallbacks: false, zdr: false, data_collection: "deny" });
    }
    expect(await app.send("other")).toEqual({ order: ["a"], allow_fallbacks: true, zdr: true, data_collection: "deny" });
    expect(await app.send("main", "primary", "another/model")).toEqual({ order: ["a", "b"], allow_fallbacks: false, zdr: true });
    // Clearing an override restores inheritance on the very next call.
    expect((await app.api("settings", { scope: "folder", modelID: "vendor/model", patch: {} })).status).toBe(200);
    expect((await app.send("main")).zdr).toBe(true);
  } finally { await app.dispose(); }
});

test("local UI API previews unsaved settings without persisting them, validates edits, and requires its launch token", async () => {
  const storage = new Map<string, unknown>();
  const app = await instance(storage);
  try {
    const page = await fetch(app.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Effective settings");
    const context = await fetch(new URL("/api/context", app.url), {
      headers: { authorization: `Bearer ${new URL(app.url).hash.slice(1)}` },
    });
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({
      directory: "/work/app",
      models: [
        { id: "vendor/locked", name: "Config-disabled model", available: false },
        { id: "vendor/model", name: "Model", variants: ["fast"], available: true },
      ],
      disabled: [],
    });
    expect((await fetch(new URL("/api/heartbeat", app.url), { method: "POST" })).status).toBe(401);
    expect((await app.api("heartbeat", {})).status).toBe(200);
    expect((await fetch(new URL("/api/context", app.url))).status).toBe(401);
    const draft = await app.api("preview", {
      variant: "fast",
      patch: { max_price: { mode: "remove" }, allow_fallbacks: { mode: "set", value: false }, sort: { mode: "set", value: { by: "price", partition: "none" } } },
    });
    expect(draft.status).toBe(200);
    expect((await draft.json() as { provider: unknown }).provider).toEqual({ allow_fallbacks: false, require_parameters: true, sort: { by: "price", partition: "none" } });
    expect(storage.size).toBe(0);
    const baseline = await (await app.api("settings", { variant: "fast" })).json() as { provider: Record<string, unknown> };
    expect(baseline.provider.max_price).toEqual({ prompt: 3, completion: 2 });
    expect((await app.api("settings", { patch: { zdr: { mode: "set", value: "yes" } } })).status).toBe(400);
    expect(storage.size).toBe(0);
    const sent = await app.send("main");
    expect(sent).toEqual({ order: ["original"], only: ["original"], allow_fallbacks: true });
  } finally { await app.dispose(); }
});

test("global model exclusions keep catalog entries visible, block session requests, and can be reversed", async () => {
  const storage = new Map<string, unknown>();
  const app = await instance(storage);
  const { default: separateModule } = await import(`./server.ts?location=${crypto.randomUUID()}`);
  let other = await instance(storage, "/work/other", separateModule);
  try {
    const response = await app.api("models", { disabled: ["vendor/model"] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      disabled: ["vendor/model"],
      models: [
        { id: "vendor/locked", available: false },
        { id: "vendor/model", name: "Model", available: true },
      ],
    });
    for (const location of [app, other]) {
      expect(location.models().map((model) => ({ id: model.id, name: model.name }))).toEqual([
        { id: "vendor/model", name: "Model (disabled - DO NOT USE)" },
      ]);
      for (const kind of ["primary", "title", "compaction", "generate"]) {
        await expect(location.send("main", kind)).rejects.toThrow("Model is explicitly disabled");
      }
    }
    // Reopening keeps one suffix, and exclusions outlive the plugin instance.
    await other.dispose();
    other = await instance(storage, "/work/other", separateModule);
    expect(other.models()[0]!.name).toBe("Model (disabled - DO NOT USE)");
    await expect(other.send("main")).rejects.toThrow("Model is explicitly disabled");
    expect((await other.api("models", { disabled: [] })).status).toBe(200);
    expect(app.models().map((model) => model.name)).toEqual(["Model"]);
    expect(other.models().map((model) => model.name)).toEqual(["Model"]);
    expect(await app.send("main")).toEqual({ order: ["original"], only: ["original"], allow_fallbacks: true });
    expect((await app.api("models", { disabled: [false] })).status).toBe(400);
  } finally {
    await app.dispose();
    await other.dispose();
  }
});
