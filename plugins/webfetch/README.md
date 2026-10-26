# Webfetch

Read webpages as Markdown with local HTML pruning, optional browser impersonation, cookie-file authentication, and an explicitly selected Exa backend. The default fetch stays local and prefers a page's `.md` version.

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

Replacement names the fetch tool `webfetch` instead of `webfetch_enhanced`; it does not register both. The companion `webfetch_profile` tool remains available. Fetches use OpenCode's `webfetch` permission rules.

## Tool reference

```ts
webfetch_profile({})
webfetch_enhanced({ url: "https://example.com/docs/guide" })
webfetch_enhanced({ url: "https://example.com/docs/guide", fresh: true })
webfetch_enhanced({ url: "https://example.com/docs/guide", profile: "chrome152" })
webfetch_enhanced({ url: "https://example.com/docs/guide", profile: "exa" })
```

| Input | Description |
| --- | --- |
| `url` | HTTP or HTTPS URL. |
| `fresh` | Optional boolean. Bypass both caches, request fresh content, and update the caches. Defaults to `false`. |
| `profile` | Optional retrieval profile. Omit for standard local HTTP. The argument's enum lists available profiles. |
| `cookies` | Optional read-only `cookies.txt` path for local fetching; bypasses caches and discovery. Ignored by Exa. |

`webfetch_profile` lists browser profiles from the pinned curl-impersonate release, including `chrome152`, `firefox155`, and `safari270`. It also lists `exa` when OpenCode's Exa integration resolves to an API key. Availability and the fetch argument's enum update when that connection changes; Exa does not need to be the selected websearch provider.

The result contains the final source URL and Markdown. When a documentation index exists, its URL appears first:

```text
Site documentation index: https://example.com/docs/llms.txt
Source: https://example.com/docs/guide.md

# Guide
...
```

The plugin does not include the index's contents or follow its links. The agent can fetch that URL separately.

## Use cookies

Pass `cookies` with the path of a Netscape-format `cookies.txt` export. It is a fetch argument, not a plugin option. Paths can be absolute or relative to the OpenCode location directory; `~` is not expanded:

```ts
webfetch_enhanced({
  url: "https://example.com/account",
  cookies: "/absolute/path/to/cookies.txt",
  profile: "firefox155"
})
```

The cookie file applies only to that call and uses OpenCode's `read` permission for file access. The file is read-only. libcurl handles cookie domain, path, expiry, Secure, and HttpOnly rules, including cookies received during redirects. No cookies are written back to your export or shared between requests.

Local calls with a cookie file use private fetching:

- Fetch the requested URL directly, without `.md` or `llms.txt` probes.
- Bypass this plugin's persistent content and discovery caches.

Exa ignores the `cookies` argument without reading the file and retrieves the URL normally without cookies.

You can select a browser profile for private requests too. Cookie values are not tool arguments or output. The fetched page text still enters normal OpenCode tool results and session history.

## Browser impersonation

Browser profiles use a direct Koffi binding to curl-impersonate **2.3.1**, not `impers` or a command-line curl process. The high-level impers API is not compatible with Bun's libuv implementation.

The first browser-profile or cookie-backed request downloads the pinned native library from its official GitHub release, verifies its published SHA-256 digest, and caches it under `opencode/webfetch/curl-v2.3.1` in your platform's cache directory. `XDG_CACHE_HOME` overrides that directory. Listing profiles does not download the library, and there is no fallback to an older system libcurl.

Release assets cover Linux x64 and arm64 with glibc or musl, macOS x64 and arm64, and Windows x64 and arm64. Linux x64 with glibc is tested. The browser profile supplies its own TLS handshake and browser headers; certificate verification remains enabled.

## Exa retrieval

Connect Exa through OpenCode's existing integration. The plugin resolves that connection's API key; it does not keep a separate credential.

Select `profile: "exa"` explicitly to send the URL to Exa's Contents API. Exa returns extracted page text rather than a model-written answer. The result includes `Backend: Exa`. Exa requests do not run local discovery probes and never receive your cookie file or cookie headers.

There is no automatic fallback to Exa. It is unavailable without a connected API key, even if anonymous Exa search works elsewhere in OpenCode.

Exa uses the same `webfetch` permission rules as local fetches, including saved approvals.

## Fetch behavior

- `/guide`, `/guide/`, and `/guide.html` each try `/guide.md` before the original URL. Query parameters are preserved. URLs with other file extensions and the origin root are fetched directly.
- HTML responses at Markdown candidate URLs count as misses, even when the server returns a successful status.
- The plugin probes `llms.txt` in the requested page's directory, then each parent directory up to the origin. It reports the nearest match.
- HTML conversion prefers a nonempty `main` or `[role="main"]`, then a single `article`. Other pages use Mozilla Readability when its readability check passes, or keep the document body for short pages.
- Conversion removes navigation, sidebars, scripts, styles, hidden content, and interactive controls. It preserves headings, fenced code, lists, tables, and links. Relative links use the final page URL or its HTML base URL.
- Markdown and other supported text responses pass through without HTML extraction.
- Requests have a 30-second timeout. Native transfers return on cancellation; background connection work can take until its timeout to finish cleanup.

## Caching

Caches persist in OpenCode's plugin storage, including across plugin reloads. Converted Markdown is cached so a hit does not repeat HTML extraction. Public content and discovery caches are separated by browser profile. Cookie-backed requests use neither cache.

| Cache | Lifetime |
| --- | --- |
| Markdown and `llms.txt` discovery | 30 days per probe URL, for both matches and confirmed misses. |
| Page content | HTTP `Cache-Control: max-age` or `Expires`, otherwise 15 minutes. |
| Exa content | 15 minutes. Each miss requests a fresh crawl from Exa; `fresh: true` also bypasses the local entry. |

Content caching accounts for response age, honors `no-store` and `no-cache`, and revalidates stale entries using `ETag` and `Last-Modified` when provided. Client errors, including `401` and `403`, count as discovery misses. Transient HTTP failures such as `408`, `429`, and `503` do not become month-long misses.

Use `fresh: true` to discover a newly published Markdown page or index before the discovery cache expires.

## Limits

Local fetching does not execute page scripts, render a browser, perform sign-in flows, extract PDFs, or solve JavaScript challenges and CAPTCHAs. Cookies and browser-like TLS do not replace a browser for those tasks. Use the browser plugin when rendering or interactive sign-in is required.

## Development

From the repository root:

```sh
bun test plugins/webfetch
```

Native tests use local HTTP servers. On a cold cache they download the pinned native library; Exa tests mock its API and require no key.
