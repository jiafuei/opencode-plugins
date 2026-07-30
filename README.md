# OpenCode plugins

Standalone plugins for [OpenCode](https://opencode.ai), maintained as independently publishable packages in a Bun workspace.

## Plugins

- [Memory](plugins/memory/README.md): project-scoped automatic memory with a `/memory` browser.
- [Model glob](plugins/model-glob/README.md): search connected model IDs and their available variants.
- [OpenAI compaction](plugins/openai-compaction/README.md): compact OpenAI sessions with the provider's server-side compact endpoint instead of a summary.
- [Redact keys](plugins/redact-keys/README.md): redact secrets from protected files before they reach the model.
- [Workflows](plugins/workflows/README.md): declarative child-agent workflows with steering and a native TUI inspector.

## Installation

Install a plugin for the current project:

```sh
opencode plugin @jiafuei/opencode-memory
opencode plugin @jiafuei/opencode-model-glob
opencode plugin @jiafuei/opencode-openai-compaction
opencode plugin @jiafuei/opencode-redact-keys
opencode plugin @jiafuei/opencode-workflows
```

Pass `--global` to install into the global OpenCode configuration. Memory and Workflows expose both server and TUI entrypoints, so the installer updates both configurations automatically.

## Development

```sh
bun install
bun test
bun run typecheck
```

Each directory under `plugins/` is an independent npm package. Run `npm pack --dry-run` from a plugin directory to inspect its publish contents.
