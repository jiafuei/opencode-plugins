---
name: html-tree-pruning
description: Shrink HTML into a compact, LLM-friendly accessibility outline using Stagehand's pruning algorithm (Chrome AX tree, structural-wrapper collapse, StaticText dedup, `[id] role: name` lines, URLs/XPaths kept in side maps). Use when asked to prune, compress, simplify or distill a DOM/HTML string for an LLM prompt, build an extraction/observe pipeline, compare token cost of HTML vs outline, or explain how Stagehand snapshots work. Triggers on DOM pruning, HTML to accessibility tree, a11y outline, AX tree, snapshot for LLM, reduce HTML tokens, Stagehand snapshot, extract/observe context.
---

# HTML Tree Pruning

Don't send HTML to the model. Render it, take Chrome's accessibility (AX) tree, drop
the structural wrappers, and print one indented line per meaningful node:

```text
[0-1] RootWebArea: Example Store
  [0-3] scrollable, html
    [0-18] navigation
      [0-20] link: Home
    [0-25] main
      [0-28] heading: Running Shoes
      [0-30] list
        [0-31] listitem
          [0-34] link: Trail Runner
          [0-37] StaticText: $120
      [0-46] checkbox: In stock only [checked]
      [0-2] select: Sort by
      [0-86] button: Add to cart
```

Script tags, styles, classes and arbitrary attributes never appear. That isn't a tag
blacklist: they just aren't part of the AX tree's semantics.

## The script

`scripts/prune.ts` launches headless Chrome, loads the HTML, and runs the pipeline
below over CDP. It has no dependencies beyond Bun and Chrome.

```bash
S=~/.claude/skills/html-tree-pruning/scripts/prune.ts
bun $S page.html                                   # outline to stdout
curl -s https://example.com | bun $S - --base-url https://example.com/
bun $S page.html --scope main --ignore .cookie-banner --ignore footer
bun $S page.html --json                            # { outline, xpathMap, urlMap }
```

- `--scope <css>`: keep only that element's AX subtree; it becomes the root.
- `--ignore <css>` (repeatable): drop every matching DOM subtree.
- `--base-url <url>`: the page is `about:blank`, so relative `href`s produce no URL
  unless you give a base (injected as `<base href>`).
- `--json`: also print `xpathMap` (id → absolute XPath, every DOM node) and `urlMap`
  (id → resolved link/image URL; lazy images fall back to `data-src`,
  `data-lazy-src`, `data-original` when `src` is missing or a `data:` placeholder).
- `CHROME_PATH` overrides the default `google-chrome` binary.

Selectors that match nothing exit with an error. Stagehand silently falls back to the
full page instead; the script fails because a scope you thought you had would
otherwise be silently missing. It takes ~1–2s per run (most of it Chrome startup).
Inline scripts in the HTML do execute; external resources usually won't load.

## Capturing the HTML string

`document.documentElement.outerHTML` is the wrong input. It contains no shadow DOM,
no iframe content, and no checkbox/option state set after load. Its `<script>`s also
re-run when `prune.ts` loads it. Capture with `scripts/capture.js` instead
(the approach follows pogme's browser extension). Run it inside the live page:

```js
// DevTools: paste the file, then
copy(capture())
// Playwright
const html = await page.evaluate(`${fs.readFileSync(CAPTURE_JS, "utf8")}\ncapture()`)
// then: bun prune.ts captured.html --base-url <page.url()>
```

It keeps shadow roots as declarative `<template shadowrootmode>`, so `prune.ts` rebuilds
them with their scoped CSS and slots intact. Same-origin iframes are inlined as a
`<section>` holding their body. Scripts, `<noscript>`, `<template>` and comments are
dropped. Live `checked`/`selected` state is written back to attributes. Two cases it
can't reach from page script:
- **Closed shadow roots.** Run it as an extension content script, where
  `chrome.dom.openOrClosedShadowRoot` exposes them; the function already uses it.
- **Cross-origin iframes.** Inject it per frame (e.g. `executeScript({allFrames: true})`),
  leave a marker element where each iframe was, and splice the frame results in by frame
  path, as pogme's `capture.js` does.

## The pipeline, distilled

1. **Render and index the DOM.** `DOM.getDocument({depth: -1, pierce: true})`. For each
   backend node record: lowercase tag (`input, <type>` for inputs), absolute XPath
   (shadow root boundary = `//` step), and `isScrollable`.
2. **Fetch the full AX tree.** `Accessibility.getFullAXTree`. It covers the whole frame,
   below-the-fold content included. Chrome computes roles and accessible names; nothing
   here reimplements that.
3. **Scope** (optional). Resolve the selector → backend node → AX node; BFS its
   `childIds`; clear the root's `parentId`.
4. **Ignore** (optional). Collect every backend id under each ignored DOM element; drop
   AX nodes pointing into that set. This uses DOM ancestry, not AX ancestry. Stagehand
   uses DFS enter/exit intervals plus binary search for speed; a set is equivalent.
5. **URL map.** Read each remaining node's AX `url` property into `id → url`, before
   pruning and outside the prompt.
6. **Decorate roles from DOM metadata.**
   - scrollable elements and `<html>` → `scrollable, <tag>` (except `#document`)
   - `input, file` overrides Chrome's `button`
   - id = `<frameOrdinal>-<backendNodeId>`, e.g. `0-31`
7. **Prune bottom-up.** Structural roles are exactly `generic`, `none`, `InlineTextBox`.
   ```text
   keep in node map if: nonblank name OR has childIds OR non-structural role
   prune(node):
     if +axNodeId < 0: drop
     if no children: drop if structural else keep
     kids = prune(children), then drop direct StaticText kids if their
            whitespace-normalized names concatenated == parent's normalized name
     if structural: 0 kids → drop; 1 kid → replace node with that kid
     surviving generic/none → relabel with DOM tag (div, span, body…)
     combobox on <select> → select
   ```
8. **Serialize.** Two-space indent, `[id] role: name [selected] [checked]`. Flags only
   when true. Names: strip private-use glyphs (U+E000–F8FF, icon fonts), turn
   NBSP-like chars into spaces, trim. `value` and `description` are **not** printed.
   The script adds two things Stagehand lacks. Newlines in names become `⏎`;
   otherwise the second line of a `<pre>` block looks like a child node. Whitespace-only
   StaticText leaves are dropped.
9. **Iframes** (Stagehand only, not in the script). Snapshot each frame separately and
   insert its outline indented under its iframe host's line. Prefix child XPaths with
   the host's XPath.

## Things it loses (on purpose or not)

- A named structural leaf is dropped, and a structural wrapper collapsed into its only
  child loses its own name.
- Form values aren't shown (a filled textbox shows its label only), and neither are
  false checkbox states.
- Dedup only applies to a parent's own direct StaticText children. Repeated prices in
  different rows stay. Split text (`Add` + `to cart` → `Addto cart`) isn't deduped.
- No viewport/visibility filter. There's no removal of nav or ads, no token budget,
  and no chunking. Hidden content mostly disappears only because Chrome marks it
  ignored (role `none`, no name).
- Not a privacy or prompt-injection boundary. Page text is still untrusted.
- The script handles only the main frame. `<iframe>` content shows up as just the host
  node unless `capture.js` inlined it.
- Shadow DOM content is included: open, closed, declarative (`<template
  shadowrootmode>`), and slotted, in flat-tree order. An HTML string only carries
  shadow roots in declarative form, so capture it with `capture.js`. Two limits apply. First,
  `--scope`/`--ignore` selectors can't reach inside a shadow root, so target the host
  instead. Ignoring a host drops its shadow content. Second, shadow XPaths like
  `/html[1]/body[1]/x-card[1]//article[1]` use `//` to mark the boundary. Plain
  `document.evaluate` reads that as "any descendant" and can't cross into the shadow
  root, so resolving them needs a shadow-aware resolver like Stagehand's.

## Adapting it for extraction

- Scoping to the content region (`--scope main`, a product panel, a table) usually
  saves more tokens than finer pruning. Ignore known-irrelevant subtrees per task;
  don't use a universal blacklist.
- Keep URLs and XPaths in side maps. Have the model return ids and resolve them in
  code, so it never has to reproduce long strings.
- When text fidelity matters, carry a collapsed wrapper's name onto its child instead
  of dropping it. For form extraction, emit `value` and explicit false states.
- Never dedup strings globally. Preserve row/cell/heading boundaries.
- If you must chunk, split on semantic boundaries (sections, rows) and keep headings
  and table headers with each chunk.
- Measure tokens on the final prompt, and track extraction quality alongside savings.

Source of truth in the Stagehand repo: `packages/extension/understudy/a11y/snapshot/`
(`a11yTree.ts`, `treeFormatUtils.ts`, `domTree.ts`, `capture.ts`).
