#!/usr/bin/env bun
// Parse and prune HTML without rendering it or executing scripts.
import { parseArgs } from "node:util";
import { load } from "cheerio";
import { isTag, type AnyNode } from "domhandler";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scope: { type: "string" },
    ignore: { type: "string", multiple: true, default: [] },
    "base-url": { type: "string" },
  },
});
const input = positionals[0] ?? "-";
const raw = input === "-" ? await Bun.stdin.text() : await Bun.file(input).text();
const $ = load(raw);
const root = values.scope ? $(values.scope).first() : $("body");
if (!root.length) throw new Error(`--scope matched nothing: ${values.scope}`);
for (const selector of values.ignore!) $(selector).remove();
$("script, style, link, meta, base, template, noscript, [hidden], [aria-hidden='true']").remove();

const attributes = new Set([
  "href", "src", "alt", "title", "role", "aria-label", "aria-expanded", "aria-checked",
  "aria-selected", "type", "name", "value", "placeholder", "checked", "selected",
  "disabled", "multiple", "required", "for", "id", "colspan", "rowspan", "scope",
  "start", "reversed", "datetime", "open",
]);
const blocks = new Set([
  "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main",
  "nav", "ol", "p", "pre", "section", "table", "ul",
]);
// Keep IDs only when a label or fragment link uses them.
const referencedIds = new Set<string>();
root.find("label[for], a[href^='#']").each((_, element) => {
  const el = $(element);
  referencedIds.add(el.attr("for") ?? el.attr("href")!.slice(1));
});

function prune(node: AnyNode, preserveWhitespace = false): void {
  if (node.type === "comment") {
    $(node).remove();
    return;
  }
  if (node.type === "text") {
    if (!preserveWhitespace) node.data = node.data.replace(/[\t\n\r\f ]+/g, " ");
    return;
  }
  if (!isTag(node)) return;
  const el = $(node);
  const preserve = preserveWhitespace || node.name === "pre" || node.name === "textarea";
  if (node.name === "img" && (!el.attr("src") || el.attr("src")!.startsWith("data:"))) {
    const src = el.attr("data-src") ?? el.attr("data-lazy-src") ?? el.attr("data-original");
    if (src) el.attr("src", src);
  }
  for (const name of Object.keys(node.attribs)) {
    if (!attributes.has(name) || (name === "id" && !referencedIds.has(node.attribs[name]!))) {
      el.removeAttr(name);
    }
  }
  if (values["base-url"]) {
    for (const name of ["href", "src"]) {
      const url = el.attr(name);
      if (url) el.attr(name, new URL(url, values["base-url"]).href);
    }
  }
  for (const child of [...node.children]) prune(child, preserve);
  if (preserve) return;
  // Whitespace beside block elements is formatting, not a word separator.
  for (const child of [...node.children]) {
    if (child.type !== "text" || child.data.trim()) continue;
    const prev = child.prev;
    const next = child.next;
    if ((prev && isTag(prev) && blocks.has(prev.name)) ||
        (next && isTag(next) && blocks.has(next.name)) ||
        (blocks.has(node.name) && (!prev || !next))) $(child).remove();
  }
  if (Object.keys(node.attribs).length) return;
  if (node.name === "span") {
    el.replaceWith(el.contents());
  } else if (node.name === "div") {
    if (!node.children.length) el.remove();
    else if (node.children.length === 1 && isTag(node.children[0]!) && blocks.has(node.children[0]!.name)) {
      el.replaceWith(el.contents());
    }
  }
}

const output = $("<div></div>");
output.append(values.scope ? root : root.contents());
for (const node of output.contents().toArray()) prune(node);
console.log(output.html()!.trim());
