# OpenCode plugins

Standalone plugins for [OpenCode](https://opencode.ai), maintained as independently publishable packages in a Bun workspace.

## Plugins

- [Anthropic compaction](plugins/anthropic-compaction/README.md): run OpenCode's native compaction through Anthropic's server-side compaction for Claude models.
- [Antigravity OAuth](plugins/antigravity-oauth/README.md): sign in with Google Antigravity to run Gemini, Claude, and GPT-OSS on the free Cloud Code Assist tier with the native client fingerprint.
- [Browser](plugins/browser/README.md): token-bounded Playwright tools for the TUI, with CDP attachment, trusted code, and network/console inspection. Not published; load it from a local checkout.
- [Claude OAuth](plugins/claude-oauth/README.md): use a Claude Pro/Max subscription through the built-in Anthropic integration, with `/anthropic-usage` for plan limits.
- [Codex usage](plugins/codex-usage/README.md): `/codex-usage` shows your ChatGPT plan's Codex rate-limit windows.
- [Computer use](plugins/computer-use/README.md): screenshot-driven desktop control on Windows (OpenCode in WSL2) and macOS. Not published; load it from a local checkout.
- [Memory](plugins/memory/README.md): project-scoped automatic memory with a `/memory` browser.
- [Web search](plugins/websearch/README.md): web search for the built-in `websearch` tool through OpenAI, Google, or Anthropic hosted search.
- [Webfetch](plugins/webfetch/README.md): local Markdown-first page reading with HTML pruning, documentation index discovery, and HTTP caching.
- [Redact keys](plugins/redact-keys/README.md): redact secrets from protected files before they reach the model.
- [OpenRouter](plugins/openrouter/README.md): routing and privacy settings with global, folder, and session overrides and a local web UI.
- [PTY](plugins/pty/README.md): session-private interactive terminals for REPLs, installers, debuggers, and terminal applications. Not published; load it from a local checkout.
- [Workflows](plugins/workflows/README.md): declarative child-agent workflows with steering and a native TUI inspector.

## Skills

- [OpenCode sessions](skills/opencode-sessions/SKILL.md): search V2 sessions and message bodies, and dump JSONL transcripts with optional tool output. Includes a standalone Bun CLI for other harnesses.

Add this repository's `skills/` directory to OpenCode's `skills` configuration, or copy an individual skill directory into `~/.config/opencode/skills/`.

## Installation

Install a plugin into the global OpenCode configuration:

```sh
opencode plugin add @jiafuei/opencode-anthropic-compaction
opencode plugin add @jiafuei/opencode-antigravity-oauth
opencode plugin add @jiafuei/opencode-claude-oauth
opencode plugin add @jiafuei/opencode-codex-usage
opencode plugin add @jiafuei/opencode-memory
opencode plugin add @jiafuei/opencode-openrouter
opencode plugin add @jiafuei/opencode-websearch
opencode plugin add @jiafuei/opencode-redact-keys
opencode plugin add @jiafuei/opencode-workflows
```

Plugins are listed in the `plugins` array of `opencode.json`, either as a package name or as `{ "package": "...", "options": { ... } }`. Plugins with a TUI side load it from the same entry.

## Retired plugins

These plugins were removed in the OpenCode v2 migration because v2 core covers them natively.

- **OpenAI compaction** (`@jiafuei/opencode-openai-compaction`): v2 core implements OpenAI's `/responses/compact` endpoint and in-band compaction trigger. Enable it per provider or model instead:

  ```json
  { "providers": { "openai": { "settings": { "compaction": { "type": "native" } } } } }
  ```

- **Model glob** (`@jiafuei/opencode-model-glob`): v2 core ships an `opencode.models` tool (reachable through `execute`) that searches available models by text or provider and returns variants, cost, and status. The built-in `subagent` tool already points the model at it.

## Development

```sh
bun install
bun test
bun run typecheck
```

Each directory under `plugins/` is an independent npm package. Run `npm pack --dry-run` from a plugin directory to inspect its publish contents.
