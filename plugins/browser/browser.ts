import { homedir } from "node:os";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type CDPSession, type Page, type Request as BrowserRequest } from "playwright-core";
import { Observation, type SnapshotNode } from "./observations.ts";
import type { Command, Result } from "./protocol.ts";

type NetworkEntry = { id: number; request: BrowserRequest; started: number; finished?: number; status?: number; error?: string };
type ConsoleEntry = { id: number; level: string; text: string; url: string; line: number };
type Tab = {
  id: string;
  page: Page;
  observation?: Observation;
  navigation?: CDPSession;
  network: NetworkEntry[];
  console: ConsoleEntry[];
  nextRequest: number;
  nextMessage: number;
};

const OUTPUT_CHARS = 7000;
const LOG_ENTRIES = 200;
const RESULT_CHARS = 1_000_000;

function path(value: string) {
  return resolve(value.startsWith("~/") ? `${homedir()}/${value.slice(2)}` : value);
}

function networkURL(value: string) {
  const url = new URL(value);
  if (url.protocol === "data:") return `${value.slice(0, value.indexOf(",")).split(";", 1)[0].slice(0, 100)} (${value.length} chars)`;
  if (url.protocol === "blob:") return `blob:${url.origin}`;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href.slice(0, 500);
}

function headers(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [
    name,
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(name) ? "[redacted]" : value,
  ]));
}

/** Browser state has no dependency on OpenCode and lives entirely in the worker process. */
export class BrowserSession {
  private context?: BrowserContext;
  private dispose?: () => Promise<void>;
  private readonly pages = new WeakMap<Page, Tab>();
  private readonly tabs = new Map<string, Tab>();
  private readonly results = new Map<string, { text: string; total: number; format: string }>();
  private nextTab = 0;
  private nextObservation = 0;
  private nextResult = 0;

  async execute(command: Command): Promise<Result> {
    if (command.method === "launch") {
      if (this.dispose) throw new Error("A browser is already connected. Close it before launching another.");
      const launchOptions = { ...command.launchOptions };
      if (launchOptions.executablePath) launchOptions.executablePath = path(launchOptions.executablePath);
      let context: BrowserContext;
      if (typeof command.userDataDir === "string") {
        context = await chromium.launchPersistentContext(command.userDataDir === "" ? "" : path(command.userDataDir), {
          ...launchOptions,
          ...command.contextOptions,
        });
        this.dispose = () => context.close();
      } else {
        const browser = await chromium.launch(launchOptions);
        this.dispose = () => browser.close();
        context = await browser.newContext(command.contextOptions);
      }
      this.attach(context);
      if (command.url) {
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(command.url, { waitUntil: "domcontentloaded" });
      }
      if (context.pages().length === 0) await context.newPage();
      return { data: { ownership: "launched", ...(await this.listTabs()) } };
    }

    if (command.method === "connect") {
      if (this.dispose) throw new Error("A browser is already connected. Close it before connecting another.");
      const browser = await chromium.connectOverCDP(command.endpoint, { noDefaults: true, ...command.options });
      this.dispose = () => browser.close(); // A CDP Browser.close disconnects this client, not the external browser.
      const context = browser.contexts()[0];
      if (!context) throw new Error("The CDP browser has no default context.");
      this.attach(context);
      return { data: { ownership: "attached", ...(await this.listTabs()) } };
    }

    if (command.method === "close") {
      await this.close();
      return { data: { closed: true } };
    }
    if (command.method === "result") return { data: this.readResult(command.id, command.offset) };
    if (command.method === "tabs") return { data: await this.listTabs(command.offset) };
    if (command.method === "open") {
      if (!this.context) throw new Error("Launch or connect to a browser first.");
      const page = await this.context.newPage();
      if (command.url) await page.goto(command.url, { waitUntil: "domcontentloaded" });
      return { data: this.receipt(this.addPage(page)) };
    }

    const tab = this.tab(command.tab);
    const before = new Set(this.tabs.keys());
    switch (command.method) {
      case "close_tab":
        await tab.page.close();
        return { data: { closed: tab.id } };
      case "navigate":
        tab.observation = undefined;
        await tab.page.goto(command.url, { waitUntil: "domcontentloaded" });
        break;
      case "snapshot": {
        if (!tab.navigation) {
          const navigation = await tab.page.context().newCDPSession(tab.page);
          // CDP distinguishes document commits (including back/forward-cache restores)
          // from same-document history updates and child-frame navigation.
          navigation.on("Page.frameNavigated", ({ frame }) => {
            if (!frame.parentId) tab.observation = undefined;
          });
          await navigation.send("Page.enable");
          tab.navigation = navigation;
        }
        const scope = command.ref !== undefined
          ? this.locator(tab, command.ref)
          : command.selector !== undefined ? tab.page.locator(command.selector) : tab.page;
        // A capture replaces Playwright's frame ref maps even if serialization later fails.
        tab.observation = undefined;
        const tree = await scope.ariaSnapshotJSON({ mode: "ai" });
        const observation = new Observation(`o${++this.nextObservation}`, tree as (SnapshotNode | string)[]);
        tab.observation = observation;
        return { data: { ...this.receipt(tab), ...observation.view(undefined, 0, command.depth) } };
      }
      case "expand":
        return { data: { ...this.receipt(tab), ...this.observation(tab).view(command.ref, command.offset, command.depth) } };
      case "find":
        return { data: { ...this.receipt(tab), ...this.observation(tab).find(command.text, command.root, command.offset) } };
      case "read":
        return { data: { ...this.receipt(tab), ...this.observation(tab).read(command.ref, command.offset) } };
      case "click":
        await this.locator(tab, command.ref).click({ button: command.button, clickCount: command.count });
        break;
      case "fill":
        await this.locator(tab, command.ref).fill(command.text);
        break;
      case "select":
        await this.locator(tab, command.ref).selectOption(command.values);
        break;
      case "check":
        await this.locator(tab, command.ref).setChecked(command.checked);
        break;
      case "hover":
        await this.locator(tab, command.ref).hover();
        break;
      case "press":
        if (command.ref === undefined) await tab.page.keyboard.press(command.key);
        else await this.locator(tab, command.ref).press(command.key);
        break;
      case "scroll":
        if (command.ref !== undefined) await this.locator(tab, command.ref).hover();
        await tab.page.mouse.wheel(command.x ?? 0, command.y);
        break;
      case "wait": {
        const options = { timeout: command.timeoutMs ?? 10_000 };
        if ("loadState" in command) await tab.page.waitForLoadState(command.loadState, options);
        else {
          const target = "text" in command ? tab.page.getByText(command.text, { exact: true }) : tab.page.locator(command.selector);
          await target.first().waitFor({ ...options, state: command.state });
        }
        break;
      }
      case "evaluate":
      case "run_code": {
        try {
          let value: unknown;
          if (command.method === "evaluate") {
            value = command.ref === undefined
              ? await tab.page.evaluate((source) => (0, eval)(`(${source})`)(), command.code)
              : await this.locator(tab, command.ref).evaluate((element, source) => (0, eval)(`(${source})`)(element), command.code);
          } else {
            const fn: unknown = new Function(`"use strict"; return (${command.code});`)();
            if (typeof fn !== "function") throw new Error("run_code expects a function expression, for example async (page) => page.title().");
            value = await fn(tab.page);
          }
          return { data: { ...this.receipt(tab), ...this.storeResult(value) } };
        } finally {
          // Trusted code can navigate other tabs or capture snapshots itself, including before throwing.
          for (const page of this.tabs.values()) page.observation = undefined;
        }
      }
      case "screenshot": {
        const options = { type: "jpeg" as const, quality: 75, scale: "css" as const };
        const bytes = command.ref === undefined
          ? await tab.page.screenshot({ ...options, fullPage: command.fullPage })
          : await this.locator(tab, command.ref).screenshot(options);
        return { data: this.receipt(tab), image: { mime: "image/jpeg", base64: bytes.toString("base64") } };
      }
      case "console":
        return { data: { ...this.receipt(tab), ...this.consoleLog(tab, command) } };
      case "network_list":
        return { data: { ...this.receipt(tab), ...this.networkLog(tab, command) } };
      case "network_get": {
        const entry = tab.network.find((entry) => entry.id === command.request);
        if (!entry) throw new Error("Request is not retained in this tab. List its current network requests first.");
        const request = entry.request;
        if (command.part === "requestHeaders") return { data: this.storeResult(headers(await request.allHeaders())) };
        if (command.part === "requestBody") {
          const body = request.postData();
          if (body === null) throw new Error("This request has no body.");
          return { data: this.storeResult(body) };
        }
        if (entry.status === undefined) throw new Error("No response headers have arrived. The request is still pending or failed before receiving a response.");
        if (command.part === "responseBody" && entry.finished === undefined) throw new Error("Response body is not complete. Inspect headers or list requests again after it finishes; streaming responses may never finish.");
        const response = await request.response();
        if (!response) throw new Error("This request has no response. It may have failed or been cancelled.");
        if (command.part === "responseHeaders") return { data: this.storeResult(headers(await response.allHeaders())) };
        const contentType = response.headers()["content-type"] ?? "";
        if (contentType && !/text|json|xml|javascript|x-www-form-urlencoded|graphql/i.test(contentType)) {
          throw new Error(`Response is not text (${contentType}). Inspect its headers or use trusted run_code.`);
        }
        return { data: this.storeResult(await response.text()) };
      }
    }
    return { data: { ...this.receipt(tab), opened: [...this.tabs.keys()].filter((id) => !before.has(id)) } };
  }

  async close() {
    if (this.dispose) await this.dispose();
    this.dispose = undefined;
    this.context = undefined;
    this.tabs.clear();
    this.results.clear();
  }

  private attach(context: BrowserContext) {
    this.context = context;
    context.setDefaultTimeout(10_000);
    context.setDefaultNavigationTimeout(30_000);
    context.on("page", (page) => this.addPage(page));
    context.pages().forEach((page) => this.addPage(page));
  }

  private addPage(page: Page): Tab {
    const existing = this.pages.get(page);
    if (existing) return existing;
    const tab: Tab = { id: `t${++this.nextTab}`, page, network: [], console: [], nextRequest: 0, nextMessage: 0 };
    this.pages.set(page, tab);
    this.tabs.set(tab.id, tab);
    page.on("close", () => this.tabs.delete(tab.id));
    const requests = new WeakMap<BrowserRequest, NetworkEntry>();
    page.on("request", (request) => {
      const entry: NetworkEntry = { id: ++tab.nextRequest, request, started: Date.now() };
      requests.set(request, entry);
      tab.network.push(entry);
      if (tab.network.length > LOG_ENTRIES) tab.network.shift();
    });
    page.on("response", (response) => {
      const entry = requests.get(response.request());
      if (entry) entry.status = response.status();
    });
    page.on("requestfinished", (request) => {
      const entry = requests.get(request);
      if (entry) entry.finished = Date.now();
    });
    page.on("requestfailed", (request) => {
      const entry = requests.get(request);
      if (entry) {
        entry.finished = Date.now();
        entry.error = request.failure()?.errorText ?? "Request failed";
      }
    });
    page.on("console", (message) => {
      const location = message.location();
      tab.console.push({ id: ++tab.nextMessage, level: message.type(), text: message.text().slice(0, 1000), url: location.url.slice(0, 500), line: location.lineNumber });
      if (tab.console.length > LOG_ENTRIES) tab.console.shift();
    });
    page.on("pageerror", (error) => {
      tab.console.push({ id: ++tab.nextMessage, level: "error", text: error.message.slice(0, 1000), url: page.url().slice(0, 500), line: 0 });
      if (tab.console.length > LOG_ENTRIES) tab.console.shift();
    });
    return tab;
  }

  private tab(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error(`Unknown tab ${id}. Call tabs and use a current tab ID.`);
    return tab;
  }

  private observation(tab: Tab) {
    if (!tab.observation) throw new Error("This tab has no current observation. Take a snapshot first.");
    return tab.observation;
  }

  private locator(tab: Tab, ref: string) {
    return tab.page.getByRef(this.observation(tab).element(ref));
  }

  private receipt(tab: Tab) {
    return { tab: tab.id, url: tab.page.url().slice(0, 1000) };
  }

  private async listTabs(offset = 0) {
    const tabs = [];
    let chars = 0;
    for (const tab of [...this.tabs.values()].slice(offset)) {
      const item = { ...this.receipt(tab), title: (await tab.page.title()).slice(0, 200) };
      const size = JSON.stringify(item).length;
      if (chars + size > OUTPUT_CHARS) break;
      tabs.push(item);
      chars += size;
    }
    return { tabs, total: this.tabs.size, ...(offset + tabs.length < this.tabs.size ? { next: offset + tabs.length } : {}) };
  }

  private storeResult(value: unknown) {
    const text = typeof value === "string" ? value : JSON.stringify(value === undefined ? null : value);
    if (text === undefined) throw new Error("Return a string or JSON-compatible value from browser code.");
    const id = `v${++this.nextResult}`;
    this.results.set(id, { text: text.slice(0, RESULT_CHARS), total: text.length, format: typeof value === "string" ? "text" : "json" });
    if (this.results.size > 8) {
      const oldest = this.results.keys().next().value;
      if (oldest !== undefined) this.results.delete(oldest);
    }
    return this.readResult(id);
  }

  private readResult(id: string, offset = 0) {
    const result = this.results.get(id);
    if (!result) throw new Error("Result is no longer retained. The worker keeps its eight most recent code/network results.");
    const text = result.text.slice(offset, offset + OUTPUT_CHARS);
    return {
      result: id,
      format: result.format,
      text,
      totalChars: result.total,
      storedChars: result.text.length,
      ...(result.total > result.text.length ? { truncated: true } : {}),
      ...(offset + text.length < result.text.length ? { next: offset + text.length } : {}),
    };
  }

  private consoleLog(tab: Tab, command: Extract<Command, { method: "console" }>) {
    const after = command.after ?? 0;
    const entries: ConsoleEntry[] = [];
    let next = after;
    let chars = 0;
    for (const entry of tab.console) {
      if (entry.id <= after) continue;
      const matches = command.level === "all" || (command.level === "error" ? entry.level === "error" : ["warning", "error"].includes(entry.level));
      if (matches) {
        const size = JSON.stringify(entry).length;
        if (chars + size > OUTPUT_CHARS) break;
        entries.push(entry);
        chars += size;
      }
      next = entry.id;
    }
    return { entries, next, dropped: Math.max(0, (tab.console[0]?.id ?? 1) - after - 1) };
  }

  private networkLog(tab: Tab, command: Extract<Command, { method: "network_list" }>) {
    const after = command.after ?? 0;
    const entries = [];
    let next = after;
    let chars = 0;
    for (const entry of tab.network) {
      if (entry.id <= after) continue;
      const matches = (command.url === undefined || entry.request.url().toLowerCase().includes(command.url.toLowerCase())) &&
        (command.status === undefined || command.status === entry.status) &&
        (command.failed === undefined || command.failed === (entry.error !== undefined));
      if (matches) {
        const item = {
          id: entry.id,
          method: entry.request.method(),
          url: networkURL(entry.request.url()),
          status: entry.status ?? "pending",
          state: entry.error !== undefined ? "failed" : entry.finished === undefined ? "pending" : "complete",
          durationMs: (entry.finished ?? Date.now()) - entry.started,
          ...(entry.error ? { error: entry.error.slice(0, 500) } : {}),
        };
        const size = JSON.stringify(item).length;
        if (chars + size > OUTPUT_CHARS) break;
        entries.push(item);
        chars += size;
      }
      next = entry.id;
    }
    return { entries, next, dropped: Math.max(0, (tab.network[0]?.id ?? 1) - after - 1) };
  }
}
