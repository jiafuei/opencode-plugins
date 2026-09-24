# Anthropic server-side compaction

Enables [Anthropic server-side compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) for supported Claude models in OpenCode.

The plugin adds Anthropic's `compact_20260112` context-management strategy to normal requests. When the trigger is reached, Anthropic summarizes the older context, returns a `compaction` block, and continues the response using the smaller context. OpenCode does not keep inline compaction blocks in the transcript, so the plugin records the latest block per session and passes it back on later requests.

## Install

```sh
opencode plugin add @jiafuei/opencode-anthropic-compaction
```

## Configuration

```json
{
  "plugins": [
    {
      "package": "@jiafuei/opencode-anthropic-compaction",
      "options": {
        "enabled": true,
        "threshold": "70%",
        "additionalProviders": ["my-anthropic-proxy"],
        "additionalModels": ["anthropic.claude-sonnet-4-6-v1:0"]
      }
    }
  ]
}
```

- `threshold` controls the input-token trigger. Use an absolute token count of at least `50000`, a percentage such as `"70%"`, or the fractional form `0.7` for 70% of the model context window. Relative values are clamped to Anthropic's 50,000-token minimum. The default is `"70%"`.
- `additionalProviders` enables provider IDs in addition to `anthropic`. Their models must still use the native Anthropic Messages package (`@ai-sdk/anthropic`, `@opencode/ai/providers/anthropic`, or `@opencode/ai/providers/anthropic-compatible`).
- `additionalModels` enables upstream or OpenCode model IDs in addition to Anthropic's documented model allowlist. This is useful for proxy and cloud-platform aliases.
- `instructions` replaces Anthropic's model-specific compaction prompt. When omitted, Anthropic uses its server-side default.

Restart OpenCode after installing the plugin or changing its configuration.

### Let Anthropic compact before OpenCode

OpenCode still runs its own automatic compaction. It compacts once the estimated prompt reaches `context - max(output limit, compaction.buffer)` (and `limit.input - compaction.buffer` when the model declares an input limit). Keep the plugin `threshold` well below that point so Anthropic compacts first. A larger `compaction.buffer` makes OpenCode compact earlier, so do not raise it above the gap between the plugin threshold and the context window. To leave compaction entirely to Anthropic, set `"compaction": { "auto": false }`; manual compaction and overflow recovery still use OpenCode's summarizer.

## Supported models

The documented model IDs are enabled by default:

- `claude-fable-5`
- `claude-mythos-5`
- `claude-mythos-preview`
- `claude-opus-5`
- `claude-opus-4-8`
- `claude-opus-4-7`
- `claude-opus-4-6`
- `claude-sonnet-5`
- `claude-sonnet-4-6`

Use `additionalModels` when a compatible provider exposes one of these models under another ID.

## How it works

- A session `context` hook sets the Anthropic `contextManagement` provider option only for configured providers, supported models, and the Anthropic Messages package. The native protocol adds the required `compact-2026-01-12` beta header.
- Only primary agent requests are affected; OpenCode's title, compaction, and generate requests are left alone.
- An `http.response` hook copies the response stream and records the compaction block, if any, together with the last message of that request.
- On later requests, the recorded block is prepended to the first assistant message after that anchor. Anthropic drops everything before it, so the compacted context is reused instead of compacting again.
- Recorded blocks live in memory. After a restart, or once OpenCode's own compaction or a revert removes the anchor message, Anthropic simply compacts again when the trigger is reached.

## Anthropic proxies backed by Bedrock

A Bedrock-backed proxy can work when OpenCode talks to it through the Anthropic Messages package. Add its OpenCode provider ID to `additionalProviders` and any renamed model ID to `additionalModels`. If the proxy forwards the request body to Bedrock unchanged, add the Bedrock-native fields with the provider `body` overlay:

```json
{
  "providers": {
    "my-anthropic-proxy": {
      "body": {
        "anthropic_version": "bedrock-2023-05-31",
        "anthropic_beta": ["compact-2026-01-12"]
      }
    }
  }
}
```

The proxy must faithfully implement the Anthropic Messages contract for compaction:

- accept `context_management.edits`
- stream `compaction` and `compaction_delta` events
- accept returned compaction blocks in later assistant messages
- preserve compaction usage iterations

Merely using Bedrock internally is not enough. A proxy that strips these fields, converts compaction blocks to ordinary text, or routes through Bedrock Converse without translating the feature will not work.

## Limitations

- OpenCode's `amazon-bedrock` provider uses Bedrock Converse and does not expose Anthropic compaction blocks. It is not enabled by this plugin.
- The compaction summary is not shown in the transcript.
- Server-side compaction adds a billed sampling iteration.

## Tests

```sh
bun test plugins/anthropic-compaction
```
