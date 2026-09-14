# Protocol — parallel safety and pipelining

Loaded by the orchestrator and by every agent running as part of a parallel group. Core protocol sections 9 and 9a.

## 9. Parallel safety

Agents run concurrently where work is independent. Four hazards, four rules:

1. **Id races** — parallel agents **never allocate global ids**. Emit local prefixed findings
   (`CORR-1`, `SEC-3`, `PERF-2`, `TEST-5`, `ARCH-1`, `PROD-4`, `BIZ-2`); a single synthesizer
   assigns `ISSUE-<NNN>` afterward and records the mapping.
2. **Concurrent edits** — only **one** agent edits per phase. Parallel members propose fixes and
   never apply them.
3. **Shared runtime** — build, suite, server, and fixtures are exercised **once**, before the
   fan-out, into a file the group reads. No parallel member starts a server or runs the suite. Need
   a measurement nobody took? Record it in `## Not covered`.
4. **Shared state** — only the phase's owning agent touches `state.json` and gates.

Each parallel agent writes exactly **one** file, named for its lens, and reads freely. If two could
write the same path, split the path — there is no locking.

A member that fails or returns nothing is recorded as **not run**. An unexamined angle is not a
clean angle, and no sign-off may imply otherwise.

## 9a. Pipelining — latency is barriers, not slow agents

Wall-clock time is the sum of the slowest step in each phase, so the wins come from removing
barriers, not from hurrying anyone. Overlap only where the dependency is not real.

**Split the verification gate.** Build and type check answer "is this reviewable" and take seconds.
The test suite and smoke test take minutes and only the **tests** lens needs their output. So:

1. **Verify-fast** — build, type check, and the diff scope. If it fails, stop: nobody reviews code
   that does not compile. This is the only thing on the critical path before the fan-out.
2. **Concurrently** — the suite and smoke test (verify-slow) run alongside the four **static** lenses
   (correctness, security, performance, compliance), which read source and need no runtime facts.
3. **The tests lens** starts when verify-slow lands, since it compares results against the plan.
4. **Synthesize** once all of it is in.

That takes the slow suite off the critical path for four of five lenses without changing what any
of them examines. Two constraints keep it honest: static lenses read **source**, never build output,
which may be mid-rewrite while the suite runs; and the claim check — implementer claims versus
observed results — stays with the lead in verify-slow, where the evidence is.

**Real dependency or incidental?** A dependency created by how work was decomposed is not a real
dependency. The architect should prefer decompositions that maximize the `parallel_with` sets, and
where a task ordering exists only because of how the work was carved up, say so and re-carve it.
Two tasks touching one file is a real conflict; two tasks the same person would naturally do in
order is not.

**Overlap that is safe:** the architect may begin the data model and backend interfaces while the UX
audit runs, since audit findings land on the interface, not the schema — then incorporate them
before declaring `interfaces.md` final. QA may begin authoring the test plan the moment the UX audit
passes, running concurrently with the architect: the plan's edge-case and acceptance-criteria cases
need only product and design, and only its architecture-derived cases (partial failure, error codes)
need `interfaces.md`, which QA folds in once it lands, before the plan goes to review. Declare the
overlap in the run record in both cases, so a reader knows what was still open when the drafting
started.

**Barriers that must stay:** anything in section 9's hazard list, functional QA before UI QA, a
reviewer re-verifying after a fix, and the release gate last and alone. Removing those buys minutes
and costs the property the pipeline exists for.
