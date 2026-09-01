# @jiafuei/opencode-claude-oauth

Claude Pro/Max subscription login for OpenCode. Adds OAuth auth methods to the
built-in `anthropic` provider and rewrites requests using selectable Agent SDK
CLI (default), Cowork desktop-agent, or ex-machina wire profiles. Profiles pin
their own headers, beta list, billing/system fingerprint, and tool-name
transport.

## Install

```json
{
  "plugin": ["@jiafuei/opencode-claude-oauth"]
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
  "plugin": [
    ["@jiafuei/opencode-claude-oauth", { "spoofingProfile": "cowork" }]
  ]
}
```

The Cowork and SDK CLI profiles derive identity from this plugin's stable
install ID and the OAuth account. No profile reads `~/.claude.json` or
`CLAUDE_CONFIG_DIR`, and none emits billing request-chain fields
(`cc_prev_req` / `cc_prompt_id`).

`sdk-cli` and `cowork` use the custom ordered HTTPS transport. `sdk-cli` uses
the header order observed in genuine Claude CLI captures; `cowork` uses OMP's
desktop-agent order. Direct HTTPS uses HTTP/1.1 and preserves header casing and
order. A configured proxy intentionally falls back to the runtime fetch so the
proxy is honored, which means exact transport ordering is not retained there.
`ex-machina` uses the runtime fetch and a strict inherited-header allowlist,
matching its source-derived behavior rather than synthesizing either ordered
profile's fingerprint headers.

### Billing attribution

Billing attribution is enabled by default. To omit the
`x-anthropic-billing-header` and its `cch` while retaining OAuth authentication
and the selected profile identity:

```json
{
  "plugin": [
    ["@jiafuei/opencode-claude-oauth", { "attributionHeader": false }]
  ]
}
```

### AI SDK request options

`toolStreaming` is an Anthropic AI SDK request option, not a provider
constructor option. Do not put it under `provider.anthropic.options`, where it
is ignored. It can be set at any request-option scope:

- Model: `provider.anthropic.models.<model-id>.options.toolStreaming`
- Agent: `agent.<agent-name>.options.toolStreaming`
- Variant: `provider.anthropic.models.<model-id>.variants.<variant-name>.toolStreaming`

For example, to disable it for one model:

```json
{
  "provider": {
    "anthropic": {
      "models": {
        "claude-opus-5": {
          "options": {
            "toolStreaming": false
          }
        }
      }
    }
  }
}
```

This setting is optional: the plugin preserves the Agent SDK
`eager_input_streaming` field on the wire for every profile.

Requires OpenCode ≥ 1.18.20 and [Bun](https://bun.sh) (OpenCode's runtime,
used for `Bun.hash.xxHash64`). Then run `opencode auth login`, pick
**Anthropic**, and choose:

- **Claude Pro/Max** — opens Claude OAuth in your browser; paste the
  authorization code shown after login (`code#state` works too).
- **Anthropic API key** — plain API-key auth, untouched by this plugin.

OAuth login has a 5-minute timeout per attempt. OpenCode keeps one pending
authorization per provider, so do not start multiple Anthropic login attempts
concurrently.

## What it does

When the stored anthropic credential is an OAuth grant, the plugin's auth
loader installs the selected wire transform for calls to the official
`api.anthropic.com` endpoint:

- `Authorization: Bearer sk-ant-oat01-…` (never `x-api-key`) and
  `?beta=true` on `/v1/messages`. `ex-machina` preserves an existing `beta`
  value and never adds the query to `/v1/messages/count_tokens`.
- Cowork and SDK CLI emit the selected profile's exact `User-Agent`, `x-app: cli`,
  a per-invocation `x-client-request-id` (stable across SDK retries), the
  Stainless header set, and a stable per-session `X-Claude-Code-Session-Id`
  UUID. Cowork derives it deterministically from the install and OpenCode
  session so it survives restarts; SDK CLI keeps a process-local mapping.
  OpenCode's internal session-routing headers are stripped before dispatch.
  `ex-machina` pins its `User-Agent` and bearer while retaining only
  safe inherited Anthropic/Stainless headers; it never emits the private
  request ID or Claude session ID.
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
- Cowork and SDK CLI token-count requests use the selected profile's beta and header set,
  omit `X-Stainless-Timeout`, preserve their body shape apart from tool
  normalization, and are not response-rewritten
- Cowork and SDK CLI custom tool names are cloaked with one `_` prefix on the way out
  (definitions, `tool_choice`, historical
  `tool_use` blocks) and the exact prefix is stripped on the way in through both
  streaming SSE (`content_block_start`) and non-streaming JSON responses, so
  OpenCode's logical tool names remain unchanged.
- `ex-machina` instead prefixes every tool definition and historical
  `tool_use` with `mcp_` plus an uppercase first character, leaves
  `tool_choice` and schemas untouched, and recursively uncloaks every parsed
  JSON `name` property in JSON and fragmentation-safe SSE responses. Its body
  transform sanitizes OpenCode prompt anchors, prepends the pinned Agent SDK
  identity, and otherwise preserves fields exactly: no metadata attribution,
  max-token normalization, schema closure, canonical ordering, or
  thinking/context mutation. Its required beta list is exactly
  `oauth-2025-04-20,interleaved-thinking-2025-05-14` before deduplicated caller
  betas.
- Model costs reported as zero while on OAuth (subscription-billed)

### Token refresh

Access tokens are refreshed ~5 minutes before expiry. Refreshes dedupe across
loader instances via an in-process promise map, and across processes via an
exclusive filesystem lease under OpenCode's data directory: a live holder is
waited on until its refresh lands, and a holder that crashes or remains
suspended is taken over after its lease record goes 120s stale. Before
persisting, the refresh re-checks that the stored
credential is still the grant it refreshed, so a concurrent logout or new
login is never overwritten. Rotation means only one winner per credential.
Rotated tokens are persisted back into OpenCode's auth store before use.
Token exchanges and refreshes use Claude Code's OAuth token endpoint and
Axios-style headers. Refresh scope excludes `org:create_api_key`; login retains
it. Missing Cowork identity is recovered best-effort from the Claude CLI
bootstrap endpoint; other profiles retain the OAuth profile and Claude CLI
roles recovery path.

Auth transitions are handled live: switching to API-key auth or logging out
while a session runs switches the request path accordingly (no OAuth
fingerprinting on the API-key path).

### Credential safety

- **Official endpoint only.** OAuth bearer tokens are attached exclusively to
  `https://api.anthropic.com` requests. HTTP, localhost, alternate hosts,
  credentials-in-URL, and custom baseURL destinations are rejected before any
  network activity. A forward proxy may be supplied to the official endpoint;
  custom gateways still require Anthropic API-key auth.
- **Validated token envelopes.** A 200 token response missing a nonempty
  `access_token` / `refresh_token` (login) or a finite positive `expires_in`
  fails before identity resolution, persistence, or dispatch.
- **Sanitized token errors.** Token-endpoint error bodies are read only up to
  16 KiB and reduced to the structured `error`/`error_description` fields plus
  the HTTP status — raw bodies and credentials never appear in thrown errors.
- **No OAuth residue on the API-key path.** When auth switches to an API key,
  the session marker header and any stale bearer are stripped and the real
  `x-api-key` set, leaving the ordinary SDK request untouched.

## Grant lifetime

The OAuth grant typically stays valid for around 30 days — an **observed**
lifetime, not a guaranteed protocol limit (matching Claude Code itself).
Refresh-token rotation does not extend it. The plugin records authorization
time at login in a sidecar file and logs a warning once the grant reaches ~28
days; terminal refresh failures (`invalid_grant`) report the observed grant
age and ask you to re-login.

## Storage

Under OpenCode's data directory (`~/.local/share/opencode` by default), all
files written with mode 0600:

- `claude-oauth-install-id` — stable random install ID feeding the derived device IDs
- `claude-oauth/grants.json` — authorization timestamps only (never tokens)
- `claude-oauth/grants.lock/` — transient cross-process sidecar lock
- `claude-oauth/refresh-lease/<hash>/` — transient cross-process refresh lease

Credentials themselves live only in OpenCode's auth store. OpenCode's OAuth
schema persists just `accountId`; email/org identity resolved during login is
transient only — there is deliberately no second credential store.

## Limitations

- **Version-pinned parity.** The plugin mirrors the selected profile's headers,
  payload, beta profile, tool-name transport, and `cch` behavior. Direct HTTPS
  reproduces captured HTTP/1.1 header order for Cowork and SDK CLI, but not
  Claude's TLS handshake or every runtime detail. Proxy fallback and
  `ex-machina` use runtime fetch. Pinned profile constants must be updated when
  their reference clients change.
- **Official endpoint only.** Subscription OAuth cannot be used through custom
  base URLs, enterprise gateways, or signing proxies. Those configurations
  must use API-key auth.
- **OpenCode owns retry policy.** The plugin does not copy Claude Code's custom
  first-event/idle watchdogs, pre-content retry loop, or strict-tool,
  invalid-thinking-signature, and fast-mode recovery paths. Requests use
  OpenCode and the Anthropic SDK's normal retry/error behavior.
- **No speculative model filtering.** OpenCode's Anthropic catalog remains
  visible while using OAuth. If Anthropic rejects a model for subscription
  credentials, the error is surfaced when that model is called rather than the
  plugin maintaining an unverified allowlist.
- **Host lifecycle limits.** OpenCode stores one pending authorization per
  provider and persists no organization UUID/name for OAuth. A live auth-type
  change can also leave model cost metadata at its previous value until the
  provider instance reloads, although request authentication switches safely.
- **Bounded response rewriting.** Tool-name uncloaking supports normal
  Anthropic SSE and JSON responses. A single SSE event larger than 1 MiB or a
  JSON response larger than the configured safety bound is rejected instead
  of buffered without limit.
- **Refresh recovery delay.** If a refresh owner crashes or is suspended,
  another process may wait up to the 120-second stale-lease threshold before
  taking over. This favors avoiding duplicate rotating-token refreshes over
  immediate recovery.

## Development

From the repo root:

```sh
bun install
bun test plugins/claude-oauth
bun run typecheck
```
