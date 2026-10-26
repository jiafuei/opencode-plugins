# Webfetch

Read public webpages as Markdown without a hosted extraction service. The plugin prefers a page's `.md` version and converts HTML locally when one is unavailable.

## Load the plugin

Requires OpenCode 2.0.32 or newer, running on Bun.

Run `bun install` from the repository root. Add the local package to `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-plugins/plugins/webfetch"]
}
```

The default tool is `webfetch_enhanced`. The built-in `webfetch` remains available.

To replace the built-in tool instead, set `replace: true`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-plugins/plugins/webfetch",
      "options": { "replace": true }
    }
  ]
}
```

Replacement registers only `webfetch`, not an additional alias. Both names use OpenCode's `webfetch` permission rules.

## Tool reference

```ts
webfetch_enhanced({ url: "https://example.com/docs/guide" })
webfetch_enhanced({ url: "https://example.com/docs/guide", fresh: true })
```

| Input | Description |
| --- | --- |
| `url` | Public HTTP or HTTPS URL. |
| `fresh` | Optional boolean. Bypass both caches, request fresh content, and update the caches. Defaults to `false`. |

The result contains the final source URL and Markdown. When a documentation index exists, its URL appears first:

```text
Site documentation index: https://example.com/docs/llms.txt
Source: https://example.com/docs/guide.md

# Guide
...
```

The plugin does not include the index's contents or follow its links. The agent can fetch that URL separately.

## Fetch behavior

- `/guide`, `/guide/`, and `/guide.html` each try `/guide.md` before the original URL. Query parameters are preserved. URLs with other file extensions and the origin root are fetched directly.
- HTML responses at Markdown candidate URLs count as misses, even when the server returns a successful status.
- The plugin probes `llms.txt` in the requested page's directory, then each parent directory up to the origin. It reports the nearest match.
- HTML conversion prefers a nonempty `main` or `[role="main"]`, then a single `article`. Other pages use Mozilla Readability when its readability check passes, or keep the document body for short pages.
- Conversion removes navigation, sidebars, scripts, styles, hidden content, and interactive controls. It preserves headings, fenced code, lists, tables, and links. Relative links use the final page URL or its HTML base URL.
- Markdown and other supported text responses pass through without HTML extraction.
- Requests stop when the tool is cancelled or after 30 seconds.

## Caching

Caches persist in OpenCode's plugin storage, including across plugin reloads. Converted Markdown is cached so a hit does not repeat HTML extraction.

| Cache | Lifetime |
| --- | --- |
| Markdown and `llms.txt` discovery | 30 days per probe URL, for both matches and confirmed misses. |
| Page content | HTTP `Cache-Control: max-age` or `Expires`, otherwise 15 minutes. |

Content caching accounts for response age, honors `no-store` and `no-cache`, and revalidates stale entries using `ETag` and `Last-Modified` when provided. Client errors, including `401` and `403`, count as discovery misses. Transient HTTP failures such as `408`, `429`, and `503` do not become month-long misses.

Use `fresh: true` to discover a newly published Markdown page or index before the discovery cache expires.

## Limits

This version reads publicly accessible text pages. It does not execute page scripts, render a browser, sign in, extract PDFs, or bypass access challenges. JavaScript-only pages may have little readable content. No page content is sent to an extraction service or model.

## Development

From the repository root:

```sh
bun test plugins/webfetch/server.test.ts
```
