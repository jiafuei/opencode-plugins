# OpenCode plugins

Standalone plugins for [OpenCode](https://opencode.ai), maintained as independently publishable packages in a Bun workspace.

## Plugins

- [Anthropic compaction](plugins/anthropic-compaction/README.md): compact supported Claude sessions with Anthropic's server-side context management.
- [Antigravity OAuth](plugins/antigravity-oauth/README.md): sign in with Google Antigravity to run Gemini, Claude, and GPT-OSS on the free Cloud Code Assist tier with the native client fingerprint.
- [Memory](plugins/memory/README.md): project-scoped automatic memory with a `/memory` browser.
- [Model glob](plugins/model-glob/README.md): search connected model IDs and their available variants.
- [Web search](plugins/websearch/README.md): provider-native web search, currently backed by OpenAI hosted search with a ChatGPT subscription.
- [Redact keys](plugins/redact-keys/README.md): redact secrets from protected files before they reach the model.
- [Workflows](plugins/workflows/README.md): declarative child-agent workflows with steering and a native TUI inspector.

## Installation

Install a plugin into the global OpenCode configuration:

```sh
opencode plugin add @jiafuei/opencode-anthropic-compaction
opencode plugin add @jiafuei/opencode-antigravity-oauth
opencode plugin add @jiafuei/opencode-memory
opencode plugin add @jiafuei/opencode-model-glob
opencode plugin add @jiafuei/opencode-websearch
opencode plugin add @jiafuei/opencode-redact-keys
opencode plugin add @jiafuei/opencode-workflows
```

Plugins are listed in the `plugins` array of `opencode.json`, either as a package name or as `{ "package": "...", "options": { ... } }`. Memory and Workflows expose both server and TUI entrypoints; OpenCode loads each from the same entry.

## Retired plugins

These plugins were removed in the OpenCode v2 migration because v2 core covers them natively.

- **OpenAI compaction** (`@jiafuei/opencode-openai-compaction`): v2 core implements OpenAI's `/responses/compact` endpoint and in-band compaction trigger. Enable it per provider or model instead:

  ```json
  { "providers": { "openai": { "settings": { "compaction": { "type": "native" } } } } }
  ```

## Development

```sh
bun install
bun test
bun run typecheck
```

Each directory under `plugins/` is an independent npm package. Run `npm pack --dry-run` from a plugin directory to inspect its publish contents.
