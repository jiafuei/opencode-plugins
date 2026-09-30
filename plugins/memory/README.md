# Memory

Project-scoped memory with a Claude Code-like `/memory` browser. Memory is a compact hint layer for context that would be expensive to re-derive, not a changelog or source of truth. The server plugin is in `server.tsx`; the TUI plugin is in `tui.tsx`.

## Behavior

- **Recall.** The first request of a session (the `context` hook) adds a `<memory>` system block with the full index. The block is cached for the rest of the session so the provider prompt cache stays warm. `preference` and `instruction` entries are user-stated and are followed unless the conversation says otherwise; `recap`, `reference`, `insight`, and legacy `feedback`/`project` entries are hints the model reads (with the `memory` tool's `read` action) and verifies before relying on them.
- **Saving.** Primary agents get a `memory` tool (`save` creates, or replaces an indexed `target`; `read` returns a topic's content; `delete` removes the index entry and topic). The tool description is the authoring contract: user-stated preferences and instructions, corrections worth keeping, settled conclusions of hard-won questions (`recap`, not in-progress investigation notes), and lasting external material (`reference`). Saves go through the same write queue as everything else, emit a `Saved: <title>` toast, and count toward automatic dreaming.
- **Reflection.** When a primary session goes idle for `idle_delay_ms` after an execution finishes, one worker call reviews the messages since the last reflection (user text, assistant text, tool calls with input and output truncated to about 2 KB each) together with the index and the topics already saved in the session, and saves up to three new topics the agent missed; it never rewrites existing topics. Most reviews save nothing. The cursor advances only when the worker call succeeds; failures are logged to stderr. The TUI shows `Reviewing conversation...` while it runs.
- **Updates.** On the first request of each genuine user turn, the current index is compared with the index that session already knows. Changed entries and removal notices are appended to that user message inside `<system>` tags (never to synthetic or compaction messages). The exact update text is frozen, so later requests replay it identically without rewriting the cached snapshot or earlier messages. This also catches changes made while a session was unloaded and hand edits to the index. The originating session acknowledges its own saves and deletions without receiving redundant updates.
- **Restarts and compaction.** Each session's snapshot, known index, frozen update text, reflection cursor, and saved-topic list persist in plugin storage (`ctx.storage`, key `session/<sessionID>`), so a restart or plugin reload renders byte-identical context. After a compaction the next request takes a fresh snapshot (which includes every committed update) and drops old updates. The entry is removed when the session is deleted.
- **Subagents and workflow workers.** Child sessions (with a `parentID`) and workflow workers (metadata `workflowWorkerID`) get a compact block with the full content of `preference` and `instruction` topics inline, no `memory` tool, no deltas, and no reflection.
- **Dreaming.** A save that grows the index past 32 KiB or 200 topics starts a dream. Dreams run from `/dream`, `Dream now` in `/memory`, or the opt-in automatic gate (`dream_interval_hours` elapsed and `dream_min_additions` creates/replacements since the last successful run). A run performs at most eight actions: `synthesize` replaces 2–8 related topics with one self-contained topic (mixed-type groups become non-authoritative `insight`s), and `prune` asks a tool-free curator for an independent keep/remove verdict per nominated topic; removals need evidence where the category requires it and move to quarantine under `trash/<run-id>/`, which a later successful run purges. Every run writes a decision-only manifest under `dreams/`; one server process runs at most one dream at a time. The sidebar shows `Dreaming...` while a run is active, and manual failures show a warning toast.
- **Disabling.** `/memory` toggles memory per project. Disabled memory adds no context, including historical updates, hides the tool, skips reflection, and refuses reads and new writes; a write already in progress finishes. Toggling can invalidate the provider's prompt cache. Cached snapshots and frozen updates remain stored for re-enabling; unseen index changes arrive on the next enabled user turn.

Workers (reflection and dreaming) are one-shot text generations with no session and no tools; replies must decode as JSON matching the worker's schema.

## Storage

The index and topics are plain markdown files outside the repository, so they are easy to read and edit by hand. Each project directory name is derived from the lowercase absolute project path, with characters outside `a-z`, `.`, `_`, and `-` replaced by `-`, followed by an 8-character hash of the resolved path. Different paths, including Git worktrees, use separate memory directories.

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/memory/-home-alice-project-a1b2c3d4/
|-- index.md
`-- <short-title>-<random>.md
```

`index.md` has one line per topic, and the prompt renders the same lines. The link target is the topic id:

```markdown
- [Short title](short-title-a1b2c3d4.md) - [preference|editor|2026-08-23] One-line summary
```

Topic files are the body alone, with no frontmatter. Title, summary, type, scope, and the plugin-owned write date live only in the index line. Files are read fresh on every access: body edits apply on the next read, and index edits arrive on the next genuine user turn without changing existing snapshots. Index lines not in the format above are ignored and dropped the next time the plugin writes the index; legacy extensionless topic ids are also accepted.

Settings, dream bookkeeping, and per-session state live in the server plugin's key-value storage (`ctx.storage`), keyed by the same project key:

```text
memory/<project-key>/settings              { enabled?, dream_auto? }
memory/<project-key>/dream                 automatic-dream counters
memory/<project-key>/dreams/<run-id>       decision-only manifest
memory/<project-key>/trash/<run-id>/<file> quarantined index entry and body
session/<session-id>                       snapshot, known index, and frozen updates
```

Saves create topics classified as `preference` (durable general preferences stated by the user), `instruction` (scoped general instructions that apply to future work), `recap` (hard-won completed-task context worth avoiding re-derivation), or `reference` (lasting external material). Replacing an existing insight preserves its type. Synthesis preserves a shared source type; mixed-type groups produce an `insight`, a non-authoritative memory that distinguishes derived conclusions from user-stated facts. A group containing an insight cannot become an instruction or preference. Existing topics classified as the retired `feedback` and `project` types stay readable and are reclassified into the current taxonomy when replaced.

Summaries are short one-line hooks describing the topic's coverage, not substitutes for the facts. Topic bodies are a few short sentences: the fact first, then why it matters or when it applies. This is prompt guidance; the plugin enforces no character or byte limits. Meaningful dates may remain in the body; the plugin separately records when the topic was written.

Writes are serialized in-process only; concurrent writes from separate OpenCode processes on the same project are not coordinated. Every file write goes through a temporary file and a rename. Each save writes the topic, then the index, and rolls the topic back if the index write fails; a delete writes the index, then removes the topic, tolerating an already-missing file. Dream commits recheck enabled state, source metadata, and contents, and abort the run when a source changed.

On first start after upgrading from the storage-backed version, the index and topics in `ctx.storage` are exported once to these files and removed from storage. Cached session snapshots and historical updates are preserved, including their old formatting. The memory tool accepts old extensionless topic ids as aliases for their `.md` files.

## Installation

Install the package and add it to the global configuration:

```sh
opencode plugin add @jiafuei/opencode-memory
```

The package exposes server, TUI, and RPC entrypoints, so the one `plugins` entry loads both sides. To customize the plugin, replace its entry in the `plugins` array of `opencode.json`:

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
        "dream_min_additions": 7
      }
    }
  ]
}
```

Options:

| Option | Default | Purpose |
| --- | --- | --- |
| `reflect_model` | OpenCode's default model | Idle reflection model |
| `dream_model` | `reflect_model` | Dream selection, synthesis, and prune curation model |
| `idle_delay_ms` | `300000` | Idle time after an execution before reflection; minimum `1000` |
| `dream_interval_hours` | `36` | Minimum hours between automatic dreams; greater than `0` |
| `dream_min_additions` | `7` | Minimum creates or replacements before automatic dreaming; positive integer |

Models use `provider/model` or `provider/model#variant`.

`/memory` toggles memory and automatic dreaming, starts a dream, and lists topics; choosing one opens its markdown file in `$VISUAL` or `$EDITOR`. `/dream` starts a manual dream without adding a conversation message.

Disclosure: reflection sends the session's user text, assistant text, and truncated tool input and output to `reflect_model`, along with the memory index. Dreaming sends the index and selected complete topics to `dream_model`. Choose both within your intended data-disclosure boundary.

Quit and restart OpenCode after installing or changing plugin configuration.
