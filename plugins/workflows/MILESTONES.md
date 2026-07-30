# OpenCode Workflows

## Product

- Plugin ID: `workflows`
- Server tool: `workflow`
- TUI command: `/workflows`
- Purpose: deterministic, programmatic orchestration of OpenCode child agents from an agent-authored declarative specification.
- Inspiration: Claude Code dynamic workflows, adapted to OpenCode's public v1 plugin and TUI APIs.
- Execution model: interpret a validated specification directly. Do not generate or evaluate JavaScript.
- Invocation: explicit user opt-in only.
- The TUI plugin is required for rich plan approval that global permission auto-approval cannot bypass.

## Workflow Specification

```ts
type WorkflowSpec = {
  version: 1
  name: string
  description: string
  goal: string
  allowedAgents: string[]
  phases: PhaseSpec[]
  limits?: {
    maxWorkers?: number
    maxRevisions?: number
    maxRunMs?: number
  }
}

type PhaseSpec = {
  id: string
  title: string
  checkpoint?: boolean
  steps: Array<WorkerStep | ParallelStep>
}

type WorkerStep = {
  type: "worker"
  worker: WorkerSpec
}

type ParallelStep = {
  type: "parallel"
  id: string
  title?: string
  workers: WorkerSpec[]
}

type WorkerSpec = {
  id: string
  label: string
  agent?: string
  modelID?: string // "providerID/modelID"
  variant?: string
  prompt: string
  schema?: Record<string, unknown>
}
```

Specification rules:

- Workers default to the registered `general` OpenCode agent when `agent` is omitted.
- `general` must be present in `allowedAgents` when a worker uses the default.
- Agents must belong to the approved allowlist; worker models must be available at submission.
- Phases execute sequentially.
- Steps execute in order.
- Only workers inside an explicit parallel step execute concurrently.
- Parallel work is capped at two active workers.
- Nested workflows are denied.
- Worker IDs are stable and globally unique within a run.
- Later prompts reference earlier results through validated templates such as `{{workers.audit.output.findings}}`.
- Objects and arrays are inserted as stable, pretty-printed JSON.
- Missing, forward, or sibling references fail validation before the affected worker starts.
- Optional JSON Schema produces validated structured output.

## Adaptive Planning

- Marked phase checkpoints invoke a hidden coordinator using the parent model.
- The coordinator has no tools except structured output.
- It receives the goal, current plan, all named outputs, failures, guidance, and remaining structural limits.
- It returns a complete replacement for pending phases plus rationale.
- Completed and active work cannot be changed.
- Revisions may add, remove, reorder, or replace pending work.
- Revisions require no separate approval but cannot exceed approved agent/model allowlists or hard limits.
- Accepted revisions generate an expandable tree-diff event.
- User plan-change requests wait for the current worker or parallel group to finish, then trigger an immediate coordinator revision.
- At that barrier, an active phase is sealed: its executed step/group prefix is immutable, its unstarted suffix is retired, and coordination replaces only subsequent phases.
- Checkpoints use durable occurrence IDs independent of plan versions. Completed/sealed phase IDs and retired worker IDs are never reusable.
- Maximum revisions: 10.
- Exhausted coordinator retries pause the run for user direction.

## Runtime Defaults

| Setting | Default |
| --- | ---: |
| Maximum concurrency | 2 (configurable via `max_concurrency`) |
| Maximum logical workers | 100 |
| Maximum revisions | 10 |
| Run window | 6 hours |
| Retry delays | 5s, 10s, 20s, 30s, 40s |
| Coordinator input | 256 KiB |
| Retained runs | 10000 (effectively unlimited) |
| Retention age | 99999999 days (effectively unlimited) |

There are no token or monetary budgets. Tokens remain informational telemetry.

The six-hour limit soft-pauses scheduling, lets active workers finish, and permits an explicit resume with a renewed window.

## Retries And Recovery

- Retry transient provider failures and malformed structured output.
- Do not retry user rejection, permission denial, explicit abort, or permanent validation errors.
- Reuse the same child session so corrective attempts retain context.
- Let successful siblings in a parallel group finish before pausing on an exhausted failure.
- Failure decisions: retry, skip, replace through coordinator, or stop.
- Skipping referenced output triggers immediate coordinator repair.
- Soft pause stops scheduling and lets active work finish.
- Hard pause interrupts active workers but retains their sessions.
- Resume continues interrupted child sessions.
- Stop releases the project lease but remains resumable from the last checkpoint.
- Steering is append-only and delivered at the next safe turn.
- If steering arrives as a worker finishes, run one follow-up turn before accepting its output.

## Permissions

- Workflow plan approval is separate from OpenCode permission auto-approval.
- Every workflow plan requires explicit approval, even when global auto-approve is enabled.
- Workers inherit parent permission rules.
- Agent-specific restrictions may narrow but never widen inherited permissions.
- Worker tool actions follow normal OpenCode permission prompts.
- The dashboard shows and toggles OpenCode's existing auto-approve mode.
- Coordinator and handoff sessions deny all tools except structured output.
- Workers, coordinator, and handoff use the originating parent model unless a worker sets `modelID`; revisions remain constrained to the original `allowedAgents`.

## Concurrency

- Only one active or paused workflow may hold a project lease.
- Enforce this across OpenCode processes with an atomic lease, heartbeat, and stale-owner recovery.
- A paused run retains the lease.
- A second request offers: open the current run, queue the new run, or stop the current run and start the replacement.

## Persistence

Use:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/workflows/<project-key>/
```

Persist:

- Original and normalized specifications
- Versioned coordinator plans
- Append-only event journal
- Atomic current-state snapshot
- Worker prompts and outputs
- Retry and failure history
- Steering messages
- Token and timing telemetry
- Child session IDs
- Control commands
- Lease and heartbeat information

The TUI sends controls through atomically renamed command files. The server remains the sole writer of runtime state and events.

Interrupted runs appear in one startup dialog with Resume, Open dashboard, Decide later, and Discard actions.

Pruning deletes the journal and all worker, coordinator, retry, and handoff sessions.

## Final Handoff

The final hidden coordinator uses the parent model to create:

```ts
type WorkflowHandoff = {
  summary: string
  completedWork: string[]
  evidence: Array<{ claim: string; source: string }>
  changedFiles: string[]
  verification: string[]
  unresolvedIssues: string[]
  recommendedNextAction: string
}
```

The handoff receives named worker outputs up to 256 KiB. Full outputs remain available in the journal and dashboard.

Completion behavior:

- Queue a synthetic `<workflow_result>` behind the parent's current turn.
- Let the parent create the user-facing response.
- Show a TUI toast.
- Update the compact workflow indicator.
- Do not change the current route.

## TUI Design

Approval dialog:

- Use the native OpenCode visual language.
- Show an expandable phase, group, and worker tree.
- Show summary, goal, allowlists, effective limits, retries, and concurrency.
- Selecting a worker shows its prompt, agent, model, schema, and template dependencies.
- Actions: Approve and Reject.
- Approval waits until decision, tool abort, interruption, or shutdown.

Chat status:

- Render in `session_prompt_right`.
- Example: `WF 3/8 | 2 running`.
- Activating it opens `/workflows`.

Dashboard:

- Left side: recent runs expanded into phases, parallel groups, and workers.
- Worker rows show status, label, agent, model, elapsed time, attempts, and tokens.
- Right side: tabbed Activity, Prompt, Result, and Attempts inspector.
- Run header shows controls and auto-approve status.
- Controls: soft pause, hard pause, resume, stop, request plan change, and steer worker.
- Plan revisions appear as expandable before/after tree diffs.
- Narrow terminals switch between tree and inspector rather than squeezing both.

Failure UX:

- If currently viewing the run, show a decision modal.
- Otherwise pause the run, add a tree badge, and show a toast.
- Do not steal focus from another route.

Worker transcript:

- Use a custom read-only Workflows route.
- Do not navigate to the native child-session route because plugins cannot make its prompt read-only.
- Back returns to the selected dashboard worker.

## Planned Files

```text
plugins/workflows/
  MILESTONES.md
  README.md
  workflow_shared.ts
  workflow_coordination.ts
  workflow_server.ts
  workflow_tui.tsx
  workflow.test.ts
```

Keep the scheduler in `workflow_server.ts` initially. Extract another module only if testing or file size provides a concrete reason.

Implementation note: `workflow_coordination.ts` was extracted because SQLite lease, queue, fencing, and maintenance-claim behavior requires independent cross-process tests.

## Stage 1: Vertical Core

- Define and validate `WorkflowSpec`.
- Register the `workflow` tool and hidden internal agents.
- Implement TUI-owned pending-plan approval.
- Execute sequential workers and two-worker parallel groups.
- Persist events, outputs, state, and the project lease.
- Render a basic run tree and prompt-right indicator.
- Complete one workflow through final coordinator handoff and queued parent synthesis.
- Resume an interrupted static workflow.

Acceptance criteria:

- An explicitly requested workflow remains pending until the TUI approves its normalized plan.
- Approval launches child sessions in deterministic phase and step order.
- A parallel group never runs more than two children at once.
- Restarting OpenCode reconstructs a non-terminal run from disk.
- A completed run queues one synthetic handoff to its originating parent session.

## Stage 2: Reliability And Controls

- Add selective retries and the specified backoff.
- Add soft pause, hard pause, resume, stop, and timeout behavior.
- Implement parallel-group failure barriers.
- Add failure decisions and resumable checkpoints.
- Add cross-process heartbeat and stale-lease recovery.
- Add queued and replacement-run behavior.

Acceptance criteria:

- Transient and structured-output failures retry in the same child session.
- Permission denial, rejection, and abort do not retry.
- Successful parallel siblings remain recorded when another sibling fails.
- Stale leases recover without permitting concurrent project writers.

## Stage 3: Adaptive Coordination

- Implement marked coordinator checkpoints.
- Validate replacement pending plans against allowlists and limits.
- Add revision diffs and revision history.
- Add user-requested plan changes.
- Add skip repair and coordinator-failure decisions.

Acceptance criteria:

- A revision cannot mutate completed or active work.
- A revision cannot introduce an unapproved agent or model.
- Every accepted revision is journaled with a deterministic before/after diff.
- Revision exhaustion pauses rather than silently continuing or failing.

## Stage 4: Steering And Full Inspector

- Add append-only worker steering.
- Force a follow-up turn for late steering.
- Add Activity, Prompt, Result, and Attempts tabs.
- Add telemetry-dense tree rows.
- Add the read-only full-screen worker transcript.
- Surface and toggle OpenCode auto-approve mode.

Acceptance criteria:

- Steering never interrupts an active worker turn.
- Late guidance is incorporated before a worker result becomes final.
- The transcript route cannot directly prompt the child session.
- Narrow terminals remain navigable without a two-column layout.

## Stage 5: Lifecycle And Release

- Add the startup resume dialog.
- Add retention and child-session pruning.
- Document local storage and sensitive-data implications.
- Document installation of both server and TUI modules.
- Add configuration examples and operational limits.
- Exercise restart, stale lease, parent deletion, pruning, permission prompts, and concurrent-process scenarios.

Acceptance criteria:

- Retention enforces both the configured run-count and age limits.
- Pruning deletes every child session owned by the run.
- Missing TUI installation fails clearly without starting a workflow.
- Installation documentation results in both plugin halves loading after restart.

## Implementation Constraints

- Use the public v1 plugin and TUI APIs. The v2 plugin API lacks required session control.
- The generated v1 SDK types lag current session creation and structured-output fields. Use one narrow local client type, following `plugins/memory/memory_server.tsx`.
- Server and TUI plugins cannot share memory. The journal and control inbox are their bridge.
- Public plugins cannot add chat-part renderers, so rich workflow state belongs in the custom dashboard.
- TUI installation is mandatory because plan approval must remain independent of global permission auto-approval.
- Use Bun native modules wherever practical.
- Keep the first implementation minimal and do not add compatibility layers without a concrete consumer.

## Implementation Status

- Stage 1 — complete: validated declarative plans, mandatory TUI approval, deterministic execution, persistence, lease, basic tree, handoff, and static recovery.
- Stage 2 — complete: selective same-session retries, pause/resume/stop, failure barriers and decisions, fenced stale recovery, queue, and replacement.
- Stage 3 — complete: durable adaptive checkpoints, constrained revisions and diffs, plan changes, repair, and coordinator failure decisions.
- Stage 4 — complete: append-only steering, follow-up turns, telemetry inspector, read-only transcript, narrow layout, and permission-mode toggle.
- Stage 5 — complete: startup recovery summary, TUI presence gate, parent-deletion lifecycle, confirmed discard, serialized child-first retention, release documentation, and lifecycle tests.

Final release-audit hardening makes execution leases and renewable maintenance claims mutually exclusive per run, routes parent deletion to the exact lease owner through durable generation-bound controls, records idempotent child-cleanup progress, bounds future TUI heartbeat skew, serializes TUI refreshes, and ages retention from the first terminal transition.

Final defaults are effectively unlimited retention (10000 terminal runs, 99999999 days), 100 workers, 10 revisions, a 6-hour run window, concurrency 2 (configurable via `max_concurrency`), 256 KiB coordinator/handoff input, 5-second lease heartbeat, 15-second stale lease/maintenance claim, and a 5-second TUI-presence freshness window.

Implemented files: `plugins/workflows/{MILESTONES.md,README.md,workflow_shared.ts,workflow_coordination.ts,workflow_server.ts,workflow_tui.tsx,workflow.test.ts}`, plus repository `README.md`, `package.json`, and `bun.lock` for listing and public plugin/TUI dependencies.

Verification:

```sh
bun test plugins/workflows/workflow.test.ts
bun -e 'await import("./plugins/workflows/workflow_server.ts")'
bun -e 'await import("./plugins/workflows/workflow_tui.tsx")'
git diff --check
```

Residual public-API follow-ups: auto-approve state cannot be read reliably; native child-session routes cannot be made read-only; generated v1 SDK types still omit fields used by session creation and structured output. These constraints preserve the original custom inspector and narrow client rationale above.
