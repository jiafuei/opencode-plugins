# Antigravity OAuth design

How the plugin imitates the native Antigravity IDE. For installation and usage, see the [README](README.md).

Requests mirror the Antigravity IDE language server (`antigravity/ide`) as captured from the Windows client: its
request envelope, trajectory labels, user agent, model catalog, and control-plane calls.

## Login and provisioning

- The flow uses Google's installed-app OAuth client with offline access and a consent prompt. Like the native flow, it
  does not use PKCE; CSRF protection is the `state` parameter, validated locally before any token exchange.
- On first login the plugin calls `loadCodeAssist` once and, if the account has no tier yet, provisions the free tier
  through `onboardUser` (one long-running operation polled every second under a 30-second deadline). The resolved
  project is stored in the credential metadata.
- Login and provisioning requests (token exchange, userinfo, `loadCodeAssist`, `onboardUser`) carry the IDE's
  Electron-side identity: `google-api-nodejs-client` user agents, `x-goog-api-client: gl-node/22.21.1`, and the
  snake_case `ide_type` / `ide_version` / `ide_name` metadata.
- Token refreshes carry the language server's Go client identity (`Go-http-client/2.0` over HTTP/2, sorted form
  fields), since that client refreshes tokens for inference.
- These plugin-owned calls go through `node:https` / `node:http2` rather than Bun's `fetch`, so header order, case, and
  `Connection` handling match the respective native client.

## Model discovery

The model list is the native agent picker: the `agentModelSorts` ids returned by `fetchAvailableModels` (sent with the
account's project), in picker order. Discovery tries the endpoints of the endpoint mode in order with a 5-second
timeout each, and the result is bound to the connection that produced it. Failed discovery falls back to the snapshot
table in the README; a successful empty list removes all models.

Wire models whose display names differ only by a `(Low)` / `(Medium)` / `(High)` suffix become one OpenCode model with
a variant per tier. Each variant selects its own wire id, and its thinking budget or level comes from the catalog
entry.

## Generation requests

The provider uses OpenCode's native Gemini client (`@opencode/ai/providers/google`, `baseURL` set to the daily
endpoint). Session `http.request` / `http.response` hooks rewrite its `models/<id>:streamGenerateContent` requests
into the Cloud Code Assist envelope used by the native client. The target URL is built from the endpoint mode, never
from the configured `baseURL`, so credentials only go to the two official endpoints.

- URL: `POST <endpoint>/v1internal:streamGenerateContent?alt=sse` (or `:generateContent` for non-stream calls).
- Envelope: `project` (from the credential metadata), `model` (the variant's wire id), `userAgent: "antigravity"`,
  `requestType: "agent"`, and `requestId = agent/<agentId>/<timestamp>/<trajectoryId>/<step>`, with labels
  `last_execution_id`, `last_step_index`, `model_enum` (from the catalog), `trajectory_id`, `used_claude`,
  `used_claude_conservative`, and `used_non_gemini_model`.
- Per-session identity: stable `agentId`/`trajectoryId` and a random signed-decimal `sessionId`. The step index is
  derived from the conversation the way the native trajectory counts it (each user message, model message, and tool
  result is a step, plus one checkpoint step), so a retry of the same history repeats its step. Each new user turn
  starts a new execution id, and the previous one becomes `last_execution_id`. The model-family flags stay set once a
  session uses Claude or any non-Gemini model. Deleting a session or switching the active connection resets its
  identity.
- Headers are rebuilt from scratch with the language server's set: the bearer token (the OAuth access token OpenCode
  sends as `x-goog-api-key`), the IDE user agent, `Content-Type: application/json`, and `Accept-Encoding: gzip`. No
  OpenCode, Gemini-client, or plugin-private header reaches Cloud Code Assist.
- The User-Agent is `antigravity/ide/<version> (aidev_client; os_type=<os>; arch=<arch>)`, pinned to the windows/amd64
  client regardless of the host platform.

### Bodies

Bodies use the native key order.

- The system prompt is a single `role: "user"` text part.
- `generationConfig` holds only the catalog's `maxOutputTokens` and thinking config: `thinkingBudget` for Gemini and
  GPT-OSS, `thinkingLevel` (`LOW`/`MEDIUM`/`HIGH`) for Claude. OpenCode's sampling settings (temperature, topP, topK,
  stop sequences, seed) are not sent.
- Function calling is always `VALIDATED`, except OpenCode's step-limit `none`, which Claude gets as `NONE`. Cloud Code
  Assist ignores `NONE` and `ANY` on Gemini, GPT-OSS leaks raw harmony tokens under `NONE`, and Claude rejects `ANY`
  while thinking is on, so structured output relies on the model choosing the tool.
- Tools are sent one declaration per `Tool`, sorted by name. Schemas are converted from `parametersJsonSchema` into the
  native converter's shape: uppercase type names, sorted `properties`, no `title` or `propertyOrdering`, with
  `format`, `pattern`, `minimum`/`maximum`, `minLength`/`maxLength`, and `minItems`/`maxItems` kept in proto field
  order (int64 bounds as strings). `anyOf`/`oneOf` are folded, null unions collapsed, and unsupported keywords
  stripped.
- User turns are wrapped as `<USER_REQUEST>…</USER_REQUEST>` followed by `<ADDITIONAL_METADATA>` with the local time
  the turn was first sent; the first turn and every model change also get the native `<USER_SETTINGS_CHANGE>` note.
  The metadata is cached per turn so replays stay byte-identical.
- Assistant turns are replayed the native way: one joined thought part, one joined text part (dropped when
  whitespace-only), then function calls, with the message signature on the first non-thought part. Empty or trailing
  `<tool_code>` wrappers are removed from the text. Thinking is kept only when the message carries a signature
  (thinking from another model has none), and for Claude only when the same wire model produced it, so switching
  Claude tiers drops earlier thinking and signatures like the native client. Gemini 3's signature bypass is added only
  to unsigned calls after the latest user turn; older calls replay bare.
- Tool results are sent as `functionResponse.response.output` in the provider's native role (`user` for Claude,
  `model` otherwise), prefixed with `Created At:` / `Completed At:` local timestamps (call streamed, result first
  sent).

### Auxiliary requests

Auxiliary requests use the `checkpoint` envelope (`requestId = checkpoint/<uuid>`, 16,384 output tokens, no labels)
with the conversation's session id. Titles go to `gemini-3.1-flash-lite` with thinking off. Compaction goes to the
current model with its thinking config, the conversation's tools, and `toolConfig: NONE`; the history replays with the
conversation's cached annotations and the summary prompt stays plain user text. Transient generation keeps its
selected model. Each request kind has separate trajectory and retry-endpoint state, so auxiliary calls do not advance
the primary conversation's trajectory.

### Compaction

Compaction continues the primary trajectory like the native client: the trajectory id stays, the step never moves
backwards, and the execution only changes when the latest user turn does. Plain-text summaries (the native resume
message, OpenCode's `<conversation-checkpoint>`) are not wrapped as user requests.

With native compaction enabled, the full history goes out with the native summary prompt, and the new window is the
latest user request plus the native `# Resuming from a compaction` message (the last ten user requests and the
summary).

### Side calls

When enabled, `writeTrajectoryAcls` is sent for the trajectory before its first agent request (5 s timeout; a failed
grant is retried on the next request and never blocks generation), and `recordCodeAssistMetrics` (trace id and
100ns-resolution streaming latencies) after each completed agent or checkpoint stream.

### Responses

SSE events wrapping Gemini chunks under `response` are unwrapped incrementally for OpenCode's Gemini parser. In-band
error events surface as stream errors with sanitized messages and count as endpoint failures in `"auto"` mode.

## Web search and usage

The `antigravity` web search provider sends the native client's dedicated `gemini-3.1-flash-lite` `web_search`
operation. `/antigravity-usage` sends the native `retrieveUserQuotaSummary` request for the connection's project to
the first endpoint of the endpoint mode.

## Known differences from the native client

- Generation requests go through OpenCode's `fetch` (Bun): it sorts header names, adds `Accept: */*` and
  `Connection: keep-alive`, and sends `Content-Length` because OpenCode core buffers the hooked body (the native client
  streams it chunked). TLS handshakes differ for every call.
- Tool errors are sent as `output` rather than the native `error` key, because OpenCode's Gemini request does not mark
  failed tool results.
- Tool timestamps, per-turn metadata, and the signature-to-model map live in memory: after a restart, replayed history
  gets fresh timestamps and Claude tier-switch detection only covers new signatures.
- `<ADDITIONAL_METADATA>` has no editor-state section (open files, cursor), since OpenCode has no editor.
- OpenCode's summary compaction sends only the older part of the history with its own prompt, and later requests open
  with its `<conversation-checkpoint>` message. The native step after compaction also advances past the checkpoint;
  the plugin only keeps it from moving backwards.
- `"auto"` mode switches endpoints only between attempts and relies on OpenCode's retry policy to re-issue a failed
  request; there is no in-request failover or first-event watchdog.
