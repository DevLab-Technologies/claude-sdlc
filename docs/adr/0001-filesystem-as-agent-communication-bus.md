# ADR-0001 — Filesystem as the agent communication bus

- **Status**: accepted
- **Date**: 2026-08-10
- **Deciders**: architecture
- **Feature**: sdlc-pipeline itself

## Context

The pipeline runs a dozen specialized agents across phases that may span sessions, days, and
separate machines. Each agent has its own context window and cannot see another agent's
reasoning. Something has to carry state, decisions, and open questions between them, and it
has to survive a session ending mid-pipeline.

## Decision

We will make the filesystem the only channel between agents. Every agent reads its inputs
from `.sdlc/features/<slug>/`, writes its outputs there, appends to an immutable event log,
and updates a single `state.json`. No agent passes information to another through
conversation context.

## Options considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Filesystem workspace (chosen) | Durable, resumable, inspectable and editable by humans, diffable in git, no infrastructure | Requires discipline about who writes where; no locking | chosen |
| Pass context in agent prompts | Simplest to start | Lost when a session ends; no audit trail; context grows unboundedly; nothing is inspectable | rejected |
| External database or issue tracker | Real concurrency control, existing UI | Infrastructure and credentials to run the pipeline; not diffable next to the code; harder to inspect mid-run | rejected — reconsider if the pipeline goes multi-user |

## Consequences

**Positive** — the pipeline is resumable from any point; a human can read or correct any
artifact by hand; the whole decision history lives in git next to the code it produced; a
failed run leaves evidence instead of a lost context.

**Negative** — agents must follow the write-ownership rules to avoid clobbering each other,
and there is no locking, so genuinely concurrent writes to one file are unsafe. The workplan
must declare parallel tasks as file-level conflict-free.

**Neutral** — the workspace grows with each cycle. Old cycles stay on disk as history.

**Constraints created** — every agent writes only inside its own phase directory plus
`issues/`, `bus/`, `history/`, and `state.json`; only the architect writes `docs/adr/`; only
the orchestrator resets gates and increments the cycle; `history/events.jsonl` is
append-only and never rewritten.

## Reversibility

Cheap to layer a database or tracker on top later by syncing from the event log — the log is
the source of truth and is designed to be replayable. Moving off the filesystem entirely
would mean rewriting every agent's I/O section.

## Validation

The test is a hard one: kill a pipeline mid-cycle, start a fresh session, run
`/sdlc-status`, and confirm the next action is unambiguous from disk alone. If a human
cannot reconstruct where the work stands without asking an agent, this decision failed.
