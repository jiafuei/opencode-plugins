# Browser

Browser automation for the OpenCode TUI. The plugin uses Playwright directly, keeps full observations outside the model context, and exposes the `browse` Code Mode namespace. It does not require the OpenCode desktop app.

## Load the plugin

Requirements:

- OpenCode 2.0.30 or newer.
- Bun on `PATH`, for the separate browser worker process.
- An installed Chromium browser or a reachable Chromium CDP endpoint.

From this repository, run `bun install`. Then add the local plugin to `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-plugins/plugins/browser",
      "options": {
        "launchOptions": {
          "channel": "chrome",
          "headless": true
        }
      }
    }
  ]
}
```

This package is not published. Loading it does not launch a browser. `browse.launch` or `browse.connect` creates a browser connection for the calling OpenCode session.

The worker runs where the OpenCode service runs. For WSL or a remote service, the browser executable must run there, or the CDP endpoint must be reachable from there.

## Launch and configure a browser

The plugin passes JSON-compatible native Playwright options through without a custom allowlist:

```js
return await tools.browse.launch({
  url: "https://example.com",
  userDataDir: "~/browser-profiles/work",
  launchOptions: {
    executablePath: "/opt/chrome/chrome",
    headless: false,
    args: ["--lang=en-US"],
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", TZ: "UTC" },
    proxy: { server: "http://127.0.0.1:8080" },
  },
  contextOptions: {
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  },
});
```

- `launchOptions` uses Playwright's `LaunchOptions`, including `channel`, `executablePath`, `args`, `ignoreDefaultArgs`, `headless`, `proxy`, and `env`.
- `contextOptions` uses Playwright's `BrowserContextOptions`, including locale, viewport, storage state, permissions, and HTTP credentials.
- `userDataDir` selects `launchPersistentContext`; an empty string keeps Playwright's temporary-profile behavior. Omit it to use an ephemeral browser and context. For persistent contexts, the two option objects are combined, with context options taking precedence.
- A configured persistent profile cannot be used concurrently by two sessions. Set `userDataDir: null` in a launch call to clear a configured profile default and use an ephemeral browser.
- The same fields are available as plugin defaults. Per-call option objects shallowly override those defaults. Arrays and nested objects are replaced, not recursively merged. Playwright's `env` replaces the browser environment; include the variables your browser needs.
- Relative executable/profile paths resolve from the plugin's project directory. `~/` expands to the service user's home directory.
- Options requiring JavaScript functions cannot be supplied through JSON. Use `run_code` for runtime customization.

Use a dedicated profile directory, not a profile already open in your everyday Chrome. Chromium locks profile directories. The plugin never deletes your profile directory.

`playwright-core` does not download browsers automatically. Use a local Chrome/Edge executable or install the pinned Playwright Chromium with `bunx playwright-core@1.64.1 install chromium`. The plugin does not add `--no-sandbox` or other security-disabling flags.

### Attach to an existing browser

```js
return await tools.browse.connect({
  endpoint: "http://127.0.0.1:9222",
  options: {
    timeout: 15000,
    headers: { "X-Browser-Token": "..." },
  },
});
```

`options` passes native `ConnectOverCDPOptions` through. `noDefaults` defaults to `true` so the connection does not apply Playwright's usual overrides to the existing default context.

CDP must already be enabled. Chrome's support depends on its version and profile configuration. A debugging endpoint grants broad browser access; do not expose an unauthenticated endpoint to an untrusted network.

The plugin observes the default context's tabs. It does not isolate an attached browser from the human or other automation clients using it. `close` disconnects; it does not close that external browser. `close_tab` explicitly closes its selected tab, even in an attached browser.

## Navigate with bounded observations

Discover tool signatures through Code Mode, for example `search({ namespace: "browse" })`. All examples below run inside `execute`.

```js
const browser = await tools.browse.launch({ url: "https://example.com" });
const tab = browser.tabs[0].tab;
return await tools.browse.snapshot({ tab });
```

A snapshot returns an overview of roughly 7,000 characters, not the full tree:

```text
[o1:n0] document
  [o1:e1] main
    [o1:e2] heading "Orders" [level=1]
    [o1:e3] textbox "Search orders"
    [o1:e4] button "Search"
    [o1:n1] table "Orders" (240 hidden children; expand)
```

Every ref includes its observation ID. Element refs such as `o1:e4` support actions. Structural refs such as `o1:n1` support reading, searching, and expansion, but do not identify an actionable DOM element. Treat refs as opaque; iframe refs have different forms.

```js
return await tools.browse.find({ tab: "t1", text: "Search" });
```

```js
await tools.browse.fill({ tab: "t1", ref: "o1:e3", text: "Acme" });
await tools.browse.click({ tab: "t1", ref: "o1:e4" });
return await tools.browse.snapshot({ tab: "t1", selector: "main" });
```

Actions return small receipts with any newly opened tab IDs. They do not automatically capture snapshots or screenshots. Use a fresh observation at the next decision boundary.

For asynchronous updates, wait for the expected UI before observing:

```js
await tools.browse.wait({ tab: "t1", text: "Loaded" });
return await tools.browse.snapshot({ tab: "t1" });
```

`wait` accepts one criterion: exact `text`, a CSS/Playwright `selector`, or `loadState` (`domcontentloaded`, `load`, or `networkidle`). Text and selector waits target the first match, not all matches. Text waits support `visible` (default) or `hidden` state. Selector waits also support `attached` and `detached`. `timeoutMs` defaults to 10,000. Prefer text or selectors to `networkidle` for application readiness. Waits require only `browse` permission and do not refresh observations.

`press` accepts an optional `ref` to focus an element before pressing a key. `scroll` accepts an optional `ref` to hover a nested scroll container before sending wheel events. Without a ref, they use the current keyboard focus or pointer position. Wheel events may finish scrolling after the call returns.

### Search, expand, and read

These operations use the cached tree and do not replace Playwright's element-ref map:

```js
return await tools.browse.expand({ tab: "t1", ref: "o1:n1", depth: 2 });
```

```js
return await tools.browse.read({ tab: "t1", ref: "o1:n1" });
```

- `snapshot` captures the complete semantic tree of the requested scope. Use `ref` to capture a current element, or `selector` to scope by a CSS/Playwright selector; `ref` takes precedence. Even a scoped capture replaces the tab's previous observation refs.
- `snapshot` and `expand` select nodes breadth-first within the output budget, then render them in tree order. Small trees include their full depth by default. Optional `depth` limits only the returned view, not acquisition cost. Hidden-child counts identify nodes you can expand.
- `expand` returns another bounded view. Pass `next` as `offset` with the same ref and depth to continue breadth-first selection; ancestor context is repeated on each page.
- `find` searches all cached descendants, including collapsed ones. It returns matches with ancestor context and a total match count. Continue with `next` as `offset`, preserving the same text and root.
- `read` pages full snapshot-derived labels, text, values, and link URLs, preserving semantic nesting. Continue with `next` as `offset` and the same ref. It is not live `innerText` or a structured table extractor.
- `tabs` also supports `next`/`offset` pagination. Tab IDs remain stable while each tab exists; they are not array positions.

A fresh snapshot replaces the previous observation. Explicit navigation clears it immediately; other full-page navigations clear it when the main document commits, including back/forward-cache restores. History changes and iframe loads preserve the cached observation. Ordinary actions leave the displayed observation historical; document or element replacement can still make a ref unusable. Re-observe rather than guessing a replacement. Short structural leaves omit refs; actionable elements and nodes with hidden or truncated content retain them. Canvas content, hidden DOM, and unrendered virtualized rows are not a complete part of the semantic tree.

## Run code and extract data

`evaluate` invokes a function expression inside the page. With an element ref, the function receives that DOM element. The supplied code is not compiled in the worker's host context:

```js
return await tools.browse.evaluate({
  tab: "t1",
  code: "() => document.title",
});
```

`run_code` receives a live Playwright `Page`. Use it for sequences, condition-based waits, custom widgets, or targeted structured extraction:

```js
return await tools.browse.run_code({
  tab: "t1",
  code: `async page => {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('Updated', { exact: true }).waitFor();
    return await page.locator('table tbody tr').evaluateAll(rows =>
      rows.slice(0, 20).map(row => row.innerText)
    );
  }`,
});
```

**`run_code` is trusted host code, not a sandbox.** It executes in a separate Bun process with the service user's filesystem, environment, and network privileges. A process boundary protects the OpenCode service's event loop, not your machine. Enable it only for trusted agents/tasks.

Both code tools invalidate all cached observations even when code throws, because code may have navigated or changed Playwright's snapshot maps. Return a string or JSON-compatible value. Stdout and automatic snapshots are not returned to the model.

Results return `result`, `format`, `text`, and size metadata. Continue without rerunning code:

```js
return await tools.browse.result({ id: "v1", offset: 7000 });
```

The worker keeps the eight most recent code/network results, up to one million characters each. The initial response and each continuation contain at most 7,000 text characters. A larger stored result reports truncation; narrow extraction rather than repeatedly generating the same large output.

`timeoutMs` defaults to 30,000 for code tools. Timeout or cancellation terminates this session's worker. An owned browser closes; an attached browser remains running. Unsaved browser state may be lost. Launch/connect again before further work. Do not repeat a submission or mutation until you know whether it ran.

## Inspect network and console evidence

```js
return await tools.browse.network_list({ tab: "t1", url: "/api/orders", status: 500 });
```

Listings contain request IDs, method, URL without query/credentials, HTTP status, completion state, and duration. Data URLs show their media type and total length; blob URLs show their origin. Listings do not include headers or bodies. Capture starts when the worker sees a tab; it cannot reconstruct earlier traffic.

```js
return await tools.browse.network_get({
  tab: "t1",
  request: 42,
  part: "responseBody",
});
```

`part` accepts `requestHeaders`, `requestBody`, `responseHeaders`, or `responseBody`. Results use the same paging as code results. Response bodies must be complete; an in-progress stream reports that state rather than waiting indefinitely. Authorization, proxy authorization, cookies, and common API-key headers are redacted. This is not general secret detection: bodies and other headers can contain private data. Binary responses require trusted code rather than a text-body dump.

```js
return await tools.browse.console({ tab: "t1" });
```

Console output defaults to warnings and errors. Use `level: "all"` to include logs. Arbitrary console argument objects are not serialized.

Each tab retains 200 console entries and 200 requests. Listings are bounded and return a `next` cursor plus a `dropped` count. Pass `next` as `after` for subsequent entries. Network cursors track request creation, not response updates; omit `after` to recheck requests that were pending.

## Permissions and cleanup

The plugin checks these OpenCode permission actions:

| Action | Operations |
| --- | --- |
| `browse` | Browser connection, navigation, observations, actions, diagnostics, screenshots, and result reads |
| `browse_evaluate` | Page-side JavaScript |
| `browse_code` | Trusted host-side Playwright code and per-call native launch/context/profile overrides |

The resource is the operation name, such as `launch` or `network_get`. These are browser-control permissions, not per-origin isolation or a network security boundary. Broad shell access can also execute browser automation outside this plugin.

Native launch options can execute arbitrary programs or access host files. Launching user-configured defaults requires `browse`; passing `launchOptions`, `contextOptions`, or `userDataDir` in a tool call requires `browse_code`. Code approvals include the script being approved. Launch approvals include executable/flags, profile location, and environment/context option names without echoing environment values.

Each OpenCode session has its own worker and browser connection. Calls within that session execute in order, even if Code Mode starts them concurrently. Separate sessions do not share a mutable current tab.

`browse.close` releases the session's worker. Session deletion, movement, and plugin unload also clean it up. An idle agent turn does not close the browser, so you can continue browsing in the next turn. Persistent profiles are never deleted.

## Development

```sh
bun test plugins/browser/browser.test.ts
```

The browser tests use local Chrome/Chromium or `BROWSER_TEST_EXECUTABLE`. Without an installed executable, the browser integration cases skip. The fixture uses only local HTTP servers and profiles in the OS temporary directory's `opencode` subdirectory (`/tmp/opencode` on this Linux host).
