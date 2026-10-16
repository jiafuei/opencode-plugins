import { join } from "node:path";
import { topicRevision, type MemoryInput, type MemoryStore } from "./store.ts";
import { listMemoryScopes, openMemoryStore } from "./scope.ts";

export function serveDashboard(options: {
  root: string;
  projectKey: string;
  directory: string;
  store: MemoryStore;
  projectDirectory: (key: string) => Promise<string | undefined>;
}) {
  const token = crypto.randomUUID();
  const assets: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/style.css": "style.css" };
  const projects = async () => {
    const result = [];
    for (const key of await listMemoryScopes(options.root)) {
      if (key.startsWith(".") || key === "global" || !await Bun.file(join(options.root, key, "index.md")).exists()) continue;
      const directory = key === options.projectKey ? options.directory : await options.projectDirectory(key);
      result.push({ id: key, name: directory ?? key, scope: "project", current: key === options.projectKey });
    }
    if (!result.some((entry) => entry.id === options.projectKey)) result.push({ id: options.projectKey, name: options.directory, scope: "project", current: true });
    return [{ id: "global", name: "Global · all projects", scope: "global", current: false }, ...result.sort((a, b) => a.name.localeCompare(b.name))];
  };
  const projectStore = async (id: string) => {
    if (!(await projects()).some((project) => project.id === id)) throw new Error("Unknown project");
    return id === options.projectKey ? options.store : openMemoryStore(options.root, id);
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      if (url.origin !== server.url.origin) return new Response("Forbidden", { status: 403 });
      if (!url.pathname.startsWith("/api/")) {
        const asset = assets[url.pathname];
        if (!asset || request.method !== "GET") return new Response("Not found", { status: 404 });
        return new Response(Bun.file(new URL(`./web/${asset}`, import.meta.url)), { headers: {
          "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        } });
      }
      if (request.headers.get("x-memory-token") !== token || (request.headers.has("origin") && request.headers.get("origin") !== server.url.origin)) {
        return Response.json({ error: "Access denied. Reopen the dashboard with /memory-web." }, { status: 403 });
      }
      try {
        let result: unknown;
        if (request.method === "GET" && url.pathname === "/api/projects") {
          result = await projects();
        } else if (request.method === "GET" && url.pathname === "/api/topics") {
          const selected = url.searchParams.get("project");
          const records = [];
          for (const project of await projects()) {
            if (selected && project.id !== selected) continue;
            const store = await projectStore(project.id);
            const topics = await store.serializeWrite(async () => {
              const view = await store.readView(await store.readCatalog());
              const topics = [];
              for (const entry of view.catalog) {
                const content = view.contents.get(entry.file) ?? await store.readTopicIfPresent(entry.file);
                topics.push({ ...entry, content: content ?? "", revision: content === undefined ? undefined : topicRevision(entry, content), status: view.status(entry), parent: view.parents.get(entry.file) });
              }
              return topics;
            });
            records.push(...topics.map((topic) => ({ ...topic, project: project.id, projectName: project.name })));
          }
          result = records;
        } else if (request.method === "POST" && url.pathname === "/api/topic") {
          const input = await request.json() as MemoryInput & { project: string; revision?: string };
          if (typeof input.project !== "string" || typeof input.title !== "string" || !input.title.trim() || typeof input.summary !== "string" || typeof input.content !== "string" || !input.content.trim()
            || !["preference", "instruction", "fact", "working", "recap", "reference", "feedback", "project", "insight"].includes(input.type!)) throw new Error("Provide a title, type, summary, and non-empty body.");
          const store = await projectStore(input.project);
          result = await store.serializeWrite(async () => {
            const catalog = await store.readCatalog();
            const previous = catalog.find((entry) => entry.file === input.target);
            if (previous && input.revision && topicRevision(previous, await store.readTopic(previous.file)) !== input.revision) throw new Error("This record changed. Refresh before saving.");
            const { entry, index } = await store.save(catalog, {
              target: input.target, title: input.title, summary: input.summary, content: input.content, type: input.type, origin: "dashboard",
            });
            await store.readView(index);
            return { file: entry.file };
          });
        } else if (request.method === "DELETE" && url.pathname === "/api/topic") {
          const input = await request.json() as { project: string; file: string };
          const store = await projectStore(input.project);
          result = await store.serializeWrite(async () => {
            const { removed, earlier, sources } = await store.remove(await store.readCatalog(), input.file);
            return { removed: [...removed], earlier, sources };
          });
        } else {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        return Response.json(result, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
      }
    },
  });
  return { url: `${server.url}#${token}`, stop: () => server.stop(true) };
}
