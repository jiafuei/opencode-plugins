#!/usr/bin/env bun
// Prune an HTML string into Stagehand's compact accessibility outline.
// Usage: bun prune.ts [file.html | -] [--scope <css>] [--ignore <css>]... [--base-url <url>] [--json]
import { parseArgs } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type DomNode = {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  attributes?: string[];
  isScrollable?: boolean;
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
};
type AXValue = { value?: unknown };
type AXNode = {
  nodeId: string;
  role?: AXValue;
  name?: AXValue;
  properties?: { name: string; value: AXValue }[];
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
};
type Node = {
  nodeId: string;
  role: string;
  name?: string;
  selected?: boolean;
  checked?: boolean;
  parentId?: string;
  childIds?: string[];
  encodedId?: string;
  children?: Node[];
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scope: { type: "string" },
    ignore: { type: "string", multiple: true, default: [] },
    "base-url": { type: "string" },
    json: { type: "boolean", default: false },
  },
});
const input = positionals[0] ?? "-";
const raw = input === "-" ? await Bun.stdin.text() : await Bun.file(input).text();
// The page is about:blank, so relative hrefs only resolve into the URL map with a <base>.
const html = values["base-url"] ? `<base href="${values["base-url"]}">${raw}` : raw;

const userDataDir = mkdtempSync(join(tmpdir(), "prune-chrome-"));
const chrome = Bun.spawn(
  [
    process.env.CHROME_PATH ?? "google-chrome",
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--window-size=1280,720",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdout: "ignore", stderr: "pipe" },
);

try {
  const send = await connect(await devtoolsPageUrl());
  const result = await snapshot(send);
  console.log(values.json ? JSON.stringify(result, null, 2) : result.outline);
} finally {
  chrome.kill();
  await chrome.exited;
  rmSync(userDataDir, { recursive: true, force: true });
}

async function devtoolsPageUrl(): Promise<string> {
  let log = "";
  const decoder = new TextDecoder();
  for await (const chunk of chrome.stderr) {
    log += decoder.decode(chunk);
    const m = log.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
    if (!m) continue;
    const targets: { type: string; webSocketDebuggerUrl: string }[] = await (
      await fetch(`http://127.0.0.1:${m[1]}/json/list`)
    ).json();
    return targets.find((t) => t.type === "page")!.webSocketDebuggerUrl;
  }
  throw new Error(`Chrome exited before exposing DevTools:\n${log}`);
}

async function connect(url: string) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(`${msg.error.message}`)) : p.resolve(msg.result);
  };
  return (method: string, params: object = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
}

async function snapshot(send: Awaited<ReturnType<typeof connect>>) {
  const { frameTree } = await send("Page.getFrameTree");
  await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
  await send("DOM.enable");
  await send("Accessibility.enable");

  // 1. DOM index: tag, xpath, scrollability per backend node (shadow roots pierced).
  const { root } = (await send("DOM.getDocument", { depth: -1, pierce: true })) as { root: DomNode };
  const enc = (backendNodeId: number) => `0-${backendNodeId}`;
  const tagNameMap: Record<string, string> = {};
  const xpathMap: Record<string, string> = {};
  const scrollableMap: Record<string, boolean> = {};
  const lazySrcMap: Record<string, string> = {};
  const byNodeId = new Map<number, DomNode>();
  const stack: { node: DomNode; xpath: string }[] = [{ node: root, xpath: "" }];
  while (stack.length) {
    const { node, xpath } = stack.pop()!;
    byNodeId.set(node.nodeId, node);
    const id = enc(node.backendNodeId);
    tagNameMap[id] = enrichedTagName(node);
    xpathMap[id] = xpath || "/";
    if (node.isScrollable) scrollableMap[id] = true;
    if (node.nodeName === "IMG") {
      const lazySrc = attr(node, "data-src") ?? attr(node, "data-lazy-src") ?? attr(node, "data-original");
      if (lazySrc) lazySrcMap[id] = lazySrc;
    }
    const counts: Record<string, number> = {};
    for (const child of node.children ?? []) {
      const tag = child.nodeName.toLowerCase();
      const idx = (counts[`${child.nodeType}:${tag}`] = (counts[`${child.nodeType}:${tag}`] ?? 0) + 1);
      const step =
        child.nodeType === 3 ? `text()[${idx}]` : child.nodeType === 8 ? `comment()[${idx}]` : `${tag}[${idx}]`;
      stack.push({ node: child, xpath: xpath.endsWith("//") ? xpath + step : `${xpath}/${step}` });
    }
    for (const sr of node.shadowRoots ?? []) stack.push({ node: sr, xpath: `${xpath}//` });
  }

  // 2. Full AX tree for the frame.
  let { nodes } = (await send("Accessibility.getFullAXTree")) as { nodes: AXNode[] };

  // 3. Scope: keep one element's AX subtree and make it the root.
  if (values.scope) {
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: values.scope });
    if (!nodeId) throw new Error(`--scope matched nothing: ${values.scope}`);
    const be = byNodeId.get(nodeId)!.backendNodeId;
    const target = nodes.find((n) => n.backendDOMNodeId === be);
    if (!target) throw new Error(`--scope element has no AX node: ${values.scope}`);
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const keep = new Set([target.nodeId]);
    const queue = [target];
    while (queue.length) {
      for (const id of queue.shift()!.childIds ?? []) {
        if (keep.has(id) || !byId.has(id)) continue;
        keep.add(id);
        queue.push(byId.get(id)!);
      }
    }
    nodes = nodes
      .filter((n) => keep.has(n.nodeId))
      .map((n) => (n === target ? { ...n, parentId: undefined } : n));
  }

  // 4. Ignore: drop AX nodes whose DOM node sits inside an ignored DOM subtree.
  const ignored = new Set<number>();
  for (const selector of values.ignore!) {
    const { nodeIds } = await send("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
    if (!nodeIds.length) throw new Error(`--ignore matched nothing: ${selector}`);
    const walk = nodeIds.map((id: number) => byNodeId.get(id)!);
    while (walk.length) {
      const n: DomNode = walk.pop()!;
      ignored.add(n.backendNodeId);
      walk.push(...(n.children ?? []), ...(n.shadowRoots ?? []));
    }
  }
  nodes = nodes.filter((n) => n.backendDOMNodeId === undefined || !ignored.has(n.backendDOMNodeId));

  // 5. URL map from AX link/image properties, kept out of the outline. Lazy-loaded images
  // have no src (or a data: placeholder) until their loader runs, so fall back to data-src.
  const urlMap: Record<string, string> = {};
  for (const n of nodes) {
    if (n.backendDOMNodeId === undefined) continue;
    const id = enc(n.backendDOMNodeId);
    let url = String(n.properties?.find((p) => p.name === "url")?.value?.value ?? "").trim();
    if (lazySrcMap[id] && (!url || url.startsWith("data:"))) {
      url = values["base-url"] ? new URL(lazySrcMap[id], values["base-url"]).href : lazySrcMap[id];
    }
    if (url) urlMap[id] = url;
  }

  // 6. Decorate roles with DOM metadata, 7. prune, 8. serialize.
  const decorated = nodes.map((n) => decorate(n, enc, tagNameMap, scrollableMap));
  const outline = buildTree(decorated, tagNameMap)
    .map((n) => formatLine(n))
    .join("\n")
    .trimEnd();
  return { outline, xpathMap, urlMap };
}

// CDP attributes are a flat [name, value, name, value, ...] list.
function attr(node: DomNode, name: string): string | undefined {
  const attrs = node.attributes ?? [];
  for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === name) return attrs[i + 1];
}

function enrichedTagName(node: DomNode): string {
  const tag = node.nodeName.toLowerCase();
  const type = tag === "input" ? attr(node, "type") : undefined;
  return type ? `input, ${type}` : tag;
}

function decorate(
  n: AXNode,
  enc: (be: number) => string,
  tagNameMap: Record<string, string>,
  scrollableMap: Record<string, boolean>,
): Node {
  const encodedId = n.backendDOMNodeId === undefined ? undefined : enc(n.backendDOMNodeId);
  let role = String(n.role?.value ?? "");
  const tag = encodedId ? tagNameMap[encodedId] : undefined;
  if (((encodedId && scrollableMap[encodedId]) || tag === "html") && tag !== "#document") {
    const label = tag?.startsWith("#") ? tag.slice(1) : tag;
    role = label ? `scrollable, ${label}` : `scrollable${role ? `, ${role}` : ""}`;
  }
  // Chrome reports file inputs as buttons.
  if (tag === "input, file") role = tag;
  const bool = (name: string) => {
    const v = n.properties?.find((p) => p.name === name)?.value?.value;
    return v === true || v === "true" || v === 1;
  };
  return {
    nodeId: n.nodeId,
    role,
    name: n.name?.value as string | undefined,
    selected: bool("selected"),
    checked: bool("checked"),
    parentId: n.parentId,
    childIds: n.childIds,
    encodedId,
  };
}

function isStructural(role: string): boolean {
  const r = role.toLowerCase();
  return r === "generic" || r === "none" || r === "inlinetextbox";
}

function buildTree(nodes: Node[], tagNameMap: Record<string, string>): Node[] {
  const map = new Map<string, Node>();
  for (const n of nodes) {
    if (n.name?.trim() || n.childIds?.length || !isStructural(n.role)) map.set(n.nodeId, { ...n });
  }
  for (const n of nodes) {
    const parent = n.parentId ? map.get(n.parentId) : undefined;
    const cur = map.get(n.nodeId);
    if (parent && cur) (parent.children ??= []).push(cur);
  }
  return nodes
    .filter((n) => !n.parentId && map.has(n.nodeId))
    .map((n) => prune(map.get(n.nodeId)!))
    .filter((n): n is Node => n !== null);

  function prune(node: Node): Node | null {
    if (+node.nodeId < 0) return null;
    if (!node.children?.length) {
      const blankText = node.role === "StaticText" && !node.name?.trim();
      return isStructural(node.role) || blankText ? null : node;
    }

    const kids = dedupeStaticText(
      node,
      node.children.map(prune).filter((n): n is Node => n !== null),
    );
    if (isStructural(node.role)) {
      if (kids.length === 0) return null;
      if (kids.length === 1) return kids[0]!;
    }

    let role = node.role;
    const tag = node.encodedId ? tagNameMap[node.encodedId] : undefined;
    if ((role === "generic" || role === "none") && tag) role = tag;
    if (role === "combobox" && tag === "select") role = "select";
    return { ...node, role, children: kids };
  }
}

// Drop direct StaticText children whose concatenated text equals the parent's name.
function dedupeStaticText(parent: Node, children: Node[]): Node[] {
  if (!parent.name) return children;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const combined = children
    .filter((c) => c.role === "StaticText" && c.name)
    .map((c) => norm(c.name!))
    .join("");
  return combined === norm(parent.name) ? children.filter((c) => c.role !== "StaticText") : children;
}

function formatLine(node: Node, level = 0): string {
  const flags = (node.selected ? " [selected]" : "") + (node.checked ? " [checked]" : "");
  const name = node.name ? cleanText(node.name) : "";
  const label = `[${node.encodedId ?? node.nodeId}] ${node.role}${name ? `: ${name}` : ""}${flags}`;
  const line = "  ".repeat(level) + label;
  const kids = node.children?.map((c) => formatLine(c, level + 1)) ?? [];
  return [line, ...kids].join("\n");
}

// Strip private-use glyphs (icon fonts) and turn NBSP-like characters into single spaces.
// Newlines (e.g. <pre> code) become ⏎ so a name never spills onto a line that looks like a child.
function cleanText(s: string): string {
  return s
    .replace(/[\ue000-\uf8ff]/g, "")
    .replace(/[\u00a0\u202f\u2007\ufeff]+/g, " ")
    .trim()
    .replace(/\r?\n/g, "⏎");
}
