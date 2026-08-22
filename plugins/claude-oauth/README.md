# @jiafuei/opencode-claude-oauth

Claude Pro/Max subscription login for OpenCode. Adds OAuth auth methods to the
built-in `anthropic` provider and rewrites requests to carry Claude Code
(`claude-cli`) subscription traffic characteristics — headers, beta profile,
billing/system fingerprint, `metadata.user_id` attribution, and the `cch`
attestation — mirroring [oh-my-pi](https://github.com/can1357/oh-my-pi)'s
Cowork transport. Parity with that transport is what's tested here; byte-for-
byte equivalence with any particular Claude Code build is not claimed.

## Install

```json
{
  "plugin": ["@jiafuei/opencode-claude-oauth"]
}
```

Requires OpenCode ≥ 1.18.20 and [Bun](https://bun.sh) (OpenCode's runtime,
used for `Bun.hash.xxHash64`). Then run `opencode auth login`, pick
**Anthropic**, and choose:

- **Claude Pro/Max (browser)** — opens claude.ai OAuth in your browser; a
  loopback callback server on 127.0.0.1 (port 54545, falling back to an
  ephemeral port if busy) completes the flow automatically.
- **Claude Pro/Max (paste code)** — headless flow; paste the redirect URL or
  just the authorization code (`code#state` works too).
- **Anthropic API key** — plain API-key auth, untouched by this plugin.

Both OAuth flows share a 5-minute timeout per login attempt; concurrent logins
are keyed by their `state` parameter so they never interfere.

## What it does

When the stored anthropic credential is an OAuth grant, the plugin's auth
loader installs a custom fetch that rewrites every `/v1/messages` call toward
the official `api.anthropic.com` endpoint (that scope is what's supported and
tested):

- `Authorization: Bearer sk-ant-oat01-…` (never `x-api-key`) and
  `?beta=true` on `/v1/messages`
- `User-Agent: claude-cli/2.1.220 (external, claude-desktop)`, `x-app: cli`,
  retry-stable `x-client-request-id`, the Stainless header set, and
  `X-Claude-Code-Session-Id` per session
- The Claude Code beta profile (`claude-code-20250219`, interleaved thinking,
  context management, …), chosen per request shape (utility vs agent profile);
  SDK/caller-supplied betas are preserved and deduplicated after it.
  `context-1m-2025-08-07` is always stripped — subscription credentials get
  hard-429'd on beta-gated 1M requests.
- Body rewrite:
  - `system[0]` = `x-anthropic-billing-header` with the CC version fingerprint,
    `system[1]` = the Agent SDK instruction (both skipped for claude-3-5-haiku)
  - `metadata.user_id` = `{device_id, session_id, account_uuid}` JSON envelope
    with a stable per-install device ID; existing valid CC attribution is
    preserved verbatim
  - `max_tokens` clamped to ≤ 64000; incoming `stream` is preserved as-is
  - `context_management`: incoming edits are preserved; when thinking is on,
    exactly one `{type:"clear_thinking_20251015", keep:"all"}` edit is
    guaranteed first
- The `cch` attestation: XXHash64 over the final body (seed
  `0x4d659218e32a3268`, low 20 bits as 5 hex chars) patched byte-wise over the
  `cch=00000` placeholder
- Custom tool names are cloaked with a `_` prefix on the way out (definitions,
  `tool_choice`, historical `tool_use` blocks) and stripped back on the way in
  through both streaming SSE (`content_block_start`) and non-streaming JSON
  responses, so Anthropic's tool-name rules are satisfied without changing
  OpenCode's logical tool names
- Model costs reported as zero while on OAuth (subscription-billed)

### Token refresh

Access tokens are refreshed ~5 minutes before expiry. Refreshes dedupe across
loader instances via an in-process promise map, and across processes via an
exclusive filesystem lease (60s stale-holder takeover, bounded 10s wait) under
OpenCode's data directory — rotation means only one winner per credential.
Rotated tokens are persisted back into OpenCode's auth store before use.

Auth transitions are handled live: switching to API-key auth or logging out
while a session runs switches the request path accordingly (no OAuth
fingerprinting on the API-key path).

## Grant lifetime

Like Claude Code itself, the OAuth grant has an absolute **~30-day lifetime**
(observed heuristic). Refresh-token rotation does not extend it. The plugin
records authorization time at login in a sidecar file and logs a warning once
the grant reaches ~28 days; terminal refresh failures (`invalid_grant`) report
the observed grant age and ask you to re-login.

## Storage

Under OpenCode's data directory (`~/.local/share/opencode` by default), all
files written with mode 0600:

- `claude-oauth-install-id` — stable random install ID feeding the device ID
- `claude-oauth/grants.json` — authorization timestamps only (never tokens)
- `claude-oauth/refresh-lease/<hash>/` — transient cross-process refresh lease

Credentials themselves live only in OpenCode's auth store. OpenCode's OAuth
schema persists just `accountId`; email/org identity resolved during login is
transient only — there is deliberately no second credential store.

## Development

From the repo root:

```sh
bun install
bun test plugins/claude-oauth
bun run typecheck
```
