# OpenAI native compaction

Replaces OpenCode's summary-based compaction with **OpenAI's server-side compact endpoint** for the `openai` provider.

Instead of asking the model to write a Markdown summary of the conversation, the plugin POSTs the conversation to `…/responses/compact`, stores the opaque array of Responses items it returns, and replays every later request as:

```
[prompt envelope] + [opaque compacted window] + [live tail since the last user turn]
```

Compaction happens in the provider's own representation, so reasoning items, tool calls and structure survive instead of collapsing into prose. This is a port of [pi-codex-compaction](https://github.com/jordyvandomselaar/pi-codex-compaction) to OpenCode.

## Install

```sh
opencode plugin @jiafuei/opencode-openai-compaction
```

## Configuration

```json
{
  "plugin": [
    ["@jiafuei/opencode-openai-compaction", {
      "enabled": true,
      "threshold": 0.7,
      "debug": false
    }]
  ]
}
```

- `threshold` — fraction of the model's context window at which a request is compacted before being sent (default `0.7`).
- `debug` — log every replay and mismatch, not just compactions and failures. Logs go to the OpenCode server log under the `openai-compaction` service.

## How it works

- `chat.headers` tags each `openai` turn with the session ID (skipping the `title` and `compaction` agents) and records the model's context limit.
- Before calling the compact endpoint, the plugin adds a persistent `Compacting context...` message to the transcript. It is a `noReply` user message with an ignored text part, so both the TUI and web UI display it without starting another turn or including it in model input. Its ID sorts immediately before the triggering user message so it cannot become the session's active prompt.
- The plugin wraps `globalThis.fetch` and intercepts the tagged POSTs to `…/responses`. It runs *inside* OpenCode's built-in codex plugin, so the request is already authenticated and addressed — the same headers are reused for the compact call, and both API-key (`api.openai.com/v1/responses`) and ChatGPT OAuth (`chatgpt.com/backend-api/codex/responses`) sessions work. The session header is always stripped before the request goes out.
- Compacted windows are stored per session under `${XDG_DATA_HOME:-~/.local/share}/opencode/openai-compaction/<project>/<session>.json` and removed when the session is deleted.
- Before replaying a window, the plugin fingerprints the history prefix it replaced. The fingerprint ignores text content — so OpenCode's tool-output pruning is harmless — but insertions, reordering, a model switch or OpenCode's own compaction invalidate it, and the plugin falls back to sending the original request.
- If the provider rejects a request carrying a window (`400`/`422`), the stored window is discarded. A rejected *replay* is treated as an expired window, so the next turn compacts again from plain history; a window rejected the moment it was created means the provider will not accept the payload at all, so the plugin stops rewriting for the rest of the session.

OpenCode's built-in compaction is deliberately left enabled. Because the wire payload shrinks, the provider reports low input token counts and OpenCode's overflow check never fires while this plugin is working; if a compact call fails, the normal summarize path is still there as a safety net.

## Limitations

- The compact endpoint contract follows [OpenAI's documented `POST /v1/responses/compact`](https://platform.openai.com/docs/api-reference/responses/compact): the request carries only `model`, `input` and `instructions`, and the response's `output` array is stored verbatim as the window. If the endpoint is unavailable for your account, the plugin logs a warning, marks the session, and every request goes out unmodified.
- The ChatGPT OAuth path (`chatgpt.com/backend-api/codex/responses/compact`) is assumed to mirror that contract, following the pi extension.
- Only requests with a string body are inspected. The experimental native LLM runtime may issue `Request` objects; those pass through untouched.
- `globalThis.fetch` is patched process-wide. The filter is narrow (POST + `/responses` + the plugin's own header) and the original is restored on dispose.

## Tests

```sh
bun test plugins/openai-compaction
```
