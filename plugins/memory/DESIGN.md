# Memory design

How memory reaches the model, how it is kept consistent, and how dreaming works. For installation and usage, see the
[README](README.md). The server plugin is in `server.tsx`; the TUI plugin is in `tui.tsx`.

## Recall

The first request of a session (the `context` hook) adds a `<memory>` system block with the root index. The block is
cached for the rest of the session so the provider prompt cache stays warm. Only current hierarchy roots appear in
this view. `preference` and `instruction` entries are followed unless the conversation says otherwise; `fact`,
`working`, `recap`, `reference`, `insight`, and legacy `feedback`/`project` entries are hints the model reads (with the
`memory` tool's `read` action) and verifies before relying on them.

Child sessions (with a `parentID`) and workflow workers (metadata `workflowWorkerID`) get the full content of
`preference` and `instruction` topics inline and an index of the remaining hint topics. Their `memory` tool exposes
only `read` and `search`; the executor independently refuses save/delete, including before the first context hook.
Their snapshots remain cached, with no updates or reflection.

Model-facing index lines use `[id: topic.md]`, not file links; on-disk lines retain their Markdown link format. Agents copy exact
topic identifiers into the memory tool instead of constructing filesystem paths. Each read consults the current index
and topic body. Reading a summary also lists its immediate children as topic IDs; repeated reads descend through any
number of layers. Literal search scans retained records independently of the root view, so summary omissions do not
make details unreachable. Superseded records remain identifiable as history. An unavailable topic returns the current
root index, without aliases or fuzzy matching.

## Updates

On the first request of each genuine user turn, the current index is compared with the index that session already
knows. Changed entries and removal notices are appended to that user message inside `<system>` tags (never to
synthetic or compaction messages). The update text is frozen, so later requests replay it identically without
rewriting the cached snapshot or earlier messages. This also catches changes made while a session was unloaded and
hand edits to the index and body-only edits to active topics. Known entries include a body revision (persisted only in
session state); changed revisions generate reread notices. Direct tool saves and deletions are acknowledged without
redundant updates. Reflection saves remain pending for the originating session's next user turn because its model
has not seen the background save result. Sessions upgraded from before revision tracking establish a baseline without
re-listing every unchanged topic.

Each session's snapshot, known index, frozen update text, reflection cursor, and saved-topic list persist in plugin
storage (`ctx.storage`, key `session/<sessionID>`), so a restart or plugin reload renders byte-identical context.
After a compaction the next request takes a fresh snapshot (which includes every committed update) and drops old
updates. The entry is removed when the session is deleted.

## Saving

Primary agents get a `memory` tool: `save` creates a detailed record; a `target` correction creates a new record and
marks the old one superseded, retaining its body. `read` retrieves details or summary children; `search` finds retained
records. The authoring contract permits user-stated or explicitly confirmed preferences, instructions, facts, working
details, recaps, and references. Tentative ideas retain their uncertainty. Assistant output and tool results alone do
not establish memories. Saves emit a `Saved: <title>` toast and count toward automatic dreaming.

Corrections target detailed records, not derived summaries. Changing a source invalidates all dependent summaries;
unaffected details become roots again. Source capture preserves complete qualifications and uncertainty; compression
belongs in derived layers. Explicit deletion removes the selected record and dependent summary bodies, not sibling
details or earlier versions. Deleting a summary unfolds it. If a replacement was deleted, an earlier retained detail
may be explicitly corrected again without automatically restoring it. Legacy `feedback` and `project` remain readable.

## Reflection

When a primary session goes idle for `idle_delay_ms` after an execution finishes, one worker call reviews the messages
since the last reflection (user and assistant text only) together with the index and the topics already saved in the
session. It sees the root index and an index of current detailed records, including consolidated ones, to avoid
duplicate capture. Superseded history stays out of reflection, even if its replacement was deleted; recovering it
requires an explicit foreground tool save. Reflection is asked to read up to eight details in one lookup round and
propose up to three saves. Explicit user corrections may target a supplied detail, creating a superseding record
while preserving its type. The commit rechecks that detail's revision so concurrent changes cannot be overwritten.
Summaries may not be targeted. Unknown read IDs, extra lookup requests, and unread corrections are skipped with
visible warnings while valid siblings continue. Valid replies are not rejected solely for exceeding suggested counts.
Working details and facts are not forced into instruction types. Most reviews save nothing. Worker failures are
logged and surfaced in the TUI; a successful review advances the cursor, with individual failed commits reported too.

## Dreaming

A save crossing `dream_index_bytes` or `dream_topic_limit` for dreamable roots starts a dream. Pinned rules do not count
toward these thresholds. Threshold runs respect Auto-dream and the retry backoff, and do not repeat on every save
while already over budget. Dreams also run from
`/dream`, **Dream now** in `/memory`, or the automatic gate (`dream_interval_hours` elapsed and `dream_min_additions`
creates/replacements since the last successful run).

A run consolidates eligible hint roots in at most eight actions. Each synthesis adds an `insight` above 2–8 related
roots and retains every source. A summary can become a child of another summary, creating progressively coarser
layers. The selector favors keeping recent working details fine-grained; elapsed time and accumulation trigger
maintenance, not deletion. Preferences and instructions remain roots and are excluded from dreaming.

Grouping is topical rather than OptMem's chronological binary grouping. The LSM-like property is progressive
consolidation, not sorted-key storage. Context thresholds trigger consolidation; they are not hard context caps when
no justified grouping exists. Automatic pruning and quarantine purging are no longer performed.

Every run writes a decision-only manifest under `dreams/`. One server process runs at most one dream at a time. Dream
commits recheck enabled state, source eligibility, metadata, and contents, and abort the run when a source changed.
Source revisions let reads detect manual edits and unfold stale ancestors rather than continuing to expose them as
current summaries. Observed stale summaries are permanently marked retired under the write queue, retaining bodies
as history but excluding them from roots, search, and dreaming. Reverting an edit cannot resurrect a retired parent;
future dreams build replacement layers from the unfolded details. Summary creation dates remain intact, with a
separate sources-through date so old evidence does not look new after summarization. Missing bodies keep their
catalog records but are not active or eligible for dreaming.

The browser defaults to active topics and offers retained-history filtering and source/parent/replacement/earlier-version
navigation by title. Editing a consolidated topic warns about retiring summaries. Malformed catalog metadata remains
an error, surfaced through logs and a deduplicated TUI error event. Catalog/body reads are batched four at a time;
ordinary views skip superseded and retired bodies, which are loaded on demand for explicit reads or history search.
Revisions are not cached across turns, so cost still grows with current detailed records. Browsing while disabled
may derive temporary statuses but never persists summary retirements.

Workers (reflection and dreaming) are one-shot text generations with no session and no tools; replies must decode as
JSON matching the worker's schema.

## Disabling

Disabled memory adds no context, including past updates, hides the tool, skips reflection, and refuses reads and new
writes; a write already in progress finishes. Cached snapshots and frozen updates stay stored for re-enabling; index
changes made meanwhile arrive on the next enabled user turn.

## Storage

The project directory name is derived from the lowercase absolute project path, with characters outside `a-z`, `.`,
`_`, and `-` replaced by `-`, followed by an 8-character hash of the resolved path.

Topic bodies and the full retained-record catalog live in Markdown. Optional hierarchy/correction metadata is encoded
in trailing HTML comments on index lines. Existing lines are level-zero records without a migration. The root view is
derived from valid parent-child links; it is not a separate source of truth.

Settings, dream bookkeeping, and per-session state live in the server plugin's key-value storage (`ctx.storage`):

```text
memory/<project-key>/settings              { enabled?, dream_auto? }
memory/<project-key>/dream                 automatic-dream counters
memory/<project-key>/dreams/<run-id>       decision-only manifest
session/<session-id>                       snapshot, known index, and frozen updates
```

Writes are serialized in-process only; concurrent writes from separate OpenCode processes on the same project are not
coordinated. Every file write goes through a temporary file and a rename. New bodies are published before the catalog;
explicit deletion publishes the catalog before removing bodies. Consolidation retains its sources. Existing legacy
quarantine data is not the hierarchy and is not automatically purged.
