# OpenCode Workflows

Declarative, explicitly approved child-agent workflows with durable recovery and a native TUI dashboard.

## Install

Install the package for the current project:

```sh
opencode plugin @jiafuei/opencode-workflows
```

Pass `--global` to install it globally. The package exposes both mandatory server and TUI entrypoints, so OpenCode updates `opencode.json` and `tui.json` automatically.

To customize the server plugin, edit its entry in `opencode.json`:

```json
{ "plugin": [["@jiafuei/opencode-workflows", {
  "retention_runs": 30,
  "retention_days": 30,
  "max_workers": 100,
  "max_revisions": 10,
  "max_run_ms": 21600000,
  "max_concurrency": 2,
  "coordinator_input_bytes": 262144
}]] }
```

For manual installation, add `{ "plugin": ["@jiafuei/opencode-workflows"] }` to `tui.json` as well.

Quit **all** OpenCode server and TUI processes and start OpenCode again after installation or option changes; closing only a tab or route is insufficient and plugins are not hot-reloaded. The server rejects `workflow` immediately with installation/restart instructions unless the TUI is maintaining a fresh project heartbeat.

## Use and approval

Ask an agent explicitly to use a workflow. The `workflow` tool validates and normalizes the plan, then waits for approval in the TUI. The TUI raises a toast and attention notification when approval is required. Open `/workflows`, inspect phases, workers, prompts, agent/model allowlists, and limits, then Approve, Queue, Replace, or Reject. Workflow approval is separate from OpenCode permissions and cannot be bypassed by global auto-approve. After approval the tool returns `running` or `queued`; the final handoff arrives later as a synthetic `<workflow_result>` message. Workers inherit parent restrictions; agent rules may narrow them. Worker tools still use normal permission prompts. Internal coordinator and handoff sessions deny tools except structured output.

`/workflows` shows the scrollable run tree and Activity, Prompt, Result, and Attempts tabs. A run's Result tab contains the final handoff or terminal error; worker tabs contain worker-specific data. Keys: arrows select, Enter opens a worker transcript, `Tab` switches narrow panes, `1`–`4` select tabs, `c` opens controls, `s` steers an active worker, `t` opens the read-only transcript, `a` toggles OpenCode permission mode, and `q`/Escape returns home. Controls include soft/hard pause, resume, stop, plan change, failure decisions, steering, and confirmed permanent discard for interrupted, stopped, or terminal runs. Every submitted control receives an accepted, ignored, or rejected TUI result.

At startup one summary dialog lists interrupted runs with Resume, Open dashboard, Decide later, and confirmed Discard. Pending unapproved plans stay approval actions and are never treated as resumable approved work. Stops and timeout pauses remain resumable; crashes interrupt active work and retain child sessions. The project lease uses SQLite fencing, a 5-second heartbeat, and a 15-second stale threshold so only one active/paused run schedules across processes.

## Limits and retention

Plugin options are positive integers normalized at startup. Defaults are `retention_runs: 10000` and `retention_days: 99999999` — effectively unlimited retention until configured lower — plus `max_workers: 100`, `max_revisions: 10`, `max_run_ms: 21600000` (6 hours), `max_concurrency: 2`, and `coordinator_input_bytes: 262144` (256 KiB). `max_concurrency` caps how many workers of a parallel group run at once and is set only in plugin options, not in a workflow spec. A workflow may lower the worker/revision/run ceilings but cannot exceed plugin values.

Worker prompts may reference earlier outputs with `{{workers.workerId.output.path}}`. Other double-brace syntax, including `${{ github.ref }}`, is literal. Prefix the reserved namespace with a backslash, as in `\{{workers.example.output}}`, when it must also remain literal. Worker output schemas are locally checked for `type`, `enum`, `required`, `properties`, `additionalProperties`, and `items`; unsupported JSON Schema constraints are not enforced by the plugin.

A worker defaults to the built-in `general` agent when `agent` is omitted; `general` must still appear in the workflow's `allowedAgents`. Specify another allowed registered agent to override it. Workers inherit the originating session's model when `modelID` is omitted, or may select an available model as `"providerID/modelID"` and a model variant directly in the spec:

```json
{
  "id": "audit",
  "label": "Audit",
  "prompt": "Review the implementation",
  "modelID": "openai/gpt-5",
  "variant": "high"
}
```

Maintenance runs at server startup and after terminal completion. Completed, rejected, failed, and aborted runs are pruned when their first terminal transition is at least `retention_days` old **or** they are beyond the newest `retention_runs` terminal runs, whichever happens first; with the defaults, terminal runs are effectively kept forever. Pending, queued, running, paused, blocked, repair-required, interrupted, and stopped-resumable runs are never automatically pruned. A renewable per-run maintenance claim is transactionally exclusive with that run's execution lease. Every persisted worker, retry, coordinator, and handoff child session is deleted before its journal. Children are additionally reconciled from parent metadata while the parent exists; after external parent deletion, persisted IDs are used and recursively removed descendants count as already deleted. Per-session progress makes retries idempotent, while any other deletion failure preserves the run for a later retry. Successful cleanup removes the run directory, queue row, and matching control/result files. Parent sessions are never deleted by Workflows.

Deleting an originating parent through OpenCode aborts its nonterminal workflows without a synthetic handoff, safely releases their lease, and permits another parent's queued run to start. Child deletion events do not abort a workflow parent.

## Storage and public-API constraints

Data lives at `${XDG_DATA_HOME:-~/.local/share}/opencode/workflows/<project-key>/`. State contains original/normalized plans, prompts, outputs, revisions, attempts, steering, event journals, child IDs, controls, telemetry, and lease metadata. **This can contain sensitive source code, model output, and user guidance in plaintext.** Protect and back up the data directory accordingly; discard/retention removes workflow-owned data but is not secure erasure.

The implementation uses OpenCode's public v1 server and TUI APIs. Server and TUI communicate through files, not memory. Public plugins cannot add chat-part renderers, expose a reliable current auto-approve value, or make the native child route read-only, so Workflows uses a custom read-only transcript and labels the permission toggle honestly. Generated v1 types lag session creation/structured-output fields, requiring one narrow local client type.
