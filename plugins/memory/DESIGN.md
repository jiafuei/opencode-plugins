# Memory design

How memory reaches the model, how it is kept consistent, and how dreaming works. For installation and usage, see the
[README](README.md). The server plugin is in `server.tsx`; the TUI plugin is in `tui.tsx`.

## Recall

The first request of a session (the `context` hook) adds a `<memory>` system block with the full index. The block is
cached for the rest of the session so the provider prompt cache stays warm. `preference` and `instruction` entries are
followed unless the conversation says otherwise; `recap`, `reference`, `insight`, and legacy `feedback`/`project`
entries are hints the model reads (with the `memory` tool's `read` action) and verifies before relying on them.

Child sessions (with a `parentID`) and workflow workers (metadata `workflowWorkerID`) get a compact block with the full
content of `preference` and `instruction` topics inline, no `memory` tool, no updates, and no reflection.

## Updates

On the first request of each genuine user turn, the current index is compared with the index that session already
knows. Changed entries and removal notices are appended to that user message inside `<system>` tags (never to
synthetic or compaction messages). The update text is frozen, so later requests replay it identically without
rewriting the cached snapshot or earlier messages. This also catches changes made while a session was unloaded and
hand edits to the index. The session that made a save or deletion acknowledges it without receiving a redundant update.

Each session's snapshot, known index, frozen update text, reflection cursor, and saved-topic list persist in plugin
storage (`ctx.storage`, key `session/<sessionID>`), so a restart or plugin reload renders byte-identical context.
After a compaction the next request takes a fresh snapshot (which includes every committed update) and drops old
updates. The entry is removed when the session is deleted.

## Saving

Primary agents get a `memory` tool: `save` creates a topic, or replaces an indexed `target`; `read` returns a topic's
content; `delete` removes the index entry and topic. The tool description is the authoring contract: user-stated
preferences and instructions, corrections worth keeping, settled conclusions of hard-won questions (`recap`, not
in-progress investigation notes), and lasting external material (`reference`). Saves emit a `Saved: <title>` toast and
count toward automatic dreaming.

Replacing an existing insight keeps its type. Topics of the retired `feedback` and `project` types stay readable and are
reclassified into the current types when replaced.

## Reflection

When a primary session goes idle for `idle_delay_ms` after an execution finishes, one worker call reviews the messages
since the last reflection (user and assistant text only) together with the index and the topics already saved in the
session. It saves up to three user-stated `preference` or `instruction` topics the agent missed and never rewrites
existing topics. Most reviews save nothing. The cursor advances only when the worker call succeeds; failures are logged
to stderr.

## Dreaming

A save that grows the index past `dream_index_bytes` or `dream_topic_limit` topics starts a dream. Dreams also run from
`/dream`, **Dream now** in `/memory`, or the automatic gate (`dream_interval_hours` elapsed and `dream_min_additions`
creates/replacements since the last successful run).

A run first drops index entries whose topic file is missing (listed as `orphans` in the manifest), then performs at
most eight actions:

- `synthesize` replaces 2–8 related topics with one self-contained topic. A shared source type is kept; mixed-type
  groups become an `insight`, a non-authoritative memory that separates derived conclusions from user-stated facts. A
  group containing an insight cannot become an instruction or preference.
- `prune` asks a tool-free curator for an independent keep/remove verdict per nominated topic. Removals need evidence
  where the category requires it and move to quarantine under `trash/<run-id>/`, which a later successful run purges.

Every run writes a decision-only manifest under `dreams/`. One server process runs at most one dream at a time. Dream
commits recheck enabled state, source metadata, and contents, and abort the run when a source changed.

Workers (reflection and dreaming) are one-shot text generations with no session and no tools; replies must decode as
JSON matching the worker's schema.

## Disabling

Disabled memory adds no context, including past updates, hides the tool, skips reflection, and refuses reads and new
writes; a write already in progress finishes. Cached snapshots and frozen updates stay stored for re-enabling; index
changes made meanwhile arrive on the next enabled user turn.

## Storage

The project directory name is derived from the lowercase absolute project path, with characters outside `a-z`, `.`,
`_`, and `-` replaced by `-`, followed by an 8-character hash of the resolved path.

Settings, dream bookkeeping, and per-session state live in the server plugin's key-value storage (`ctx.storage`):

```text
memory/<project-key>/settings              { enabled?, dream_auto? }
memory/<project-key>/dream                 automatic-dream counters
memory/<project-key>/dreams/<run-id>       decision-only manifest
memory/<project-key>/trash/<run-id>/<file> quarantined index entry and body
session/<session-id>                       snapshot, known index, and frozen updates
```

Writes are serialized in-process only; concurrent writes from separate OpenCode processes on the same project are not
coordinated. Every file write goes through a temporary file and a rename. A save writes the topic, then the index, and
rolls the topic back if the index write fails; a delete writes the index, then removes the topic, tolerating an
already-missing file.
