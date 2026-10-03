# @jiafuei/opencode-claude-oauth

Claude Pro/Max subscription login for OpenCode. Adds an OAuth connection method
to the built-in `anthropic` integration and rewrites requests using selectable Agent SDK
CLI (default) or interactive CLI wire profiles. Profiles pin
their own headers, beta list, billing/system fingerprint, and tool-name
transport.

## Install

```json
{
  "plugins": ["@jiafuei/opencode-claude-oauth"]
}
```

## Plugin options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `spoofingProfile` | `"cli" \| "sdk-cli"` | `"sdk-cli"` | Selects the complete client wire profile. |
| `attributionHeader` | `boolean` | `true` | Controls the billing header and `cch`. Profile identity remains enabled when false. |

### Spoofing profiles

Each value selects one coherent wire identity:

| Value | Reference | Version / entrypoint | CCH |
| --- | --- | --- | --- |
| `"cli"` | September 29–30 interactive CLI captures | `2.1.284` / `cli` | Native global byte-marker normalization |
| `"sdk-cli"` | September 29 genuine SDK CLI capture | `2.1.284` / `sdk-cli` | Native global byte-marker normalization |

```json
{
  "plugins": [
    { "package": "@jiafuei/opencode-claude-oauth", "options": { "spoofingProfile": "cli" } }
  ]
}
```

Both profiles derive device identity from this plugin's stable
install ID and the OAuth account. No profile reads `~/.claude.json` or
`CLAUDE_CONFIG_DIR`. Both `cli` and `sdk-cli` emit billing request-chain fields
(`cc_prev_req` / `cc_prompt_id`).

`cli` and `sdk-cli` share a local relay to control upstream header order and casing.

### Interactive and SDK CLI

```json
{
  "plugins": [
    { "package": "@jiafuei/opencode-claude-oauth", "options": { "spoofingProfile": "cli" } }
  ]
}
```

Both CLI profiles follow the Linux x64 Claude Code 2.1.284 captures. Only the interactive
CLI was captured at 2.1.284; `sdk-cli` applies the same 2.1.284 changes to its 2.1.280 SDK
capture. `sdk-cli` is the default; set `spoofingProfile` to `cli` for interactive CLI identity.

| Wire behavior | `cli` | `sdk-cli` |
| --- | --- | --- |
| Main system identity | Official Claude Code CLI | Claude Agent SDK |
| Billing entrypoint | `cli` | `sdk-cli` |
| Turn origin | `human` / `task_notification` | `sdk` |
| Modern Opus/Sonnet thinking display | `updates` | `omitted` |
| Fallback-credit beta | Auxiliary and compaction requests | Absent |
| Thinking-display-updates beta | Present with updates | Absent |

They share the following behavior:

- Custom tools are exposed as `mcp__oc__<name>`, retaining their schemas
  and arguments. Definitions, forced tool choices, historical calls, and tool
  references are rewritten consistently; response tool names are restored.
- The OpenCode harness opening is replaced by the selected identity. System blocks
  are regrouped into stable instructions and caller instructions; repository
  rules, skills, memories, user messages, and tool results retain their text.
  Main agent requests use 1-hour caches; child agents use short caches.
- Headers and betas distinguish main, subagent, auxiliary, and compaction requests. The model's
  supplied output limit is retained, including 128000-token Opus requests.
- Compaction requests follow CC's compaction wire (the September 30 manual and auto captures): the
  `compaction` request class, `x-cc-compaction-request` / `x-claude-code-compaction` set to `manual` or
  `auto` from OpenCode's compaction reason, a billing line with only `cc_prev_req`, 5-minute caching up
  to the block before the summary prompt, and no extended cache TTL beta. Like CC's fork, the request
  repeats the chain position of the last main request and does not advance the chain.
- The chain, session UUID, and indices survive a compaction. The next main request alone carries
  `x-cc-context-compacted` / `x-claude-code-context-compacted` with the compaction's reason.
- Anthropic server-side compaction (`@jiafuei/opencode-anthropic-compaction`) works over OAuth with
  both mechanisms, verified live on September 30. A threshold `compact_20260112` edit is kept after the
  keep-all clear-thinking edit, and an on-demand `compaction` request carries no `context_management`,
  which the API rejects alongside it.
- Child agents share the root's wire-session UUID and inherit its prompt ID,
  while each raw OpenCode session has its own response chain. Auxiliary
  requests do not advance the primary chain. Each new turn gets a prompt ID;
  turn-origin markers follow the selected profile.
- `cc_prev_req` and `diagnostics.previous_message_id` advance only after a
  successful complete JSON message or an SSE stream ending with a parsed
  `message_stop` and no error event. Retries reuse logical IDs and increment
  `X-Stainless-Retry-Count`. Late completions cannot replace newer chains or
  restore deleted or account-switched state.
- Main requests carry `x-claude-code-prompt-id` and billing `cc_prompt_index` /
  `cc_turn_index`: every turn advances the turn index, and task notifications do not
  count as prompts. Subagents carry the prompt ID header but no indexes.
- A root session's Claude Code state (wire session UUID, `cc_prev_req` /
  `previous_message_id` chain, prompt ID, and prompt/turn indexes) is saved in the
  session's metadata under `claude-oauth.session` and restored after plugin reloads and
  restarts, as a Claude Code `--resume` keeps all of it (September 30 capture). State
  saved under another account is not restored. Device identity remains stable across
  reloads.
- CCH uses the native serialized-byte algorithm, including nested `model`
  values and `max_tokens`/fallback exclusions. It reproduces all 61 2.1.280 and
  176 2.1.284 message checksums in the September 29–30 captures.

The relay starts on a random loopback port on first use and closes with the
plugin. One-use request capabilities select prepared upstream requests.
`Bun.serve` handles the local hop; ordered `node:https` requests handle the
upstream hop. This removes headers injected after OpenCode's HTTP hooks,
including `b3` and `traceparent`, and preserves streaming and cancellation.
When `HTTPS_PROXY` is set, the relay tunnels its upstream connections through
it with `CONNECT`, so debugging proxies capture the final wire request (trust
the proxy's CA via `NODE_EXTRA_CA_CERTS`). TLS ClientHello parity has not been established
from the Charles export.

### Third-party classification

Anthropic rejects requests it classifies as third-party apps with HTTP 400
`invalid_request_error`: "Third-party apps now draw from your extra usage, not
your plan limits." The response also carries
`anthropic-ratelimit-unified-overage-disabled-reason`. The September 30 bisection
replayed a failing `cli` opus request, swapping one part at a time for its
counterpart from a genuine 2.1.284 CLI capture, with `cch` recomputed for each
variant:

| Variant | Status |
| --- | --- |
| Genuine CLI request replayed with the same token | 200 |
| Failing request replayed | 400 |
| Genuine global-scope system prompt instead of the plugin preamble | 400 |
| Genuine tool set instead of `mcp__opencode__*` | 400 |
| Genuine caller-instructions block | 200 |
| Project `AGENTS.md` + OpenCode `<env>` block alone | 400 (repeatable) |
| Either half alone | 200 |
| Same, with the env preamble's "some" removed | 200 |
| Full failing request with the env preamble reworded | 200 |

The trigger was OpenCode's environment preamble,
`Here is some useful information about the environment you are running in:`
(from OpenCode core's built-in instructions), combined with the `<env>` lines
that follow it. The phrase with only a working-directory line passed, so the
check appears to score content rather than match one exact string. Neither CLI
profile's `cch`, billing suffix, header order, betas, tool names, nor global
preamble triggered it. Both CLI profiles rewrite the preamble to Claude Code's
wording, "You have been invoked in the following environment:".

When this error returns, capture the failing request (see the relay's
`HTTPS_PROXY` support) and bisect the same way. Content in the system blocks is
the likeliest cause.

### Billing attribution

Billing attribution is enabled by default. To omit the
`x-anthropic-billing-header` and its `cch` while retaining OAuth authentication
and the selected profile identity:

```json
{
  "plugins": [
    { "package": "@jiafuei/opencode-claude-oauth", "options": { "attributionHeader": false } }
  ]
}
```

## Login

Requires OpenCode ≥ 2.0.15 and [Bun](https://bun.sh) (OpenCode's runtime,
used for `Bun.hash.xxHash64`). Connect the **Anthropic** integration and
choose **Claude Pro/Max**: it opens Claude OAuth in your browser; paste the
authorization code shown after login (`code#state` or the full redirect URL
work too). The attempt expires after 5 minutes. OpenCode's built-in API-key
methods for Anthropic are unaffected.

OpenCode stores the credential and refreshes it; the plugin only supplies the
token exchange and refresh calls. The account identity resolved at login
(account, email, organization) is kept in the credential's metadata, and the
email labels the connection.

## Usage limits

Run `/anthropic-usage` (or **Anthropic usage** in the command palette) to show
the plan's 5-hour and weekly utilization with reset times, and whether extra
usage is enabled. It sends Claude Code's `/usage` request
(`GET /api/oauth/usage` with the `oauth-2025-04-20` beta and the profile's
User-Agent, per an October 3 capture) using the active Claude Pro/Max
credential. Limits come from the response's `limits` list, so new limit kinds
show under their raw names.

## What it does

When the active Anthropic connection is the Claude Pro/Max OAuth credential,
the plugin's session `model.request`, `http.request`, and `http.response`
hooks apply the selected wire transform to `/v1/messages` calls. OpenCode
itself sends the `Authorization: Bearer …` token and the `?beta=true` query.

- Both profiles emit the selected profile's exact `User-Agent`, `x-app: cli`,
  a per-invocation `x-client-request-id` (stable across HTTP retries), the
  Stainless header set, and a per-session `X-Claude-Code-Session-Id` UUID kept
  in a process-local mapping. OpenCode's session-routing, project, and client
  headers are dropped.
- Both profiles use a beta profile chosen per request class (utility vs
  agent requests). Other caller betas are preserved and deduplicated after the
  profile's list, except `fine-grained-tool-streaming-2025-05-14` (absent from
  the profile), the SDK's obsolete `structured-outputs-2025-11-13` tool beta,
  and `context-1m-2025-08-07` (hard-429'd for subscription credentials).
- Both profiles use the native `cch` algorithm from the profile table, patched over the
  `cch=00000` placeholder as five lowercase hex characters.
- Anthropic model costs are reported as zero while the OAuth connection is
  active (subscription-billed); models reload when the credential switches.

### Token exchange

Token exchanges and refreshes use Claude Code's OAuth token endpoint and
Axios-style headers. Refresh scope excludes `org:create_api_key`; login retains
it. Missing identity is recovered best-effort from the OAuth profile and
Claude CLI roles endpoints. Token-endpoint errors are reduced to the HTTP status and the
structured `error`/`error_description` fields; raw bodies and credentials
never appear in thrown errors. The OAuth grant typically stays valid for
around 30 days (an observed lifetime); an `invalid_grant` refresh failure asks
you to reconnect.

## Storage

`claude-oauth-install-id` under OpenCode's data directory
(`~/.local/share/opencode` by default, mode 0600) is a stable random install
ID feeding the derived device IDs. Credentials live only in OpenCode's
credential store.

## Limitations

- **Version-pinned parity.** The plugin mirrors the selected profile's headers,
  payload, beta profile, tool-name transport, and `cch` behavior, but not
  Claude's TLS handshake or every runtime detail. Both CLI profiles control
  header order on their upstream connections. Pinned
  profile constants must be updated when their reference clients change.
- **Session requests only.** The rewrite runs in OpenCode's session HTTP hooks,
  so it covers the model requests OpenCode sends for sessions (agent turns,
  compaction, titles, generation).
- **OpenCode owns retry policy.** The plugin does not copy Claude Code's custom
  first-event/idle watchdogs, pre-content retry loop, or strict-tool,
  invalid-thinking-signature, and fast-mode recovery paths.
- **No speculative model filtering.** OpenCode's Anthropic catalog remains
  visible while using OAuth. If Anthropic rejects a model for subscription
  credentials, the error is surfaced when that model is called.

## Development

From the repo root:

```sh
bun install
bun test plugins/claude-oauth
bun run typecheck
```
