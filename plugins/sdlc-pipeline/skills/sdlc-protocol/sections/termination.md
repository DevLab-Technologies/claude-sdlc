# Protocol — termination criteria

Loaded by `sdlc-release-gate` and the orchestrator. Core protocol section 7a.

## 7a. The cycle, and when the work is done

A **cycle** is one pass of implement -> review -> QA -> UI QA. Findings at `blocker` or `major`
become issues; `minor` and `nit` findings do not (protocol section 4). The orchestrator opens cycle
`n+1` when one of those gates failed, resetting only the gates the change actually invalidated.

The feature reaches `ready_to_ship` only when **all** of these hold. Each needs a file that proves
it — "probably fine" is a fail:

1. Zero `open` or `fixing` issues at `blocker` or `major`.
2. `review`, `qa`, and `ui-qa` are each `passed`, or `skipped` with a reason the **track** justifies.
   **A pass carries forward while it still describes the tree.** A sign-off is **live** when no file
   in its `commit_or_files` scope has changed since it was written, and **stale** the moment one
   has. The test is mechanical: `git diff --name-only <that sign-off's sha> HEAD` intersected with
   its scope — empty means live. **Fail closed.** A sign-off carrying no sha where the project has
   a repo, or a scope you cannot resolve to real paths, is stale: it may be fine, but nothing on
   disk says so, and a pass nobody can re-test is the kind of green light this gate exists to
   refuse. A stale pass fails until that gate re-runs over the change; a live one from cycle 1 is
   worth exactly as much in cycle 3. Compare the scope, not the cycle number: re-running a gate
   across code nothing touched costs a full phase and buys nothing, and a skip justified by
   expedience rather than the track is still a fail.
3. Every story in `02-product/backlog.md` maps to at least one verified QA result — unless the track
   declared no test plan, which must be recorded.
4. Every `blocking: true` bus message is `answered`.
5. **`minor` and `nit` findings never block ship, and never open a cycle.** They are carried as the
   aggregate line each reviewer wrote, totalled in `state.json`, and reproduced in the release
   record so nobody has to go hunting for them. No ids, no triage, no fix loop. A reviewer may still
   fix a mechanical one inline under section 7; what it may not do is make the feature wait on it.
6. Every fixed `blocker`/`major` has a named regression test, and every one that needed a debugger
   has a linked `INV` with a proven root cause.
7. No issue sits in `investigating` or `fixing`.
8. `06-test-plan/plan.md` holds no case still `planned` or `implemented` — those mean the suite was
   never fully run.
9. Nobody signed off on work they authored beyond mechanical fixes.
10. If `design_version` is set, no live `review`, `qa`, or `ui-qa` pass predates the publish of that
   version, and the implementation was built against it rather than a superseded one.

## 7b. The budget — what a feature is allowed to spend

An unbounded pipeline is not a careful one; it is one that cannot say what a verdict cost. So
`state.json` carries a `budget`, written at setup and never raised silently:

```json
"budget": { "cycles": 3, "tokens": null },
"spend":  { "cycles": 2, "tokens": 4120000 }
```

- **`cycles`** comes from the track: `trivial` 1, `small` 2, `standard` 3, `large` 5. This replaces
  `max_cycles`, which said the same thing without saying what it was for.
- **`tokens`** is optional and project-set. Leave it `null` when nobody has set one — then the spend
  is still reported, just without a verdict against it. An invented ceiling is worse than none.
- **`spend`** is the truth from the log: cycles closed, and the sum of every `run_usage.tokens`
  (protocol section 3). Runs that reported no usage are counted as runs and excluded from the token
  sum, which the report must say, because a spend figure missing half its runs reads as a low one.

The release gate reports spend against budget in every cycle decision, whether or not it matters to
that decision. A cost nobody states is a cost nobody manages.

**Escalation instead of spinning.** If `spend.cycles >= budget.cycles`, or a token budget is set and
exhausted, or the same issue has reopened in three cycles, or a contradiction exists that only a
human can resolve — conflicting requirements, an assumption proven wrong, scope unreachable under
the constraints — do not open another cycle. Set `status: blocked`, append `escalated`, and write
`history/ESCALATION.md`: what keeps failing, the root cause as best it is known, what the run has
spent, and two or three concrete options with their trade-offs. Raising the budget is a legitimate
option for a human to choose; it is never one the pipeline takes for itself.

Never pass a gate to end a loop. A pipeline that is honestly stuck is a useful result; a green light
nobody earned is the expensive failure. **And never open a cycle for findings criterion 5 says do
not block** — a cycle spent closing nits is the same waste wearing a diligent face.
