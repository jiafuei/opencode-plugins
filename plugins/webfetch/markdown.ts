/// <reference path="./types.d.ts" />

import { isProbablyReaderable, Readability } from "@mozilla/readability";
import { createDocument } from "@mixmark-io/domino";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
converter.use(gfm);
converter.addRule("code", {
  filter: "pre",
  replacement: (_content, node) => {
    const code = node.querySelector("code") ?? node;
    for (const br of Array.from(code.querySelectorAll("br"))) br.replaceWith("\n");
    for (const line of Array.from(code.querySelectorAll("div")).reverse()) {
      if (!line.textContent?.endsWith("\n")) line.appendChild(node.ownerDocument.createTextNode("\n"));
    }
    const language = code.getAttribute("data-language") ?? node.getAttribute("data-language")
      ?? /(?:lang|language)-(\S+)/.exec(`${code.className} ${node.className}`)?.[1] ?? "";
    const text = (code.textContent ?? "").replace(/\n$/, "");
    const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(([run]) => run.length + 1)));
    return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
  },
});

export function toMarkdown(html: string, url: string): string {
  const document = createDocument(html);
  const base = new URL(document.querySelector("base[href]")?.getAttribute("href") ?? url, url);
  for (const node of Array.from(document.querySelectorAll("script, style, noscript, template, svg, iframe, [hidden], [aria-hidden='true']"))) node.remove();
  for (const table of Array.from(document.querySelectorAll("table"))) {
    if (!table.querySelector("tr")) table.replaceWith(...Array.from(table.childNodes));
  }

  // Keep article headers; remove navigation and other site-level chrome.
  const articles = Array.from(document.querySelectorAll("article"));
  const main = Array.from(document.querySelectorAll("main, [role='main']")).find((node) => node.textContent?.trim())
    ?? (articles.length === 1 ? articles[0] : undefined);
  for (const node of Array.from(document.querySelectorAll("nav, aside, [role='navigation'], [role='complementary'], button"))) node.remove();
  if (!main) {
    for (const node of Array.from(document.querySelectorAll("body > header, body > footer, [role='banner'], [role='contentinfo']"))) node.remove();
  }
  for (const node of Array.from(document.querySelectorAll("[href], [src]"))) {
    for (const attribute of ["href", "src"]) {
      const value = node.getAttribute(attribute);
      if (value === null) continue;
      if (/^(?:javascript|data):/i.test(value.trim())) node.removeAttribute(attribute);
      else if (URL.canParse(value, base)) node.setAttribute(attribute, new URL(value, base).href);
    }
  }

  const content = main?.innerHTML
    ?? (isProbablyReaderable(document)
      ? new Readability(document.cloneNode(true) as typeof document, { charThreshold: 0, keepClasses: true }).parse()?.content
      : undefined)
    ?? document.body.innerHTML;
  return converter.turndown(content).trim();
}
