# @jiafuei/opencode-antigravity-oauth

Google [Antigravity](https://antigravity.google) OAuth for [OpenCode](https://opencode.ai). Sign in with a personal Google account and run **Gemini, Claude, and GPT-OSS models** through Google's Cloud Code Assist endpoints on the Antigravity free tier — no API key, no billing account.

Inference and control-plane requests use the captured Antigravity CLI identity. OAuth login still uses the earlier IDE identity.

> This plugin is an unofficial client. Availability, quotas, and model access are controlled entirely by Google's backend and can change or break at any time. Use is subject to Google's terms of service.

## Installation

```sh
opencode plugin add @jiafuei/opencode-antigravity-oauth
```

The plugin registers the `google-antigravity` integration and provider. The provider becomes available once you connect an account.

## Login

1. Connect the **Google Antigravity** integration in OpenCode.
2. Choose a sign-in method:
   - **Antigravity (browser)** — opens Google sign-in in your browser and completes login through a local callback server. Keep OpenCode open until the redirect completes.
   - **Antigravity (paste code)** — use this when the browser cannot reach OpenCode's machine (remote OpenCode, container, or restricted port forwarding). After sign-in the browser shows “cannot connect”; copy the complete `http://localhost:<port>/oauth-callback?...` URL from its address bar and paste it into OpenCode. Start a fresh paste-code login first; a redirect from an older attempt is rejected.
3. On first login the plugin sets up the Antigravity free tier for the account if it has none yet.

If Google requires account verification, the error shows the verification URL. Complete it, then sign in again (or retry the request, if it happened during inference).

OpenCode stores the credential and refreshes it before it expires. The connection is labeled with your account email.

## Supported models

The model list is fetched from Google at startup and whenever the active connection changes, in the order the native model picker shows. If that fails, the plugin falls back to this snapshot:

| Model | Variants (wire ids) | Context | Output | Input |
| --- | --- | --- | --- | --- |
| `gemini-4-argon` | low / medium / high | 1M | 65,536 | text+image |
| `gemini-4-hydrogen` | low / medium / high / xhigh | 1M | 262,144 | text+image |
| `gemini-3.8-flash` | low / medium / high (`gemini-3.8-flash-<tier>`) | 1M | 65,536 | text+image |
| `claude-opus-5-5` | low / medium / high (`claude-opus-5-5-<tier>`) | 1M | 128,000 | text+image |
| `claude-sonnet-5-5` | low / medium / high (`claude-sonnet-5-5-<tier>`) | 1M | 128,000 | text+image |
| `gpt-oss-120b` | — (`gpt-oss-120b-medium`) | 131k | 32,768 | text |

Models with Low/Medium/High/XHigh tiers become one OpenCode model with a variant per available tier; the highest available tier is the default. Models marked disabled by Google cannot be used. The snapshot includes disabled Gemini 4 Carbon, which the capture describes as Ultra-only. Unknown tier names remain separate models, and unknown numeric thinking levels pass through unchanged.

Each tier's thinking level is fixed by Google's catalog, so OpenCode's reasoning controls and sampling settings (temperature, topP, and so on) have no effect on agent requests. Title requests preserve OpenCode's selected model and settings. All models report zero cost. The November 13 catalog announces GPT-OSS removal on November 18, 2026.

## Configuration

```jsonc
// opencode.json
{
  "plugins": [
    { "package": "@jiafuei/opencode-antigravity-oauth", "options": { "endpointMode": "auto", "trajectoryAcls": false, "metrics": false } }
  ]
}
```

**Options**

- `endpointMode`: `"auto"` (default) starts each session on Google's daily Cloud Code Assist endpoint and moves it to the sandbox endpoint (or back) after a failed response, so OpenCode's retry lands on the other one. `"production"` pins the daily endpoint; `"sandbox"` pins the sandbox endpoint.
- `trajectoryAcls`: `true` sends the native client's `writeTrajectoryAcls` call before a session's first request. Default `false`.
- `metrics`: `true` sends the native client's `recordCodeAssistMetrics` call after each response. Default `false`.

**Native compaction**

```jsonc
{
  "providers": {
    "google-antigravity": { "settings": { "compaction": { "type": "native" } } }
  }
}
```

With this setting the plugin compacts like the native client: it summarizes with the native prompt and continues from the native resume message, which every model can read, so compaction carries over model switches. Without it, OpenCode's own summary compaction runs. Native compaction needs an OpenCode build that includes the experimental `experimental.compaction.native` hook; on other builds it fails as unsupported.

**Environment overrides**

| Variable | Meaning | Default |
| --- | --- | --- |
| `OPENCODE_ANTIGRAVITY_CLI_VERSION` | Reported CLI version | `1.5.7` |
| `OPENCODE_ANTIGRAVITY_CLI_BUILD` | Reported CLI build | `1019769835` |
| `OPENCODE_ANTIGRAVITY_VERSION` | IDE login and metrics version | `2.5.5` |
| `OPENCODE_ANTIGRAVITY_OS` | Reported `os_type` | CLI `linux`; IDE login and metrics `windows` |
| `OPENCODE_ANTIGRAVITY_ARCH` | Reported `arch` | `amd64` |

The request User-Agent defaults to the captured Linux CLI build `1019769835` with `auth_method=consumer`, regardless of your platform. CLI version and build overrides are independent of the IDE version. OS and architecture overrides apply to both identities.

## Web search

While an Antigravity connection exists, the plugin registers an `antigravity` web search provider for OpenCode's built-in `websearch` tool. It uses the first discovered `webSearchModelIds` entry, falling back to `gemini-3.5-flash-lite`, and returns each source with the parts of the answer it supports.

## Usage limits

Run `/antigravity-usage` (or **Antigravity usage** in the command palette) to see each model group's 5-hour and weekly quota as percent used, with reset times.

## Limitations

- The pinned client versions and snapshot model table age as Google ships new clients. CLI version and build have separate environment overrides.
- Requests match the native client's content, not its network-level details (header normalization by OpenCode's HTTP client, TLS handshake).

See [DESIGN.md](DESIGN.md) for exactly what each request carries and the remaining differences from the native client.

## Attribution

This implementation follows the behavior of [oh-my-pi](https://github.com/oh-my-pi/oh-my-pi)'s local Google Antigravity provider (`google-antigravity` OAuth flow, Cloud Code Assist provisioning), updated against captures of the native Antigravity IDE. All trademarks belong to their respective owners.
