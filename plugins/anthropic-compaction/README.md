# Anthropic server-side compaction

Runs OpenCode's native compaction through [Anthropic server-side compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) for Claude models.

OpenCode's own routes have no native compaction for Anthropic. This plugin supplies it through the `experimental.compaction.native` hook, so it needs an OpenCode build that includes that hook.

## Install

```sh
opencode plugin add @jiafuei/opencode-anthropic-compaction
```

## Enable

The plugin is opt-in per provider. List the providers it should handle in its `providers` option, and turn on native compaction for them, as for any provider with native compaction:

```json
{
  "plugins": [
    {
      "package": "@jiafuei/opencode-anthropic-compaction",
      "options": { "providers": ["anthropic"] }
    }
  ],
  "providers": {
    "anthropic": {
      "settings": { "compaction": { "type": "native" } }
    }
  }
}
```

- `providers` lists the OpenCode provider IDs the plugin compacts for. Without it the plugin does nothing. Each provider must use the Anthropic Messages package (`@opencode/ai/providers/anthropic` or `@opencode/ai/providers/anthropic-compatible`).
- `instructions` replaces Anthropic's default compaction prompt.

A model setting overrides the provider setting, so one model can stay on OpenCode's summary with `{ "type": "summary" }`. Native compaction on a provider the plugin does not handle, and whose route has no native compaction, is rejected when the model resolves.

Restart OpenCode after installing the plugin or changing its configuration.

## How it works

- OpenCode still decides when to compact, both automatically and on `/compact`, and still persists, replays, and bills the result.
- When it compacts, the plugin sends the conversation to Anthropic once with the `compact_20260112` context-management edit, a 50,000-token trigger, and `pauseAfterCompaction`, so Anthropic compacts and stops without answering.
- The returned `compaction` block becomes OpenCode's checkpoint, after a `<synthetic_user_message>` that keeps the conversation opening with a user message. Later requests replay the block and Anthropic ignores everything before it.
- The request goes through the session's provider, auth, and HTTP hooks. The native protocol adds the `compact-2026-01-12` beta header.

### Minimum size

Anthropic only compacts once input reaches 50,000 tokens. A manual `/compact` on a smaller conversation fails with an error saying so. Automatic compaction runs near the context limit, which for Claude models is well above the minimum.

## Anthropic proxies backed by Bedrock

A Bedrock-backed proxy can work when OpenCode talks to it through the Anthropic Messages package. Add its provider to the plugin's `providers` and enable native compaction on it as above. If the proxy forwards the request body to Bedrock unchanged, add the Bedrock-native fields with the provider `body` overlay:

```json
{
  "providers": {
    "my-anthropic-proxy": {
      "settings": { "compaction": { "type": "native" } },
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
- stream `compaction` and `compaction_delta` events and the `compaction` stop reason
- accept returned compaction blocks in later assistant messages
- preserve compaction usage iterations

A proxy that strips these fields, converts compaction blocks to ordinary text, or routes through Bedrock Converse without translating the feature will not work.

## Limitations

- OpenCode's `amazon-bedrock` provider uses Bedrock Converse and does not expose Anthropic compaction blocks, so it cannot be listed in `providers`.
- The compaction summary is not shown in the transcript.

## Tests

```sh
bun test plugins/anthropic-compaction
```
