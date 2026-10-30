// Serialize the live page into an HTML string that prune.ts can rebuild faithfully.
// outerHTML drops shadow roots and live form state, and keeps scripts that would re-run.
// - shadow roots (open; closed too from an extension) → declarative <template shadowrootmode>
// - same-origin iframes → their <body> content inlined in a <section>
// - <script>/<noscript>/<template> dropped, comments dropped
// - live checked/selected state written back to attributes
// Run it in the page: paste into DevTools then `copy(capture())`,
// or `page.evaluate(src + "\ncapture()")` in Playwright/CDP.
function capture() {
  const omitted = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE"]);

  function shadowRootOf(el) {
    if (!el.attachShadow) return null;
    return (
      globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el) ?? el.openOrClosedShadowRoot ?? el.shadowRoot
    );
  }

  function append(src, parent) {
    if (src.nodeType === Node.TEXT_NODE) return parent.append(src.data);
    if (src.nodeType !== Node.ELEMENT_NODE || omitted.has(src.tagName)) return;

    if (src.tagName === "IFRAME" || src.tagName === "FRAME") {
      // contentDocument is null for cross-origin frames; those need per-frame injection.
      const body = src.contentDocument?.body;
      if (!body) return;
      const section = document.createElement("section");
      body.childNodes.forEach((child) => append(child, section));
      return parent.append(section);
    }

    const clone = src.cloneNode(false);
    if (src.tagName === "INPUT" && (src.type === "checkbox" || src.type === "radio")) {
      clone.toggleAttribute("checked", src.checked);
    }
    if (src.tagName === "OPTION") clone.toggleAttribute("selected", src.selected);
    parent.append(clone);

    const shadowRoot = shadowRootOf(src);
    if (shadowRoot) {
      const template = document.createElement("template");
      template.setAttribute("shadowrootmode", "open");
      shadowRoot.childNodes.forEach((child) => append(child, template.content));
      clone.append(template);
    }
    src.childNodes.forEach((child) => append(child, clone));
  }

  const container = document.createElement("div");
  append(document.documentElement, container);
  return `<!doctype html>${container.innerHTML}`;
}
