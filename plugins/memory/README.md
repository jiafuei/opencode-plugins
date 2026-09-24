# Memory

Project-scoped memory with a Claude Code-like `/memory` browser. Memory is a compact hint layer for context that would be expensive to re-derive, not a changelog or source of truth. The server plugin is in `server.tsx`; the TUI plugin is in `tui.tsx`.

## Behavior

- **Recall.** The first request of a session (the `context` hook) adds a `<memory>` system block with the memory directory and the full managed index. The block is cached for the rest of the session so the provider prompt cache stays warm. `preference` and `instruction` entries are user-stated and are followed unless the conversation says otherwise; `recap`, `reference`, `insight`, and legacy `feedback`/`project` entries are hints the model reads (with the normal `read` tool) and verifies before relying on them. External-directory permission asks are auto-allowed when every requested directory is this memory directory.
- **Saving.** Primary agents get a `memory` tool (`save` creates, or replaces an indexed `target`; `delete` removes the index entry and topic file). The tool description is the authoring contract: user-stated preferences and instructions, corrections worth keeping, hard-won findings (`recap`), and lasting external material (`reference`). Saves go through the same locked commit path as everything else, emit a `Saved: <title>` toast, and count toward automatic dreaming.
- **Reflection.** When a primary session goes idle for `idle_delay_ms` after an execution finishes, one worker call reviews the messages since the last reflection (user text, assistant text, tool calls with input and output truncated to about 2 KB each) together with the index and the topics already saved in the session, and saves up to three new topics the agent missed; it never rewrites existing topics. Most reviews save nothing. The cursor advances only when the worker call succeeds; failures are logged to stderr. The TUI shows `Reviewing conversation...` while it runs.
- **Updates in a live session.** Saves, deletions, and dream changes reach other live sessions as a compact `<memory_update>` part on their next genuine user message (never on synthetic or compaction messages). Deltas are frozen per user message so every later request re-renders them identically. The originating session gets none; it already knows.
- **Restarts and compaction.** Each session's snapshot, frozen and pending deltas, reflection cursor, and saved-topic list persist in plugin storage (`ctx.storage`, key `session/<sessionID>`), so a restart or plugin reload renders byte-identical context. After a compaction the next request takes a fresh snapshot (which includes every committed update) and drops old deltas. The entry is removed when the session is deleted.
- **Subagents and workflow workers.** Child sessions (with a `parentID`) and workflow workers (metadata `workflowWorkerID`) get a compact block with only `preference` and `instruction` entries, no `memory` tool, no deltas, and no reflection.
- **Maintenance and dreaming.** Maintenance removes index entries whose files are missing and orphan topic files, and starts a dream when the index exceeds 32 KiB or 200 topics. Dreams run from `/dream`, `Dream now` in `/memory`, or the opt-in automatic gate (`dream_interval_hours` elapsed and `dream_min_additions` creates/replacements since the last successful run). A run performs at most eight actions: `synthesize` replaces 2–8 related topics with one self-contained topic (mixed-type groups become non-authoritative `insight`s), and `prune` asks a tool-free curator for an independent keep/remove verdict per nominated topic; removals need evidence where the category requires it and move to `.trash/<run-id>/`, which a later successful run purges. Every run writes a decision-only manifest under `.dreams/`; `.dream.lock` prevents duplicate runs across processes. The sidebar shows `Dreaming...` while a run is active, and manual failures show a warning toast.
- **Disabling.** `/memory` toggles memory per project. Disabled memory adds no context, hides the tool, skips reflection, and refuses new writes; a write already in progress finishes. Malformed settings report an error instead of silently enabling memory.

Workers (reflection and dreaming) are one-shot text generations with no session and no tools; replies must decode as JSON matching the worker's schema.

## Storage

Memory is stored outside the repository. Each project directory name is derived from its lowercase absolute path, with characters outside `a-z`, `.`, `_`, and `-` replaced by `-`, followed by an 8-character hash of the original resolved path:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/memory/-home-alice-project-a1b2c3d4/
|-- .dreams/
|   `-- <run-id>.json
|-- .trash/
|   `-- <run-id>/
|       `-- <quarantined-topic>.md
|-- index.md
|-- settings.json
`-- <short-title>-<random>.md
```

Different paths, including Git worktrees, use separate memory directories. Existing hash-named memory directories are not migrated automatically.

`index.md` uses one managed entry per topic. New entries carry a `[type|scope|updated]` prefix; older lines without one remain valid:

```markdown
- [Short title](short-title-a1b2c3d4.md) - [preference|editor|2026-08-23] One-line summary
- [Legacy topic](legacy-a1b2c3d4.md) - One-line summary
```

Saves create topics classified as `preference` (durable general preferences stated by the user), `instruction` (scoped general instructions that apply to future work), `recap` (hard-won completed-task context worth avoiding re-derivation), or `reference` (lasting external material). Replacing an existing insight preserves its type. Synthesis preserves a shared source type; mixed-type groups produce an `insight`, a non-authoritative memory that distinguishes derived conclusions from user-stated facts. A group containing an insight cannot become an instruction or preference. Existing topics classified as the retired `feedback` and `project` types stay readable.

Summaries are short one-line hooks describing the topic's coverage, not substitutes for the facts. Topic bodies are a few short sentences: the fact first, then why it matters or when it applies. This is prompt guidance; the plugin enforces no character or byte limits. Meaningful dates may remain in the body; the plugin separately records when the topic was written.

Topic files carry plugin-owned metadata. `sessionId` is the last writer: the originating session for creation/replacement and the requesting or most recently active session for synthesis (omitted when no session is known). `scope` names where the memory applies, and `updatedAt` is the plugin-owned ISO write date. Synthesis outputs also carry `dreamRunId`, linking them to the run's decision-only manifest.

```markdown
---
revision: "random-revision-token"
type: "instruction"
scope: "plugins/memory"
sessionId: "ses_last_writer"
updatedAt: "2026-08-23"
---
```

Older topics without `type` are treated as `project`. Retired `feedback` and `project` entries stay readable and are reclassified into the current taxonomy when replaced; synthesis preserves their shared type like any other same-type group.

Before committing, the plugin checks enabled state at transaction entry and index membership; dream commits also compare complete source file contents, including revision metadata. Writes are serialized in-process and coordinated across processes with an atomic lock directory; stale locks are reclaimed after a crash. Topic/index replacements remain atomic and an index-write failure rolls back the topic. Prune quarantine moves are rolled back if the coordinated index update fails. `.trash` never enters snapshots, indexes, or maintenance. Maintenance also removes index entries whose files are missing and deletes root topic `.md` files confirmed absent from the index.

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

`/memory` toggles memory and automatic dreaming, starts a dream, and opens the index, topic files, or storage folder with `$VISUAL` or `$EDITOR`. `/dream` starts a manual dream without adding a conversation message.

Disclosure: reflection sends the session's user text, assistant text, and truncated tool input and output to `reflect_model`, along with the memory index. Dreaming sends the index and selected complete topic files to `dream_model`. Choose both within your intended data-disclosure boundary.

Quit and restart OpenCode after installing or changing plugin configuration.
