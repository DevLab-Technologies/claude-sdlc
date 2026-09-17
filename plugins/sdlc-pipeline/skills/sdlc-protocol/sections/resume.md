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

**One artifact does not prove its phase ran.** `08-review/cycle-<n>/verification.md` can exist with
the review gate still `pending` and nothing wrong: its fast stage is also the join that compiles the
tree after a parallel implementation group (section 9b), so it is routinely written while phase 7 is
still the current phase. Row 3 above is about a phase's **own** completing artifact — for the review
gate that is the lead's `review-summary.md` sign-off, never `verification.md`.

The same holds for the **event log**: a paired `sdlc-review-lead` run labelled `phase: 08-review`
may be that join, written while `state.json` still reads `07-implementation` (section 9b requires
the label). It is not evidence the pipeline reached phase 8 — never advance the position past an
`implementation` gate still `pending`, or the sequential workplan tasks that had not run yet are
dropped silently. And re-running anything that touches the tree stales that `verification.md`:
phase 8 re-runs verify-fast rather than carrying it forward.

Discard means move it aside, not delete it: rename to `<name>.interrupted-<ts>.md` so the evidence
survives. A partial report can still show what an interrupted agent was seeing.

**Never resume by assuming.** If the log and the artifacts disagree, say so and reconcile from the
artifacts — they are the work; state is a claim about the work. Report what you discarded and why
rather than silently redoing it, because a re-run that quietly replaces a different conclusion is
how an interruption becomes a wrong verdict.

**Idempotence.** Re-running an interrupted agent must revise its output in place for that cycle, not
append a second copy. Numbered artifacts already allocated — `ISSUE-011`, `INV-004`, `TC-014` — keep
their numbers; never reuse a number for different content.

