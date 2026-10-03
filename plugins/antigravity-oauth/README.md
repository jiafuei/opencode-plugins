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

Login and provisioning requests (token exchange, userinfo, `loadCodeAssist`, `onboardUser`) carry the IDE's Electron-side identity: `google-api-nodejs-client` user agents, `x-goog-api-client: gl-node/22.21.1`, and the snake_case `ide_type` / `ide_version` / `ide_name` metadata. Token refreshes carry the language server's Go client identity (`Go-http-client/1.1`, sorted form fields), since that client refreshes tokens for inference.

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
  - Function calling defaults to `VALIDATED` (forced for Claude).
  - Tool schemas are converted from `parametersJsonSchema` into the native converter's shape: uppercase type names, sorted `properties`, no `title` or `propertyOrdering`.
  - Assistant turns are replayed the native way: one joined thought part, one joined text part (dropped when whitespace-only), then function calls, with the message signature on the first non-thought part. Empty or trailing `<tool_code>` wrappers are removed from the text. Claude thinking is kept only when the message carries a signature.
  - Tool results are sent as `functionResponse.response.output` in the provider's native role (`user` for Claude, `model` otherwise).
- Title generation: OpenCode's title requests go out as native `checkpoint` calls (`gemini-3.1-flash-lite`, `requestId = checkpoint/<uuid>`, thinking off, 16,384 output tokens) and do not advance the session's trajectory.
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
- Bun's HTTP client cannot reproduce the Go client exactly: it always adds `Accept: */*` and `Connection: keep-alive`, sends streaming bodies with `Content-Length`, and has its own header order and TLS handshake.
- Tool errors are sent as `output` rather than the native `error` key, because OpenCode's Gemini request does not mark failed tool results.
- Switching models mid-session keeps OpenCode's history serialization as is; the native client's model-switch body handling is not reproduced.
- OMP's flash "planning leak" filtering and forced-tool directive text are not reproduced; requests rely on OpenCode's own Gemini serialization otherwise.
- Schema normalization covers the constructs OpenCode emits in practice (`anyOf`/`oneOf` folding, null unions, unsupported keyword stripping) but not OMP's full combiner-merge matrix.
- There is no in-request endpoint failover or first-event watchdog: `"auto"` mode only switches endpoints between attempts, relying on OpenCode's retry policy to re-issue a failed request.

## Attribution

This implementation follows the behavior of [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi)'s local Google Antigravity provider (`google-antigravity` OAuth flow, Cloud Code Assist provisioning), updated against captures of the native Antigravity IDE. All trademarks belong to their respective owners.
