# Authoring workflows

Reference for the agent writing a `workflow` spec. Run `/workflow-plan <request>` to be walked through the design conversation first.

## The four facts that decide a spec's shape

**Phases are the only ordering.** Phases run in order, steps within a phase run in order, and only workers inside a `parallel` step overlap — at most `max_concurrency` (default 2) at once. A twelve-worker parallel step is a six-round queue. There is no loop and no conditional.

**`checkpoint: true` is the loop.** After a checkpoint phase, a coordinator sees that phase's outputs and rewrites every remaining phase. It may add phases and workers that did not exist at submission. This is the only way to express a fan-out whose width you learn at runtime, or work that repeats until nothing new turns up. Its budget is `limits.maxWorkers` minus the workers already in the spec, so a spec with checkpoints must set `maxWorkers` well above its own worker count. Each checkpoint also consumes one of `maxRevisions` (default 10).

**Outputs arrive intact.** Worker outputs reach checkpoint coordinators and the final handoff without byte truncation. Keep them concise; put bulk results in an artifact file and return `{path, count, notes}`. Workers inherit the parent session's permissions, so they can write.

**Workers and coordinators are blind.** A worker sees only its own prompt. A checkpoint coordinator sees `goal`, the current plan, worker outputs, and failures — no tools, no conversation history. Whatever must survive between phases goes in `goal` or in a file.

## Shape 1 — discover, fan out, verify, synthesize

For "comb through these codebases and inventory X". The repo list is not known when the spec is written, so the crawl phase cannot be written by you.

```json
{
  "version": 1,
  "name": "config-inventory",
  "description": "Inventory feature configuration across the service repos",
  "goal": "Produce .workflow/INVENTORY.md listing every configuration surface for auth, rate limiting, and telemetry across the repos under ~/src. Each repo's findings go in .workflow/inventory/<repo>.md. Stop when a sweep phase reports no repo and no configuration surface that is not already covered by a file in .workflow/inventory/.",
  "allowedAgents": ["general"],
  "limits": { "maxWorkers": 60, "maxRevisions": 8 },
  "phases": [
    {
      "id": "scope",
      "title": "Identify repos and features",
      "checkpoint": true,
      "steps": [{ "type": "worker", "worker": {
        "id": "scope", "label": "Scope",
        "prompt": "List every git repository under ~/src that builds a deployable service. For each, record its path, its name, and which of {auth, rate limiting, telemetry} it plausibly configures, with the evidence that made you say so. Return the structured result only; write no files.",
        "schema": { "type": "object", "additionalProperties": false, "required": ["repos"], "properties": { "repos": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["path", "name", "features"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "features": { "type": "array", "items": { "type": "string" } } } } } } }
      }}]
    },
    {
      "id": "synthesize",
      "title": "Merge into the inventory",
      "steps": [{ "type": "worker", "worker": {
        "id": "synthesize", "label": "Synthesize",
        "prompt": "Read every file in .workflow/inventory/ and write .workflow/INVENTORY.md: one section per feature, one row per configuration surface, each row citing repo and file:line. Note contradictions between repos rather than resolving them silently. Return {path, sections, rows}."
      }}]
    }
  ]
}
```

Submitted with two phases; the coordinator inserts the crawl, sweep, and verify phases between them once `scope` reports. The crawl phase it writes should give each worker one repo, an explicit output path (`.workflow/inventory/<repo>.md`), and a small return value. The sweep phase reads those files, reports scope the first pass missed, and carries `checkpoint: true` so another crawl round can be added — that is the "repeat exhaustively" loop, and `goal` is what terminates it.

State this expansion in the outline you show the user, since it will not be visible in the submitted spec.

## Shape 2 — find, then adversarially verify

```
phase find      parallel workers, one per dimension (correctness, security, perf),
                each writing .workflow/findings/<dimension>.json
phase verify    parallel workers with a DIFFERENT modelID, each prompted to refute
                a dimension's findings and default to "refuted" when uncertain
phase report    one worker merges survivors into .workflow/REVIEW.md
```

Set `modelID` explicitly on the verify workers. Omitting it inherits the parent model, and a model rarely refutes its own reasoning.

## Shape 3 — staged migration

```
phase inventory   one worker lists call sites → .workflow/sites.json, checkpoint: true
phase migrate     coordinator writes one worker per site or per batch
phase verify      build/test worker; failures surface as unresolved issues in the handoff
```

Batch the call sites in the coordinator's expansion rather than spawning one worker per site — with `max_concurrency: 2`, two hundred single-site workers is a hundred serial rounds.

## Checks before submitting

- Every phase whose successor's shape depends on its results carries `checkpoint: true`.
- `limits.maxWorkers` leaves room for what those checkpoints will add.
- `goal` states the stopping condition in full sentences.
- No worker returns bulk data; each that produces some names its output path in its prompt.
- Verification workers set a `modelID` different from what they verify.
- Every prompt reads correctly to someone with no other context.
- The user has seen the outline and agreed to it.
