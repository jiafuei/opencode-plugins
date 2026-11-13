import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { OpenRouterRpc } from "./rpc.ts";
import { fields, patchSchema, resolveSettings, settingsKey, type Layer, type Patch } from "./settings.ts";

const selectionSchema = z.object({
  sessionID: z.string().optional(),
  scope: z.enum(["global", "folder", "session"]),
  modelID: z.string(),
  previewModelID: z.string(),
  variant: z.string().optional(),
  patch: patchSchema.optional(),
});

const modelSelectionSchema = z.object({ disabled: z.array(z.string()) });
const disabledModelsKey = "models/disabled";
// Local plugin reloads re-evaluate modules, but loaded locations share this realm.
const modelReloadsKey = Symbol.for("@jiafuei/opencode-openrouter/model-reloads");
const shared = globalThis as typeof globalThis & { [modelReloadsKey]?: Set<() => Promise<void>> };
const modelReloads = shared[modelReloadsKey] ??= new Set<() => Promise<void>>();

export default Plugin.define({
  id: "openrouter-settings",
  async setup(ctx) {
    let server: Bun.Server<undefined> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const token = crypto.randomUUID();
    let disabledModels = new Set((await ctx.storage.get(disabledModelsKey) as string[] | undefined) ?? []);
    let models: { id: string; name: string; variants: string[]; available: boolean }[] = [];

    await ctx.model.transform((editor) => {
      models = editor.list("openrouter").map((model) => ({
        id: model.id,
        name: model.name,
        variants: model.variants.map((variant) => variant.id),
        available: model.enabled,
      })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      for (const model of models) {
        if (!disabledModels.has(model.id)) continue;
        editor.update("openrouter", model.id, (draft) => {
          draft.name = `${model.name} (disabled - DO NOT USE)`;
        });
      }
    });

    async function reloadModels() {
      disabledModels = new Set((await ctx.storage.get(disabledModelsKey) as string[] | undefined) ?? []);
      await ctx.model.reload();
    }

    await ctx.session.hook("model.request", async (event) => {
      const disabled = await ctx.storage.get(disabledModelsKey) as string[] | undefined;
      if (disabled?.includes(event.model.id)) throw new Error("Model is explicitly disabled");
    }, { providerID: "openrouter" });

    function stop() {
      clearTimeout(idleTimer);
      server?.stop(true);
      server = undefined;
    }

    async function context(sessionID?: string) {
      const sessions = [];
      while (sessionID) {
        const session = await ctx.session.get({ sessionID });
        sessions.unshift(session);
        sessionID = session.parentID;
      }
      const session = sessions.at(-1);
      return { sessions, session, directory: session?.location.directory ?? ctx.location.directory };
    }

    async function layers(info: Awaited<ReturnType<typeof context>>, modelID: string) {
      const scopes = [
        { id: "global", name: "Global" },
        { id: `folder/${encodeURIComponent(info.directory)}`, name: "Folder" },
        ...info.sessions.map((session) => ({ id: `session/${session.id}`, name: `Session: ${session.title ?? session.id}` })),
      ];
      const entries = scopes.flatMap((scope) => [
        { key: settingsKey(scope.id, ""), name: `${scope.name} defaults` },
        ...(modelID ? [{ key: settingsKey(scope.id, modelID), name: `${scope.name} · ${modelID}` }] : []),
      ]);
      return Promise.all(entries.map(async (entry): Promise<Layer> => ({
        ...entry, patch: (await ctx.storage.get(entry.key) as Patch | undefined) ?? {},
      })));
    }

    await ctx.session.hook("http.request", async (event) => {
      const info = await context(event.sessionID);
      const applied = await layers(info, event.model.id);
      if (!applied.some((layer) => Object.keys(layer.patch).length)) return;
      const body = await event.request.json() as { provider?: Record<string, unknown> };
      const { provider } = resolveSettings(body.provider ?? {}, applied);
      if (Object.keys(provider).length) body.provider = provider;
      else delete body.provider;
      const headers = new Headers(event.request.headers);
      headers.delete("content-length");
      event.request = new Request(event.request, { headers, body: JSON.stringify(body) });
    }, { providerID: "openrouter" });

    // Start the local UI only when it is opened from the TUI.
    await ctx.rpc.register(OpenRouterRpc, {
      open: async ({ sessionID }) => {
        if (!server) {
          server = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            async fetch(request) {
              const url = new URL(request.url);
              if (!url.pathname.startsWith("/api/")) {
                const assets: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/style.css": "style.css" };
                const asset = assets[url.pathname];
                if (!asset) return new Response("Not found", { status: 404 });
                return new Response(Bun.file(new URL(`./web/${asset}`, import.meta.url)));
              }
              if (request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
              if (url.pathname === "/api/heartbeat" && request.method === "POST") {
                idleTimer!.refresh();
                return Response.json({ ok: true });
              }
              if (url.pathname === "/api/context" && request.method === "GET") {
                const info = await context(url.searchParams.get("sessionID") ?? undefined);
                await reloadModels();
                await ctx.model.list();
                return Response.json({
                  directory: info.directory,
                  session: info.session ? { id: info.session.id, title: info.session.title, model: info.session.model } : null,
                  models,
                  disabled: [...disabledModels],
                  fields,
                }, { headers: { "Cache-Control": "no-store" } });
              }
              if (url.pathname === "/api/models" && request.method === "POST") {
                const input = modelSelectionSchema.parse(await request.json());
                await ctx.storage.set(disabledModelsKey, [...new Set(input.disabled)]);
                // Every loaded location owns a registry; invalidate each after a global edit.
                await Promise.all([...modelReloads].map((reload) => reload()));
                await ctx.model.list();
                return Response.json({ models, disabled: [...disabledModels] }, { headers: { "Cache-Control": "no-store" } });
              }
              if ((url.pathname === "/api/settings" || url.pathname === "/api/preview") && request.method === "POST") {
                const input = selectionSchema.parse(await request.json());
                const info = await context(input.sessionID);
                if (input.scope === "session" && !info.session) {
                  return Response.json({ error: "Session not found" }, { status: 400 });
                }
                const scope = input.scope === "folder" ? `folder/${encodeURIComponent(info.directory)}`
                  : input.scope === "session" ? `session/${info.session!.id}` : "global";
                const key = settingsKey(scope, input.modelID);
                if (url.pathname === "/api/settings" && input.patch) await ctx.storage.set(key, input.patch);
                const patch = input.patch ?? (await ctx.storage.get(key) as Patch | undefined) ?? {};
                const applied = await layers(info, input.previewModelID);
                if (input.patch) {
                  const edited = applied.find((layer) => layer.key === key);
                  if (edited) edited.patch = input.patch;
                }
                const { data: models } = await ctx.model.list();
                const model = models.find((model) => model.providerID === "openrouter" && model.id === input.previewModelID);
                const variant = model?.variants.find((variant) => variant.id === input.variant);
                // Model registry values already include provider defaults. Body overlays win over semantic settings.
                const base: Record<string, unknown> = {};
                for (const overlay of [model?.settings?.provider, variant?.settings?.provider, model?.body?.provider, variant?.body?.provider]) {
                  for (const [key, value] of Object.entries(overlay ?? {})) {
                    const prev = base[key];
                    base[key] = value && typeof value === "object" && !Array.isArray(value)
                      ? { ...(prev && typeof prev === "object" && !Array.isArray(prev) ? prev : {}), ...value }
                      : value;
                  }
                }
                return Response.json({ patch, ...resolveSettings(base, applied) }, { headers: { "Cache-Control": "no-store" } });
              }
              return Response.json({ error: "Not found" }, { status: 404 });
            },
            error(error) {
              if (error instanceof z.ZodError) {
                const message = error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
                return Response.json({ error: message }, { status: 400 });
              }
              return Response.json({ error: error.message }, { status: 500 });
            },
          });
        }
        clearTimeout(idleTimer);
        idleTimer = setTimeout(stop, 5 * 60_000);
        idleTimer.unref();
        const url = new URL(`http://127.0.0.1:${server.port}/`);
        if (sessionID) url.searchParams.set("sessionID", sessionID);
        url.hash = token;
        return { url: url.href };
      },
    });

    modelReloads.add(reloadModels);
    return () => {
      modelReloads.delete(reloadModels);
      stop();
    };
  },
});
