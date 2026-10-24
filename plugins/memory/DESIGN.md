# Memory design

How memory reaches the model, how it is kept consistent, and how dreaming works. For installation and usage, see the
[README](README.md). The server plugin is in `server.tsx`; the TUI plugin is in `tui.tsx`.

## Recall

The first request of a session (the `context` hook) adds a `<memory>` system block with global and current-project root indexes, labeled by scope. Primary sessions have separate sections for rules and hints. The block is
cached for the rest of the session so the provider prompt cache stays warm. Only current hierarchy roots appear in
this view. Index lines are retrieval hooks, not full instructions. Before doing work covered by a `preference` or
`instruction`, the model reads its full record and follows its conditions unless the conversation says otherwise; `fact`,
`working`, `recap`, `reference`, `insight`, and legacy `feedback`/`project` entries are hints the model reads (with the
`memory_read` tool) and verifies before relying on them. Other projects are available only through explicit cross-project
search and reads of the returned IDs, not automatic context injection.

Child sessions (with a `parentID`) and workflow workers (metadata `workflowWorkerID`) get the full content of
`preference` and `instruction` topics inline and an index of the remaining hint topics. Only `memory_read` and
`memory_search` are exposed; mutation executors independently refuse saves, corrections, and deletions, including before the first context hook.
Their snapshots remain cached, with no updates or reflection.

Model-facing index lines use `[id: topic.md]`, not file links; on-disk lines retain their Markdown link format. Agents copy exact
topic identifiers into `memory_read` instead of constructing filesystem paths. Each read consults the current index
and topic body. Reading a summary also lists its immediate children as topic IDs; repeated reads descend through any
number of layers. Search matches all query words (separated by whitespace, commas, or double quotes) as case-insensitive literal substrings, in any
order, across current detailed records independently of the root view, including details beneath summaries. Derived
summaries are excluded at every level; agents navigate them through the root index and `memory_read`. Search includes
superseded details only with `include_history: true`. It is not semantic matching; misses suggest trying fewer terms,
not assuming absence. Superseded rules are explicitly marked not current instructions, and generated summary
topics are labeled not user-stated. An unavailable topic returns the current
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
The cached memory block stays unchanged when upgrading from the action-based API; a separate current-tool guide is
added only for legacy snapshots and supersedes their old instructions without rewriting snapshots or frozen updates.
After a compaction the next request takes a fresh snapshot (which includes every committed update) and drops old
updates. The entry is removed when the session is deleted.

## Saving

Primary agents get five flat-schema tools: `memory_read(id)`, `memory_search(query, offset?, all_projects?, include_history?)`,
`memory_save(title, hook, content, type, source_message_ids, scope?)`,
`memory_correct(id, content, source_message_ids, optional metadata)`, and `memory_delete(id)`.
Tools and worker schemas call the index line text `hook` so it is not confused with summary records; it is stored as the
entry's `summary`. Primary sessions' `<memory>` block also says when to save; reflection catches what the agent misses.
Saves default to project scope; clearly general preferences may be global. Explicit global saves can use any supported
type. Corrections preserve their target's scope; cross-project search does not implicitly permit cross-project writes.
Global IDs use `global:<file>` and other-project IDs use `project:<key>:<file>`. Current-project IDs stay bare for
compatibility. Stored filenames and source links remain local; qualification happens at the tool and RPC boundaries.
Creation and correction are separate operations; omitting an optional target can no longer accidentally create a
competing current record. Corrections inherit omitted or empty title/hook metadata and create a new record, retaining the previous body
as superseded history. When every source of the corrected record came from the correcting session, the record is replaced
instead: an evolving discussion leaves one record, not a chain of drafts. Earlier versions from other sessions are relinked
to the replacement. Dashboard edits always keep history. Their responses explicitly name the new current ID. Creating a
preference or instruction with the same title, type, and cited user messages as a current record is refused as a duplicate. There is no mandatory read tracking or
confirmation gate; reading full details is recommended when needed to preserve qualifications. The authoring contract permits user-stated or explicitly confirmed preferences, instructions, facts, working
details, recaps, and references. Tentative ideas retain their uncertainty. Assistant output and tool results alone do
not establish memories. One capture threshold is shared by `memory_save` and reflection: keep explicit remember
requests, lasting rules, and durable decisions with rationale the repository does not show; skip current task requests,
plans, intermediate choices, and progress; skip when unsure. Task completion is neither a save trigger nor a
confirmation. Saves emit a `Saved: <title>` toast and count toward automatic dreaming.

Corrections target detailed records, not derived summaries. Changing a source invalidates all dependent summaries;
unaffected details become roots again. Source capture preserves complete qualifications and uncertainty; compression
belongs in derived layers. Explicit deletion removes the selected record and dependent summary bodies, not sibling
details or earlier versions. Deleting a summary unfolds it. If a replacement was deleted, an earlier retained detail
may be explicitly corrected again without automatically restoring it. Legacy `feedback` and `project` remain readable.

## Reflection

When a primary session goes idle for `idle_delay_ms` after an execution finishes, reflection reviews the messages
since the last reflection (user and assistant text only) together with the index and the topics already saved in the
session. The selector sees global and current-project roots plus a separate index of details beneath summaries, with no
duplicate entries between the indexes. Both indexes have scope labels. The extractor receives selected detail bodies,
the saved-topic list, and the transcript, without repeating the lookup indexes. Details that already cite a user message in
the batch are always supplied, so a subject the agent saved during the turn is visible before the extractor creates another.
Each create states whether it outlasts the current task; task-only creates are dropped in code, and duplicate rules are
dropped silently. Superseded history stays out of reflection, even if its replacement was deleted; recovering it
requires an explicit foreground `memory_correct` call. Reflection is asked to read up to eight details in one lookup round and
propose up to three changes. A selection-only schema returns whether extraction is needed and IDs to inspect; a no-op
review ends there. A separate extraction schema returns `create` and `correct` arrays, with no lookup field or
optional-target switch. Explicit user corrections refer to supplied details by ID and complete content, inheriting
metadata and retaining history. Optional title/hook updates keep an old index claim from contradicting the corrected
body; classification remains inherited. The commit rechecks the inspected revision so concurrent changes cannot be overwritten.
Summaries may not be corrected. Unknown selection IDs are skipped silently; unsupplied correction IDs are reported as
unresolved while valid siblings continue. Valid replies are not rejected solely for exceeding suggested counts.
Reflection chooses global scope for clearly general user preferences, or for any memory the user explicitly asks to make
global; project-specific and uncertain scope stays project-local. Existing records are not bulk-classified or promoted. Working details and facts are not forced into instruction types. Most reviews save nothing. Worker failures are
logged and surfaced in the TUI; a successful review advances the cursor, with individual failed commits reported too.

Before compaction, unreviewed user and assistant text is staged in the existing session storage. Reflection merges this
backlog with live context by message ID. Successful extraction persists the review cursor and proposed writes together,
then commits each write and removes its acknowledged proposal. Failed writes remain for the next idle review; successful
siblings are not extracted again. A changed, superseded, or deleted correction target invalidates its proposal: report it
for fresh review and remove it from automatic retries. A failed extraction keeps its original backlog. The buffer is removed after review or
session deletion. No retry daemon or attempt-based deletion is used. A crash between a successful catalog create and
the acknowledgment in session storage can duplicate that create. Resumed sessions rearm pending review when their next
execution finishes, so streaming assistant text is not treated as a complete response. Review batches have a soft
48,000-character target and stop between user turns. Remaining text stays buffered and a successful batch schedules
the next idle batch; failed extraction does not create a retry loop. A single oversized turn is kept intact. The previous
assistant reply remains available as context for interpreting a user confirmation at the next batch boundary, not as
independent user evidence.

Foreground tools and reflection cite supporting user message IDs. Source timestamps and session identity come from the
host; assistant IDs are not user evidence. New details store these references and their capture route in index metadata,
and corrections inherit previous source history. User-facing reads distinguish statement dates from capture/version dates.
The context hook adds deterministic ID/date annotations to genuine user messages and caches source dates per session.
Permanent records retain no source quotes. Direct dashboard edits have a separate capture route and do not invent chat
provenance. Legacy records remain unchanged. New summaries retain the existing source-update coverage date and also
record the latest known user-statement date when available; no complete date coverage is inferred for undated sources.

## Dreaming

A save crossing `dream_index_bytes` or `dream_topic_limit` for dreamable roots starts a dream. Pinned rules do not count
toward these thresholds. Threshold runs respect Auto-dream and the retry backoff, and do not repeat on every save
while already over budget. Dreams also run from
`/dream`, **Dream now** in `/memory`, or the automatic gate (`dream_interval_hours` elapsed and `dream_min_additions`
creates/replacements since the last successful run).

A run consolidates eligible hint roots in at most four actions. Candidates are partitioned by scope: no summary mixes
global and project sources or different projects. Automatic runs stop once hint roots are at or below `dream_target`
(default 30); a manual `/dream` may go below it. Preferences and instructions remain roots and are excluded from dreaming.

Summaries form one flat layer above details. The selector picks 2–8 related roots. A selected summary is absorbed: the
new summary is rebuilt from all details beneath it plus the other selected records, and the absorbed summary (with any
older summaries beneath it) is deleted, since summaries are derived and regenerable. A group must cover 3–12 details. A
summary written during a run is not offered again in the same run, so one run cannot stack layers on its own output.
The curator always reads detail bodies, never earlier summary prose, so a summary's distortions are not carried
upward. The selector favors keeping recent working details fine-grained; elapsed time and accumulation trigger
maintenance, not deletion. Summaries stacked by older versions remain valid until they are absorbed or retired.

Summaries are navigation overviews, not replacements for their sources. The synthesis prompt asks for shared themes
and major decisions in 150 words or fewer, usually 3-5 short bullets; no validator enforces or truncates the length.
Exact conditions, implementation details, and history stay in the linked sources unless omitting them would make the
overview misleading. Summaries do not recap each source's contribution or repeat source IDs,
because `memory_read` lists immediate sources. Summaries keep brief provenance distinctions: user-stated or confirmed,
and tentative or abandoned. They note contradictions between records instead of resolving them by recency.

Grouping is topical rather than OptMem's chronological binary grouping. Context thresholds trigger consolidation; they
are not hard context caps when no justified grouping exists. Automatic pruning and quarantine purging are no longer performed.

Every run writes a decision-only manifest under `dreams/`. One server process runs at most one dream at a time. Dream
commits recheck enabled state, source eligibility, metadata, and contents, and abort the run when a source changed.
Source revisions let reads detect manual edits and unfold stale ancestors rather than continuing to expose them as
current summaries. Observed stale summaries are permanently marked retired under the write queue, retaining bodies
as history but excluding them from roots, search, and dreaming. Reverting an edit cannot resurrect a retired parent;
future dreams build replacement layers from the unfolded details. Summary creation dates remain intact, with a
separate sources-through date so old evidence does not look new after summarization. Missing bodies keep their
catalog records but are not active or eligible for dreaming.

The TUI browser defaults to active topics, displays each record's scope, type, and status, and offers retained-history
filtering and navigation to sources, parent summaries, replacements, and earlier versions by title. A scrollable read-only
view loads the selected body through RPC, including historical bodies on demand, without requiring an external editor.
Raw file editing is available only for active or consolidated details. Its label explains that no previous version is
saved and dependent summaries retire; versioned corrections remain available through the dashboard. Malformed catalog metadata remains
an error, surfaced through logs and a deduplicated TUI error event. Catalog/body reads are batched four at a time;
ordinary views skip superseded and retired bodies, which are loaded on demand for explicit reads or history search.
Revisions are not cached across turns, so cost still grows with current detailed records. Browsing while disabled
may derive temporary statuses but never persists summary retirements.

Workers (reflection and dreaming) are one-shot text generations with no session and no tools; replies must decode as
JSON matching the worker's schema.

## Disabling

Disabled memory adds no context, including past updates, hides all five tools, skips reflection, and refuses reads and new
writes; a write already in progress finishes. Cached snapshots and frozen updates stay stored for re-enabling; index
changes made meanwhile arrive on the next enabled user turn.

## Storage

The central store has a `global` partition and project partitions shared by linked worktrees. The project directory name
is derived from OpenCode's canonical checkout path, with characters outside `a-z`, `.`,
`_`, and `-` replaced by `-`, followed by an 8-character hash of the resolved path. This keeps existing main-checkout
keys stable and treats separate clones as separate projects. Scope is represented by the partition.

Topic bodies and the full retained-record catalog live in Markdown. Optional hierarchy/correction metadata is encoded
in trailing HTML comments on index lines. Existing lines are level-zero records without a migration. The root view is
derived from valid parent-child links; it is not a separate source of truth.

On activation, an enabled instance imports its old checkout and project-directory partitions into the canonical
partition. The import copies bodies and merges unchanged catalog entries, retaining the original partition. A durable
`.scope-import.json` alias prevents later reimport and excludes the old partition from scope discovery. Imports reject
filename or body collisions before publishing a merged catalog. Other worktree partitions migrate when those worktrees
load; there is no bulk classification or promotion of existing memories into global scope.

Settings, dream bookkeeping, and per-session state live in the server plugin's key-value storage (`ctx.storage`):

```text
memory/<project-key>/settings              { enabled?, dream_auto? }
memory/<project-key>/dream                 automatic-dream counters
memory/<project-key>/dreams/<run-id>       decision-only manifest
memory/global/dream                       global automatic-dream counters
session/<session-id>                       snapshot, known index, and frozen updates
```

Writes to a partition share an in-process queue across plugin instances and the dashboard; concurrent writes from separate OpenCode processes are not
coordinated. Every file write goes through a temporary file and a rename. New bodies are published before the catalog;
explicit deletion publishes the catalog before removing bodies. Consolidation retains its sources. Existing legacy
quarantine data is not the hierarchy and is not automatically purged.
