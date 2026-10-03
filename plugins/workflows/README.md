# OpenCode Workflows

Multi-agent workflows for OpenCode. An agent writes a plan of phases and child-agent workers, you approve it in the
TUI, and the plugin runs it with live steering, pause/resume, and recovery after crashes. A dashboard shows every
worker's prompt, transcript, and result.

## Install

```sh
opencode plugin add @jiafuei/opencode-workflows
```

The package includes both the server and TUI sides; approval happens only in the TUI. To customize the server plugin,
edit its entry:

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

| Option | Default | Purpose |
| --- | --- | --- |
| `retention_runs` | `10000` | Finished runs kept per project |
| `retention_days` | `99999999` | Days a finished run is kept |
| `max_workers` | `100` | Maximum workers per run |
| `max_revisions` | `10` | Maximum plan revisions per run |
| `max_run_ms` | `21600000` (6 hours) | Maximum run time |
| `max_concurrency` | `2` | Workers of a parallel step that run at once |

Options are positive integers. A workflow may lower the worker, revision, and run-time limits but cannot exceed them.
`max_concurrency` is set only here, not in a workflow. With the retention defaults, finished runs are effectively kept
forever; a run is pruned once it exceeds either retention limit. Unfinished and resumable runs are never pruned.

## Starting a workflow

Ask an agent explicitly to use a workflow, or run `/workflow-plan <request>` to have it establish scope, propose a
phase outline in prose, and agree the shape with you before submitting a plan. [AUTHORING.md](AUTHORING.md) documents
the plan format and common workflow shapes for the agent writing it.

The `workflow` tool validates the plan, then waits for your approval: the TUI shows a toast and an attention
notification. Open `/workflows`, inspect phases, workers, prompts, allowed agents and models, and limits, then
**Approve** (starts now, or queues behind the active run), **Replace**, or **Reject**. Workflow approval is separate
from OpenCode permissions and cannot be bypassed by auto-accept. Without the TUI nothing can approve a plan, so the
tool call stays pending until it is aborted.

After approval the tool returns `running` or `queued`, or returns early with `blocked`/`repair_required` when a
failure needs your decision; the run stays resumable from the dashboard. The final result arrives later as a
`<workflow_result>` message in the originating session.

Each worker runs in its own session titled `Workflow: <label>`. Workers inherit the originating session's deny and
`external_directory` rules, cannot start workflows, and still ask for permissions as usual.

## Workers

A worker uses the built-in `general` agent when `agent` is omitted; `general` must still appear in the workflow's
`allowedAgents`. Workers inherit the originating session's model when `modelID` is omitted, or select one as
`"providerID/modelID"` or `"providerID/modelID#variant"`, matching OpenCode's subagent model format:

```json
{
  "id": "audit",
  "label": "Audit",
  "prompt": "Review the implementation",
  "modelID": "openai/gpt-5#high"
}
```

Worker prompts may reference earlier outputs with `{{workers.workerId.output.path}}`. Other double-brace syntax,
including `${{ github.ref }}`, is literal. Escape the reserved form with a backslash, as in
`\{{workers.example.output}}`, when it must stay literal. Outputs are passed on without truncation, so keep results
concise and use files for bulk data.

## Dashboard

`/workflows` shows the run tree and Activity, Prompt, Result, and Attempts tabs. A run's Result tab holds the final
result or error; worker tabs hold worker-specific data.

Keys: arrows select, Enter opens a worker transcript, `Tab` switches narrow panes, `1`–`4` select tabs, `c` opens
controls, `s` steers an active worker, `t` opens the read-only transcript, and `q`/Escape returns.

Controls include soft/hard pause, resume, stop, plan change, failure decisions, steering, and confirmed permanent
discard for interrupted, stopped, or finished runs. Every control reports whether it was accepted, ignored, or
rejected.

## Recovery

At startup a dialog lists interrupted runs with **Resume**, **Open dashboard**, **Decide later**, and confirmed
**Discard**. Stopped and timed-out runs stay resumable, and after a crash workers resume in their existing sessions.
Plans that were never approved stay pending approval. Only one run per project is active at a time, across OpenCode
processes.

Deleting the originating session aborts its unfinished workflows. Pruning and discarding remove the run's workflow
data only; worker sessions stay in the session list.

## Storage

Data lives at `${XDG_DATA_HOME:-~/.local/share}/opencode/workflows/<project-key>/`, including plans, prompts, outputs,
steering, and worker session IDs. **This can contain sensitive source code, model output, and user
guidance in plaintext.** Protect and back up the data directory accordingly; discarding and retention remove
workflow-owned data but are not secure erasure.

See [DESIGN.md](DESIGN.md) for how runs execute, recover, and are stored.
