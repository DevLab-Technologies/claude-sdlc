# Protocol — termination criteria

Loaded by `sdlc-release-gate` and the orchestrator. Core protocol section 7a.

## 7a. The cycle, and when the work is done

A **cycle** is one pass of implement -> review -> QA -> UI QA. Findings become issues. The
orchestrator opens cycle `n+1` when any of those gates failed, resetting only those gates.

The feature reaches `ready_to_ship` only when **all** of these hold. Each needs a file that proves
it — "probably fine" is a fail:

1. Zero `open` or `fixing` issues at `blocker` or `major`.
2. `review`, `qa`, and `ui-qa` are each `passed`, or `skipped` with a reason the **track** justifies,
   **in the current cycle**. A pass from cycle 1 does not carry forward past later changes, and a
   skip justified by expedience rather than the track is a fail.
3. Every story in `02-product/backlog.md` maps to at least one verified QA result — unless the track
   declared no test plan, which must be recorded.
4. Every `blocking: true` bus message is `answered`.
5. `minor` and `nit` issues are fixed or explicitly `deferred` with a rationale, and every deferral
   is listed in the release record. Deferred work nobody can see is just hidden work.
6. Every fixed `blocker`/`major` has a named regression test, and every one that needed a debugger
   has a linked `INV` with a proven root cause.
7. No issue sits in `investigating` or `fixing`.
8. `06-test-plan/plan.md` holds no case still `planned` or `implemented` — those mean the suite was
   never fully run.
9. No sign-off was made stale by a later code change, and nobody signed off on work they authored
   beyond mechanical fixes.
10. If `design_version` is set, no `review`, `qa`, or `ui-qa` pass predates the publish of that
   version, and the implementation was built against it rather than a superseded one.

**Escalation instead of spinning.** If `cycle > max_cycles`, or the same issue has reopened in three
cycles, or a contradiction exists that only a human can resolve — conflicting requirements, an
assumption proven wrong, scope unreachable under the constraints — do not open another cycle. Set
`status: blocked`, append `escalated`, and write `history/ESCALATION.md`: what keeps failing, the
root cause as best it is known, and two or three concrete options with their trade-offs.

Never pass a gate to end a loop. A pipeline that is honestly stuck is a useful result; a green light
nobody earned is the expensive failure.
