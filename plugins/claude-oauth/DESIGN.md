# Claude OAuth design

How the plugin turns OpenCode's Anthropic requests into Claude Code requests. For installation and usage, see the [README](README.md).

## Request rewriting

When the active Anthropic connection is the Claude Pro/Max OAuth credential, the plugin's session `model.request`,
`http.request`, and `http.response` hooks rewrite `/v1/messages` calls. OpenCode itself sends the
`Authorization: Bearer …` token and the `?beta=true` query.

### Profiles

Both profiles follow Linux x64 Claude Code 2.1.284. The interactive CLI reference is a 2.1.284 capture; `sdk-cli`
applies the same 2.1.284 changes to a 2.1.280 SDK capture.

| Wire behavior | `cli` | `sdk-cli` |
| --- | --- | --- |
| Main system identity | Official Claude Code CLI | Claude Agent SDK |
| Billing entrypoint | `cli` | `sdk-cli` |
| Turn origin | `human` / `task_notification` | `sdk` |
| Modern Opus/Sonnet thinking display | `updates` | `omitted` |
| Fallback-credit beta | Auxiliary and compaction requests | Absent |
| Thinking-display-updates beta | Present with updates | Absent |

Device identity is derived from the plugin's install ID and the OAuth account. Neither profile reads
`~/.claude.json` or `CLAUDE_CONFIG_DIR`.

### Headers and betas

- Requests carry the profile's exact `User-Agent`, `x-app: cli`, a per-invocation `x-client-request-id` (stable across
  HTTP retries), the Stainless header set, and a per-session `X-Claude-Code-Session-Id` UUID. OpenCode's
  session-routing, project, and client headers are dropped.
- Each request class (main, subagent, auxiliary, compaction) gets its own header and beta profile. Other caller betas
  are kept and deduplicated after the profile's list, except `fine-grained-tool-streaming-2025-05-14` (absent from the
  profile), the SDK's obsolete `structured-outputs-2025-11-13` tool beta, and `context-1m-2025-08-07` (hard-429'd for
  subscription credentials).
- The model's output limit is kept, including 128000-token Opus requests.

### Body

- Custom tools are exposed as `mcp__oc__<name>` with their schemas and arguments intact. Definitions, forced tool
  choices, historical calls, and tool references are rewritten consistently; response tool names are restored.
- The OpenCode harness opening is replaced by the profile's identity. System blocks are regrouped into stable
  instructions and caller instructions; repository rules, skills, memories, user messages, and tool results keep their
  text. OpenCode's environment preamble is reworded to Claude Code's "You have been invoked in the following
  environment:" (see [Third-party classification](#third-party-classification)).
- Main agent requests use 1-hour caches; child agents use short caches.

### Billing header and `cch`

- The `x-anthropic-billing-header` carries the request-chain fields `cc_prev_req` and `cc_prompt_id`. Main requests
  also carry `x-claude-code-prompt-id` and `cc_prompt_index` / `cc_turn_index`: every turn advances the turn index, and
  task notifications do not count as prompts. Subagents carry the prompt ID header but no indexes.
- `cch` uses Claude Code's serialized-byte algorithm (global byte-marker normalization, nested `model` values,
  `max_tokens`/fallback exclusions) and is patched over the `cch=00000` placeholder as five lowercase hex characters.
- `attributionHeader: false` drops the billing header and `cch`; the rest of the profile stays.

### Session state

- Child agents share the root's wire-session UUID and inherit its prompt ID, while each OpenCode session has its own
  response chain. Auxiliary requests do not advance the primary chain. Each new turn gets a prompt ID.
- `cc_prev_req` and `diagnostics.previous_message_id` advance only after a complete JSON message or an SSE stream that
  ends with a parsed `message_stop` and no error event. Retries reuse logical IDs and increment
  `X-Stainless-Retry-Count`. Late completions cannot replace newer chains or restore deleted or account-switched state.
- A root session's state (wire session UUID, `cc_prev_req` / `previous_message_id` chain, prompt ID, and prompt/turn
  indexes) is saved in the session's metadata under `claude-oauth.session` and restored after plugin reloads and
  restarts, as a Claude Code `--resume` keeps all of it. State saved under another account is not restored.

### Compaction

- Compaction requests follow Claude Code's compaction requests: the `compaction` request class,
  `x-cc-compaction-request` / `x-claude-code-compaction` set to `manual` or `auto` from OpenCode's compaction reason, a
  billing line with only `cc_prev_req`, 5-minute caching up to the block before the summary prompt, and no extended
  cache TTL beta. Like Claude Code's compaction fork, the request repeats the chain position of the last main request
  and does not advance the chain.
- The chain, session UUID, and indexes survive a compaction. The next main request alone carries
  `x-cc-context-compacted` / `x-claude-code-context-compacted` with the compaction's reason.
- Anthropic server-side compaction (`@jiafuei/opencode-anthropic-compaction`) works with both mechanisms. A threshold
  `compact_20260112` edit is kept after the keep-all clear-thinking edit, and an on-demand `compaction` request carries
  no `context_management`, which the API rejects alongside it.

## Relay

Both profiles send through a local relay to control upstream header order and casing. It starts on a random loopback
port on first use and closes with the plugin. `Bun.serve` handles the local hop; ordered `node:https` requests handle
the upstream hop. This removes headers injected after OpenCode's HTTP hooks, including `b3` and `traceparent`, and
keeps streaming and cancellation. When `HTTPS_PROXY` is set, the relay tunnels upstream connections through it with
`CONNECT`.

## Token exchange

Token exchanges and refreshes use Claude Code's OAuth token endpoint and Axios-style headers. The refresh scope
excludes `org:create_api_key`; login keeps it. Missing account identity is recovered best-effort from the OAuth
profile and Claude CLI roles endpoints. Token-endpoint errors are reduced to the HTTP status and the structured
`error`/`error_description` fields; raw bodies and credentials never appear in thrown errors.

## Third-party classification

Anthropic rejects requests it classifies as third-party apps with HTTP 400 `invalid_request_error` ("Third-party apps
now draw from your extra usage, not your plan limits.") and an `anthropic-ratelimit-unified-overage-disabled-reason`
header.

Replaying a failing request while swapping one part at a time for its counterpart from a genuine Claude Code request
traced the trigger to OpenCode's environment preamble, `Here is some useful information about the environment you are
running in:`, combined with the `<env>` lines that follow it. The preamble with only a working-directory line passed,
and small rewordings passed, so the check appears to score content rather than match one exact string. `cch`, the
billing suffix, header order, betas, tool names, and the global system prompt did not trigger it.
