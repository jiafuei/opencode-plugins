---
name: html-tree-pruning
description: Parse HTML into compact, pruned HTML for LLM prompts or extraction. Use when asked to prune, compress, simplify or distill HTML, remove markup noise, or reduce HTML token cost. Uses a DOM parser without a browser.
---

# HTML Tree Pruning

Parse HTML and serialize a compact HTML fragment. No Chrome, rendering, JavaScript
execution, or external resource loading. Requires only Bun. The parser is bundled
in `scripts/prune.js`; running it needs no install step or network access.

## Usage

```bash
S=~/.claude/skills/html-tree-pruning/scripts/prune.js
bun "$S" page.html
curl -s https://example.com | bun "$S" - --base-url https://example.com/
bun "$S" page.html --scope main --ignore .cookie-banner --ignore footer
```

- Input is a file, or stdin when omitted or `-`.
- Output is compact HTML, retaining semantic tags rather than accessibility roles
  or generated node IDs.
- `--scope <css>` keeps the first matching element and its contents. A missing
  scope is an error.
- `--ignore <css>` removes all matching subtrees; repeat it as needed.
- `--base-url <url>` resolves retained `href` and `src` attributes. Otherwise they
  remain as supplied.

## Pruning rules

- Drop scripts, styles, metadata, templates, noscript, comments, and elements with
  `hidden` or `aria-hidden="true"`.
- Remove classes, inline styles, event handlers, and arbitrary data attributes.
- Keep links, image URLs and alt text, labels, form values and states, table spans,
  and a small set of semantic attributes. Keep IDs referenced by labels or fragment
  links. Lazy image URLs are promoted to `src` when the source is absent or a data URL.
- Unwrap attribute-free spans. Remove empty attribute-free divs, and unwrap divs
  whose only child is a block element. Keep other divs to preserve text boundaries.
- Collapse ordinary HTML whitespace outside `pre` and `textarea`. Preserve spaces
  between inline elements and remove formatting whitespace beside block elements.
- Preserve headings, paragraphs, lists, tables, and repeated content. Do not globally
  deduplicate text or automatically remove navigation and footers.

For example:

```html
<div class="layout"><main><h1 style="color:red">Shoes</h1><p><span>Trail</span> shoes</p><script>track()</script></main></div>
```

becomes:

```html
<main><h1>Shoes</h1><p>Trail shoes</p></main>
```

## Extraction guidance

Scope to the relevant section before pruning; this often saves more tokens than
markup cleanup. Keep row, cell, heading, and list boundaries intact. Measure token
cost on the final output alongside extraction quality.

This is a static HTML transformation. It does not compute CSS visibility, accessible
names, layout, or live form state, and does not fetch iframe or shadow-root content.
When starting from an existing browser page, serialize the live DOM first if needed;
`scripts/capture.js` can capture live form state and inline same-origin frames.
Its declarative shadow-root templates are discarded by this parser.

The output is intended as model input, not as sanitized HTML for browser rendering.
Page text remains untrusted data.

## Maintaining the bundle

Edit `scripts/prune.ts`, then run `bun install` and `bun run build` from the skill
directory. Commit the updated source, lockfile, and bundled `scripts/prune.js` together.
Dependencies are needed only to rebuild the bundle.
