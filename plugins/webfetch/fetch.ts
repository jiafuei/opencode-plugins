import type { Plugin } from "@opencode/plugin";
import { toMarkdown } from "./markdown.ts";
import type { NativeProfile } from "./profiles.ts";

type Storage = Pick<Plugin.Context["storage"], "get" | "set" | "remove">;
type Discovery = { url: string | null; expiresAt: number };
type Page = { url: string; content: string; expiresAt: number; headers: Record<string, string> };

const MONTH = 30 * 24 * 60 * 60 * 1000;
const CACHE_HEADERS = ["cache-control", "expires", "etag", "last-modified"];
const ACCEPT = "text/markdown, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7";

function isHTML(type: string, text: string): boolean {
  return /(?:text\/html|application\/xhtml\+xml)/i.test(type)
    || /^(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(text.trimStart());
}

export class WebFetcher {
  constructor(private readonly storage: Storage, private readonly profile?: NativeProfile, private readonly cookies?: string) {}

  async read(url: URL, fresh: boolean, signal: AbortSignal): Promise<string> {
    if (this.cookies) {
      const page = await this.page(url, false, fresh, signal);
      return `Source: ${page.url}\n\n${page.content}`;
    }
    const [page, index] = await Promise.all([
      this.content(url, fresh, signal),
      this.index(url, fresh, signal),
    ]);
    return `${index ? `Site documentation index: ${index}\n` : ""}Source: ${page.url}\n\n${page.content}`;
  }

  private async content(url: URL, fresh: boolean, signal: AbortSignal): Promise<Page> {
    const path = url.pathname.replace(/\/$/, "");
    if (path && (!/\.[^/]+$/.test(path) || /\.html$/.test(path))) {
      const candidate = new URL(url);
      candidate.pathname = `${path.replace(/\.html$/, "")}.md`;
      const page = await this.page(candidate, true, fresh, signal);
      if (page) return page;
    }
    return this.page(url, false, fresh, signal);
  }

  private page(url: URL, candidate: false, fresh: boolean, signal: AbortSignal): Promise<Page>;
  private page(url: URL, candidate: true, fresh: boolean, signal: AbortSignal): Promise<Page | undefined>;
  private async page(url: URL, candidate: boolean, fresh: boolean, signal: AbortSignal): Promise<Page | undefined> {
    const discoveryKey = `discovery/${this.profile ?? "default"}/${url.href}`;
    if (candidate && !fresh) {
      const known = await this.storage.get(discoveryKey) as Discovery | undefined;
      if (known && known.expiresAt > Date.now() && known.url === null) return;
    }
    const key = `content/v1/${this.profile ?? "default"}/${url.href}`;
    const cached = fresh || this.cookies ? undefined : await this.storage.get(key) as Page | undefined;
    if (cached && cached.expiresAt > Date.now()) return cached;

    const headers = new Headers({ Accept: ACCEPT });
    if (fresh) headers.set("Cache-Control", "no-cache");
    if (cached?.headers.etag) headers.set("If-None-Match", cached.headers.etag);
    if (cached?.headers["last-modified"]) headers.set("If-Modified-Since", cached.headers["last-modified"]);
    const response = await this.request(url, headers, signal);
    let page: Page;
    if (response.status === 304 && cached) {
      page = { ...cached, headers: { ...cached.headers } };
    } else {
      if (!response.ok) {
        await response.body?.cancel();
        if (!candidate) throw new Error(`HTTP ${response.status} ${response.statusText}: ${url.href}`);
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          await this.storage.set(discoveryKey, { url: null, expiresAt: Date.now() + MONTH });
          await this.storage.remove(key);
        }
        return;
      }
      const type = response.headers.get("content-type") ?? "";
      const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(type)?.[1] ?? "utf-8";
      const text = new TextDecoder(charset).decode(await response.arrayBuffer());
      const final = new URL(response.url);
      const html = isHTML(type, text);
      if (candidate) {
        const found = response.status === 200 && final.pathname.endsWith(".md") && !html && text.trim() !== "";
        await this.storage.set(discoveryKey, { url: found ? final.href : null, expiresAt: Date.now() + MONTH });
        if (!found) {
          await this.storage.remove(key);
          return;
        }
      } else if (!html && type && !/^(?:text\/|application\/(?:json|[\w.+-]+\+json|xml|[\w.+-]+\+xml))/i.test(type)
        && !(type.startsWith("application/octet-stream") && /\.(?:md|txt)$/.test(final.pathname))) {
        throw new Error(`Unsupported content type: ${type}. This tool reads text pages.`);
      }
      page = { url: final.href, content: html ? toMarkdown(text, final.href) : text.trim(), expiresAt: 0, headers: {} };
    }
    if (this.cookies) return page;

    for (const name of CACHE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) page.headers[name] = value;
    }
    const now = Date.now();
    const control = page.headers["cache-control"] ?? "";
    const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(control);
    const date = Date.parse(response.headers.get("date") ?? "") || now;
    const age = Math.max(Number(response.headers.get("age") ?? 0) * 1000, now - date, 0);
    const lifetime = maxAge ? Number(maxAge[1]) * 1000
      : page.headers.expires ? Date.parse(page.headers.expires) - date : 15 * 60 * 1000;
    page.expiresAt = /\bno-cache\b/i.test(control) ? now : now + (Number.isNaN(lifetime) ? 0 : lifetime) - age;
    if (/\bno-store\b/i.test(control)) await this.storage.remove(key);
    else await this.storage.set(key, page);
    return page;
  }

  private async index(url: URL, fresh: boolean, signal: AbortSignal): Promise<string | undefined> {
    let directory = new URL(".", url);
    while (true) {
      const target = new URL("llms.txt", directory);
      const key = `discovery/${this.profile ?? "default"}/${target.href}`;
      const known = fresh ? undefined : await this.storage.get(key) as Discovery | undefined;
      if (known && known.expiresAt > Date.now()) {
        if (known.url) return known.url;
      } else {
        const headers = new Headers({ Accept: "text/plain", ...(fresh ? { "Cache-Control": "no-cache" } : {}) });
        const response = await this.request(target, headers, signal);
        let found = false;
        if (response.status === 200 && new URL(response.url).pathname.endsWith("/llms.txt")) {
          const reader = response.body?.getReader();
          let prefix = "";
          if (reader) {
            const decoder = new TextDecoder();
            try {
              while (prefix.length < 512) {
                const { value, done } = await reader.read();
                if (done) break;
                prefix += decoder.decode(value.subarray(0, 512 - prefix.length), { stream: true });
              }
            } finally {
              await reader.cancel();
            }
          }
          found = prefix.trim() !== "" && !isHTML(response.headers.get("content-type") ?? "", prefix);
        } else {
          await response.body?.cancel();
        }
        if (response.status === 200 || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)) {
          await this.storage.set(key, { url: found ? response.url : null, expiresAt: Date.now() + MONTH });
        }
        if (found) return response.url;
      }
      if (directory.pathname === "/") return;
      directory = new URL("../", directory);
    }
  }

  private async request(url: URL, headers: Headers, signal: AbortSignal): Promise<Response> {
    if (!this.profile && !this.cookies) return fetch(url, { headers, signal });
    const native = await import("./native.ts");
    return native.request(url, headers, signal, this.profile, this.cookies);
  }
}
