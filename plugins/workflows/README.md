# OpenCode Workflows

Declarative, explicitly approved multi-agent workflows with durable recovery and a native TUI dashboard.

## Install

```sh
opencode plugin add @jiafuei/opencode-workflows
```

The package exposes both a server and a TUI entrypoint; approval happens only in the TUI. To customize the server plugin, edit its entry:

```jsonc
{
  "plugins": [
    {
      "package": "@jiafuei/opencode-workflows",
      "options": {
        "retention_runs": 30,
        "retention_days": 30,
        "max_workers": 100,
        "max_revisions": 10,
        "max_run_ms": 21600000,
        "max_concurrency": 2
      }
    }
  ]
}
```

Restart OpenCode after installation or option changes.

## Use and approval

Ask an agent explicitly to use a workflow, or run `/workflow-plan <request>` to have it establish scope, propose a phase outline in prose, and agree the shape with you before any spec is submitted. `AUTHORING.md` documents the constructs and the common workflow shapes for the agent writing the spec.

The `workflow` tool validates and normalizes the plan, then waits for approval in the TUI. The TUI raises a toast and attention notification when approval is required. Open `/workflows`, inspect phases, workers, prompts, agent/model allowlists, and limits, then Approve (starts now or queues behind the active run), Replace, or Reject. Workflow approval is separate from OpenCode permissions and cannot be bypassed by auto-accept. Without the TUI plugin nothing can approve a plan, so the tool call stays pending until it is aborted. After approval the tool returns `running` or `queued` — or early with `blocked`/`repair_required` when a worker or coordinator failure needs your decision, leaving the run resumable from the dashboard; the final handoff arrives later as a synthetic `<workflow_result>` message.

Each worker runs in its own top-level session titled `Workflow: <label>` and tagged with `workflowRunID`/`workflowWorkerID` metadata. Workers inherit the originating session's deny and `external_directory` rules and cannot start workflows; worker tools still use normal permission prompts. A worker with a `schema` runs its turn with opencode structured output, which ends the turn with a result matching the schema; a worker that ends its turn without producing it is retried like any other failed turn. Workers without a schema return their final text. Checkpoint coordinators and the final handoff are single model calls without tools whose JSON replies are decoded against a fixed schema.

`/workflows` shows the scrollable run tree and Activity, Prompt, Result, and Attempts tabs. A run's Result tab contains the final handoff or terminal error; worker tabs contain worker-specific data. Keys: arrows select, Enter opens a worker transcript, `Tab` switches narrow panes, `1`–`4` select tabs, `c` opens controls, `s` steers an active worker, `t` opens the read-only transcript, and `q`/Escape returns. Controls include soft/hard pause, resume, stop, plan change, failure decisions, steering, and confirmed permanent discard for interrupted, stopped, or terminal runs. Every control reports whether it was accepted, ignored, or rejected.

At startup one summary dialog lists interrupted runs with Resume, Open dashboard, Decide later, and confirmed Discard. Pending unapproved plans stay approval actions and are never treated as resumable approved work. Stops and timeout pauses remain resumable; crashes interrupt active work and retain worker sessions, which resume with their persisted session and message IDs. A project lease uses SQLite fencing, a 5-second heartbeat, and a 15-second stale threshold so only one active/paused run schedules across OpenCode processes and directories of the same project. Controls are applied by the server the TUI is connected to; a run owned by another process is rejected rather than forwarded.

## Limits and retention

Plugin options are positive integers normalized at startup. Defaults are `retention_runs: 10000` and `retention_days: 99999999` — effectively unlimited retention until configured lower — plus `max_workers: 100`, `max_revisions: 10`, `max_run_ms: 21600000` (6 hours), and `max_concurrency: 2`. `max_concurrency` caps how many workers of a parallel group run at once and is set only in plugin options, not in a workflow spec. A workflow may lower the worker/revision/run ceilings but cannot exceed plugin values.

Worker prompts may reference earlier outputs with `{{workers.workerId.output.path}}`. Other double-brace syntax, including `${{ github.ref }}`, is literal. Prefix the reserved namespace with a backslash, as in `\{{workers.example.output}}`, when it must also remain literal. Dependency order is checked before execution; field paths are resolved against actual outputs at runtime. Worker schemas are sent to the model as the prompt's structured output format without local output revalidation.

Worker outputs and failure details reach coordinators and the final handoff intact, without byte truncation or an input-size cap. Keep results concise and use artifact files for bulk data. Identifiers retain their syntax restrictions but have no plugin-defined length cap.

A worker defaults to the built-in `general` agent when `agent` is omitted; `general` must still appear in the workflow's `allowedAgents`. Specify another allowed registered agent to override it. Workers inherit the originating session's model when `modelID` is omitted, or may select an available model as `"providerID/modelID"`, or `"providerID/modelID#variant"` to include a variant, matching OpenCode's subagent model format:

```json
{
  "id": "audit",
  "label": "Audit",
  "prompt": "Review the implementation",
  "modelID": "openai/gpt-5#high"
}
```

Maintenance runs at server startup and after terminal completion. Completed, rejected, failed, and aborted runs are pruned when their first terminal transition is at least `retention_days` old **or** they are beyond the newest `retention_runs` terminal runs, whichever happens first; with the defaults, terminal runs are effectively kept forever. Pending, queued, running, paused, blocked, repair-required, interrupted, and stopped-resumable runs are never automatically pruned. A per-run maintenance claim is transactionally exclusive with that run's execution lease. Pruning and discard remove the run's workflow data only: the plugin API cannot delete sessions, so worker sessions remain in the session list.

Deleting an originating parent session aborts its nonterminal workflows without a synthetic handoff, releases their lease, and permits a queued run to start.

## Storage

Data lives at `${XDG_DATA_HOME:-~/.local/share}/opencode/workflows/<project-key>/`. State contains original/normalized plans, prompts, outputs, revisions, attempts, steering, event journals, worker session IDs, telemetry, and lease metadata. **This can contain sensitive source code, model output, and user guidance in plaintext.** Protect and back up the data directory accordingly; discard/retention removes workflow-owned data but is not secure erasure.

The server owns all run state and exposes it to the TUI over a plugin RPC (`list`, `control`) plus `updated`/`removed` events. The dashboard's transcript view is read-only; OpenCode's permission auto-accept mode is not exposed to plugins, so the dashboard no longer shows or toggles it.
