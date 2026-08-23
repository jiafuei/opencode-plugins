# @jiafuei/opencode-claude-oauth

Claude Pro/Max subscription login for OpenCode. Adds OAuth auth methods to the
built-in `anthropic` provider and rewrites requests to carry Claude Code
(`claude-cli`) subscription traffic characteristics — headers, beta profile,
billing/system fingerprint, `metadata.user_id` attribution, and the `cch`
attestation. The application-layer behavior is matched against Claude Code
2.1.228; byte-for-byte equivalence is not claimed because Bun owns the HTTP
transport and header serialization.

## Install

```json
{
  "plugin": ["@jiafuei/opencode-claude-oauth"]
}
```

Billing attribution is enabled by default. To omit the
`x-anthropic-billing-header` and its `cch`, `cc_prev_req`, and `cc_prompt_id`
fields while retaining OAuth authentication and the Claude CLI identity:

```json
{
  "plugin": [
    ["@jiafuei/opencode-claude-oauth", { "attributionHeader": false }]
  ]
}
```

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
loader installs a custom fetch for `/v1/messages` and
`/v1/messages/count_tokens` calls to the official `api.anthropic.com`
endpoint:

- `Authorization: Bearer sk-ant-oat01-…` (never `x-api-key`) and
  `?beta=true` on `/v1/messages`
- `User-Agent: claude-cli/2.1.228 (external, cli)`, `x-app: cli`,
  a per-invocation `x-client-request-id` (stable across SDK retries of the
  same request, fresh per logical invocation), the Stainless header set, and
  `X-Claude-Code-Session-Id` per session
- The Claude Code beta profile (`oauth-2025-04-20`, interleaved thinking,
  redacted thinking, context management, and related features), chosen per
  request shape (utility vs agent profile);
  SDK/caller-supplied betas are preserved and deduplicated after it.
  `context-1m-2025-08-07` is always stripped — subscription credentials get
  hard-429'd on beta-gated 1M requests.
- Body rewrite:
  - `system[0]` = `x-anthropic-billing-header` with the CC version fingerprint,
    `system[1]` = `You are Claude Code, Anthropic's official CLI for Claude.`
    (both skipped for claude-3-5-haiku)
  - `metadata.user_id` = `{device_id, account_uuid, session_id}` JSON envelope
    with a stable per-install device ID and a UUIDv4 session ID persisted per
    OpenCode conversation; existing valid CC attribution is preserved verbatim
  - `max_tokens` clamped to ≤ 64000; incoming `stream` is preserved as-is
  - `context_management`: incoming edits are preserved; when thinking is on,
    exactly one `{type:"clear_thinking_20251015", keep:"all"}` edit is
    guaranteed first
- The `cch` attestation: XXHash64 over the canonical final body after blanking
  model values and omitting `fallbacks`, `fallback_credit_token`, and
  `max_tokens` (low 20 bits as 5 hex chars), patched over the `cch=00000`
  placeholder
- Billing state follows a conversation: `cc_prompt_id` remains stable for the
  same OpenCode message, and the next successful request includes the prior
  Anthropic `request-id` as `cc_prev_req`. Request chains persist across
  OpenCode restarts and are shared safely by concurrent processes; generation
  fencing prevents late responses from restoring state cleared by compaction,
  deletion, or an auth transition. If SQLite is unavailable, inference
  continues with process-local tracking but restart/cross-process continuity is
  temporarily unavailable
- Token-count requests use Claude Code's dedicated beta profile and header set,
  omit `X-Stainless-Timeout`, preserve their body shape apart from tool-name
  cloaking, and are not response-rewritten
- Custom tool names are cloaked with a `_` prefix on the way out (definitions,
  `tool_choice`, historical `tool_use` blocks) and stripped back on the way in
  through both streaming SSE (`content_block_start`) and non-streaming JSON
  responses, so Anthropic's tool-name rules are satisfied without changing
  OpenCode's logical tool names
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
  network activity — use Anthropic API-key auth for gateways/proxies instead.
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

- **Best-effort application-layer parity.** The plugin mirrors the headers,
  payload, beta profile, tool-name transport, and `cch` behavior tested against
  Claude Code 2.1.228. It does not reproduce Claude Code's TLS handshake, ALPN,
  HTTP stack, exact header order, or every future client release. The pinned
  version and fingerprint constants will need updates as the upstream client
  changes.
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
