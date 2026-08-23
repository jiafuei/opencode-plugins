# Memory

Project-scoped automatic memory with a Claude Code-like `/memory` browser. The server plugin is in `memory_server.tsx`; the TUI plugin is in `memory_tui.tsx`.

## Behavior

- On the first main-model request in a session, a `<memory>` system block snapshots the absolute memory directory and complete current managed index. The snapshot is cached and stays immutable for the rest of that session without rereading the index, which keeps the request prefix stable for provider prompt caches. This initial local file read does not call a model.
- Memory saved after that snapshot reaches the originating session as a compact synthetic `<memory_update>` text part injected onto the next genuine user message by `experimental.chat.messages.transform`. The part is marked untrusted and non-authoritative, lists only the added or updated index lines (never topic bodies or the full index), and states that it supersedes matching entries in the initial snapshot. Deltas are frozen per user message at its first transform: saves committing later in the same tool loop defer to the following user turn, every historical user message keeps its own frozen assignment and part across transforms (transforms are not persisted), assignments are pruned as messages leave the model history, and all delta state is cleared when the session is deleted.
- When prior preferences, instructions, recaps, or references may matter, the model uses the normal `read` tool with the directory and an exact indexed filename. Memories are hints only, not authoritative facts, and relevant details must be verified against the current conversation, project state, or primary sources before use. Index summaries are not substitutes for topic contents, and both index and topic data are marked untrusted and potentially stale.
- External-directory permission asks are automatically allowed only for exact indexed topic files that resolve inside this project’s memory directory. Unindexed, symlink-escaped, sibling, and unrelated paths retain their normal permission handling.
- Checkpoints capture only previously completed turns. When a new real user message arrives and `interval` turns have completed since the last checkpoint, the buffered prompts, completed assistant outputs, and tool activity are snapshotted before the new prompt is buffered — the triggering prompt is never classified. A save classification returns up to three atomic decisions, each a narrow subject describing exactly one thing to remember, and extraction is constrained to that subject. Everything runs in the background and does not delay that user message or later messages.
- An idle timer saves the final pending turns from short sessions that do not reach a periodic checkpoint. A checkpoint whose classification or extraction fails restores its buffered source unchanged, and that buffer is not offered for review again until new conversation content is collected.
- When the TUI observes a hidden classifier worker launch for one of its sessions, it shows an ephemeral `Memory: Reviewing conversation...` info toast. Each checkpoint runs exactly one classifier worker, so one checkpoint produces exactly one reviewing toast; extraction, maintenance, and dream workers never trigger it. Worker sessions carry a `memoryActivity` marker (`classification`, `extraction`, `maintenance`, or `dream`) for this.
- Save notifications are driven by committed writes, not worker completion. The TUI watches this workspace's memory index and topic files on disk and diffs a baseline of committed index entries plus topic-file revisions. Created topics and replacements toast, including replacements that keep the same title and summary; checks run after the atomic topic/index write pair settles, so an in-flight or rolled-back write is never announced. A `Memory: Saved: <topic title>` success toast appears only when the changed topic's plugin-owned `sessionId` frontmatter names a parent whose memory worker this TUI instance actually observed.
- Attribution is per TUI instance: concurrent OpenCode sessions in the same workspace have distinct session IDs, so another instance's saves stay silent here. Events from other workspaces' memory directories never match this project key and cannot leak in. Parent-session tracking is bounded (TTL and entry cap).
- `/memory` no longer creates the per-project directory just by being opened; it shows the normal selector with an empty memory list when storage does not exist yet. The directory is created lazily at true write boundaries: toggling auto-memory, opening the folder or a topic file from `/memory`, or the server's first coordinated write. The shared memory root may be created by the TUI's save watcher.
- Maintenance runs when the managed index exceeds 32 KiB or 200 topics. A worker may consolidate only 2–8 semantically related duplicates, overlaps, or stale variants; unrelated topics are left over the soft cap. Complete selected files must fit the dedicated maintenance input cap, and source revisions/content are rechecked before commit.
- Dreaming is an opt-in, whole-store cleanup pass started with `/dream`, `Dream now` in `/memory`, or the automatic gate. A run performs at most eight bounded transformations: merging duplicates, superseding contradicted variants, or synthesizing a derived insight. Merge and supersede groups must share one type. Age alone never justifies removal, and source files are rechecked against the immutable run snapshot before each commit.
- Automatic dreaming requires both `dream_interval_hours` to have elapsed and `dream_min_additions` ordinary creates or replacements since the previous successful run. Defaults are 36 hours and 7 additions. Enabling it on an existing project seeds the addition count from the current topic count and starts a fresh interval window. Successful no-op runs reset the gate; failed runs retain it and back off before retrying.
- Dream results apply automatically. Every run writes a decision-only manifest under `.dreams/`, but manifests do not retain old topic contents and therefore cannot provide exact rollback. A separate `.dream.lock` prevents duplicate runs across OpenCode processes without holding the short-lived commit lock during model calls.
- Dream changes reach every live project session as compact additions and removal tombstones, so a cached initial memory index stops referring to deleted files. Dream-produced topics do not emit ordinary per-topic save notifications; a changed run emits one completion toast with operation counts, while no-op runs stay silent.
- Workers receive user prompts, completed agent text output, and compact tool activity, never tool output bodies: `read`, `grep`, `glob`, and `list` contribute only their tool name and display title; qualifying test/check/build shell commands do the same only when their exit status is zero. Workers never receive tool-call structures, and activity lines are labeled hints rather than verified evidence. Agent output is supporting context rather than an authoritative source.
- Prompts reject current task requests, future plans, procedural task instructions, repository-obvious detail, transient state such as uncommitted work or test counts, guesses, and secrets. Recaps require a concrete completed task outcome; ongoing work, questions and answers, advice, explanations, discussions, and casual conversation do not qualify.
- Memory is disabled per project from `/memory`. Disabling stops new collection, system context, and persistence checks; an already-running worker request is not canceled and completes before its child session is deleted.

Worker model calls use hidden child sessions with executable tools denied. The sessions are deleted after each call. Worker failures are logged and do not fail the main prompt.

## Storage

Memory is stored outside the repository. Each project directory name is derived from its lowercase absolute path, with characters outside `a-z`, `.`, `_`, and `-` replaced by `-`, followed by an 8-character hash of the original resolved path:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/memory/-home-alice-project-a1b2c3d4/
|-- .dreams/
|   `-- <run-id>.json
|-- index.md
|-- settings.json
`-- <short-title>-<random>.md
```

Different paths, including Git worktrees, use separate memory directories. Existing hash-named memory directories are not migrated automatically. The TUI's save watcher watches only the shared memory root (for this workspace's directory key appearing) and then the project directory non-recursively; fs events are debounced and resolved against a baseline of committed index entries and topic revisions, so atomic-rename duplicates never produce spurious toasts. Content that already exists when the TUI starts never toasts; when the project directory first appears during this TUI lifetime, its initial content counts as new and attributed writes toast.

`index.md` uses one managed entry per topic. New entries carry a `[type|scope|updated]` prefix; older lines without one remain valid:

```markdown
- [Short title](short-title-a1b2c3d4.md) - [preference|editor|2026-08-23] One-line summary
- [Legacy topic](legacy-a1b2c3d4.md) - One-line summary
```

Ordinary learning classifies topics as `preference` (durable general preferences stated by the user), `instruction` (scoped general instructions that apply to future work), `recap` (concise outcomes of concretely completed tasks), or `reference` (lasting external material). Dreaming may additionally create `insight`, an explicitly derived, non-authoritative pattern supported by multiple existing topics. Ordinary extraction cannot create insights, insights are never dream inputs, and hard-cap maintenance does not reclassify them. Bodies are a few concise lines of natural prose with per-type length caps, no mandatory Why/How formatting, and no absolute dates in the body — the plugin records timing metadata itself. Existing topics classified as the retired `feedback` and `project` types stay readable.

Topic files carry plugin-owned metadata. `sessionId` is the last writer: the originating session for creation/replacement and the maintenance or dream parent session for consolidation. `scope` names where the memory applies, and `updatedAt` is the plugin-owned ISO write date. Dream outputs also carry `dreamRunId`; insights carry `sources`, an array of `filename@revision` evidence references used to prevent duplicate synthesis.

```markdown
---
revision: "random-revision-token"
type: "instruction"
scope: "plugins/memory"
sessionId: "ses_last_writer"
updatedAt: "2026-08-23"
---
```

Older topics without `type` are treated as `project`. Retired `feedback` and `project` entries stay readable and are reclassified into the current taxonomy whenever they are next replaced or consolidated; replacement bodies carry the new classification rather than the old one.

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
       "dream_model": "anthropic/claude-sonnet-4-6",
       "interval": 6,
       "idle_delay_ms": 300000,
       "dream_interval_hours": 36,
       "dream_min_additions": 7
    }]
  ]
}
```

Options:

| Option | Default | Purpose |
| --- | --- | --- |
| `classifier_model` | `small_model` | Background save classification and maintenance selection model |
| `extractor_model` | classifier model | Background extraction and consolidation model |
| `dream_model` | extractor, classifier, then `small_model` | Memory dreaming selection and curation model |
| `interval` | `6` | User turns between periodic checkpoints; minimum `2` |
| `idle_delay_ms` | `300000` | Delay before pending short-session turns are classified |
| `dream_interval_hours` | `36` | Minimum elapsed hours before automatic dreaming; must be greater than `0` |
| `dream_min_additions` | `7` | Minimum ordinary creates or replacements before automatic dreaming; positive integer |

Set `small_model` or `classifier_model` to enable save classification. Reading memory uses the normal local `read` tool and does not require a model worker.

For manual installation, register the same package in `tui.json`:

```json
{
  "plugin": ["@jiafuei/opencode-memory"]
}
```

`/memory` toggles auto-memory and automatic dreaming, starts a dream, and opens the index, topic files, or storage folder using `$VISUAL` and then `$EDITOR`. `/dream` starts the same manual dreaming pass without adding a conversation message. Automatic dreaming is disabled until enabled from `/memory`.

Successful tool activity may be sent to different providers when the classifier and extractor models differ from the main conversation model. Dreaming sends the memory index and selected complete topic files to its configured model. Configure all worker models within the intended data-disclosure boundary.

Quit and restart OpenCode after installing or changing plugin configuration.
