import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { OpenRouterRpc } from "./rpc.ts";
import { fields, patchSchema, resolveSettings, settingsKey, type Layer, type Patch } from "./settings.ts";

const selectionSchema = z.object({
  scope: z.enum(["global", "folder"]),
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

    async function pruneRetiredOverrides() {
      if (!models.length) return;
      const known = new Set(models.map((model) => model.id));
      let after: string | undefined;
      do {
        const page = await ctx.storage.scan({ prefix: "config/", after });
        for (const entry of page.entries) {
          const encoded = entry.key.slice(entry.key.lastIndexOf("/") + 1);
          if (encoded !== "*" && !known.has(decodeURIComponent(encoded))) {
            await ctx.storage.remove(entry.key);
          }
        }
        after = page.next;
      } while (after);
    }

    await pruneRetiredOverrides();

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

    async function layers(directory: string, modelID: string) {
      const scopes = [
        { id: "global", name: "Global" },
        { id: `folder/${encodeURIComponent(directory)}`, name: "Folder" },
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
      const session = event.sessionID ? await ctx.session.get({ sessionID: event.sessionID }) : undefined;
      const applied = await layers(session?.location.directory ?? ctx.location.directory, event.model.id);
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
      open: async () => {
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
              if (url.pathname === "/api/heartbeat" && request.method === "POST") {
                idleTimer!.refresh();
                return Response.json({ ok: true });
              }
              if (url.pathname === "/api/context" && request.method === "GET") {
                await reloadModels();
                await ctx.model.list();
                await pruneRetiredOverrides();
                return Response.json({
                  directory: ctx.location.directory,
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
                const scope = input.scope === "folder" ? `folder/${encodeURIComponent(ctx.location.directory)}` : "global";
                const key = settingsKey(scope, input.modelID);
                if (url.pathname === "/api/settings" && input.patch) {
                  if (Object.keys(input.patch).length) await ctx.storage.set(key, input.patch);
                  else await ctx.storage.remove(key);
                }
                const patch = input.patch ?? (await ctx.storage.get(key) as Patch | undefined) ?? {};
                const applied = await layers(ctx.location.directory, input.previewModelID);
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
