# Protocol — interruption recovery

Loaded by `/sdlc-resume` and the orchestrator. Core protocol section 3a covers the three rules every agent follows; this is the recovery procedure.

## 3a (continued). Recovering an interrupted run

**Resuming.** Read `state.json` for position, then reconcile against the event log:

| Signal | Meaning | Action |
|---|---|---|
| `phase_start` with no `run_complete` | that agent was interrupted | discard its artifacts and re-run it |
| Artifact without `status: complete` | partial output | discard and re-run its owner |
| Gate `pending`, artifacts present and complete | the agent finished but state was not written | verify the artifacts, then set the gate |
| Parallel group with some members unpaired | only those members were interrupted | re-run **only** those; completed reports stand |
| Working tree has edits not listed in a `## Fixed inline` section | the lead was interrupted mid-fix | inspect the diff, then either record or revert those edits before continuing |

Discard means move it aside, not delete it: rename to `<name>.interrupted-<ts>.md` so the evidence
survives. A partial report can still show what an interrupted agent was seeing.

**Never resume by assuming.** If the log and the artifacts disagree, say so and reconcile from the
artifacts — they are the work; state is a claim about the work. Report what you discarded and why
rather than silently redoing it, because a re-run that quietly replaces a different conclusion is
how an interruption becomes a wrong verdict.

**Idempotence.** Re-running an interrupted agent must revise its output in place for that cycle, not
append a second copy. Numbered artifacts already allocated — `ISSUE-011`, `INV-004`, `TC-014` — keep
their numbers; never reuse a number for different content.

