# @jiafuei/opencode-antigravity-oauth

Google [Antigravity](https://antigravity.google) OAuth for [OpenCode](https://opencode.ai). Sign in with a personal Google account and run **Gemini, Claude, and GPT-OSS models** through Google's Cloud Code Assist endpoints on the Antigravity free tier — no API key, no billing account.

Requests mirror the native Antigravity IDE language server (`antigravity/ide`): its request envelope, trajectory labels, user agent, model catalog, and control-plane calls, as captured from the Windows client.

> This plugin is an unofficial client. Availability, quotas, and model access are controlled entirely by Google's backend and can change or break at any time. Use is subject to Google's terms of service.

## Installation

```sh
opencode plugin add @jiafuei/opencode-antigravity-oauth
```

The plugin registers the `google-antigravity` integration and provider. The provider becomes available once you connect an account.

## Login

1. Connect the **Google Antigravity** integration in OpenCode.
2. Choose a sign-in method:
   - **Antigravity (browser)** — opens `accounts.google.com` in your browser and completes login against a local callback server on an ephemeral port, redirecting to `http://localhost:<port>/oauth-callback` like the native client. Keep OpenCode open until the redirect completes.
   - **Antigravity (paste code)** — use this when the browser cannot reach the callback server (remote OpenCode, container, or restricted loopback forwarding). This method intentionally does not start a server: it picks a random `localhost` port, so after Google redirects the browser shows “cannot connect.” Copy the complete `http://localhost:<port>/oauth-callback?...` URL from its address bar and paste that URL into OpenCode. Start a fresh paste-code login first; a redirect from an older browser-method attempt has a different `state` and is rejected.
3. On first login the plugin calls `loadCodeAssist` once, provisions the Antigravity free tier through `onboardUser` if the account has no tier yet (one long-running operation polled every second under a 30-second deadline), and stores the resolved project.

Login and provisioning requests (token exchange, userinfo, `loadCodeAssist`, `onboardUser`) carry the IDE's Electron-side identity: `google-api-nodejs-client` user agents, `x-goog-api-client: gl-node/22.21.1`, and the snake_case `ide_type` / `ide_version` / `ide_name` metadata. Token refreshes carry the language server's Go client identity (`Go-http-client/2.0` over HTTP/2, sorted form fields), since that client refreshes tokens for inference. These plugin-owned calls go through `node:https` / `node:http2` rather than Bun's `fetch`, so header order, case, and `Connection` handling match the respective native client.

The flow uses Google's installed-app OAuth client with offline access and consent prompt. It does **not** use PKCE — the current native flow does not either; CSRF protection is the `state` parameter, which is validated locally before any token exchange.

If Google requires account verification, login errors show the verification URL and ask you to sign in again after completing it. Inference errors show the same URL with an instruction to retry the request.

## Supported models

All models report zero subscription cost. The model list is the native agent picker: the `agentModelSorts` ids returned by `fetchAvailableModels` (sent with the account's project), in picker order. Discovery runs at startup and whenever the active Antigravity connection changes (daily then sandbox, or the pinned endpoint; 5-second timeout per endpoint), and the result is bound to the connection that produced it. Failed discovery falls back to the snapshot table below; a successful empty list removes all models.

Wire models whose display names differ only by a `(Low)` / `(Medium)` / `(High)` suffix are grouped into one OpenCode model with one variant per tier. The highest tier is the default. Each variant selects its own wire id, and its thinking budget or level comes from the catalog entry rather than from OpenCode's reasoning controls.

| Model | Variants (wire ids) | Context | Output | Input |
| --- | --- | --- | --- | --- |
| `gemini-3.8-flash` | low / medium / high (`gemini-3.8-flash-<tier>`) | 1M | 65,536 | text+image |
| `gemini-3.7-flash` | low / medium / high (`gemini-3.7-flash-<tier>`) | 1M | 65,536 | text+image |
| `gemini-3.6-flash` | low / medium / high (`gemini-3.6-flash-<tier>`) | 1M | 65,536 | text+image |
| `gemini-3.1-pro` | low (`gemini-3.1-pro-low`) / high (`gemini-pro-agent`) | 1M | 65,535 | text+image |
| `claude-opus-5-5` | low / medium / high (`claude-opus-5-5-<tier>`) | 1M | 128,000 | text+image |
| `claude-sonnet-5-5` | low / medium / high (`claude-sonnet-5-5-<tier>`) | 1M | 128,000 | text+image |
| `gpt-oss-120b` | — (`gpt-oss-120b-medium`) | 131k | 32,768 | text |

## Configuration

```jsonc
// opencode.json
{
  "plugins": [
    { "package": "@jiafuei/opencode-antigravity-oauth", "options": { "endpointMode": "auto", "trajectoryAcls": false, "metrics": false } }
  ]
}
```

**Options**

- `endpointMode`: `"auto"` (default) dispatches to `https://daily-cloudcode-pa.googleapis.com` first; a failed response moves that session to the other endpoint (sandbox, or back to daily), so OpenCode's retry lands there, and a successful one keeps it. `"production"` / `"sandbox"` pin one endpoint.
- `trajectoryAcls`: `true` sends `writeTrajectoryAcls` for a session's trajectory before its first agent request, as the native client does. Default `false`.
- `metrics`: `true` sends `recordCodeAssistMetrics` (trace id and 100ns-resolution streaming latencies) after each agent or checkpoint stream that finishes, as the native client does. Default `false`.

**Native compaction** (needs an OpenCode build with the experimental `experimental.compaction.native` hook that stores plugin windows as model-neutral, fork commit `5a39a06e74`; without it, compaction fails as unsupported because Gemini routes have no fixed endpoint path)

```jsonc
{
  "providers": {
    "google-antigravity": { "settings": { "compaction": { "type": "native" } } }
  }
}
```

The plugin then compacts like the native client: the full history goes out with the native summary prompt, and the new window is the latest user request plus the native `# Resuming from a compaction` message (the last ten user requests and the summary). Every model reads that window, so it carries over model switches like the native client's. Without the setting, OpenCode's own summary compaction runs and only its request envelope is native.

**Environment overrides**

| Variable | Meaning | Default |
| --- | --- | --- |
| `OPENCODE_ANTIGRAVITY_VERSION` | IDE version in the User-Agent and `onboardUser` metadata | `2.5.5` |
| `OPENCODE_ANTIGRAVITY_OS` | `os_type` field | `windows` |
| `OPENCODE_ANTIGRAVITY_ARCH` | `arch` field | `amd64` |

The User-Agent is `antigravity/ide/<version> (aidev_client; os_type=<os>; arch=<arch>)`. os/arch are pinned to the windows/amd64 client the constants were captured from, independent of your host platform.

## Wire behavior

The provider uses OpenCode's native Gemini client (`@opencode/ai/providers/google`, `baseURL` set to the daily endpoint). Session `http.request` / `http.response` hooks for `google-antigravity` rewrite its `models/<id>:streamGenerateContent` requests into the Cloud Code Assist envelope used by the native client:

- URL: `POST <endpoint>/v1internal:streamGenerateContent?alt=sse` (or `:generateContent` for non-stream calls).
- Envelope: `project` (from the active connection's credential metadata), `model` (the selected variant's wire id), `userAgent: "antigravity"`, `requestType: "agent"`, and `requestId = agent/<agentId>/<timestamp>/<trajectoryId>/<step>`, with labels `last_execution_id`, `last_step_index`, `model_enum` (from the catalog), `trajectory_id`, `used_claude`, `used_claude_conservative`, and `used_non_gemini_model`.
- Per-session identity: stable `agentId`/`trajectoryId` and a random signed-decimal `sessionId`. The step index is derived from the conversation the way the native trajectory counts it (each user message, model message, and tool result is a step, plus one checkpoint step), so a retry of the same history repeats its step. A step never moves backwards after compaction. Each new user turn starts a new execution id, and the previous one becomes `last_execution_id`. The model-family flags stay set once a session uses Claude or any non-Gemini model. Deleting a session or switching the active connection resets its identity.
- Headers: rebuilt from scratch with the language server's header set: the bearer token (the OAuth access token OpenCode sends as `x-goog-api-key`), the IDE user agent, `Content-Type: application/json`, and `Accept-Encoding: gzip`. No OpenCode, Gemini-client, or plugin-private header reaches Cloud Code Assist.
- Bodies, in the native key order:
  - The system prompt is a single `role: "user"` text part.
  - `generationConfig` holds only the catalog's `maxOutputTokens` and thinking config: `thinkingBudget` for Gemini and GPT-OSS, `thinkingLevel` (`LOW`/`MEDIUM`/`HIGH`) for Claude. OpenCode's sampling settings (temperature, topP, topK, stop sequences, seed) are not sent.
  - Function calling is always `VALIDATED`, except OpenCode's step-limit `none`, which Claude gets as `NONE`. Live tests showed Cloud Code Assist ignores `NONE` and `ANY` on Gemini, GPT-OSS leaks raw harmony tokens under `NONE`, and Claude rejects `ANY` while thinking is on, so structured output relies on the model choosing the tool.
  - Tools are sent one declaration per `Tool`, sorted by name. Schemas are converted from `parametersJsonSchema` into the native converter's shape: uppercase type names, sorted `properties`, no `title` or `propertyOrdering`, with `format`, `pattern`, `minimum`/`maximum`, `minLength`/`maxLength`, and `minItems`/`maxItems` kept in proto field order (int64 bounds as strings).
  - User turns are wrapped as `<USER_REQUEST>…</USER_REQUEST>` followed by `<ADDITIONAL_METADATA>` with the local time the turn was first sent; the first turn and every model change also get the native `<USER_SETTINGS_CHANGE>` note. The metadata is cached per turn so replays stay byte-identical.
  - Assistant turns are replayed the native way: one joined thought part, one joined text part (dropped when whitespace-only), then function calls, with the message signature on the first non-thought part. Empty or trailing `<tool_code>` wrappers are removed from the text. Thinking is kept only when the message carries a signature (thinking from another model has none), and for Claude only when the same wire model produced it, so switching Claude tiers drops earlier thinking and signatures like the native client. Gemini 3's signature bypass is added only to unsigned calls after the latest user turn; older calls replay bare.
  - Tool results are sent as `functionResponse.response.output` in the provider's native role (`user` for Claude, `model` otherwise), prefixed with `Created At:` / `Completed At:` local timestamps (call streamed, result first sent).
- Auxiliary requests use the `checkpoint` envelope (`requestId = checkpoint/<uuid>`, 16,384 output tokens, no labels) with the conversation's session id. Titles go to `gemini-3.1-flash-lite` with thinking off. Compaction goes to the current model with its thinking config, the conversation's tools, and `toolConfig: NONE`; the history replays with the conversation's cached annotations and the summary prompt stays plain user text. Transient generation keeps its selected model. Each request kind has separate trajectory and retry-endpoint state, so auxiliary calls do not advance the primary conversation's trajectory.
- Compaction continues the primary trajectory like the native client: the trajectory id stays, the step never moves backwards, and the execution only changes when the latest user turn does. Plain-text summaries (the native resume message, OpenCode's `<conversation-checkpoint>`) are not wrapped as user requests.
- Side calls (opt-in via `trajectoryAcls` / `metrics`): `writeTrajectoryAcls` for the trajectory before its first agent request (5 s timeout; a failed grant is retried on the next request and never blocks generation), and `recordCodeAssistMetrics` after each completed agent or checkpoint stream. Without them only generation requests are sent.
- Responses: SSE events wrapping Gemini chunks under `response` are unwrapped incrementally (no full buffering) for the native parser. In-band error events surface as stream errors with sanitized messages (and count as endpoint failures in `"auto"` mode).

Credentials only ever go to the two official Cloud Code Assist endpoints: the target URL is built from the endpoint mode, not from the configured `baseURL`. There is no plain API-key mode.

## Web search

While an Antigravity connection exists, the plugin registers an `antigravity` web search provider for OpenCode's built-in `websearch` tool. It dispatches the dedicated `gemini-3.1-flash-lite` `web_search` operation captured from the native client and returns each grounding source with the answer segments it supports.

## Credential storage

OpenCode stores the OAuth credential (`refresh`, `access`, `expires`) and refreshes it through the plugin's refresh callback, preserving rotated refresh tokens. The Cloud Code Assist **project id** and the account email are kept in the credential metadata; the email labels the connection. No secondary credential store exists, and tokens are never written to logs or error messages.

## Limitations

- The pinned IDE version (`2.5.5`) and the snapshot model table age as Google ships new clients. If Google gates models behind newer versions, set `OPENCODE_ANTIGRAVITY_VERSION`.
- Free-tier quota windows (daily/weekly buckets per backend) are enforced server-side; the plugin does not track or display usage.
- Generation requests still go through OpenCode's `fetch` (Bun): it sorts header names, adds `Accept: */*` and `Connection: keep-alive`, and sends `Content-Length` because OpenCode core buffers the hooked body (the native client streams it chunked). TLS handshakes differ for every call.
- Tool errors are sent as `output` rather than the native `error` key, because OpenCode's Gemini request does not mark failed tool results.
- The tool timestamps, per-turn metadata, and signature-to-model map live in memory: after a restart, replayed history gets fresh timestamps and Claude tier-switch detection only covers new signatures.
- `<ADDITIONAL_METADATA>` has no editor-state section (open files, cursor), since OpenCode has no editor.
- OpenCode's summary compaction sends only the older part of the history with its own prompt (and one reminder if the reply skips its template), and later requests open with its `<conversation-checkpoint>` message. Native compaction (above) avoids this. The native step after compaction also advances past the checkpoint; the plugin only keeps it from moving backwards.
- OMP's flash "planning leak" filtering and forced-tool directive text are not reproduced; requests rely on OpenCode's own Gemini serialization otherwise.
- Schema normalization covers the constructs OpenCode emits in practice (`anyOf`/`oneOf` folding, null unions, unsupported keyword stripping) but not OMP's full combiner-merge matrix.
- There is no in-request endpoint failover or first-event watchdog: `"auto"` mode only switches endpoints between attempts, relying on OpenCode's retry policy to re-issue a failed request.

## Attribution

This implementation follows the behavior of [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi)'s local Google Antigravity provider (`google-antigravity` OAuth flow, Cloud Code Assist provisioning), updated against captures of the native Antigravity IDE. All trademarks belong to their respective owners.
