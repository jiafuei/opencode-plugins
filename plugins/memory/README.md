# Memory

Project-scoped memory for OpenCode, with a Claude Code-like `/memory` browser. The model remembers your preferences,
instructions, and hard-won context across sessions, so you don't have to repeat them. Memory is a compact hint layer
for things that are expensive to re-derive, not a changelog or source of truth.

## How it works

- **Recall.** Each session starts with the project's memory index in context. Preferences and instructions you gave
  are followed; other entries are hints the model reads in full and verifies before relying on them.
- **Saving.** The model saves memories with a `memory` tool when you state a preference or instruction, correct it, or
  settle a hard question. A `Saved: <title>` toast shows each save.
- **Reflection.** When a session goes idle, a background review saves preferences and instructions you stated that
  the model missed. The TUI shows `Reviewing conversation...` while it runs.
- **Updates.** Memories saved or edited in one session reach other open sessions on their next user message.
- **Dreaming.** As memory grows, a periodic cleanup merges related topics and removes stale ones. Removed topics are
  quarantined first, not deleted outright. The sidebar shows `Dreaming...` while it runs.
- **Subagents** get your preferences and instructions, but no `memory` tool.

Memory is designed to keep the provider's prompt cache warm: what the model sees doesn't change mid-session, and new
memories arrive as small additions instead.

## Memory types

| Type | What it holds |
| --- | --- |
| `preference` | Durable general preferences you stated |
| `instruction` | Scoped instructions that apply to future work |
| `recap` | Context from a completed hard task, to avoid re-deriving it |
| `reference` | Lasting external material |
| `insight` | A conclusion merged from several memories by dreaming; a hint, not a fact you stated |

## Storage

Memories are plain markdown files outside the repository, easy to read and edit by hand. Each project (including each
Git worktree) gets its own directory:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/memory/-home-alice-project-a1b2c3d4/
|-- index.md
`-- <short-title>-<random>.md
```

`index.md` has one line per topic, and the model sees the same lines:

```markdown
- [Short title](short-title-a1b2c3d4.md) - [preference|2026-08-23] One-line summary
```

Topic files hold the body alone, with no frontmatter; the title, summary, type, and write date live only in the index
line. Edits to a topic apply the next time it is read, and edits to the index reach sessions on their next user
message. Index lines not in this format are dropped the next time the plugin writes the index.

## Installation

```sh
opencode plugin add @jiafuei/opencode-memory
```

The package includes both the server and TUI sides. To customize it, replace its entry in the `plugins` array of
`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@jiafuei/opencode-memory",
      "options": {
        "reflect_model": "anthropic/claude-haiku-4-5#low",
        "dream_model": "anthropic/claude-sonnet-4-6#high",
        "idle_delay_ms": 300000,
        "dream_interval_hours": 36,
        "dream_min_additions": 7,
        "dream_index_bytes": 8192,
        "dream_topic_limit": 200
      }
    }
  ]
}
```

| Option | Default | Purpose |
| --- | --- | --- |
| `reflect_model` | OpenCode's default model | Idle reflection model |
| `dream_model` | `reflect_model` | Dreaming model |
| `idle_delay_ms` | `300000` | Idle time after an execution before reflection |
| `dream_interval_hours` | `36` | Minimum hours between automatic dreams |
| `dream_min_additions` | `7` | Minimum new or replaced topics before an automatic dream |
| `dream_index_bytes` | `8192` | Index size in bytes that starts a dream after a save |
| `dream_topic_limit` | `200` | Topic count that starts a dream after a save |

Models use `provider/model` or `provider/model#variant`. Quit and restart OpenCode after installing or changing the
configuration.

## Commands

- `/memory` turns memory and automatic dreaming on or off for the project, starts a dream, and lists topics; choosing
  one opens its markdown file in `$VISUAL` or `$EDITOR`. Toggling memory can invalidate the provider's prompt cache.
- `/dream` starts a dream without adding a conversation message.

## Data disclosure

Reflection sends the session's user and assistant text to `reflect_model`, along with the memory index. Dreaming sends
the index and selected topics to `dream_model`. Choose both within your intended data-disclosure boundary.

See [DESIGN.md](DESIGN.md) for how recall, updates, reflection, and dreaming work in detail.
