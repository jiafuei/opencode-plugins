# Memory

Project-scoped automatic memory with a Claude Code-like `/memory` browser. The server plugin is in `memory_server.tsx`; the TUI plugin is in `memory_tui.tsx`.

## Behavior

- On the first main-model request in a session, a `<memory>` system block snapshots the absolute memory directory and complete current managed index. The same block is reused for the rest of that session without rereading the index. This initial local file read does not call a model.
- When a prior preference, decision, incident, or reference may matter, the model uses the normal `read` tool with the directory and an exact indexed filename. Index summaries are not substitutes for topic contents, and both index and topic data are marked untrusted and potentially stale.
- External-directory permission asks are automatically allowed only for exact indexed topic files that resolve inside this project’s memory directory. Unindexed, symlink-escaped, sibling, and unrelated paths retain their normal permission handling.
- Every `interval` user turns, pending prompts and evidence are snapshotted quickly. Save classification, extraction, and persistence all run in the background and do not delay that user message or later messages.
- When the TUI observes a hidden classifier worker launch for one of its sessions, it shows an ephemeral `Memory: Reviewing conversation...` info toast. Each checkpoint runs exactly one classifier worker, so one checkpoint produces exactly one reviewing toast; extraction and maintenance workers never trigger it. Worker sessions carry a `memoryActivity` marker (`classification`, `extraction`, or `maintenance`) for this.
- Save notifications are driven by committed writes, not worker completion. The TUI watches this workspace's memory index and topic files on disk and diffs a baseline of committed index entries plus topic-file revisions. Created topics and replacements toast, including replacements that keep the same title and summary; checks run after the atomic topic/index write pair settles, so an in-flight or rolled-back write is never announced. A `Memory: Saved: <topic title>` success toast appears only when the changed topic's plugin-owned `sessionId` frontmatter names a parent whose memory worker this TUI instance actually observed.
- Attribution is per TUI instance: concurrent OpenCode sessions in the same workspace have distinct session IDs, so another instance's saves stay silent here. Events from other workspaces' memory directories never match this project key and cannot leak in. Parent-session tracking is bounded (TTL and entry cap).
- `/memory` no longer creates the per-project directory just by being opened; it shows the normal selector with an empty memory list when storage does not exist yet. The directory is created lazily at true write boundaries: toggling auto-memory, opening the folder or a topic file from `/memory`, or the server's first coordinated write. The shared memory root may be created by the TUI's save watcher.
- Maintenance runs when the managed index exceeds 24 KiB or 200 topics. A worker may consolidate only 2–8 semantically related duplicates, overlaps, or stale variants; unrelated topics are left over the soft cap. Complete selected files must fit the dedicated maintenance input cap, and source revisions/content are rechecked before commit.
- An idle timer saves pending turns from short sessions that do not reach a periodic checkpoint.
- The extractor receives user prompts, completed agent text output, and compact tool evidence, never tool output bodies: `read`, `grep`, `glob`, and `list` contribute only their tool name and display title; qualifying test/check/build shell commands do the same only when their exit status is zero. It never receives tool-call structures. Agent output is supporting context rather than an authoritative source.
- Memory is disabled per project from `/memory`. Disabling stops new collection, system context, and persistence checks; an already-running worker request is not canceled and completes before its child session is deleted.

Worker model calls use hidden child sessions with executable tools denied. The sessions are deleted after each call. Worker failures are logged and do not fail the main prompt.

## Storage

Memory is stored outside the repository. Each project directory name is derived from its lowercase absolute path, with characters outside `a-z`, `.`, `_`, and `-` replaced by `-`, followed by an 8-character hash of the original resolved path:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/memory/-home-alice-project-a1b2c3d4/
|-- index.md
|-- settings.json
`-- <short-title>-<random>.md
```

Different paths, including Git worktrees, use separate memory directories. Existing hash-named memory directories are not migrated automatically. The TUI's save watcher watches only the shared memory root (for this workspace's directory key appearing) and then the project directory non-recursively; fs events are debounced and resolved against a baseline of committed index entries and topic revisions, so atomic-rename duplicates never produce spurious toasts. Content that already exists when the TUI starts never toasts; when the project directory first appears during this TUI lifetime, its initial content counts as new and attributed writes toast.

`index.md` uses one managed entry per topic:

```markdown
- [Short title](short-title-a1b2c3d4.md) - One-line summary
```

Topics are classified as `feedback` (corrections and confirmed approaches), `project` (durable facts and decisions), or `reference` (lasting external material). Feedback bodies state the rule and include `**Why:**` and `**How to apply:**`. Project bodies use concise natural prose and may preserve useful chronology, rationale, accepted tradeoffs, unresolved decisions, and related-topic links; they do not contain Why, How, or When-to-apply sections or procedural guidance. References may use a natural reference-oriented structure.

Topic files carry plugin-owned metadata. `sessionId` is the last writer: the originating session for creation/replacement and the maintenance session for consolidation.

```markdown
---
revision: "random-revision-token"
type: "project"
sessionId: "ses_last_writer"
---
```

Older topics without `type` are treated as `project`; metadata is migrated only when the topic is next replaced or consolidated. Replacements preserve the existing classification unless new content clearly changes it.

Before committing, the plugin rechecks enabled state, index membership, revision, and complete file content. Writes are serialized in-process and coordinated across processes with an atomic lock directory; stale locks are reclaimed after a crash. Topic/index replacements remain atomic and an index-write failure rolls back the topic. Maintenance also removes index entries whose files are missing and deletes topic `.md` files confirmed absent from the index.

## Installation

Install the package for the current project:

```sh
opencode plugin @jiafuei/opencode-memory
```

Pass `--global` to install it globally. The package exposes both server and TUI entrypoints, so OpenCode updates `opencode.json` and `tui.json` automatically.

To customize the server plugin, edit its entry in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "small_model": "anthropic/claude-haiku-4-5",
  "plugin": [
    ["@jiafuei/opencode-memory", {
      "classifier_model": "anthropic/claude-haiku-4-5",
      "extractor_model": "anthropic/claude-sonnet-4-6",
      "interval": 3,
      "idle_delay_ms": 90000
    }]
  ]
}
```

Options:

| Option | Default | Purpose |
| --- | --- | --- |
| `classifier_model` | `small_model` | Background save classification and maintenance selection model |
| `extractor_model` | classifier model | Background extraction and consolidation model |
| `interval` | `3` | User turns between periodic checkpoints; minimum `2` |
| `idle_delay_ms` | `90000` | Delay before pending short-session turns are classified |

Set `small_model` or `classifier_model` to enable save classification. Reading memory uses the normal local `read` tool and does not require a model worker.

For manual installation, register the same package in `tui.json`:

```json
{
  "plugin": ["@jiafuei/opencode-memory"]
}
```

`/memory` toggles auto-memory and opens the index, topic files, or storage folder using `$VISUAL` and then `$EDITOR`.

Successful tool evidence may be sent to different providers when the classifier and extractor models differ from the main conversation model. Configure models within the intended data-disclosure boundary.

Quit and restart OpenCode after installing or changing plugin configuration.
