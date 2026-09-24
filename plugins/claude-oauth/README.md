# @jiafuei/opencode-claude-oauth

Claude Pro/Max subscription login for OpenCode. Adds an OAuth connection method
to the built-in `anthropic` integration and rewrites requests using selectable Agent SDK
CLI (default), Cowork desktop-agent, or ex-machina wire profiles. Profiles pin
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
| `spoofingProfile` | `"cowork" \| "sdk-cli" \| "ex-machina"` | `"sdk-cli"` | Selects the complete client wire profile. |
| `attributionHeader` | `boolean` | `true` | Controls the billing header and `cch`. Profile identity remains enabled when false. |

### Spoofing profiles

Each value selects one coherent wire identity:

| Value | Reference | Version / entrypoint | CCH |
| --- | --- | --- | --- |
| `"cowork"` | oh-my-pi Cowork | `2.1.246` / `claude-desktop` | Raw serialized-body attestation |
| `"sdk-cli"` | pi-black Agent SDK CLI | `2.1.224` / `sdk-cli` | Top-level model/max-token normalization |
| `"ex-machina"` | opencode-anthropic-auth production source | `2.1.87` / `sdk-cli` | SHA-256 of first user text |

```json
{
  "plugins": [
    { "package": "@jiafuei/opencode-claude-oauth", "options": { "spoofingProfile": "cowork" } }
  ]
}
```

The Cowork and SDK CLI profiles derive identity from this plugin's stable
install ID and the OAuth account. No profile reads `~/.claude.json` or
`CLAUDE_CONFIG_DIR`, and none emits billing request-chain fields
(`cc_prev_req` / `cc_prompt_id`).

`sdk-cli` and `cowork` replace the request headers with the profile's
complete header set. `ex-machina` keeps a strict inherited-header allowlist,
matching its source-derived behavior rather than synthesizing the other
profiles' fingerprint headers. All profiles are sent by OpenCode's own HTTP
client, so header order and casing are not controlled by the plugin.

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

## What it does

When the active Anthropic connection is the Claude Pro/Max OAuth credential,
the plugin's session `model.request`, `http.request`, and `http.response`
hooks apply the selected wire transform to `/v1/messages` calls. OpenCode
itself sends the `Authorization: Bearer …` token and the `?beta=true` query.

- Cowork and SDK CLI emit the selected profile's exact `User-Agent`, `x-app: cli`,
  a per-invocation `x-client-request-id` (stable across HTTP retries), the
  Stainless header set, and a stable per-session `X-Claude-Code-Session-Id`
  UUID. Cowork derives it deterministically from the install and OpenCode
  session so it survives restarts; SDK CLI keeps a process-local mapping.
  OpenCode's session-routing, project, and client headers are dropped.
  `ex-machina` pins its `User-Agent` while retaining only the bearer and
  safe inherited Anthropic/Stainless headers; it never emits the request ID
  or Claude session ID.
- Cowork and SDK CLI use a beta profile chosen per request shape (utility vs
  agent profile). Other caller betas are preserved and deduplicated after the
  profile's list, except `fine-grained-tool-streaming-2025-05-14` (absent from
  the profile), the SDK's obsolete `structured-outputs-2025-11-13` tool beta,
  and `context-1m-2025-08-07` (hard-429'd for subscription credentials).
- Cowork and SDK CLI body rewrite:
  - `system[0]` = `x-anthropic-billing-header` with the selected version and
    entrypoint. Cowork fingerprints the first user text like OMP; SDK CLI skips
    leading `<system-reminder>` text blocks. `system[1]` carries the selected
    Agent SDK identity. Cowork sanitizes OpenCode-identifying caller-system
    lines and uses a generic coding-agent opening. Cowork skips both fingerprint
    blocks for claude-3-5-haiku; SDK CLI does not.
  - `metadata.user_id` uses Cowork's `{device_id, session_id, account_uuid}`
    order and SDK CLI's `{device_id, account_uuid, session_id}` order. Device
    IDs derive deterministically from this plugin's install ID and the OAuth
    account, and existing valid CC attribution is preserved verbatim.
  - `max_tokens` clamped to ≤ 64000. Incoming `stream` is preserved as-is.
  - Cowork recursively normalizes tool schemas to Anthropic's accepted subset,
    selectively enables strict schemas for OMP's supported tool set, adds short
    prompt-cache breakpoints to the last two real messages, and applies
    model-aware thinking, sampling, forced-tool, and context-management rules.
    SDK CLI retains its top-level schema closure and pass-through cache behavior.
  - The redundant default `tool_choice:{type:"auto"}` is omitted.
- Cowork and SDK CLI use the selected `cch` algorithm from the profile table, patched over the
  `cch=00000` placeholder as five lowercase hex characters.
- Cowork and SDK CLI custom tool names are cloaked with one `_` prefix on the way out
  (definitions, `tool_choice`, historical
  `tool_use` blocks) and the exact prefix is stripped on the way in from the
  streaming SSE response (`content_block_start`), so OpenCode's logical tool
  names remain unchanged.
- `ex-machina` instead prefixes every tool definition and historical
  `tool_use` with `mcp_` plus an uppercase first character, leaves
  `tool_choice` and schemas untouched, and recursively uncloaks every parsed
  JSON `name` property in fragmentation-safe SSE responses. Its body
  transform sanitizes OpenCode prompt anchors, prepends the pinned Agent SDK
  identity, and otherwise preserves fields exactly: no metadata attribution,
  max-token normalization, schema closure, canonical ordering, or
  thinking/context mutation. Its required beta list is exactly
  `oauth-2025-04-20,interleaved-thinking-2025-05-14` before deduplicated caller
  betas.
- Anthropic model costs are reported as zero while the OAuth connection is
  active (subscription-billed); models reload when the credential switches.

### Token exchange

Token exchanges and refreshes use Claude Code's OAuth token endpoint and
Axios-style headers. Refresh scope excludes `org:create_api_key`; login retains
it. Missing Cowork identity is recovered best-effort from the Claude CLI
bootstrap endpoint; other profiles use the OAuth profile and Claude CLI roles
endpoints. Token-endpoint errors are reduced to the HTTP status and the
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
  Claude's TLS handshake, header order, or every runtime detail. Pinned
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
- **Bounded response rewriting.** A single SSE event larger than 1 MiB is
  rejected instead of buffered without limit.

## Development

From the repo root:

```sh
bun install
bun test plugins/claude-oauth
bun run typecheck
```
