# Protocol — parallel safety and pipelining

Loaded by the orchestrator and by every agent running as part of a parallel group. Core protocol sections 9, 9a and 9b.

## 9. Parallel safety

Agents run concurrently where work is independent. Four hazards, four rules:

1. **Id races** — parallel agents **never allocate global ids**. Emit local prefixed findings
   (`CORR-1`, `SEC-3`, `PERF-2`, `TEST-5`, `ARCH-1`, `PROD-4`, `BIZ-2`); a single synthesizer
   assigns `ISSUE-<NNN>` afterward and records the mapping.
2. **Concurrent edits** — only **one** agent edits per phase. Parallel members propose fixes and
   never apply them.
3. **Shared runtime** — build, suite, server, and fixtures are exercised **once per group**,
   never once per member. No parallel member starts a server or runs the full suite. Where the
   group *reads* a runtime fact, that run comes **before** the fan-out, into a file the group reads
   — the review phase, section 9a. Where the group *produces* the tree, it comes **at the join**,
   once every member has returned — the implementation phase, section 9b. A member cannot honestly
   take the measurement earlier: the working tree it would measure is one its peers are still
   editing. Need a measurement nobody took? Record it in `## Not covered`.
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

## 9b. Fan-out width — more agents is not more speed

Section 9a removes barriers. This one is about the other instinct, which is to widen the group, and
it is mostly wrong. Four things bound what width buys, in the order they bite.

**Width is set by the decomposition, not by whoever launches.** Phase 7 runs one implementer per
workplan task, and only tasks the workplan declares `parallel_with` run together — conflicting
tasks run in sequence, because rule 2 gives one editor per path and there is no locking. So "use
more implementers" is not a setting anyone can turn up. It means "carve the workplan into more
independent tasks", and it buys nothing when the new tasks still touch the same files: eight tasks
over one directory is eight sequential runs with eight times the reading.

**Past that cap, width costs and does not save.** Section 3's sum-versus-wall rule is the
arithmetic. Agent-time grows with every member added; wall-clock divides only across members that
were genuinely independent. A group of eight whose real width is two pays eight and saves two.

**A phase is not the pipeline.** Implementation is one phase of twelve, and most of the others are
serial on purpose: the chain up to `interfaces.md`, functional QA before UI QA, a reviewer
re-verifying its own findings after a fix, the release gate last and alone. Taking implementation
to zero would still leave every one of those, so the gain is capped at implementation's share of
the wall-clock — which is exactly why 9a spends its length on barriers.

**And a wider group is a more expensive way to be wrong.** Every member is one more run to redo
when the cycle reopens.

So when phase 7 feels slow, the levers are these, strongest first:

1. **Launch each group in one message.** Separate messages run in sequence, and a group launched
   that way was never a group. This costs nothing and is the most common way the benefit is lost.
2. **Decompose for independence, not for count.** A dependency created by how the work was carved
   is not a real one — that is a message to the architect about `parallel_with`, not a bigger
   fan-out.
3. **Pick the right track** (section 8), so fewer phases run at all.
4. **Avoid a cycle.** A failed gate re-runs implement, review, and QA together, and dwarfs every
   saving available inside a single phase.

**Members verify what they own; the tree is verified once, at the join.** A parallel implementer
runs the type check, the lint, and the tests covering its own files and its assigned `TC` ids —
not the full suite, no dev server, no fixtures. Running the suite from inside the group measures a
tree its peers are still rewriting, so a red result may belong to a task that is not the runner's
and a green one proves less than it appears to; it is also the same minutes spent N times over. The
integrated build and type check run once when the group joins, before the implementation gate is
set, and that run is the review phase's verify-fast rather than an extra one. A member reporting
scoped verification is reporting honestly; a member reporting a clean full-suite run is reporting
something it was not in a position to observe.

What makes the scoping necessary is the **shared tree**, not the concurrency. Implementers working
in separate repositories (section 12) do not share one, so each verifies its own repository in
full, as if alone — and the join that still has to happen there is integration, not the build.

