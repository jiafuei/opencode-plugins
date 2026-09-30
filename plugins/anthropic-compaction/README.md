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
      "options": {
        "providers": {
          "anthropic": { "mechanism": "threshold" },
          "my-bedrock-proxy": { "aws": true, "models": { "claude-opus-4-6": "threshold" } }
        }
      }
    }
  ],
  "providers": {
    "anthropic": {
      "settings": { "compaction": { "type": "native" } }
    },
    "my-bedrock-proxy": {
      "settings": { "compaction": { "type": "native" } }
    }
  }
}
```

- `providers` maps the OpenCode provider IDs the plugin compacts for to their settings. Without it the plugin does nothing. Each provider must use the Anthropic Messages package (`@opencode/ai/providers/anthropic` or `@opencode/ai/providers/anthropic-compatible`).
  - `mechanism` is `"on-demand"` ([compaction on demand](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand), beta `compact-2026-09-04`) or `"threshold"` ([compaction at a token threshold](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold), beta `compact-2026-01-12`).
  - `models` sets the mechanism for individual model IDs, for a provider whose models support different mechanisms.
  - `aws` marks a provider that forwards requests to Bedrock InvokeModel. See [Anthropic proxies backed by Bedrock](#anthropic-proxies-backed-by-bedrock).
- `instructions` replaces Anthropic's default compaction prompt, for both mechanisms.

Each compaction picks its mechanism from the model's entry in `models`. Without one, Claude Haiku, Sonnet, and Opus 5.5 and later, and Claude Fable and Mythos 5 and later, use on-demand; the version is read from the model ID, so `claude-opus-5-5`, `us.anthropic.claude-opus-5-5-v1`, and `opus-5.5` all match. Other models use the provider's `mechanism`, and compaction fails for a model none of these cover.

A model setting overrides the provider setting, so one model can stay on OpenCode's summary with `{ "type": "summary" }`. Use that for models without compaction support, such as Haiku. Native compaction on a provider the plugin does not handle, and whose route has no native compaction, is rejected when the model resolves.

Restart OpenCode after installing the plugin or changing its configuration.

## How it works

OpenCode still decides when to compact, both automatically and on `/compact`, and still persists, replays, and bills the result. The request goes through the session's provider, auth, and HTTP hooks, and OpenCode adds the beta header for the mechanism.

### On demand

The plugin sends the conversation with `compaction: { type: "summarize" }`. Anthropic summarizes all of it and returns a single signed `compaction` block with no reply. The block becomes OpenCode's checkpoint, first in the conversation, and is replayed with its signature on every later request. There is no minimum size. This is Anthropic's recommended mechanism.

### Threshold

The plugin sends the conversation with the `compact_20260112` context-management edit, a 50,000-token trigger, and `pauseAfterCompaction`, so Anthropic compacts and stops without answering. The returned block becomes the checkpoint, after a `<synthetic_user_message>` that keeps the conversation opening with a user message. Later requests replay the block and Anthropic ignores everything before it.

Anthropic only compacts once input reaches 50,000 tokens. Below that it answers normally instead, so a manual `/compact` on a smaller conversation is billed for a reply and then fails. Automatic compaction runs near the context limit, which for Claude models is well above the minimum.

## Anthropic proxies backed by Bedrock

A proxy that accepts the Anthropic Messages API and forwards it to Bedrock InvokeModel (or InvokeModelWithResponseStream) can use either mechanism. The Bedrock Converse API supports neither.

Set `aws: true` on the provider. Bedrock reads betas from the request body rather than the `anthropic-beta` header, so the plugin copies the header's betas into the body's `anthropic_beta` and sets `anthropic_version` to `bedrock-2023-05-31`. The proxy still has to remove the fields InvokeModel does not accept, such as `model` and `stream`.

The proxy must otherwise pass compaction through unchanged:

- accept `compaction` (on demand) or `context_management.edits` (threshold)
- stream the `compaction` block and the `compaction` stop reason
- accept returned compaction blocks in later messages, including their `signature`
- preserve compaction usage iterations

Bedrock model support differs by mechanism. Check the model's card in the Bedrock documentation: at the time of writing, threshold compaction lists Claude Opus 4.6 and Sonnet 4.6, and on-demand compaction models such as Claude Opus 5.5. Bedrock can also refuse custom `instructions` with `compaction.instructions is not available on this platform`.

## Limitations

- OpenCode's `amazon-bedrock` provider uses Bedrock Converse and does not expose Anthropic compaction blocks, so it cannot be listed in `providers`.
- The compaction summary is not shown in the transcript.
- Images, documents, and fetched URLs in the summarized conversation do not survive compaction.
- On-demand compaction needs an OpenCode build that replays compaction block signatures.

## Tests

```sh
bun test plugins/anthropic-compaction
```
