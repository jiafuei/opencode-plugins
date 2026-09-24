# @jiafuei/opencode-antigravity-oauth

Google [Antigravity](https://antigravity.google) OAuth for [OpenCode](https://opencode.ai). Sign in with a personal Google account and run **Gemini, Claude, and GPT-OSS models** through Google's Cloud Code Assist endpoints on the Antigravity free tier — no API key, no billing account.

Requests are fingerprinted to look exactly like the native `antigravity/hub` desktop client (request envelope, session identity chain, user agent, endpoint behavior), mirroring oh-my-pi's local Google Antigravity implementation.

> This plugin is an unofficial client. Availability, quotas, and model access are controlled entirely by Google's backend and can change or break at any time. Use is subject to Google's terms of service.

## Installation

```sh
opencode plugin add @jiafuei/opencode-antigravity-oauth
```

The plugin registers the `google-antigravity` integration and provider. The provider becomes available once you connect an account.

## Login

1. Connect the **Google Antigravity** integration in OpenCode.
2. Choose a sign-in method:
   - **Antigravity (browser)** — opens `accounts.google.com` in your browser and completes login against a local callback server on `127.0.0.1:51121/oauth-callback` (the native Antigravity port). Keep OpenCode open until the redirect completes.
   - **Antigravity (paste code)** — use this when the browser cannot reach the callback server (remote OpenCode, container, or restricted loopback forwarding). This method intentionally does not start a server: after Google redirects, the browser may show “cannot connect.” Copy the complete `http://127.0.0.1:51121/oauth-callback?...` URL from its address bar and paste that URL into OpenCode. Start a fresh paste-code login first; a redirect from an older browser-method attempt has a different `state` and is rejected.
3. On first login the plugin checks your Cloud Code Assist account state, provisions the Antigravity free tier if needed (one long-running operation polled every second under a 30-second deadline), and stores the resolved project.

The flow uses Google's installed-app OAuth client with offline access and consent prompt. It does **not** use PKCE — the current native flow does not either; CSRF protection is the `state` parameter, which is validated locally before any token exchange.

If Google requires account verification, login errors show the verification URL and ask you to sign in again after completing it. Inference errors show the same URL with an instruction to retry the request.

## Supported models

All models report zero subscription cost. Reasoning variants (`minimal` / `low` / `medium` / `high`) map onto upstream effort tiers exactly like the native client:

The table below is the static fallback. At startup and whenever the active Antigravity connection changes, live `fetchAvailableModels` discovery runs (daily then sandbox, or the pinned endpoint; 5-second timeout per endpoint). Discovery filters the list to supported models whose default wire route is available, drops unavailable reasoning variants, and updates context/output limits and image support. The discovered list is bound to the connection that produced it. Failed discovery retains the defaults; a successful empty list removes them. Unknown and internal models are not automatically added.

| Model | Context | Output | Input | Notes |
| --- | --- | --- | --- | --- |
| `gemini-3.5-flash`, `gemini-3-flash` | 1M | 65,536 | text+image | budget transport; high → `gemini-3-flash-agent` |
| `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash` | 1M | 65,536 | text+image | one wire id per thinking level |
| `gemini-3.1-pro` | 1M | 65,535 | text+image | low/high efforts; high routes to `gemini-pro-agent` |
| `gemini-3-pro` | 1M | 65,535 | text+image | level transport |
| `gemini-2.5-flash`, `gemini-2.5-flash-lite` | 1M | ~65k | text+image | budget transport |
| `claude-opus-4-6`, `claude-sonnet-4-6` | 250k / 250k | 64,000 | text+image | asymmetric upstream wire ids |
| `claude-opus-4-5`, `claude-sonnet-4-5` | 200k / 1M | 64,000 | text+image | `-thinking` wire ids for reasoning efforts |
| `gpt-oss-120b` | 131k | 32,768 | text | constant medium wire id |

Checkpoint-only ids (`gemini-3.1-flash-lite`, tab completion previews) are intentionally absent: this provider only serves agent requests.
`gemini-2.5-pro` is excluded, matching OMP's discovery exclusions.

## Configuration

```jsonc
// opencode.json
{
  "plugins": [
    { "package": "@jiafuei/opencode-antigravity-oauth", "options": { "endpointMode": "auto" } }
  ]
}
```

**Options**

- `endpointMode`: `"auto"` (default) dispatches to `https://daily-cloudcode-pa.googleapis.com` first; a failed response moves that session to the other endpoint (sandbox, or back to daily), so OpenCode's retry lands there, and a successful one keeps it. `"production"` / `"sandbox"` pin one endpoint.

**Environment overrides**

| Variable | Meaning | Default |
| --- | --- | --- |
| `OPENCODE_ANTIGRAVITY_VERSION` | Client version in the User-Agent (disables manifest discovery) | latest from update manifest, else `2.8.0` |
| `OPENCODE_ANTIGRAVITY_CL` | Changelog value in the User-Agent | `963137146` |
| `OPENCODE_ANTIGRAVITY_OS` | `os_type` field | `darwin` |
| `OPENCODE_ANTIGRAVITY_ARCH` | `arch` field | `arm64` |

os/arch are deliberately pinned to the darwin/arm64 reference client the constants were captured from, independent of your host platform.

## Wire behavior

The provider uses OpenCode's native Gemini client (`@opencode/ai/providers/google`, `baseURL` set to the daily endpoint). Session `http.request` / `http.response` hooks for `google-antigravity` rewrite its `models/<id>:streamGenerateContent` requests into the Cloud Code Assist envelope used by the native client:

- URL: `POST <endpoint>/v1internal:streamGenerateContent?alt=sse` (or `:generateContent` for non-stream calls).
- Envelope: `project` (from the active connection's credential metadata), `model` (effort-routed wire id), `userAgent: "antigravity"`, `requestType: "agent"`, and `request.requestId = agent/<agentId>/<timestamp>/<trajectoryId>/<step>` with labels `last_step_index`, `trajectory_id`, `used_claude`, `used_claude_conservative`, `model_enum`, and `last_execution_id`.
- Per-session identity: stable `agentId`/`trajectoryId`, signed-decimal `sessionId`, monotonic step index, and the prior response's id carried forward. Retries of the same logical request reuse the envelope instead of advancing the step. Deleting a session or switching the active connection resets its identity chain.
- Headers: rebuilt from scratch — bearer token (the OAuth access token OpenCode sends as `x-goog-api-key`), captured `antigravity/hub/<version> (...)` user agent, `Content-Type: application/json`, `Accept: text/event-stream`, plus `anthropic-beta: interleaved-thinking-2025-05-14` for Claude models. No OpenCode, Gemini-client, or plugin-private header reaches Cloud Code Assist.
- Bodies: system instructions tagged `role: "user"`, default function-calling mode `VALIDATED` (forced for Claude even with no tools), tool schemas converted from `parametersJsonSchema` to normalized legacy `parameters`, fixed per-model `maxOutputTokens`, thinking controls normalized to each family's native transport (budget or level), and explicit server-side thinking suppression where omitting the config would silently re-enable it.
- Responses: SSE events wrapping Gemini chunks under `response` are unwrapped incrementally (no full buffering) for the native parser; the response id is carried into the next request's `last_execution_id` only after a stream completes. In-band error events surface as stream errors with sanitized messages (and count as endpoint failures in `"auto"` mode).

Credentials only ever go to the two official Cloud Code Assist endpoints: the target URL is built from the endpoint mode, not from the configured `baseURL`. There is no plain API-key mode.

## Web search

While an Antigravity connection exists, the plugin registers an `antigravity` web search provider for OpenCode's built-in `websearch` tool. It dispatches the dedicated `gemini-3.1-flash-lite` `web_search` operation captured from the native client and returns each grounding source with the answer segments it supports.

## Credential storage

OpenCode stores the OAuth credential (`refresh`, `access`, `expires`) and refreshes it through the plugin's refresh callback, preserving rotated refresh tokens. The Cloud Code Assist **project id** and the account email are kept in the credential metadata; the email labels the connection. No secondary credential store exists, and tokens are never written to logs or error messages.

## Limitations

- The pinned fallback version (`2.8.0`) ages as Google ships new clients; the plugin refreshes it from the official update manifest at startup (5-second timeout, cached per process). If Google gates new models behind newer versions, update `OPENCODE_ANTIGRAVITY_VERSION`.
- Free-tier quota windows (daily/weekly buckets per backend) are enforced server-side; the plugin does not track or display usage.
- OMP's flash "planning leak" filtering and forced-tool directive text are not reproduced; requests rely on OpenCode's own Gemini serialization otherwise.
- Schema normalization covers the constructs OpenCode emits in practice (`anyOf`/`oneOf` folding, null unions, unsupported keyword stripping) but not OMP's full combiner-merge matrix.
- There is no in-request endpoint failover or first-event watchdog: `"auto"` mode only switches endpoints between attempts, relying on OpenCode's retry policy to re-issue a failed request.
- Unmatched custom thinking controls (budgets or levels outside the captured tiers) are forwarded untouched rather than remapped.

## Attribution

This implementation follows the behavior of [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi)'s local Google Antigravity provider (`google-antigravity` OAuth flow, `antigravity/hub` wire profiles, Cloud Code Assist discovery), including captured request constants. All trademarks belong to their respective owners.
