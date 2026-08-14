---
description: Run the whole review phase in one command — verify the build once, fan out five specialist lenses in parallel, then merge, deduplicate, fix mechanically, and sign off. Works inside a feature workspace or standalone on a diff, branch, or PR.
argument-hint: [feature slug | branch | PR number | path | blank for the working diff]
---

Run the full parallel review over: **$ARGUMENTS**

If that is blank, review the current working diff (uncommitted changes, else the last commit).

You are the orchestrator for this phase. You do not review anything yourself — you sequence the
lead, launch the lenses concurrently, and report the merged verdict.

## Step 0 — Establish the target and the context

1. Invoke the `sdlc-protocol` skill. Section 9 governs the parallel group you are about to launch,
   and it is the reason this runs in three steps rather than one.

2. **Resolve the target** from the argument:
   - A feature slug matching `.sdlc/features/<slug>/` -> full context mode, reviewing that
     feature's current cycle
   - A branch name or PR number -> that diff, via git or `gh pr diff`
   - A path -> the files under it
   - Blank -> `git diff` if there are uncommitted changes, otherwise `git diff HEAD~1`

3. **Detect the mode**, and say which one you are in before you launch anything:
   - **Full context** — a feature workspace exists with stories, contracts, and an approved test
     plan. Every lens has its specification to review against. Write outputs to
     `.sdlc/features/<slug>/08-review/cycle-<n>/`.
   - **Standalone** — no feature workspace for this change. Write outputs to
     `.sdlc/reviews/<date>-<target>/` instead, and tell each lens explicitly what it does *not*
     have. This matters: requirement fidelity has no acceptance criteria to check against, and test
     honesty has no approved plan, so both must review against the code's own apparent intent and
     say plainly that they could not verify against a specification. A standalone review that
     implies it checked requirements is a false signal.

## Step 1 — Verify once

Launch `sdlc-review-lead` in **verify mode** with the target. It runs build, lint, type check, and
the suite using the project's real commands, smoke-tests the primary path, checks any implementer
claims, and writes `verification.md`.

**If it reports `build_usable: no`, stop here.** Report the failure with its actual output. Five
lenses reading code that does not compile produce five reports about one broken build.

## Step 2 — Fan out five lenses, in one message

Launch all five **in a single message** so they run concurrently. Separate messages run in
sequence and you lose the entire point.

| Agent | Lens | Owns file | Local id prefix |
|---|---|---|---|
| `sdlc-code-reviewer` | correctness + requirement fidelity | `correctness.md` | `CORR-` |
| `sdlc-review-security` | authorization, injection, secrets, exposure | `security.md` | `SEC-` |
| `sdlc-review-performance` | N+1, unboundedness, indexes, timeouts | `performance.md` | `PERF-` |
| `sdlc-review-tests` | do the tests assert what was required | `tests.md` | `TEST-` |
| `sdlc-architect` | architectural compliance | `compliance.md` | `ARCH-` |

Give every lens: the target and diff scope, the output directory, its own file name, its local id
prefix, the path to `verification.md`, and the mode from step 0. Remind each that it must not run
a server, run the suite, edit code, or allocate global issue ids.

Skip a lens only when it is genuinely inapplicable — no tests changed and none were required, or
no feature workspace and no architecture to comply with. **Record every skip and why.** A skipped
lens is an unexamined angle, never a clean one.

## Step 3 — Synthesize

Wait for **all** launched lenses. Then launch `sdlc-review-lead` in **synthesize mode** with the
list of reports and the list of any lens that was skipped or failed.

It merges and deduplicates across lenses, resolves severity conflicts upward, allocates global
`ISSUE` ids, applies mechanical fixes sequentially and re-runs the build, reports the cross-cutting
patterns no single lens could see, and writes `review-summary.md` with the sign-off.

In full-context mode it also sets the `review` gate. In standalone mode there is no gate — the
verdict is the deliverable.

## Step 4 — Report

Give the human, compactly:

- Mode, target, and which lenses ran, were skipped, or failed
- The verdict, and counts by severity
- Every blocker and major: id, one-line summary, file, and which lenses found it
- What was fixed inline
- The cross-cutting findings — these are usually the most valuable output
- The `NOT verified` line from the sign-off, verbatim. Do not summarize it away; it is where the
  remaining risk is declared.
- What runs next: fixes, a debugger for anything whose cause is unproven, or nothing

Never restate a lens's verdict as the phase verdict — only the lead's merged sign-off counts. And
never imply ship-readiness: this command establishes that the code is correct and is what was
specified, not that the feature is ready. That needs QA execution and belongs to
`sdlc-release-gate`.

## When to reach for something lighter

This launches seven agent runs. For a quick pass over a small diff, the built-in `/code-review` is
one agent and enough. Use this command when the change is substantial, touches security or
performance-sensitive paths, or is finishing a feature cycle.
