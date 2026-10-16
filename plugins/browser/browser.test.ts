import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Observation } from "./observations.ts";
import { BrowserRuntime } from "./runtime.ts";
import type { Result } from "./protocol.ts";
import plugin from "./server.ts";
import type { Context } from "@opencode/plugin/promise/plugin";
import type * as Tool from "@opencode/plugin/promise/tool";

const executable = process.env.BROWSER_TEST_EXECUTABLE ?? Bun.which("google-chrome") ?? Bun.which("chromium") ?? "";
const browserTest = executable ? test : test.skip;
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/stream") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("pending")); } }), { headers: { "content-type": "text/plain" } });
    if (url.pathname === "/api/orders") return Response.json({ orders: ["Acme", "Example"] }, { headers: { "x-fixture": "visible" } });
    if (url.pathname === "/frame") return new Response('<button onclick="this.textContent=\'Frame clicked\'">Frame action</button>', { headers: { "content-type": "text/html" } });
    return new Response(`<!doctype html><title>Browser fixture</title><main>
      <h1>Orders</h1><label>Search orders<input oninput="history.replaceState(null,'','?q='+encodeURIComponent(this.value))"></label>
      <button onclick="console.warn('fixture warning');fetch('/api/orders?token=secret',{headers:{Authorization:'Bearer fixture-token'}}).then(r=>r.json()).then(()=>document.querySelector('#state').textContent='Loaded')">Load orders</button>
      <output id="state">Idle</output><input type="checkbox" aria-label="Include archived">
      <iframe title="Cross-origin frame" src="http://localhost:${url.port}/frame"></iframe>
      <button onclick="const frame=document.querySelector('iframe');frame.onload=()=>document.querySelector('#frame-state').textContent='Frame ready';frame.src='http://localhost:${url.port}/frame?reload'">Reload frame</button>
      <output id="frame-state">Frame idle</output><a href="/next">Next page</a>
    </main>`, { headers: { "content-type": "text/html", "content-security-policy": "script-src 'self' 'unsafe-inline'" } });
  },
});
let directory: string;
beforeAll(async () => {
  const root = join(tmpdir(), "opencode");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, "browser-test-"));
});
afterAll(async () => {
  server.stop(true);
  await rm(directory, { recursive: true, force: true });
});

function element(result: Result, label: string) {
  const line = String(result.data.outline).split("\n").find((line) => line.includes(label));
  const ref = line?.match(/\[([^\]]+)\]/)?.[1];
  if (!ref) throw new Error(`Fixture element ${label} is missing from the observation: ${result.data.outline}`);
  return ref;
}

function firstTab(data: Record<string, unknown>) {
  const tabs = data.tabs as { tab: string }[];
  const tab = tabs[0]?.tab;
  if (!tab) throw new Error("Launched browser has no fixture tab");
  return tab;
}

test("large observations remain searchable and pageable without lost or duplicated content", () => {
  const content = Array.from({ length: 800 }, (_, i) => `Full text ${i} with\nnewlines.\n`).join("");
  const names = Array.from({ length: 1000 }, (_, i) => `Order ${i}`);
  const observation = new Observation("capture", [
    { role: "navigation", name: "Primary", children: [
      { role: "list", children: [
        { role: "group", children: [
          { role: "group", children: names.map((name, i) => ({ role: "button", ref: `e${i + 3}`, name: `${name} ${"long label ".repeat(12)}` })) },
        ] },
      ] },
    ] },
    { role: "main", name: "Orders", children: [
      { role: "form", children: [{ role: "group", children: [
        { role: "textbox", ref: "e1", name: "Search orders", text: "Acme", active: true, invalid: true },
        { role: "link", ref: "e2", name: "Order help", url: "https://example.com/orders" },
      ] }] },
      { role: "paragraph", text: content },
    ] },
  ]);
  const first = observation.view();
  expect(first.outline).toContain('main "Orders"');
  expect(first.outline).toContain('textbox "Search orders"');
  expect(first.outline).toContain('value="Acme"');
  expect(first.outline).toContain("active=true");
  expect(first.outline.indexOf('navigation "Primary"')).toBeLessThan(first.outline.indexOf('main "Orders"'));
  expect(observation.view(undefined, 0, 2).outline).not.toContain("Search orders");
  expect(observation.find("example.com/orders").matches).toBe(1);
  let offset = 0;
  let pages = 0;
  const recovered: string[] = [];
  for (;;) {
    const page = observation.view(undefined, offset);
    expect(page.outline.length).toBeLessThanOrEqual(7000);
    recovered.push(...(page.outline.match(/Order \d+/g) ?? []));
    pages++;
    if (page.next === undefined) break;
    expect(page.next).toBeGreaterThan(offset);
    offset = page.next;
  }
  expect(pages).toBeGreaterThan(1);
  expect(recovered).toEqual(names);
  const found = observation.find("Order 999");
  expect(found.matches).toBe(1);
  expect(found.outline).toContain("Primary");
  let text = "";
  offset = 0;
  for (;;) {
    const page = observation.read(undefined, offset);
    text += page.text;
    if (page.next === undefined) break;
    expect(page.next).toBeGreaterThan(offset);
    offset = page.next;
  }
  expect(text).toContain(content);
});

browserTest("history updates and iframe loads preserve refs; scoped snapshots replace them", async () => {
  const runtime = new BrowserRuntime(import.meta.dir, () => {});
  const signal = AbortSignal.timeout(30_000);
  try {
    const launched = await runtime.call({ method: "launch", url: server.url.href, launchOptions: { executablePath: executable, headless: true, args: ["--no-sandbox"] } }, signal);
    const tab = firstTab(launched.data);
    await runtime.call({ method: "wait", tab, selector: "button" }, signal);
    const snapshot = await runtime.call({ method: "snapshot", tab }, signal);
    const search = element(snapshot, 'textbox "Search orders"');
    await runtime.call({ method: "fill", tab, ref: search, text: "Acme" }, signal);
    await runtime.call({ method: "click", tab, ref: element(snapshot, "Reload frame") }, signal);
    await runtime.call({ method: "wait", tab, text: "Frame ready" }, signal);
    await runtime.call({ method: "press", tab, ref: search, key: "Backspace" }, signal);
    const scoped = await runtime.call({ method: "snapshot", tab, ref: search }, signal);
    expect(scoped.data.outline).toContain('value="Acm"');
    expect(scoped.data.outline).not.toContain("Reload frame");
    await expect(runtime.call({ method: "fill", tab, ref: search, text: "stale" }, signal)).rejects.toThrow("Stale observation ref");
    await runtime.call({ method: "fill", tab, ref: element(scoped, 'textbox "Search orders"'), text: "Current" }, signal);
    const refreshed = await runtime.call({ method: "snapshot", tab }, signal);
    await runtime.call({ method: "click", tab, ref: element(refreshed, "Next page") }, signal);
    await runtime.call({ method: "wait", tab, loadState: "domcontentloaded" }, signal);
    await expect(runtime.call({ method: "find", tab, text: "Search orders" }, signal)).rejects.toThrow("no current observation");
  } finally {
    await runtime.close();
  }
}, 35_000);

browserTest("real browser refs, cached search, iframe actions, evaluation, and diagnostics", async () => {
  const runtime = new BrowserRuntime(import.meta.dir, () => {});
  const signal = AbortSignal.timeout(30_000);
  try {
    const launched = await runtime.call({ method: "launch", url: server.url.href, launchOptions: { executablePath: executable, headless: true, args: ["--no-sandbox"] } }, signal);
    const tab = firstTab(launched.data);
    await runtime.call({ method: "run_code", tab, code: "async page => { await page.locator('iframe').contentFrame().getByRole('button', {name:'Frame action'}).waitFor(); }" }, signal, 10_000);
    await runtime.call({ method: "snapshot", tab, depth: 2 }, signal);
    const load = await runtime.call({ method: "find", tab, text: "Load orders" }, signal);
    const target = element(load, "Load orders");
    await runtime.call({ method: "click", tab, ref: target }, signal);
    // Cached searches/expansions must not replace Playwright's live ref map.
    const checkbox = await runtime.call({ method: "find", tab, text: "Include archived" }, signal);
    const frame = await runtime.call({ method: "find", tab, text: "Frame action" }, signal);
    await runtime.call({ method: "check", tab, ref: element(checkbox, "Include archived"), checked: true }, signal);
    await runtime.call({ method: "click", tab, ref: element(frame, "Frame action") }, signal);
    const state = await runtime.call({ method: "run_code", tab, code: "async page => { await page.getByText('Loaded', {exact:true}).waitFor(); return {checked:await page.getByRole('checkbox').isChecked(),frame:await page.locator('iframe').contentFrame().getByRole('button').innerText()}; }" }, signal, 10_000);
    expect(JSON.parse(String(state.data.text))).toEqual({ checked: true, frame: "Frame clicked" });
    // Code can replace Playwright's ref map. Its previous observation must no longer be actionable.
    await expect(runtime.call({ method: "click", tab, ref: target }, signal)).rejects.toThrow("no current observation");
    const network = await runtime.call({ method: "network_list", tab, url: "/api/orders", status: 200 }, signal);
    const requests = network.data.entries as { id: number; url: string }[];
    const request = requests[0];
    if (!request) throw new Error("Fixture request was not captured");
    expect(request.url).not.toContain("secret");
    const body = await runtime.call({ method: "network_get", tab, request: request.id, part: "responseBody" }, signal);
    expect(JSON.parse(String(body.data.text))).toEqual({ orders: ["Acme", "Example"] });
    const credentials = await runtime.call({ method: "network_get", tab, request: request.id, part: "requestHeaders" }, signal);
    expect(String(credentials.data.text)).not.toContain("fixture-token");
    const headers = await runtime.call({ method: "network_get", tab, request: request.id, part: "responseHeaders" }, signal);
    expect(JSON.parse(String(headers.data.text))["x-fixture"]).toBe("visible");
    const log = await runtime.call({ method: "console", tab }, signal);
    expect(JSON.stringify(log.data.entries)).toContain("fixture warning");
    const evaluated = await runtime.call({ method: "evaluate", tab, code: "() => ({title:document.title,host:typeof process})" }, signal, 10_000);
    expect(JSON.parse(String(evaluated.data.text))).toEqual({ title: "Browser fixture", host: "undefined" });
    await runtime.call({ method: "snapshot", tab, selector: "main" }, signal);
    const checked = await runtime.call({ method: "find", tab, text: "Include archived" }, signal);
    const value = await runtime.call({ method: "evaluate", tab, ref: element(checked, "Include archived"), code: "element => element.checked" }, signal, 10_000);
    expect(JSON.parse(String(value.data.text))).toBe(true);
    await runtime.call({ method: "evaluate", tab, code: "async () => { const response=await fetch('/stream'); window.fixtureStream=response; return response.status; }" }, signal, 10_000);
    const streaming = await runtime.call({ method: "network_list", tab, url: "/stream" }, signal);
    const stream = (streaming.data.entries as { id: number }[])[0];
    if (!stream) throw new Error("Fixture stream was not captured");
    await expect(runtime.call({ method: "network_get", tab, request: stream.id, part: "responseBody" }, signal)).rejects.toThrow("Response body is not complete");
    await runtime.call({ method: "tabs" }, signal); // Rejection must not come from a timeout that killed the worker.
  } finally {
    await runtime.close();
  }
}, 35_000);

browserTest("profiles persist across relaunch and CDP detach preserves the external browser", async () => {
  const userDataDir = `${directory}/profile`;
  const owner = new BrowserRuntime(import.meta.dir, () => {});
  const attached = new BrowserRuntime(import.meta.dir, () => {});
  const resumed = new BrowserRuntime(import.meta.dir, () => {});
  const signal = AbortSignal.timeout(30_000);
  try {
    const launched = await owner.call({ method: "launch", userDataDir, url: server.url.href, launchOptions: { executablePath: executable, headless: true, args: ["--no-sandbox", "--remote-debugging-port=0"] } }, signal);
    const ownerTab = firstTab(launched.data);
    const [port, endpoint] = (await Bun.file(`${userDataDir}/DevToolsActivePort`).text()).trim().split("\n");
    await attached.call({ method: "connect", endpoint: `ws://127.0.0.1:${port}${endpoint}` }, signal);
    await attached.close();
    await owner.call({ method: "run_code", tab: ownerTab, code: `async page => { await page.context().addCookies([{name:'persistent',value:'yes',url:${JSON.stringify(server.url.href)},expires:Math.floor(Date.now()/1000)+3600}]); }` }, signal);
    await owner.close();
    const restored = await resumed.call({ method: "launch", userDataDir, url: server.url.href, launchOptions: { executablePath: executable, headless: true, args: ["--no-sandbox"] } }, signal);
    const tab = firstTab(restored.data);
    const cookies = await resumed.call({ method: "run_code", tab, code: "async page => (await page.context().cookies()).find(cookie=>cookie.name==='persistent')?.value" }, signal);
    expect(cookies.data.text).toBe("yes");
  } finally {
    await attached.close();
    await owner.close();
    await resumed.close();
  }
}, 35_000);

browserTest("plugin permissions, native option overrides, images, and close/relaunch regressions", async () => {
  const tools = new Map<string, Tool.Info>();
  let allowCode = false;
  const cleanup = await plugin.setup({
    location: { directory: import.meta.dir },
    options: { userDataDir: `${directory}/adapter-profile`, launchOptions: { executablePath: executable, headless: true, args: ["--no-sandbox"] }, contextOptions: { locale: "de-DE" } },
    tool: {
      async transform(register: (editor: { namespace: () => void; add: (tool: Tool.Info) => void }) => void) {
        register({ namespace() {}, add(tool) { tools.set(tool.name, tool); } });
      },
    },
    permission: {
      async assert(request: { action: string }) {
        if (request.action === "browse_code" && !allowCode) throw new Error("Trusted code denied");
      },
    },
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      },
    },
  } as unknown as Context);
  const context = { sessionID: "fixture-session", agent: "build", messageID: "fixture-message", id: "fixture-call", signal: AbortSignal.timeout(20_000), progress: async () => {} } as unknown as Tool.ToolContext;
  const tool = (name: string) => {
    const found = tools.get(name);
    if (!found) throw new Error(`Tool ${name} not registered`);
    return found;
  };
  try {
    const overrides = { contextOptions: { locale: "fr-FR" } };
    await expect(tool("launch").execute(overrides, context)).rejects.toThrow("Trusted code denied");
    allowCode = true;
    const launched = await tool("launch").execute(overrides, context);
    const tab = firstTab(launched.output as Record<string, unknown>);
    await expect(tool("launch").execute({}, context)).rejects.toThrow("already launching or connected");
    allowCode = false;
    const input = { tab, code: "async page => ({pid:process.pid,language:await page.evaluate(()=>navigator.language)})" };
    await expect(tool("run_code").execute(input, context)).rejects.toThrow("Trusted code denied");
    allowCode = true;
    const output = await tool("run_code").execute(input, context);
    const value = JSON.parse(String((output.output as Record<string, unknown>).text));
    expect(value.pid).not.toBe(process.pid);
    expect(value.language).toBe("fr-FR");
    const screenshot = await tool("screenshot").execute({ tab }, context);
    const attachments = Array.isArray(screenshot.content) ? screenshot.content : [];
    expect(attachments.some((item) => item.type === "file" && item.mime.startsWith("image/") && item.uri.startsWith("data:image/"))).toBe(true);
    await expect(tool("run_code").execute({ tab, code: "async page => { while (true) {} }", timeoutMs: 100 }, context)).rejects.toThrow("cancelled or timed out");
    allowCode = false;
    // Relaunch must release both the adapter entry and Chromium's profile lock, without host-code permission.
    await tool("launch").execute({}, context);
    await Promise.all([tool("close").execute({}, context), tool("close").execute({}, context)]);
    await tool("launch").execute({}, context);
  } finally {
    if (cleanup) await cleanup();
  }
}, 25_000);
