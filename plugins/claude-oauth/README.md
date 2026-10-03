# @jiafuei/opencode-claude-oauth

Use your Claude Pro/Max subscription in OpenCode. The plugin adds a **Claude Pro/Max** login to the built-in
`anthropic` integration and sends requests the way Claude Code does, so they draw from your plan limits instead of
API billing. OpenCode's API-key methods for Anthropic are unaffected.

## Install

```json
{
  "plugins": ["@jiafuei/opencode-claude-oauth"]
}
```

Requires OpenCode ≥ 2.0.15 and [Bun](https://bun.sh) (OpenCode's runtime).

## Login

Connect the **Anthropic** integration and choose **Claude Pro/Max**. Claude's sign-in page opens in your browser;
after login, paste the authorization code it shows (`code#state` or the full redirect URL also work). The login
attempt expires after 5 minutes.

OpenCode stores the credential and refreshes it before it expires. The connection is labeled with your account email.
The login typically stays valid for around 30 days; when a refresh fails with `invalid_grant`, the error asks you to
reconnect.

While the Claude Pro/Max connection is active, Anthropic model costs show as zero, since usage is billed to the
subscription.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `spoofingProfile` | `"cli" \| "sdk-cli"` | `"sdk-cli"` | Which Claude Code client requests imitate. |
| `attributionHeader` | `boolean` | `true` | Send Claude Code's billing header. The rest of the profile stays when false. |

| Profile | Imitates |
| --- | --- |
| `sdk-cli` | Claude Code run through the Claude Agent SDK |
| `cli` | The interactive Claude Code CLI |

```json
{
  "plugins": [
    { "package": "@jiafuei/opencode-claude-oauth", "options": { "spoofingProfile": "cli" } }
  ]
}
```

Both profiles imitate Claude Code 2.1.284: its headers, beta flags, system prompt identity, billing header, and tool
naming. See [DESIGN.md](DESIGN.md) for exactly what each request carries.

## Usage limits

Run `/anthropic-usage` (or **Anthropic usage** in the command palette) to see your plan's 5-hour and weekly
utilization with reset times, and whether extra usage is enabled.

## Server-side compaction

Anthropic server-side compaction through
[`@jiafuei/opencode-anthropic-compaction`](../anthropic-compaction/README.md) works over the subscription with both
of its mechanisms.

## Troubleshooting

If requests fail with HTTP 400 "Third-party apps now draw from your extra usage, not your plan limits.", Anthropic
has classified the request as coming from a third-party app. The known trigger was OpenCode's environment preamble,
which the plugin rewrites; a new failure most likely comes from content in the system prompt. To inspect the exact
requests sent, set `HTTPS_PROXY` to a debugging proxy and trust its CA through `NODE_EXTRA_CA_CERTS`.

## Limitations

- **Pinned to one Claude Code version.** The profiles must be updated as Claude Code changes. The TLS handshake is not
  Claude Code's.
- **Session requests only.** The rewrite covers the model requests OpenCode sends for sessions: agent turns,
  compaction, titles, and generation.
- **OpenCode owns retries.** Claude Code's own stream watchdogs, retry loop, and recovery paths are not reproduced.
- **No model filtering.** OpenCode's full Anthropic catalog stays visible. A model the subscription can't use fails
  when you call it.

## Storage

Credentials live only in OpenCode's credential store. The plugin keeps a random install ID in
`claude-oauth-install-id` under OpenCode's data directory (`~/.local/share/opencode` by default, mode 0600), used to
derive stable device IDs.

## Development

From the repo root:

```sh
bun install
bun test plugins/claude-oauth
bun run typecheck
```
