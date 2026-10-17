# Memory

Global and project memory for OpenCode, with a Claude Code-like `/memory` browser. The model remembers your preferences,
instructions, facts, and working details across sessions, so you don't have to repeat them. Detailed records remain
available beneath progressively coarser summaries. Memory is a hint layer, not a source of truth.

## How it works

- **Recall.** Each primary session starts with separate indexes of user rules and contextual hints, labeled by global or project scope.
  Index lines are retrieval hooks, not full instructions. Before doing work a rule covers, the model reads its full record
  and follows its stated conditions unless the current conversation says otherwise. Other entries are hints the model
  reads in full and verifies before relying on them.
- **Saving.** The model saves user-stated or explicitly confirmed preferences, instructions, facts, and working
  details with `memory_save`, and updates existing details with `memory_correct`. Conditions, qualifications, and uncertainty are preserved before summarization.
  Tentative ideas stay labeled as tentative. A `Saved: <title>` toast shows each save.
- **Reflection.** When a session goes idle, a background review catches user-grounded memories the model missed.
  It can read existing details and apply explicit user corrections while retaining the previous version. The TUI
  shows `Reviewing conversation...` while it runs.
- **Updates.** Saves and index/body edits reach primary sessions on their next user message as reread notices.
- **Dreaming.** As memory grows, background consolidation adds summaries over related topics without deleting their
  sources. Summaries can themselves be summarized, and each level is a coarser overview rather than a merge of the
  details below it. A summary covers shared themes and major decisions; exact conditions and history stay in its linked
  sources. The synthesis prompt targets 150 words or fewer, but nothing enforces or truncates that length. Preferences
  and instructions are never folded into summaries. The sidebar shows `Dreaming...` while it runs.
- **Retrieval.** Read a summary to discover its source IDs, then read those IDs for more detail. All-words search reaches
  current detailed records directly, including details omitted from summaries. Derived summaries are excluded from
  search; superseded details are included only with `include_history: true`.
- **Subagents** get your preferences and instructions inline, an index of other topics, and read/search access to memory.
  They cannot save or delete memories.

Memory is designed to keep the provider's prompt cache warm: what the model sees doesn't change mid-session, and new
memories arrive as small additions instead.

## Scopes

All memories live in one central store, partitioned into **global** and **project** scopes. A repository's main checkout
and linked worktrees share project memory. Separate clones remain separate projects.

New memories default to the current project. Clearly general preferences can be saved globally, including by background
reflection; project-specific choices stay local. Scope is separate from type: an instruction is not automatically global,
and an explicit global memory can hold any supported type. Existing records are not automatically promoted to global.

Sessions receive only global and current-project memory. Agents may explicitly search other projects, then read the
returned IDs; those projects are not automatically injected. Corrections retain the original record's scope. Conflicting
project choices are not global contradictions, and summaries never combine records from different scopes.

Current-project IDs keep their existing bare filenames. Global IDs use `global:<filename>`; other-project search results
use `project:<key>:<filename>`. Copy the returned ID into `memory_read`. Other-project records are read-only from the
current project; switch to their project to correct or delete them.

## Memory types

| Type | What it holds |
| --- | --- |
| `preference` | A lasting general preference |
| `instruction` | A rule for specific future work, with its conditions stated |
| `fact` | A user-stated or confirmed constraint, decision, or piece of context |
| `working` | A plan, idea, open question, or working detail; tentative unless explicitly decided or abandoned |
| `recap` | A user-confirmed conclusion with useful rationale and rejected alternatives |
| `reference` | Lasting external material you pointed to or confirmed is worth returning to |
| `insight` | A derived summary with links to its source records; a hint, not a fact you stated |

Assistant conclusions and tool results alone do not establish memories. Assistant text may explain what your explicit
confirmation refers to; "thanks", "ok", and silence alone do not confirm a claim. Working details are tentative unless
you explicitly decide or abandon them; no exact `Status:` prefix is required. Secrets should not be saved.

## Agent tools

Each operation is a separate tool with a plain object input:

| Tool | Inputs | Behavior |
| --- | --- | --- |
| `memory_read` | `id` | Read a detail, summary, or explicitly labeled historical version |
| `memory_search` | `query`, optional `offset`, `all_projects`, `include_history` | Search current details in this project and global memory; opt into other projects or superseded details |
| `memory_save` | `title`, `hook`, `content`, `type`, `source_message_ids`, optional `scope` | Create in `project` (default) or `global`; `hook` is its one-line index text |
| `memory_correct` | `id`, `content`, `source_message_ids`; optional `title`, `hook`, `type` | Replace a detail's complete content; omitted metadata is inherited |
| `memory_delete` | `id` | Remove a selected record; deleting a summary preserves its sources |

For example, `memory_correct({ id: "fixture-plan-a1b2c3d4.md", content: "The user decided to use isolated Redis fixtures.", source_message_ids: ["msg_confirmation"] })`
retains the record's title, index hook, and classification. Empty optional titles/hooks also keep their existing values;
new records need a non-empty title. Legacy non-derived insights keep their `insight` type rather than becoming rules.
The result names the new current ID and marks the previous
ID historical. Read details when needed to preserve their qualifications; there is no mandatory read or confirmation gate.
Workers receive only `memory_read` and `memory_search`.

Genuine user messages carry a `<memory_source>` annotation with their message ID and original timestamp. Cite the
supporting user messages when saving or correcting a memory. The plugin supplies the session and verifies the selected
messages; assistant messages cannot establish user provenance. An accepted proposal cites the user's confirmation.
Corrections retain earlier source references as history and add the new evidence. Dashboard edits are labeled direct
user edits rather than attributed to a chat.

The index date is the capture or version-update date, not the date the user made the statement. `memory_read` and the
dashboard show original source dates and IDs when available. New summaries separately track the latest known user
statement date. Legacy records keep their existing dates and do not receive guessed provenance. Permanent records
retain references and dates, not supporting conversation quotes. Source text may become unavailable if its session is deleted.

Background review preserves pending user and assistant text across compaction in plugin session storage. That temporary
buffer is removed after successful review or session deletion; tool output and reasoning are not included. Resumed
sessions recover pending work after their next execution finishes. Large backlogs are reviewed in batches with a soft
48,000-character target, keeping each user turn with its replies; remaining batches continue during idle time.
Failed extracted writes remain pending for a later idle period
or resumed session, without re-extracting successful siblings. A correction invalidated by a changed, superseded, or
deleted target is reported for fresh review and removed from automatic retries, rather than overwriting newer edits.
This is not an exactly-once transaction across the catalog
and session storage: a crash between a successful create and its acknowledgment can repeat that create.

These named tools replace the former `memory({ action, target, ... })` API, without aliases. Existing stored records
and session snapshots are retained; a current API guide supersedes action-based instructions in cached snapshots.

## Storage

Memories are plain markdown files outside the repository, easy to read and edit by hand. The central store has a global
partition and one partition per canonical project checkout, shared by its linked worktrees:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/memory/
|-- global/
|   |-- index.md
|   `-- <short-title>-<random>.md
`-- -home-alice-project-a1b2c3d4/
    |-- index.md
    `-- <short-title>-<random>.md
```

Existing main-checkout partitions keep their keys. When an enabled project loads in an old worktree or subdirectory,
its known directory partitions are imported into the canonical project partition. Original files, IDs, source links,
and history are preserved. A `.scope-import.json` marker hides the old partition and prevents reimport, including after
a migrated record is deleted. Other old worktrees migrate when opened. Conflicting IDs or bodies stop the import with
an error rather than overwrite either copy. Migration does not promote existing preferences to global scope.

Worktrees also share the canonical project's memory and Auto-dream toggles. Old per-worktree toggles are not merged;
a worktree that previously disabled memory follows the canonical project's setting after this upgrade.

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
next `offset` when there are more than 20 matches; repeat the same query and options with that offset. Concurrent saves
can shift pages. Search excludes derived summaries at every level and defaults to current details, including details
beneath summaries. Use `memory_search({ query: "Redis fixture", include_history: true })` to also find superseded
details. Summaries and historical versions remain readable by exact ID with `memory_read`. Missing IDs return the
current root index.

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

- `/memory` controls memory and automatic dreaming for the current project and lists active topics first, with their
  scope, type, and status. Disabling memory also removes global recall in this project. **Show retained history** includes
  consolidated details, superseded versions, retired summaries, and missing records. Choosing a topic offers **View memory**,
  a scrollable read-only view that needs no external editor, and navigation to related records by title. Enter or Escape
  returns from the reader to the selected topic. **Edit file in place** (`$VISUAL` or `$EDITOR`) is available only for
  current details, including consolidated details. It overwrites the body without keeping a previous version or updating
  its capture metadata, and dependent summaries retire. Use `/memory-web` for versioned corrections. Derived summaries
  and historical records cannot be edited through the TUI. Toggling memory can invalidate the provider's prompt cache.
- `/dream` starts a dream without adding a conversation message.
- `/memory-web` opens a central browser dashboard for global and project memories. It starts a localhost listener on an
  OS-assigned port on first use and reuses it while running. Tabs send heartbeats every 30 seconds, even in the background.
  The listener stops after five minutes without a heartbeat or when the plugin unloads. Memory processing continues.
  Suspended tabs can time out; run `/memory-web` again to restart the listener.
  The listener lives with the OpenCode background service, not the terminal client. The command also shows the URL
  if you need to open it manually.

## Web dashboard

Browse and search global and project scopes, create records, correct their titles, types, summaries and bodies, or delete them.
The scope selector includes Global; new records default to the current project unless another scope is selected.
The default view is a left-to-right node graph: root summaries link to their immediate sources, which can be expanded
one layer at a time down to facts and working details. Selecting a node opens its full content beside the graph and
highlights its ancestry. Scroll to pan and use the zoom controls for deeper hierarchies. Search keeps matching branches
and their ancestors connected rather than displaying isolated hits. Rules and uncompacted details remain standalone
roots; older insights without retained source links cannot show a reconstructed hierarchy.

History is a separate list for superseded versions, retired summaries, and unavailable bodies. Version links are not
mixed into the source graph. Related-record links still connect sources, parents, replacements, and earlier versions;
following one opens the appropriate view. Bodies are plain markdown text. The graph uses native SVG links and HTML
cards, with no web dependencies, build step, or external assets.

Corrections create a new ID and keep the original as history. Derived summaries are read-only: correct a source, or
delete/unfold the summary to expose its sources. Deletion removes the selected record and dependent summaries, not its
sources, siblings, or earlier versions. The dashboard does not provide dreaming or settings controls, and manual edits
are available even when automatic memory is disabled. Changes reach sessions through the existing next-prompt notices.

The dashboard discovers existing memory directories, including projects not currently open in OpenCode. Project paths
are remembered as each project loads with this version; older, unvisited projects are labeled with their storage key.
Dashboard and worker writes to the same partition share an in-process queue, including across plugin instances.
Separate OpenCode service processes writing the same store are not coordinated.

Access is restricted to `127.0.0.1` and API requests require the token in the launch URL. The browser keeps that token in
tab-local session storage and removes it from the address bar. Treat the launch URL as access to all your memories.
For a remote OpenCode service, forward the dashboard port and open the URL through that tunnel; it is not exposed on the
network or routed through OpenCode's HTTP API.

## Data disclosure

Reflection sends the session's user and assistant text and root/detail indexes to `reflect_model` for selection; when
capture is needed, a separate extraction call receives the selected detail bodies as well. Dreaming sends the index
and selected topics to `dream_model`. Choose both within your intended
data-disclosure boundary.

See [DESIGN.md](DESIGN.md) for how recall, updates, reflection, and dreaming work in detail.
