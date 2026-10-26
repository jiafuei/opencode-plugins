import { afterEach, expect, setSystemTime, test } from "bun:test";
import type { Plugin } from "@opencode/plugin";
import type { Info, ToolContext } from "@opencode/plugin/promise/tool";
import type { Schema } from "effect";
import Webfetch from "./server.ts";

const servers: Bun.Server<undefined>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  setSystemTime();
});

function site(handler: (request: Request, path: string) => Response) {
  const requests: Request[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      requests.push(request);
      return handler(request, new URL(request.url).pathname);
    },
  });
  servers.push(server);
  return {
    url: (path: string) => new URL(path, server.url).href,
    count: (path: string) => requests.filter((request) => new URL(request.url).pathname === path).length,
    requests,
  };
}

async function plugin({ replace = false, storage = new Map<string, Schema.Json>(), allow = true } = {}) {
  const tools: Info[] = [];
  const permissions: unknown[] = [];
  const ctx = {
    options: { replace },
    storage: {
      async get(key: string) { return storage.get(key); },
      async set(key: string, value: Schema.Json) { storage.set(key, structuredClone(value)); },
      async remove(key: string) { storage.delete(key); },
    },
    tool: { async transform(callback: (editor: { add(tool: Info): void }) => void) { callback({ add: (tool) => tools.push(tool) }); } },
    permission: { async assert(input: unknown) { permissions.push(input); if (!allow) throw new Error("Denied by webfetch permission"); } },
  };
  await Webfetch.setup(ctx as unknown as Plugin.Context);
  expect(tools).toHaveLength(1);
  const tool = tools[0]!;
  return {
    name: tool.name,
    permissions,
    storage,
    async read(url: string, fresh = false, signal = new AbortController().signal) {
      const result = await tool.execute({ url, fresh }, { signal } as ToolContext);
      expect(typeof result.content).toBe("string");
      return result.content as string;
    },
  };
}

test("prefers Markdown candidates, reports the nearest index, and reuses persistent caches", async () => {
  let content = "# Original Markdown";
  const web = site((_request, path) => {
    if (path === "/docs/guide.md") return new Response(content, { headers: { "Content-Type": "text/markdown" } });
    if (path === "/docs/llms.txt") return new Response("# PRIVATE INDEX CONTENT");
    return new Response("Not found", { status: 404 });
  });
  const first = await plugin();
  expect(first.name).toBe("webfetch_enhanced");
  for (const path of ["/docs/guide", "/docs/guide/", "/docs/guide.html"]) {
    const output = await first.read(web.url(path));
    expect(output).toStartWith(`Site documentation index: ${web.url("/docs/llms.txt")}\n`);
    expect(output).toContain(`Source: ${web.url("/docs/guide.md")}\n\n# Original Markdown`);
    expect(output).not.toContain("PRIVATE INDEX CONTENT");
    expect(web.count(path)).toBe(0);
  }
  expect(web.count("/docs/guide.md")).toBe(1);
  expect(web.count("/docs/llms.txt")).toBe(1);
  expect(web.count("/llms.txt")).toBe(0);

  const reloaded = await plugin({ storage: first.storage });
  content = "# Fresh Markdown";
  expect(await reloaded.read(web.url("/docs/guide#section"))).toContain("# Original Markdown");
  expect(web.count("/docs/guide.md")).toBe(1);
  expect(await reloaded.read(web.url("/docs/guide"), true)).toContain("# Fresh Markdown");
  expect(web.count("/docs/guide.md")).toBe(2);
  expect(web.count("/docs/llms.txt")).toBe(2);
  expect(first.permissions[0]).toMatchObject({ action: "webfetch", resources: [web.url("/docs/guide")] });
});

test("rejects HTML probe fallbacks and prunes short HTML docs without losing code, tables, or links", async () => {
  const html = `<!doctype html><html><head><base href="/reference/"><title>Guide</title></head><body>
    <nav>SITE NAVIGATION</nav><aside>SIDEBAR CLUTTER</aside>
    <main><header><h1>Install</h1></header><p>Use <a href="setup">the setup guide</a>.</p>
    <pre data-language="ts"><code>const fence = "\x60\x60\x60";\n  run();\n</code><button>COPY CLUTTER</button></pre>
    <table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>timeout</td><td>30</td></tr></tbody></table>
    <p hidden>HIDDEN CLUTTER</p><svg>SVG CLUTTER</svg><script>EXECUTABLE CLUTTER</script></main>
    <footer>FOOTER CLUTTER</footer></body></html>`;
  const web = site((_request, path) => {
    if (path === "/docs/install.md" || path === "/docs/llms.txt") return new Response("<!doctype html><html><body>SPA shell</body></html>");
    if (path === "/llms.txt") return new Response("# ROOT INDEX CONTENT");
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  });
  const app = await plugin();
  const output = await app.read(web.url("/docs/install"));
  expect(output).toStartWith(`Site documentation index: ${web.url("/llms.txt")}\nSource: ${web.url("/docs/install")}`);
  expect(output).toContain("# Install");
  expect(output).toContain(`[the setup guide](${web.url("/reference/setup")})`);
  expect(output).toContain("````ts\nconst fence = \"```\";\n  run();\n````");
  expect(output).toContain("| Name | Value |");
  expect(output).toContain("| timeout | 30 |");
  expect(output).not.toMatch(/CLUTTER|SPA shell|ROOT INDEX CONTENT/);
  await app.read(web.url("/docs/install"));
  expect(web.count("/docs/install.md")).toBe(1);
  expect(web.count("/docs/llms.txt")).toBe(1);
});

test("uses HTTP freshness and the 15-minute fallback, but never caches no-store responses", async () => {
  const start = Date.now();
  setSystemTime(start);
  const policies = [
    { path: "/default.txt", headers: {}, ttl: 900 },
    { path: "/max-age.txt", headers: { "Cache-Control": "private, max-age=120" }, ttl: 120 },
    { path: "/age.txt", headers: { "Cache-Control": "max-age=120", Age: "100" }, ttl: 20 },
    { path: "/expires.txt", headers: { Expires: new Date(start + 60_000).toUTCString() }, ttl: 60 },
    { path: "/no-cache.txt", headers: { "Cache-Control": "no-cache, max-age=3600" }, ttl: 0 },
    { path: "/no-store.txt", headers: { "Cache-Control": "no-store, max-age=3600" }, ttl: 0 },
  ];
  const web = site((_request, path) => {
    const policy = policies.find((entry) => entry.path === path);
    if (!policy) return new Response("Missing", { status: 404 });
    return new Response(`# ${web.count(path)}`, { headers: { ...policy.headers, Date: new Date().toUTCString() } });
  });
  const app = await plugin();
  for (const { path, ttl } of policies) {
    setSystemTime(start);
    expect(await app.read(web.url(path))).toEndWith("# 1");
    if (ttl > 0) {
      setSystemTime(start + (ttl - 1) * 1000);
      expect(await app.read(web.url(path))).toEndWith("# 1");
      expect(web.count(path)).toBe(1);
    }
    setSystemTime(start + (ttl + 1) * 1000);
    expect(await app.read(web.url(path))).toEndWith("# 2");
    expect(web.count(path)).toBe(2);
  }
});

test("preserves content on short, minified, and nonsemantic HTML pages", async () => {
  const cases = [
    { html: "<!doctype html><title>Title</title><h1>Title</h1><p>Some text</p>", includes: ["# Title", "Some text"] },
    { html: '<html><head><title>Example</title></head><body><div><h1>Example</h1><p>A short page.</p><p><a href="/more">Learn more</a></p></div></body></html>', includes: ["# Example", "Learn more"] },
    { html: "<html><body>Plain inline text without a paragraph.</body></html>", includes: ["Plain inline text without a paragraph."] },
    { html: "<html><body><article><h2>First post</h2><p>One</p></article><article><h2>Second post</h2><p>Two</p></article></body></html>", includes: ["## First post", "## Second post"] },
    { html: '<main><pre><code class="language-sh"><div class="token-line">first<br></div><div class="token-line">  second<br></div><div class="token-line">third</div></code></pre></main>', includes: ["```sh\nfirst\n  second\nthird\n```"] },
    { html: '<main><pre><code><div class="ec-line">alpha</div><div class="ec-line">beta</div></code></pre></main>', includes: ["```\nalpha\nbeta\n```"] },
    { html: '<main><h1>Useful page</h1><p><a href="http://">Malformed link</a></p></main>', includes: ["# Useful page", "Malformed link"] },
    { html: '<html><body><main id="root"></main><h1>Outside the shell</h1><p>Actual content.</p></body></html>', includes: ["# Outside the shell", "Actual content."] },
    { html: '<main><h1>Readable content</h1><table></table><table><tbody></tbody></table><table><caption>Pending results</caption></table></main>', includes: ["# Readable content", "Pending results"] },
  ];
  const web = site((_request, path) => {
    const fixture = cases[Number(path.slice(1).replace(".html", ""))];
    if (!fixture || !path.endsWith(".html")) return new Response("Missing", { status: 404 });
    return new Response(fixture.html, { headers: { "Content-Type": "text/html" } });
  });
  const app = await plugin();
  for (const [index, fixture] of cases.entries()) {
    const output = await app.read(web.url(`/${index}.html`));
    for (const expected of fixture.includes) expect(output).toContain(expected);
  }
});

test("accepts canonical probe redirects and remembers denied public probes as misses", async () => {
  const canonical = site((_request, path) => {
    if (path === "/guide.md") return new Response("# Canonical Markdown");
    if (path === "/llms.txt") return new Response("# Canonical index");
    return new Response("Canonical HTML fallback");
  });
  const redirect = site((_request, path) => Response.redirect(canonical.url(path), 301));
  const app = await plugin();
  const output = await app.read(redirect.url("/guide"));
  expect(output).toContain("# Canonical Markdown");
  expect(output).toStartWith(`Site documentation index: ${canonical.url("/llms.txt")}`);
  expect(output).toContain(`Source: ${canonical.url("/guide.md")}`);

  for (const status of [401, 403]) {
    const denied = site((_request, path) => path.endsWith(".md") || path.endsWith("llms.txt")
      ? new Response("Denied", { status }) : new Response("Public HTML", { headers: { "Content-Type": "text/plain" } }));
    await app.read(denied.url("/public"));
    await app.read(denied.url("/public"));
    expect(denied.count("/public.md")).toBe(1);
    expect(denied.count("/llms.txt")).toBe(1);
    expect(denied.count("/public")).toBe(1);
  }
});

test("revalidates cached content with validators, merges 304 freshness, and makes fresh unconditional", async () => {
  const seen: Headers[] = [];
  const web = site((request, path) => {
    if (path === "/llms.txt") return new Response("Missing", { status: 404 });
    seen.push(request.headers);
    if (request.headers.has("if-none-match")) return new Response(null, { status: 304, headers: { "Cache-Control": "max-age=3600" } });
    return new Response(`# Version ${seen.length}`, {
      headers: { ETag: '"v1"', "Last-Modified": "Mon, 26 Oct 2026 00:00:00 GMT", "Cache-Control": "max-age=0" },
    });
  });
  const app = await plugin();
  const url = web.url("/page.txt");
  expect(await app.read(url)).toEndWith("# Version 1");
  expect(await app.read(url)).toEndWith("# Version 1");
  expect(seen[1]!.get("if-none-match")).toBe('"v1"');
  expect(seen[1]!.get("if-modified-since")).toBe("Mon, 26 Oct 2026 00:00:00 GMT");
  expect(await app.read(url)).toEndWith("# Version 1");
  expect(seen).toHaveLength(2);
  expect(await app.read(url, true)).toEndWith("# Version 3");
  expect(seen[2]!.has("if-none-match")).toBe(false);
  expect(seen[2]!.has("if-modified-since")).toBe(false);
  expect(seen[2]!.get("cache-control")).toBe("no-cache");
});

test("caches discovery misses for a month, bypasses them on fresh, and retries transient probe failures", async () => {
  let published = false;
  let transient = true;
  const start = Date.now();
  const web = site((_request, path) => {
    if (path === "/retry.md") return transient
      ? new Response("Unavailable", { status: 503 }) : new Response("# Recovered Markdown");
    if (path === "/guide.md") return published ? new Response("# Published Markdown") : new Response("Missing", { status: 404 });
    if (path === "/llms.txt") return published ? new Response("# Newly published index") : new Response("Missing", { status: 404 });
    return new Response("<main><h1>HTML fallback</h1></main>", { headers: { "Content-Type": "text/html" } });
  });
  const app = await plugin();
  expect(await app.read(web.url("/retry"))).toContain("# HTML fallback");
  transient = false;
  expect(await app.read(web.url("/retry"))).toContain("# Recovered Markdown");
  expect(web.count("/retry.md")).toBe(2);

  expect(await app.read(web.url("/guide"))).toContain("# HTML fallback");
  published = true;
  setSystemTime(start + 29 * 24 * 60 * 60 * 1000);
  const before = await app.read(web.url("/guide"));
  expect(before).toContain("# HTML fallback");
  expect(before).not.toContain("Site documentation index:");
  expect(web.count("/guide.md")).toBe(1);
  setSystemTime(start + 31 * 24 * 60 * 60 * 1000);
  const after = await app.read(web.url("/guide"));
  expect(after).toContain("# Published Markdown");
  expect(after).toStartWith(`Site documentation index: ${web.url("/llms.txt")}`);
  expect(web.count("/guide.md")).toBe(2);

  published = false;
  await app.read(web.url("/guide"), true);
  published = true;
  expect(await app.read(web.url("/guide"))).toContain("# HTML fallback");
  expect(await app.read(web.url("/guide"), true)).toContain("# Published Markdown");
});

test("replacement registers only webfetch and permission denials prevent network access", async () => {
  const app = await plugin({ replace: true, allow: false });
  expect(app.name).toBe("webfetch");
  const web = site(() => new Response("Must not be fetched"));
  await expect(app.read(web.url("/guide"))).rejects.toThrow("Denied by webfetch permission");
  expect(web.requests).toHaveLength(0);
});
