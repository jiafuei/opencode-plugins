# @jiafuei/opencode-antigravity-oauth

Google [Antigravity](https://antigravity.google) OAuth for [OpenCode](https://opencode.ai). Sign in with a personal Google account and run **Gemini, Claude, and GPT-OSS models** through Google's Cloud Code Assist endpoints on the Antigravity free tier — no API key, no billing account.

Requests are fingerprinted to look exactly like the native `antigravity/hub` desktop client (request envelope, session identity chain, user agent, endpoint behavior), mirroring oh-my-pi's local Google Antigravity implementation.

> This plugin is an unofficial client. Availability, quotas, and model access are controlled entirely by Google's backend and can change or break at any time. Use is subject to Google's terms of service.

## Installation

```sh
opencode plugin @jiafuei/opencode-antigravity-oauth
```

Pass `--global` to install into your global OpenCode configuration. Then restart OpenCode so the plugin registers the `google-antigravity` provider.

## Login

```sh
opencode auth login
```

1. Pick **Google Antigravity**.
2. Choose a sign-in method:
   - **Antigravity (browser)** — opens `accounts.google.com` in your browser and completes login against a local callback server on `127.0.0.1:51121/oauth-callback` (the native Antigravity port). Keep the command running until the redirect completes.
   - **Antigravity (paste code)** — use this when the browser cannot reach the callback server (remote OpenCode, container, or restricted loopback forwarding). This method intentionally does not start a server: after Google redirects, the browser may show “cannot connect.” Copy the complete `http://127.0.0.1:51121/oauth-callback?...` URL from its address bar and paste that URL into OpenCode. Start a fresh paste-code login first; a redirect from an older browser-method attempt has a different `state` and is rejected.
3. On first login the plugin checks your Cloud Code Assist account state, provisions the Antigravity free tier if needed (one long-running operation polled every second under a 30-second deadline), and stores the resolved project.

The flow uses Google's installed-app OAuth client with offline access and consent prompt. It does **not** use PKCE — the current native flow does not either; CSRF protection is the `state` parameter, which is validated locally before any token exchange.

## Supported models

All models report zero subscription cost. Reasoning variants (`minimal` / `low` / `medium` / `high`) map onto upstream effort tiers exactly like the native client:

| Model | Context | Output | Input | Notes |
| --- | --- | --- | --- | --- |
| `gemini-3.5-flash`, `gemini-3-flash` | 1M | 65,536 | text+image | budget transport; high → `gemini-3-flash-agent` |
| `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash` | 1M | 65,536 | text+image | one wire id per thinking level |
| `gemini-3.1-pro` | 1M | 65,535 | text+image | low/high efforts; high routes to `gemini-pro-agent` |
| `gemini-3-pro` | 1M | 65,535 | text+image | level transport |
| `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` | 1M | ~65k | text+image | budget transport |
| `claude-opus-4-6`, `claude-sonnet-4-6` | 250k / 250k | 64,000 | text+image | asymmetric upstream wire ids |
| `claude-opus-4-5`, `claude-sonnet-4-5` | 200k / 1M | 64,000 | text+image | `-thinking` wire ids for reasoning efforts |
| `gpt-oss-120b` | 131k | 32,768 | text | constant medium wire id |

Checkpoint-only ids (`gemini-3.1-flash-lite`, tab completion previews) are intentionally absent: this provider only serves agent requests.

## Configuration

```jsonc
// opencode.json
{
  "plugin": [
    ["@jiafuei/opencode-antigravity-oauth", { "endpointMode": "auto" }]
  ]
}
```

**Options**

- `endpointMode`: `"auto"` (default) dispatches to `https://daily-cloudcode-pa.googleapis.com` first with sandbox failover before streaming begins, remembering the last-good endpoint per session. `"production"` / `"sandbox"` pin one endpoint.
- `firstEventTimeoutMs`: override the pre-first-event watchdog ceiling (OMP uses 60s for Flash models and 300s otherwise). Only meaningful in `"auto"` mode where another endpoint can be tried.

**Environment overrides**

| Variable | Meaning | Default |
| --- | --- | --- |
| `OPENCODE_ANTIGRAVITY_VERSION` | Client version in the User-Agent (disables manifest discovery) | latest from update manifest, else `2.8.0` |
| `OPENCODE_ANTIGRAVITY_CL` | Changelog value in the User-Agent | `963137146` |
| `OPENCODE_ANTIGRAVITY_OS` | `os_type` field | `darwin` |
| `OPENCODE_ANTIGRAVITY_ARCH` | `arch` field | `arm64` |

os/arch are deliberately pinned to the darwin/arm64 reference client the constants were captured from, independent of your host platform.

## Wire behavior

For OAuth traffic only, the auth loader's fetch boundary rewrites standard `@ai-sdk/google` requests into the Cloud Code Assist envelope used by the native client:

- URL: `POST https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse` (or `:generateContent` for non-stream calls).
- Envelope: `project`, `model` (effort-routed wire id), `userAgent: "antigravity"`, `requestType: "agent"`, and `request.requestId = agent/<agentId>/<timestamp>/<trajectoryId>/<step>` with labels `last_step_index`, `trajectory_id`, `used_claude`, `used_claude_conservative`, `model_enum`, and `last_execution_id`.
- Per-session identity: stable `agentId`/`trajectoryId`, signed-decimal `sessionId`, monotonic step index, and the prior response's id carried forward. SDK retries of the same logical request reuse the envelope instead of advancing the step.
- Headers: captured `antigravity/hub/<version> (...)` user agent, bearer token, `Content-Type: application/json`, `Accept: text/event-stream`, plus `anthropic-beta: interleaved-thinking-2025-05-14` for reasoning Claude models. The `@ai-sdk/google` fingerprint (`x-goog-api-key`, `x-goog-api-client`), OpenCode's session-routing headers (`x-session-affinity`, `x-session-id`, `x-parent-session-id`, `client-metadata`), and the plugin-private routing markers are all stripped before dispatch — only the native inference header set reaches Cloud Code Assist.
- Bodies: system instructions tagged `role: "user"`, default function-calling mode `VALIDATED` (forced for Claude even with no tools), tool schemas converted from the SDK's `parametersJsonSchema` form to normalized legacy `parameters`, fixed per-model `maxOutputTokens`, thinking controls normalized to each family's native transport (budget or level), and explicit server-side thinking suppression where omitting the config would silently re-enable it.
- Responses: SSE events wrapping Gemini chunks under `response` are unwrapped incrementally (no full buffering); the response id is captured for the next request's `last_execution_id`. In-band error events surface as stream errors with sanitized messages. Session state (last-good endpoint, response identity) commits only after a stream completes successfully.
- Endpoint failover: in `"auto"` mode a pre-first-event watchdog buffers up to the first complete SSE event; transient failures before that point (HTTP status or in-band error) switch to the alternate endpoint without losing bytes, while non-transient errors surface immediately. Once an ordinary event has been exposed, the endpoint is never switched.
- Origin safety: bearer credentials are sent **only** to the two official Cloud Code Assist endpoints. Any other configured `baseURL` (proxy/gateway) is rejected with a clear error rather than leaking subscription traffic. There is no plain API-key mode; logout/re-login transitions are detected per request because stored auth is re-read at every request.

Responses are parsed by OpenCode's bundled `@ai-sdk/google` — the plugin never interprets model output itself.

## Credential storage

OpenCode's OAuth auth schema persists `refresh`, `access`, `expires`, and an opaque `accountId`. The plugin stores the Cloud Code Assist **project id** in `accountId`; the account email is shown during login only and is not persisted. No secondary credential store exists, and tokens are never written to logs or error messages. Token refresh happens transparently with a five-minute expiry skew and preserves rotated refresh tokens.

## Limitations

- The pinned fallback version (`2.8.0`) ages as Google ships new clients; the plugin refreshes it from the official update manifest at startup (5-second timeout, cached per process). If Google gates new models behind newer versions, update `OPENCODE_ANTIGRAVITY_VERSION`.
- Free-tier quota windows (daily/weekly buckets per backend) are enforced server-side; the plugin does not track or display usage.
- OMP's flash "planning leak" filtering and forced-tool directive text are not reproduced; requests rely on the SDK's own serialization otherwise.
- Schema normalization covers the constructs OpenCode emits in practice (`anyOf`/`oneOf` folding, null unions, unsupported keyword stripping) but not OMP's full combiner-merge matrix.
- The pre-first-event watchdog only engages in `"auto"` mode where a second endpoint exists. Pinned `"production"` / `"sandbox"` modes have no first-event failover (matching OMP's single-endpoint attempts).
- Unmatched custom thinking controls (budgets or levels outside the captured tiers) are forwarded untouched rather than remapped.

## Attribution

This implementation follows the behavior of [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi)'s local Google Antigravity provider (`google-antigravity` OAuth flow, `antigravity/hub` wire profiles, Cloud Code Assist discovery), including captured request constants. All trademarks belong to their respective owners.
