# @jiafuei/opencode-claude-oauth

Claude Pro/Max subscription login for OpenCode. Adds OAuth auth methods to the
built-in `anthropic` provider and rewrites requests using selectable Claude
CLI, Cowork desktop-agent, or Agent SDK CLI wire profiles. This includes
ordered HTTP/1.1 headers, beta profiles, billing/system fingerprints,
`metadata.user_id` attribution, tool-name transport, and `cch` attestation.

## Install

```json
{
  "plugin": ["@jiafuei/opencode-claude-oauth"]
}
```

## Plugin options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `spoofingProfile` | `"cli" \| "cowork" \| "sdk-cli"` | `"cli"` | Selects the complete client wire profile. |
| `attributionHeader` | `boolean` | `true` | Controls the billing header and `cch`, plus CLI request-chain fields. Profile identity remains enabled when false. |

### Spoofing profiles

Each value selects one coherent wire identity:

| Value | Reference | Version / entrypoint | CCH and request chain |
| --- | --- | --- | --- |
| `"cli"` | Claude Code CLI | `2.1.241` / `cli` | Claude CLI normalization; `cc_prev_req` and `cc_prompt_id` enabled |
| `"cowork"` | oh-my-pi Cowork | `2.1.220` / `claude-desktop` | Raw serialized-body CCH; no billing request chain |
| `"sdk-cli"` | pi-black Agent SDK CLI | `2.1.224` / `sdk-cli` | Top-level model/max-token normalization; no billing request chain |

```json
{
  "plugin": [
    ["@jiafuei/opencode-claude-oauth", { "spoofingProfile": "cowork" }]
  ]
}
```

The `sdk-cli` profile derives identity from this plugin's stable install ID and
the OAuth account. It never reads `~/.claude.json` or `CLAUDE_CONFIG_DIR`.

All profiles use the custom ordered HTTPS transport. CLI and SDK CLI use the
header order observed in genuine Claude CLI captures; Cowork uses OMP's
desktop-agent order. Direct HTTPS uses HTTP/1.1 and preserves header casing and
order. A configured proxy intentionally falls back to the runtime fetch so the
proxy is honored, which means exact transport ordering is not retained there.

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

In CLI mode this also disables `cc_prev_req` and `cc_prompt_id` generation and
persistence. Cowork and SDK CLI never emit those request-chain fields.

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

This setting is optional for the default CLI profile, which removes the
SDK-generated `eager_input_streaming` field at the wire boundary. Cowork and
SDK CLI preserve the Agent SDK field.

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
loader installs the ordered transport for `/v1/messages` and
`/v1/messages/count_tokens` calls to the official `api.anthropic.com`
endpoint:

- `Authorization: Bearer sk-ant-oat01-…` (never `x-api-key`) and
  `?beta=true` on `/v1/messages`
- The selected profile's exact `User-Agent`, `x-app: cli`,
  a per-invocation `x-client-request-id` (stable across SDK retries of the
  same request, fresh per logical invocation), the Stainless header set, and
  `X-Claude-Code-Session-Id` per session; OpenCode's internal session-routing
  headers are stripped before dispatch
- The selected client's beta profile, chosen per request shape (utility vs
  agent profile).
  SDK/caller-supplied betas are preserved and deduplicated after it, except
  `fine-grained-tool-streaming-2025-05-14` (absent from Claude Code's profile),
  the SDK's obsolete `structured-outputs-2025-11-13` tool beta, and
  `context-1m-2025-08-07` (hard-429'd for subscription credentials).
- Body rewrite:
  - `system[0]` = `x-anthropic-billing-header` with the selected version and
    entrypoint; its prompt fingerprint skips leading `<system-reminder>` text
    blocks. `system[1]` carries the selected CLI or Agent SDK identity. CLI and
    Cowork skip both for claude-3-5-haiku; SDK CLI does not.
  - `metadata.user_id` = `{device_id, account_uuid, session_id}` JSON envelope
    with a stable per-install device ID and a UUIDv4 session ID persisted per
    OpenCode conversation; existing valid CC attribution is preserved verbatim
  - `max_tokens` clamped to ≤ 64000; incoming `stream` is preserved as-is
  - CLI omits `thinking.display` and SDK `eager_input_streaming`, normalizes
    one-hour cache breakpoints to the final two caller system blocks and the
    final message block (never tools), globally scopes the first system
    breakpoint, and preserves incoming context edits while adding
    clear-thinking first. Cowork and SDK CLI preserve Agent SDK fields and
    caches and replace active context edits with one keep-all clear-thinking
    edit.
  - The redundant default `tool_choice:{type:"auto"}` is omitted and tool input
    schemas are closed with top-level `additionalProperties:false`.
- The selected `cch` algorithm from the profile table, patched over the
  `cch=00000` placeholder as five lowercase hex characters.
- In CLI mode, billing state follows a conversation: `cc_prompt_id` remains
  stable for the same OpenCode message, and the next successful request includes
  the prior Anthropic `request-id` as `cc_prev_req`. Request chains persist across
  OpenCode restarts and are shared safely by concurrent processes; generation
  fencing prevents late responses from restoring state cleared by compaction,
  deletion, or an auth transition. If SQLite is unavailable, inference
  continues with process-local tracking but restart/cross-process continuity is
  temporarily unavailable. Cowork and SDK CLI do not emit or persist this
  request chain.
- Token-count requests use the selected profile's beta and header set,
  omit `X-Stainless-Timeout`, preserve their body shape apart from tool
  normalization, and are not response-rewritten
- Custom tool names are cloaked with one `_` prefix on the way out
  (definitions, `tool_choice`, historical
  `tool_use` blocks) and the exact prefix is stripped on the way in through both
  streaming SSE (`content_block_start`) and non-streaming JSON responses, so
  OpenCode's logical tool names remain unchanged
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
it. Missing login identity is recovered best-effort from the OAuth profile and
Claude CLI roles endpoints.

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

- `claude-oauth-install-id` — stable random install ID feeding the device ID
- `claude-oauth/grants.json` — authorization timestamps only (never tokens)
- `claude-oauth/claude-oauth.db` — SQLite session state for durable
  `cc_prev_req` chains; stores OpenCode session IDs, hashed credential keys,
  Anthropic request IDs, and generation/sequence/timestamp metadata, never
  tokens
- `claude-oauth/grants.lock/` — transient cross-process sidecar lock
- `claude-oauth/refresh-lease/<hash>/` — transient cross-process refresh lease

Credentials themselves live only in OpenCode's auth store. OpenCode's OAuth
schema persists just `accountId`; email/org identity resolved during login is
transient only — there is deliberately no second credential store.

## Limitations

- **Version-pinned parity.** The plugin mirrors the selected profile's headers,
  payload, beta profile, tool-name transport, and `cch` behavior. Direct HTTPS
  reproduces the captured HTTP/1.1 header order, but not Claude's TLS handshake
  or every runtime detail. Proxy fallback uses runtime fetch. Pinned profile
  constants must be updated when their reference clients change.
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
