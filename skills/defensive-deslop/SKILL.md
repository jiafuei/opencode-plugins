---
name: defensive-deslop
description: Remove speculative defensive code and unnecessary complexity. Use when writing or reviewing over-validation, redundant guards, silent fallbacks, excessive error handling, speculative race-condition protection, or edge-case bloat. Prefer simpler ownership and stronger types, and propose targeted deterministic enforcement for recurring problems.
---

# Defensive deslop

Remove protections for scenarios the program does not need to support.
Preserve protections for real failures. Prefer designs that make checks
unnecessary over instructions telling developers to remember them.

## Establish whether the protection is needed

For each questionable guard, identify:

- The failure it prevents.
- A concrete caller, input source, or execution interleaving that can cause it.
- Whether another boundary or invariant already prevents it.
- What happens without the guard.

Read callers and state ownership before deciding. "Just in case" is not a
requirement. Uncertainty is a reason to investigate, not to add machinery.

A possible failure does not automatically need recovery. Let it fail when
this layer has no useful response.

## Remove unsupported defenses

Look for:

- Repeated validation of internal values already guaranteed by a boundary.
- Null checks and optional chaining on values that must exist.
- Default values that turn broken invariants into plausible output.
- Catch blocks that swallow errors, return fabricated success, or merely
  rethrow unchanged.
- Locks, running flags, cancellation machinery, retries, and stale-result
  guards without a concrete concurrency requirement.
- Special handling for inputs outside the supported contract.
- Compatibility branches for internal callers that can migrate together.
- Helpers and configuration added solely to support these defenses.

Do not replace removed checks with casts, non-null assertions, or another
"safe" wrapper. Correct the contract or the data flow.

## Preserve necessary protections

Keep checks required by actual behavior:

- Validation where external data enters the program.
- Authorization and other security controls.
- Resource cleanup and recovery this layer can actually perform.
- Synchronization for genuinely shared mutable state.
- Transactions, constraints, and other required data-integrity guarantees.

A type annotation is not runtime validation of external data.
Single-threaded code can still race across async suspension points.
A rare failure can still justify protection when its consequences matter.

Do not remove these protections merely to shorten the code.

## Prefer simpler structure

Before adding a guard, consider removing the condition that needs it:

- Give independent writers separate state instead of adding a lock.
- Confine shared state to one owner when sharing is necessary.
- Use required fields when absence is not a valid state.
- Use discriminated unions instead of combinations of optional fields
  and flags.
- Validate once at the boundary, then pass a precise internal type.
- Migrate controlled callers together instead of maintaining both APIs.
- Propagate errors to a layer that can handle them.

Keep the solution local. Do not introduce a framework or abstraction for
a one-off cleanup.

## Deterministic enforcement

When the same problem recurs, propose a cheap structural fix rather than
another instruction.

### Types and compiler checks

Prefer contracts that reject invalid programs:

- Required fields and discriminated unions.
- Exhaustive handling of variants.
- Ownership or visibility rules that restrict mutation.
- Existing strict null checking and precise boundary types.

Do not weaken types to silence errors. Do not add broad compiler settings
without assessing their migration cost.

### Lints and static analysis

Use existing tooling first. Possible targeted checks include:

- ESLint `no-useless-catch` for catches that only rethrow.
- TypeScript ESLint `no-unnecessary-condition` for conditions made
  redundant by the types.
- TypeScript ESLint `switch-exhaustiveness-check` for missing variants.

Check the project's tool versions and prerequisites before proposing rules.
Do not blanket-ban catches, optional chaining, defaults, or locks.

Consider a custom rule only for a recurring, mechanically recognizable
pattern that existing rules cannot cover.

### Proposal and limits

For each enforcement proposal, state:

- Which recurring mistake it prevents.
- The smallest change that would enforce it.
- What it cannot detect and any likely false positives.

Types and lints cannot establish that every concurrency design is correct.
A syntax pattern alone does not prove a guard is unnecessary.

Ask before installing tools, changing configuration, or adding enforcement
machinery. Do not replace speculative code with speculative tooling.

## Review output

Summarize meaningful removals and the evidence supporting them.
Call out unresolved assumptions and protections deliberately retained.
Keep enforcement proposals separate from code changes.
