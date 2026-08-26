---
description: Diagnose an interrupted pipeline run and continue it — reconciles state against the event log and artifacts, quarantines partial output, re-runs only what was interrupted, then hands back to the pipeline.
argument-hint: [feature slug, or blank to find the interrupted one]
---

Resume the interrupted run for: **$ARGUMENTS**

Blank means find it: read `.sdlc/registry.json` and pick the feature whose `status` is
`in_progress`. If several are, list them and ask which — resuming the wrong feature wastes a cycle.

## Step 1 — Diagnose before doing anything

Invoke the `sdlc-protocol` skill; section 3a is the contract for this whole command.

Read `state.json`, then `history/events.jsonl`, then the artifacts. Build the picture:

1. **Find unpaired runs.** Every `phase_start` with no matching `run_complete` for the same agent,
   phase, and cycle is an interrupted run.
2. **Find untrusted artifacts.** Any artifact without `status: complete` in its frontmatter is
   partial, whatever its size — a half-written report reads like a finished one. Skip `digest/` and
   `floor/`: those briefs are derived, own no phase, and are regenerated rather than recovered.
3. **Check for state drift.** A gate marked `passed` whose artifact is missing or partial, or a gate
   `pending` whose artifacts are complete. The artifacts are the work; `state.json` is a claim about
   the work, so believe the artifacts and fix the claim.
4. **Check the working tree.** `git status` and the diff. Edits not accounted for by a
   `## Fixed inline` section or a task record mean an agent was interrupted mid-write — most likely
   the review lead applying mechanical fixes.
5. **Check for a half-finished parallel group.** In a fan-out, some members may have completed and
   some not. Only the unpaired ones need re-running; completed reports stand.

## Step 1b — If this is a program, diagnose both levels

A cross-repo program has two kinds of state, and an interruption can leave them disagreeing. If
`spec-link.md` or `participants.json` exists, this is a program (protocol 12) — widen the diagnosis:

1. **Which workspace was interrupted?** Check the shared workspace *and* this repo. An interruption in
   the shared phases is different from one in a participant's local cycle, and the fix differs.
2. **Shared-versus-local drift.** Compare `participants/<repo>/status.md` in the shared workspace against
   that repo's own `state.json`. The **repo's own state is authoritative for that repo** — a stale
   `status.md` is a reporting lag, not a reason to re-run the repo's work. Refresh the copy instead.
3. **Contract state.** A steward interrupted mid-publication is the dangerous case: a contract may be
   `published` in the file while its `CHANGELOG.md` has no entry, or vice versa. Never resolve this by
   guessing — a consumer may already have built against it. Report both states and let the human decide,
   because silently un-publishing a contract someone consumed is worse than any delay.
4. **Acknowledgement skew.** A `contract-ack.md` written locally but not copied to the shared workspace,
   or the reverse. Reconcile toward whatever the consumer actually built against, which is the local
   copy.
5. **Interrupted integration.** If `12-integration/cycle-<n>/` has partial output, quarantine it and
   re-run the whole gate rather than the missing pieces. Integration passes for a *set of participant
   commits*, so a half-finished gate cannot be topped up — the commits may have moved since.

**Do not re-run another repository's work from here.** You can only see this checkout and the shared
workspace. Report which participants need their own `/sdlc-resume` and let the human run them there.

## Step 2 — Report the diagnosis and get agreement

Before changing anything, tell the human:

- Where the run stopped: phase, cycle, track, and which agent was mid-flight
- What is trustworthy and what is not, by file
- Any state drift found, and which way you intend to reconcile it
- Unaccounted working-tree edits, with the diff summary
- Exactly what you will re-run, and what you will keep

**Stop and ask if any of these hold**, because each can destroy work or produce a wrong verdict:
- Unaccounted code edits in the working tree — the human may want to keep, review, or revert them
- A contract left half-published, since a consumer may already depend on it
- An interrupted integration gate whose participant commits have since moved
- A gate marked `passed` with a missing artifact, which may mean someone edited state by hand
- More than one interrupted cycle, meaning the history is harder to trust than a fresh cycle would be

Otherwise proceed.

## Step 3 — Quarantine, do not delete

Rename every untrusted artifact to `<name>.interrupted-<ISO-ts>.md` rather than deleting it. A
partial report still shows what its author was seeing, which matters if the re-run reaches a
different conclusion. Append an `interrupted_run_quarantined` note to your run record listing every
file moved.

Never quarantine an append-only file. `history/events.jsonl` is never rewritten, even when it
records a run that failed — that record is the evidence this command depends on.

## Step 4 — Re-run only what was interrupted

Launch exactly the agents whose runs were unpaired, with the same inputs, cycle, and track they had.
Preserve already-allocated numbers — `ISSUE-011`, `INV-004`, `TC-014` keep their ids, and a re-run
revises in place rather than appending a second copy.

For a half-finished parallel group, launch the missing members **in one message** so they still run
concurrently, and pass them the same shared inputs the completed members used — in phase 8 that
means the same `verification.md` and diff scope, not a freshly computed one. Re-deriving the diff
scope would have some lenses reviewing a different set of files than their siblings.

Then reconcile `state.json` and hand back to the normal sequence: `/sdlc <slug>` continues the
pipeline from the corrected position.

## Step 5 — Report

- What was interrupted, what you quarantined, what you re-ran
- Whether any re-run reached a **different** conclusion than the partial artifact suggested — call
  this out explicitly; it is the most interesting thing an interruption can teach you
- The corrected position, and the next phase to run

## What this command will not do

It will not repair a workspace whose history and artifacts contradict each other in ways only a
human can settle — conflicting conclusions across cycles, or hand-edited state. In that case say so,
lay out the options, and let the human choose. A confidently reconstructed workspace that is wrong
is worse than one that admits it is confused.
