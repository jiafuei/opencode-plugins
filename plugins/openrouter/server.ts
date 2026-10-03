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

export default Plugin.define({
  id: "openrouter-settings",
  async setup(ctx) {
    let server: Bun.Server<undefined> | undefined;
    const token = crypto.randomUUID();

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
      const request = event.request;
      if (request.method !== "POST" || !request.headers.get("content-type")?.includes("application/json")) return;
      const info = await context(event.sessionID);
      const applied = await layers(info, event.model.id);
      if (!applied.some((layer) => Object.keys(layer.patch).length)) return;
      const body = await request.json();
      const { provider } = resolveSettings(body.provider ?? {}, applied);
      if (Object.keys(provider).length) body.provider = provider;
      else delete body.provider;
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      event.request = new Request(request, { headers, body: JSON.stringify(body) });
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
                if (!asset || request.method !== "GET") return new Response("Not found", { status: 404 });
                return new Response(Bun.file(new URL(`./web/${asset}`, import.meta.url)), { headers: {
                  "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
                  "Referrer-Policy": "no-referrer",
                } });
              }
              if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("Unauthorized", { status: 401 });
              try {
                if (url.pathname === "/api/context" && request.method === "GET") {
                  const info = await context(url.searchParams.get("sessionID") ?? undefined);
                  const models = (await ctx.model.list()).filter((model) => model.providerID === "openrouter");
                  return Response.json({
                    directory: info.directory,
                    session: info.session ? { id: info.session.id, title: info.session.title, model: info.session.model } : null,
                    models: models.map((model) => ({ id: model.id, name: model.name, variants: model.variants.map((variant) => variant.id) })),
                    fields,
                  }, { headers: { "Cache-Control": "no-store" } });
                }
                if ((url.pathname === "/api/settings" || url.pathname === "/api/preview") && request.method === "POST") {
                  const input = selectionSchema.parse(await request.json());
                  const info = await context(input.sessionID);
                  if (input.scope === "session" && !info.session) return Response.json({ error: "Open settings from a session to edit its overrides." }, { status: 400 });
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
                  const models = await ctx.model.list();
                  const model = models.find((model) => model.providerID === "openrouter" && model.id === input.previewModelID);
                  const variant = model?.variants.find((variant) => variant.id === input.variant);
                  // Model registry values already include provider defaults. Body overlays win over semantic settings.
                  const base: Record<string, unknown> = {};
                  for (const overlay of [model?.settings?.provider, variant?.settings?.provider, model?.body?.provider, variant?.body?.provider]) {
                    for (const [key, value] of Object.entries(overlay ?? {})) {
                      base[key] = value && typeof value === "object" && !Array.isArray(value)
                        ? { ...(typeof base[key] === "object" ? base[key] : {}), ...value }
                        : value;
                    }
                  }
                  return Response.json({ patch, ...resolveSettings(base, applied) }, { headers: { "Cache-Control": "no-store" } });
                }
                return new Response("Not found", { status: 404 });
              } catch (error) {
                return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof z.ZodError ? 400 : 500 });
              }
            },
          });
        }
        const url = new URL(`http://127.0.0.1:${server.port}/`);
        if (sessionID) url.searchParams.set("sessionID", sessionID);
        url.hash = token;
        return { url: url.href };
      },
    });

    return () => { server?.stop(true); };
  },
});
