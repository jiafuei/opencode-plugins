# Workflows design

How runs execute, recover, and are stored. For installation and usage, see the [README](README.md); for writing specs,
see [AUTHORING.md](AUTHORING.md).

## Workers and coordinators

Each worker runs in its own top-level session titled `Workflow: <label>` and tagged with
`workflowRunID`/`workflowWorkerID` metadata. Workers inherit the originating session's deny and
`external_directory` rules and cannot start workflows; worker tools still use normal permission prompts.

A worker with a `schema` runs its turn with OpenCode structured output, which ends the turn with a result matching the
schema; a worker that ends its turn without producing it is retried like any other failed turn. Worker schemas are not
revalidated locally. Workers without a schema return their final text.

Checkpoint coordinators and the final handoff are single model calls without tools whose JSON replies are decoded
against a fixed schema. Worker outputs and failure details reach them intact, without truncation or an input-size cap.

Template references (`{{workers.<id>.output.<path>}}`) are checked for dependency order before execution; field paths
are resolved against actual outputs at runtime.

## Recovery and leases

Crashes interrupt active work and keep worker sessions, which resume with their persisted session and message IDs. A
project lease uses SQLite fencing, a 5-second heartbeat, and a 15-second stale threshold, so only one active or paused
run schedules across OpenCode processes and directories of the same project. Controls are applied by the server the
TUI is connected to; a run owned by another process is rejected rather than forwarded.

Deleting an originating session aborts its unfinished workflows without a handoff, releases their lease, and lets a
queued run start.

## Retention

Maintenance runs at server startup and after a run finishes. Completed, rejected, failed, and aborted runs are pruned
when their first terminal transition is at least `retention_days` old **or** they fall outside the newest
`retention_runs` terminal runs. Pending, queued, running, paused, blocked, repair-required, interrupted, and
stopped-resumable runs are never pruned automatically. A per-run maintenance claim is transactionally exclusive with
that run's execution lease.

## Server and TUI

The server owns all run state and exposes it to the TUI over a plugin RPC (`list`, `control`) plus `updated`/`removed`
events. State contains original and normalized plans, prompts, outputs, revisions, attempts, steering, event journals,
worker session IDs, telemetry, and lease metadata.
