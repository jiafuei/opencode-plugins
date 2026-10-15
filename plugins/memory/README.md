# Memory

Project-scoped memory for OpenCode, with a Claude Code-like `/memory` browser. The model remembers your preferences,
instructions, facts, and working details across sessions, so you don't have to repeat them. Detailed records remain
available beneath progressively coarser summaries. Memory is a hint layer, not a source of truth.

## How it works

- **Recall.** Each session starts with the project's memory index in context. Preferences and instructions you gave
  are followed; other entries are hints the model reads in full and verifies before relying on them.
- **Saving.** The model saves user-stated or explicitly confirmed preferences, instructions, facts, and working
  details with `memory_save`, and updates existing details with `memory_correct`. Conditions, qualifications, and uncertainty are preserved before summarization.
  Tentative ideas stay labeled as tentative. A `Saved: <title>` toast shows each save.
- **Reflection.** When a session goes idle, a background review catches user-grounded memories the model missed.
  It can read existing details and apply explicit user corrections while retaining the previous version. The TUI
  shows `Reviewing conversation...` while it runs.
- **Updates.** Saves and index/body edits reach primary sessions on their next user message as reread notices.
- **Dreaming.** As memory grows, background consolidation adds summaries over related topics without deleting their
  sources. Summaries can themselves be summarized, building multiple layers. Preferences and instructions are never
  folded into summaries. The sidebar shows `Dreaming...` while it runs.
- **Retrieval.** Read a summary to discover its source IDs, then read those IDs for more detail. All-words search reaches
  retained records directly, including details omitted from summaries.
- **Subagents** get your preferences and instructions inline, an index of other topics, and read/search access to memory.
  They cannot save or delete memories.

Memory is designed to keep the provider's prompt cache warm: what the model sees doesn't change mid-session, and new
memories arrive as small additions instead.

## Memory types

| Type | What it holds |
| --- | --- |
| `preference` | Durable general preferences you stated |
| `instruction` | Scoped instructions that apply to future work |
| `fact` | A granular fact you stated or explicitly confirmed |
| `working` | User-grounded working details, including clearly labeled tentative ideas |
| `recap` | Context from a completed hard task, to avoid re-deriving it |
| `reference` | Lasting external material |
| `insight` | A derived summary with links to its source records; a hint, not a fact you stated |

Assistant conclusions and tool results alone do not establish memories. Assistant text may explain what your explicit
confirmation refers to; "thanks", "ok", and silence alone do not confirm a claim. Working details are tentative unless
you explicitly decide or abandon them; no exact `Status:` prefix is required. Secrets should not be saved.

## Agent tools

Each operation is a separate tool with a plain object input:

| Tool | Inputs | Behavior |
| --- | --- | --- |
| `memory_read` | `id` | Read a detail, summary topic, or explicitly labeled historical version |
| `memory_search` | `query`, optional `offset` | Find records containing every query word, in any order and case |
| `memory_save` | `title`, `summary`, `content`, `type` | Create a new record; `summary` is its short index hook |
| `memory_correct` | `id`, `content`; optional `title`, `summary`, `type` | Replace a detail's complete content; omitted metadata is inherited |
| `memory_delete` | `id` | Remove a selected record; deleting a summary topic preserves its sources |

For example, `memory_correct({ id: "fixture-plan-a1b2c3d4.md", content: "The user decided to use isolated Redis fixtures." })`
retains the record's title, index hook, and classification. Empty optional titles/hooks also keep their existing values;
new records need a non-empty title. Legacy non-derived insights keep their `insight` type rather than becoming rules.
The result names the new current ID and marks the previous
ID historical. Read details when needed to preserve their qualifications; there is no mandatory read or confirmation gate.
Workers receive only `memory_read` and `memory_search`.

These named tools replace the former `memory({ action, target, ... })` API, without aliases. Existing stored records
and session snapshots are retained; a current API guide supersedes action-based instructions in cached snapshots.

## Storage

Memories are plain markdown files outside the repository, easy to read and edit by hand. Each project (including each
Git worktree) gets its own directory:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/memory/-home-alice-project-a1b2c3d4/
|-- index.md
`-- <short-title>-<random>.md
```

`index.md` catalogs retained records, with one line per topic:

```markdown
- [Short title](short-title-a1b2c3d4.md) - [preference|2026-08-23] One-line summary
```

Hierarchy and correction metadata are stored in trailing HTML comments on index lines. Existing flat indexes work
without migration. The session index shows only current roots: summaries, uncompacted details, and pinned rules.
The model sees topic identifiers rather than file links:

```text
- Short title [id: short-title-a1b2c3d4.md] - [preference|2026-08-23] One-line summary
```

Agents retrieve topics with `memory_read({ id: "short-title-a1b2c3d4.md" })`, not filesystem paths. Successful reads name
the requested ID and distinguish current rules, hints, derived summary topics, and historical versions. Historical
instructions are not current guidance; derived summaries are not user statements. Consolidated source IDs remain
readable. Search with `memory_search({ query: "Redis fixture" })`. Every whitespace-separated word must occur, ignoring
order and case; commas and double quotes also separate words rather than requiring literal punctuation. Each word is
a literal substring, not a regex, semantic match, or ordered phrase. A miss is not proof a subject is absent.
Try fewer or different words. Results provide a
next `offset` when there are more than 20 matches; repeat the same query with that offset. Concurrent saves can shift
pages. Retired summaries are excluded from search but remain browsable. Missing IDs return the current root index.

Topic files hold the body alone, with no frontmatter; metadata lives in the index. Edits to source content or metadata
permanently retire dependent summaries when detected, exposing finer details again. Retired bodies remain as history;
reverting an edit does not reactivate an observed stale summary. Missing-body records keep their metadata and are
hidden from active context until restored; their retired ancestor summaries do not reactivate when files return.
Preserve hierarchy comments when editing metadata; malformed metadata is
reported through logs and an error toast rather than silently discarded. Lines outside the index format are dropped
the next time the plugin writes the index.

Correcting a detailed record creates a new ID and retains the old record as superseded. Metadata is inherited unless
explicitly changed. Correct an incorrect source
detail; if only the summary is wrong, delete/unfold it and run dreaming again. Explicit deletion removes the selected
record and dependent summaries, not earlier versions or sibling details. Deleting a summary lists its preserved source
IDs and does not generate a replacement summary; the user can run `/dream` to rebuild layers.
Deleting a replacement does not restore its predecessor automatically, but that retained predecessor can be explicitly
corrected again. Consolidation never expires original records automatically.

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
| `dream_interval_hours` | `36` | Minimum interval for periodic automatic dreams |
| `dream_min_additions` | `7` | Minimum additions/replacements for periodic automatic dreams |
| `dream_index_bytes` | `8192` | Dreamable root-index byte threshold; crossing it starts a dream |
| `dream_topic_limit` | `200` | Dreamable root-count threshold; crossing it starts a dream |

Auto-dream controls both periodic and threshold-triggered runs. Thresholds exclude pinned rules, trigger only on a
crossing, and respect the failure retry backoff. An already-running dream may finish after Auto-dream is disabled;
manual `/dream` remains available while automatic dreaming is off. Thresholds are maintenance triggers, not hard caps.

Models use `provider/model` or `provider/model#variant`. Quit and restart OpenCode after installing or changing the
configuration.

## Commands

- `/memory` controls memory and automatic dreaming and lists active topics first. **Show retained history** includes
  consolidated details, superseded versions, retired summaries, and missing records. Choosing a topic opens navigation
  to its sources, parent summary, replacement, or earlier versions by title, plus **Open in editor** (`$VISUAL` or
  `$EDITOR`). Editing a consolidated record warns that its summaries will retire. Toggling
  memory can invalidate the provider's prompt cache.
- `/dream` starts a dream without adding a conversation message.

## Data disclosure

Reflection sends the session's user and assistant text and root/detail indexes to `reflect_model` for selection; when
capture is needed, a separate extraction call receives the selected detail bodies as well. Dreaming sends the index
and selected topics to `dream_model`. Choose both within your intended
data-disclosure boundary.

See [DESIGN.md](DESIGN.md) for how recall, updates, reflection, and dreaming work in detail.
