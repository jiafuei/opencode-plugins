# Anthropic server-side compaction

Enables [Anthropic server-side compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) for supported Claude models in OpenCode.

The plugin adds Anthropic's `compact_20260112` context-management strategy to normal requests. When the trigger is reached, Anthropic summarizes the older context, returns a `compaction` block, and continues the response using the smaller context. OpenCode's Anthropic AI SDK preserves that block and passes it back on later turns.

## Install

```sh
opencode plugin @jiafuei/opencode-anthropic-compaction
```

## Configuration

```json
{
  "plugin": [
    ["@jiafuei/opencode-anthropic-compaction", {
      "enabled": true,
      "threshold": "70%",
      "additionalProviders": ["my-anthropic-proxy"],
      "additionalModels": ["anthropic.claude-sonnet-4-6-v1:0"],
      "instructions": "Summarize the transcript inside <summary></summary> tags. Preserve the task state, code, technical decisions, learnings, and next steps needed to continue. Do not call any tools while writing this summary; respond with text only."
    }]
  ]
}
```

- `threshold` controls the input-token trigger. Use an absolute token count of at least `50000`, a percentage such as `"70%"`, or the fractional form `0.7` for 70% of the model context window. Relative values are clamped to Anthropic's 50,000-token minimum. The default is `"70%"`.
- `additionalProviders` enables provider IDs in addition to `anthropic`. Their models must still use the `@ai-sdk/anthropic` adapter.
- `additionalModels` enables upstream or OpenCode model IDs in addition to Anthropic's documented model allowlist. This is useful for proxy and cloud-platform aliases.
- `instructions` replaces Anthropic's compaction prompt. The default preserves coding-task state and explicitly prevents tool calls during summarization.

Restart OpenCode after installing the plugin or changing its configuration.

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

- `chat.params` enables `contextManagement.edits` only for configured providers, supported models, and the `@ai-sdk/anthropic` adapter.
- The installed Anthropic AI SDK adds the required `compact-2026-01-12` beta automatically.
- Existing non-compaction context-management edits are preserved. An existing `compact_20260112` edit is replaced by this plugin's configuration.
- Anthropic streams a compaction block as a metadata-tagged text part. OpenCode stores that part and the Anthropic SDK reconstructs it as a `compaction` block on subsequent requests.
- The generated summary is visible in the transcript. This is intentional: retaining the metadata-tagged part provides the reliable plugin-only replay path.
- The internal `title`, `summary`, and `compaction` agents are skipped.

No global fetch patch or separate per-session state is used.

## Anthropic proxies backed by Bedrock

A Bedrock-backed proxy can work when OpenCode talks to it through `@ai-sdk/anthropic`. Add its OpenCode provider ID to `additionalProviders` and any renamed model ID to `additionalModels`.

The proxy must faithfully implement the Anthropic Messages contract for compaction:

- accept `context_management.edits`
- forward the `compact-2026-01-12` beta to Bedrock's expected request field
- stream `compaction` and `compaction_delta` events
- accept returned compaction blocks in later assistant messages
- preserve compaction usage iterations

Merely using Bedrock internally is not enough. A proxy that strips these fields, converts compaction blocks to ordinary text, or routes through Bedrock Converse without translating the feature will not work.

## Limitations

- OpenCode's standard `@ai-sdk/amazon-bedrock` models use Bedrock Converse and do not expose Anthropic compaction blocks through the required request and response conversion. They are not enabled by this plugin.
- OpenCode's experimental native LLM runtime currently drops Anthropic compaction blocks. Do not enable `OPENCODE_EXPERIMENTAL_NATIVE_LLM` when using this plugin with the built-in `anthropic` provider.
- The plugin does not automatically disable OpenCode's built-in compaction. Set its server-side trigger early enough that Anthropic compacts before OpenCode reaches its own overflow boundary.
- Server-side compaction adds a billed sampling iteration. The current Anthropic AI SDK aggregates compaction and message iterations into reported executor usage.

## Tests

```sh
bun test plugins/anthropic-compaction
```
