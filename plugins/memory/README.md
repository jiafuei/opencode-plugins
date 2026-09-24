# Memory

Project-scoped automatic memory with a Claude Code-like `/memory` browser. Memory is a compact hint layer for context that would be expensive to re-derive, not a changelog or source of truth. The server plugin is in `memory_server.tsx`; the TUI plugin is in `memory_tui.tsx`.

## Behavior

- On the first primary-agent request in a session (the `context` session hook), a `<memory>` system block snapshots the absolute memory directory and complete current managed index. The snapshot is cached and stays immutable for the rest of that session without rereading the index, which keeps the request prefix stable for provider prompt caches. This initial local file read does not call a model.
- Memory saved after that snapshot reaches the originating session as a compact `<memory_update>` text part appended to the next genuine user message in the same `context` hook. A user message is genuine when the `prompt` hook saw it; synthetic, skill, shell, and compaction messages never receive deltas. The part is marked untrusted and non-authoritative, lists only the added or updated index lines (never topic bodies or the full index), and states that it supersedes matching entries in the initial snapshot. Deltas are frozen per user message at its first request: saves committing later in the same tool loop defer to the following user turn, every historical user message keeps its own frozen assignment and part across requests (the injection is not persisted), assignments are pruned as messages leave the model history, and all delta state is cleared when the session is deleted.
- When prior preferences, instructions, recaps, or references may matter, the model uses the normal `read` tool with the directory and an exact indexed filename. Memories are hints only, not authoritative facts, and relevant details must be verified against the current conversation, project state, or primary sources before use. Index summaries are not substitutes for topic contents, and both index and topic data are marked untrusted and potentially stale.
- External-directory permission asks are automatically allowed when every requested directory is this project’s memory directory. OpenCode requests external-directory approval per directory, so the grant covers the whole directory rather than individual indexed files; the tool's own read or edit permission still applies. Sibling and unrelated directories retain their normal permission handling.
- Checkpoints capture only the text of previously completed genuine user prompts (the `prompt` hook). Assistant output and tool activity are never collected or sent to memory workers, so ordinary memory cannot automatically retain facts inferred from the codebase or the model's own output. When a new real user message arrives and either `interval` turns have completed or the buffered text reaches 12 KiB, the buffered prompts are snapshotted before the new prompt is buffered — the triggering prompt is never classified. The size threshold triggers an earlier checkpoint; messages are never truncated or discarded to fit it. A save classification returns up to three atomic decisions, each a narrow subject describing exactly one thing to remember, and extraction is constrained to that subject. Everything runs in the background and does not delay that user message or later messages.
- An idle timer, armed when a session's execution finishes, saves the final pending user messages from short sessions that do not reach a periodic checkpoint. A checkpoint whose classification or extraction fails restores its buffered source unchanged, and that buffer is not offered for review again until another genuine user message is collected.
- The server and TUI talk over the plugin RPC contract in `memory_rpc.ts`. Each checkpoint emits one `review` event when classification starts, each committed ordinary save emits a `saved` event, and dreams emit `dream` status events. The TUI shows `Memory: Reviewing conversation...` and `Memory: Saved: <topic title>` toasts only for sessions it knows; dream-produced topics never emit per-topic save events (the run's completion toast covers them).
- `/memory` does not create the per-project directory just by being opened; it shows the normal selector with an empty memory list when storage does not exist yet. The directory is created lazily at true write boundaries: toggling auto-memory, opening the folder or a topic file from `/memory`, or the server's first coordinated write.
- Maintenance and dreaming share one cleanup engine and the configured dream model. It runs when the managed index exceeds 32 KiB or 200 topics, on `/dream` or `Dream now`, or through the opt-in automatic gate. Workers receive complete selected files, and source contents are rechecked before commit.
- A run performs at most eight actions: `synthesize` replaces 2–8 related topics with one self-contained memory, while `prune` reviews 1–8 nominated topics independently. Synthesis combines duplicates, resolves supported corrections, and captures useful implications while preserving still-useful facts and qualifications. Same-type groups retain their type; mixed-type groups become non-authoritative insights. The selector avoids mixing types when doing so would lose actionable user instructions or preferences. Existing insights may be synthesized again.
- Synthesis always removes its sources from the index and deletes their topic files after publishing the replacement. It remains available at any store size. The target of 30 indexed topics is guidance, not a quota: never combine unrelated topics or remove information merely to reduce count, and never treat recency alone as proof. Invalid selections are retried once; if still invalid after earlier actions committed, the run keeps those changes and stops successfully.
- Automatic dreaming requires both `dream_interval_hours` to have elapsed and `dream_min_additions` ordinary creates or replacements since the previous successful run. Defaults are 36 hours and 7 additions. Enabling it on an existing project seeds the addition count from the current topic count and starts a fresh interval window. Successful no-op runs reset the gate; failed runs retain it and back off before retrying.
- Dream results apply automatically. While a run is active, the sidebar of the session that requested it (or, for automatic runs, the most recently active session) shows a `Memory` section with `Dreaming...`; the indicator clears on success, no-op, or failure. Manual failures show a warning toast to the requesting TUI; automatic failures are recorded only in their manifest. A manual request while another OpenCode process holds the dream lock fails immediately. Every run writes a decision-only manifest under `.dreams/`. Prune actions record every file verdict, category, reason, evidence paths, and quarantine path without copying topic contents into the manifest. A separate `.dream.lock` prevents duplicate runs across OpenCode processes without holding the short-lived commit lock during model calls.
- All workers, including the prune curator, are tool-free and judge only from the supplied topics; inability to verify requires a keep verdict. Repository-recoverable and superseded removals require nonempty evidence paths named in the topics, while self-evident task receipts, stale plans, generic/non-actionable notes, and duplicates may need no citation.
- Approved prunes are removed atomically from the index and moved to `.trash/<run-id>/` rather than deleted. Topic references already missing their files are removed directly from the index at dream snapshot time and counted as pruned; there is no file to quarantine. A successful later run, including a no-op, purges quarantine from successful older runs while retaining the current run's quarantine; failed runs do not purge. Dream changes reach every live project session as compact additions and removal tombstones. Prune status and toast counts report topic files removed rather than one batch action. Dream-produced topics do not emit ordinary per-topic save notifications; no-op runs stay silent.
- Synthesis manifests record the decision reason and resulting topic, without source filenames, revisions, or contents. Replaced sources are deleted, not quarantined. Legacy `sources` metadata does not protect topics from synthesis or cause cascading removal; every prune requires its own verdict.
- Ordinary learning workers receive only genuine user-authored text. Synthetic messages, assistant output, tool calls, tool activity, and tool output bodies are never collected. Existing index entries are supplied only for duplicate detection and replacement targeting, not as evidence for new claims.
- Prompts require every saved claim to be directly supported by self-contained user text. They reject current task requests, future plans, procedural task instructions, questions, pasted code, diffs, logs, errors, repository-obvious detail, transient state such as uncommitted work or test counts, guesses, secrets, and terse confirmations without their own context. A prior outcome qualifies for a recap only when the user explicitly states or confirms non-obvious rationale, continuing constraints, unresolved concerns, rejected alternatives, hard-won diagnoses or negative findings, or a conclusion that would require re-derivation rather than merely re-checking code, git, tests, or docs. Commit receipts, passing tests, file edits, cleanups, and review results are not memories by themselves; codebase facts learned by the assistant are never memorized automatically.
- Memory is disabled per project from `/memory`. Disabling stops new collection, system context, and new write transactions; an already-running write transaction finishes. Worker requests are not canceled. Missing settings use defaults; malformed settings report an error rather than silently enabling memory.

Worker model calls are one-shot text generations (no session, no tools). The prompt demands a JSON reply matching the worker's schema; replies that do not decode fail the worker. Worker failures are written to stderr and do not fail the main prompt.

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

Ordinary learning creates topics classified as `preference` (durable general preferences stated by the user), `instruction` (scoped general instructions that apply to future work), `recap` (hard-won completed-task context worth avoiding re-derivation), or `reference` (lasting external material). Updating an existing insight preserves its type. Synthesis preserves a shared source type; mixed-type groups produce an `insight`, a non-authoritative memory that distinguishes derived conclusions from user-stated facts. A group containing an insight cannot become an instruction or preference. Existing topics classified as the retired `feedback` and `project` types stay readable.

Summaries are concise, one-line retrieval descriptions of the topic's coverage and distinctive terms, not substitutes for the facts. Topic bodies use as much space as needed to preserve useful conditions, exceptions, and rationale, in short paragraphs or bullets. Neither summaries nor bodies have arbitrary character or byte limits; full existing topics remain available to replacement and synthesis workers. Meaningful dates may remain in the body; the plugin separately records when the topic was written.

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

Older topics without `type` are treated as `project`. Retired `feedback` and `project` entries stay readable and are reclassified into the current taxonomy when replaced through ordinary learning; synthesis preserves their shared type like any other same-type group.

Before committing, the plugin checks enabled state at transaction entry, index membership, and complete file content. The content comparison includes revision metadata. Writes are serialized in-process and coordinated across processes with an atomic lock directory; stale locks are reclaimed after a crash. Topic/index replacements remain atomic and an index-write failure rolls back the topic. Prune quarantine moves are rolled back if the coordinated index update fails. `.trash` never enters snapshots, indexes, or maintenance. Maintenance also removes index entries whose files are missing and deletes root topic `.md` files confirmed absent from the index.

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
        "classifier_model": "anthropic/claude-haiku-4-5",
        "classifier_variant": "low",
        "extractor_model": "openai/gpt-5.6-luna",
        "extractor_variant": "xhigh",
        "dream_model": "anthropic/claude-sonnet-4-6",
        "dream_variant": "high",
        "interval": 6,
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
| `classifier_model` | OpenCode's default model | Background save classification model |
| `classifier_variant` | model default | Variant for classifier workers; requires a classifier model |
| `extractor_model` | classifier model | Background extraction model |
| `extractor_variant` | classifier variant when the model falls back | Variant for extractor workers |
| `dream_model` | extractor, then classifier model | Memory dreaming selection and curation model |
| `dream_variant` | extractor or classifier variant when the model falls back | Variant for dream workers |
| `interval` | `6` | User turns between periodic checkpoints; minimum `2` |
| `idle_delay_ms` | `300000` | Delay before pending short-session turns are classified |
| `dream_interval_hours` | `36` | Minimum elapsed hours before automatic dreaming; must be greater than `0` |
| `dream_min_additions` | `7` | Minimum ordinary creates or replacements before automatic dreaming; positive integer |

Models use `provider/model` format. Without any configured model, workers use OpenCode's default model. Reading memory uses the normal local `read` tool and does not require a model worker.

Variant fallback follows model fallback. For example, an extractor without `extractor_model` or `extractor_variant` inherits both classifier settings. If `extractor_model` is set explicitly, it uses that model's default variant unless `extractor_variant` is also set.

`/memory` toggles auto-memory and automatic dreaming, starts a dream, and opens the index, topic files, or storage folder using `$VISUAL` and then `$EDITOR`. `/dream` starts the same manual dreaming pass without adding a conversation message. Automatic dreaming is disabled until enabled from `/memory`.

User-authored messages may be sent to different providers when the classifier and extractor models differ from the main conversation model. Assistant output and tool activity are not sent to those workers. Dreaming sends the memory index and selected complete topic files to its configured model. Configure all worker models within the intended data-disclosure boundary.

Quit and restart OpenCode after installing or changing plugin configuration.
