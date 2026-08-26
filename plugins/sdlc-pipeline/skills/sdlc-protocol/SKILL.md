---
name: sdlc-protocol
description: The shared filesystem contract every SDLC agent must follow — where artifacts live, how agents communicate, how state and history are recorded, and the rules for issues, fix authority, sign-off, and parallel safety. Read this before doing any SDLC phase work.
---

# SDLC Protocol

Agents never talk to each other directly. They communicate **only** through the feature workspace on
disk: read your inputs, write your outputs, append to history, update state. That is what makes the
pipeline resumable and auditable across sessions.

This file is the shared core. Role-specific detail lives in the agent that owns it — your own agent
definition carries the checklists and formats for your job.

## 1. Workspace layout

One directory per feature: `.sdlc/features/<slug>/`

```
state.json  brief.md
00-intake/      questions.md assumptions.md scope.md answers.md
01-research/    findings.md prior-art.md constraints.md
02-product/     prd.md stories/STORY-001.md backlog.md
                specification.md changes.md recommendations.md
                review/{product-critique,business-case,ux-review,feasibility}.md
03-design/      ux-spec.md flows.md screens/<screen>.md design-tokens.md
03b-figma/      figma-link.md CHANGELOG.md
                v<N>/{manifest.json,tokens.md,components.md,coverage.md,reconciliation.md}
                v<N>/screens/<screen>.md  v<N>/shots/<screen>--<state>.png
04-ux-audit/    audit.md
05-architecture/architecture.md interfaces.md workplan.md test-strategy.md
06-test-plan/   plan.md review.md assignments.md
07-implementation/ TASK-001.md handoff.md
08-review/      cycle-<n>/{verification,correctness,security,performance,tests,compliance}.md
                cycle-<n>/review-summary.md
09-qa/          cycle-<n>/{functional-qa,ui-qa,exploratory}.md
10-release/     traceability.md cycle-<n>-decision.md release-notes.md
11-investigations/ INV-001.md
issues/         ISSUE-001.md
bus/            0001-architect-to-po.md
history/        events.jsonl  runs/<ts>-<agent>.md
digest/         feature-brief.md stories-brief.md one-pager.md
```

Paths are relative to the repo root. Write only inside your own phase directory plus `issues/`,
`bus/`, `history/`, and `state.json` — except the architect, who also owns `docs/adr/`, and
`/sdlc-digest`, which owns `digest/` and writes nowhere else in the workspace.

`digest/` is derived, human-facing, and owned by nobody: short briefs generated from the artifacts
above by `/sdlc-digest`, governed by the `sdlc-digest` skill. It affects no gate and no state, no
agent reads it as input, and deleting it costs nothing but regeneration. Never digest a digest, and
never let a brief stand in for the artifact it summarizes.

**`digest/` is outside 3a.** The interruption machinery below does not apply to it: a brief left
`partial` by a killed session is regenerated on the next `/sdlc-digest`, never quarantined, and
never reported as an interrupted run. It has no owning agent to re-run and logs no events, so
treating it as pipeline output sends the recovery path looking for something that was never there.
Every scan for unpaired runs or partial artifacts skips this directory.

Standalone runs with no feature behind them go to `.sdlc/reviews/<date>-<target>/`,
`.sdlc/product/<date>-<slug>/`, or `.sdlc/design/<date>-<slug>/` for a design version with no
feature attached — same layouts, no gate to set.

## 2. state.json — the single source of truth

```json
{
  "slug": "user-auth", "title": "…", "created": "2026-08-10",
  "phase": "09-qa", "cycle": 2, "max_cycles": 5,
  "track": "standard",
  "status": "in_progress",
  "gates": { "intake": "passed", "research": "skipped", "product": "passed",
    "design": "passed", "figma-design": "passed", "ux-audit": "passed",
    "architecture": "passed", "test-plan": "passed", "implementation": "passed",
    "review": "failed", "qa": "pending", "ui-qa": "pending", "release": "pending" },
  "issues": { "blocker": 1, "major": 2, "minor": 4, "nit": 3 },
  "design_version": 2,
  "open_questions": 0, "adrs": ["ADR-0001"], "blocked_on": null
}
```

Gates: `pending` | `passed` | `failed` | `skipped`. A `skipped` gate needs a recorded reason.
Status: `in_progress` | `awaiting_human` | `blocked` | `ready_to_ship` | `shipped`.
Track: `trivial` | `small` | `standard` | `large` — see section 8.
`design_version`: the published Figma design version number, or `null` when there is none — see
section 2a and the `sdlc-figma-design` skill.

Read it before you start; update it as your **last** action, in one write. Never reset another
phase's gate; only the orchestrator does that when opening a cycle.

## 2a. Two design artifacts, one authority split

A feature may carry a Figma design as well as the markdown design specification. The full contract
is the `sdlc-figma-design` skill; three rules matter to every agent, whether or not it ever opens
Figma.

1. **Only `sdlc-figma-designer` talks to Figma.** It exports what it read into
   `03b-figma/v<N>/` — extracted per-screen specs, reference renders, tokens, and a Figma-to-code
   component mapping. Every other agent reads those files. Nobody else needs Figma access, and no
   phase blocks on Figma being reachable.
2. **Implement against a `published` version, never a `draft` and never the live file.** Versions
   are immutable once published; a change is `v<N+1>`. `state.json` -> `design_version` names the
   current one, or `null`.
3. **Authority splits by kind of question.** Visual properties — layout, spacing, type scale,
   color, radius, elevation, component composition — follow the published design version when one
   exists. Behavioral properties — which states exist, validation, copy strings, focus order,
   accessibility semantics, analytics — follow `03-design/*.md`, always, because that is what the
   UX audit ran against. With no published version, `03-design/*.md` governs everything.

Where the two disagree inside one column, that is a `major` defect: follow `03-design/*.md`, open an
issue naming both files and both values, and bus `sdlc-ux-designer`. Never split the difference.

**A newly published design version makes later sign-offs stale**, exactly as a code change does
(section 7): a `review`, `qa`, or `ui-qa` pass recorded before the publish no longer covers the
current design, and those gates re-run in the current cycle. Gate key `figma-design`; `skipped` with
a recorded reason when there is no Figma, no access, or no user-facing surface.

## 3. History — append-only, never rewritten

One JSON line per meaningful event in `history/events.jsonl`:

```json
{"ts":"2026-08-10T14:20:41Z","cycle":2,"agent":"sdlc-review-security","event":"phase_start","phase":"08-review"}
{"ts":"2026-08-10T14:22:05Z","cycle":2,"agent":"sdlc-review-security","event":"run_complete","phase":"08-review","duration_ms":84000,"summary":"1 blocker (SEC-2), 0 major","artifacts":["08-review/cycle-2/security.md"]}
{"ts":"2026-08-10T14:22:11Z","cycle":2,"agent":"sdlc-review-lead","event":"gate_failed","phase":"08-review","verdict":"failed","summary":"1 blocker (unbounded query), 2 major","artifacts":["08-review/cycle-2/review-summary.md"],"issues_opened":["ISSUE-011"],"next":"sdlc-implementer"}
```

Events: `phase_start`, `run_complete`, `question_asked`, `question_answered`, `issue_opened`,
`issue_triaged`, `investigation_started`, `investigation_complete`, `root_cause_found`,
`issue_fixed`, `issue_verified`, `issue_reopened`, `adr_recorded`, `test_plan_approved`,
`test_plan_amended`, `figma_version_published`, `figma_drift_detected`, `figma_conflict_opened`,
`gate_passed`, `gate_failed`, `cycle_opened`, `cycle_closed`, `escalated`, `shipped`.

**Timing rides on the same bracket, for free.** You already write `phase_start` before working and
`run_complete` after — this is the only extra step:

- On `run_complete`, add `"duration_ms"`: the wall-clock gap between your own `run_complete.ts` and
  your own `phase_start.ts` for this exact agent, phase, and cycle. You already have both
  timestamps; this is arithmetic, not new instrumentation.
- On `cycle_closed`, the agent closing the cycle (normally `sdlc-release-gate`) adds
  `"duration_ms"`: the gap between this `cycle_closed.ts` and the `cycle_opened.ts` for the same
  cycle number.
- On `shipped`, add `"duration_ms"`: the gap from the very first event in `history/events.jsonl`
  to this one — the feature's total wall-clock, start to ship.

**Sum-time and wall-time are different numbers — never conflate them when reporting.** Five review
lenses each taking 90 seconds is 450 seconds of combined agent-time but roughly 90 seconds of
wall-clock, because they ran concurrently. Sum-time answers "how much work happened"; wall-time
(latest `run_complete.ts` minus earliest `phase_start.ts` in the group) answers "how long did we
actually wait." A report that adds parallel durations and calls it elapsed time is wrong, not just
imprecise — see `/sdlc-timing` for the reporting rules this drives.

Also write `history/runs/<ISO-ts>-<agent>.md` with frontmatter (`agent`, `phase`, `cycle`,
`verdict`, `inputs`, `outputs`) and the narrative: what you concluded, what you were uncertain
about, what you deliberately did not do. A human reading only that file must be able to
reconstruct your reasoning.

## 3a. Interruption and resume

A run can die at any moment — a killed session, a crash, a closed laptop, a hit context limit. The
workspace is designed so the next session can tell exactly where it stopped and what to trust.

**Three rules make it work. Follow them even when a run seems certain to finish.**

1. **Bracket your run in the event log.** Append `phase_start` with your agent name, phase, and cycle
   **before** you do any work, and `run_complete` when you are done. An unpaired `phase_start` is the
   signature of an interrupted run.
2. **Mark your artifacts complete, last.** Every artifact you write carries `status: partial` in its
   frontmatter from the moment you create it, flipped to `status: complete` in your final write. A
   file without `status: complete` is **untrusted** — it may be half a thought.
3. **Update `state.json` as your very last action**, in one write. A gate therefore never claims
   `passed` for work that did not finish.

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

## 4. Issues

`issues/ISSUE-<NNN>.md`, monotonic across the feature, numbers never reused:

```markdown
---
id: ISSUE-011
title: Session lookup runs an unbounded query per request
severity: blocker      # blocker | major | minor | nit
source: sdlc-review-security
phase_found: 08-review
cycle_found: 2
story: STORY-003
location: src/auth/session.ts:41
status: open           # open | investigating | fixing | fixed | verified | wontfix | deferred
cycle_fixed: null
root_cause: null       # INV-<NNN> once proven
related_issues: []     # others sharing this root cause
reopened_count: 0
---
## What is wrong
## Why it matters
## How to reproduce / where to look
## Suggested direction (non-binding)
## Verification steps   <- QA runs these verbatim
```

**Severity ladder.** `blocker`: breaks correctness, security, data integrity, a contract, or
requirement fidelity. `major`: will cause a real defect or real maintenance pain. `minor`: worth
fixing, no user impact at plausible scale. `nit`: preference. Never inflate to be heard; never
deflate to be agreeable. Mark speculative findings `minor` and say they are speculative.

**Rules.** Only the opening agent or a QA agent may set `verified`. Implementers move `open` ->
`fixed`, naming the files. `wontfix`/`deferred` need a rationale. Every reopen increments
`reopened_count`; at `>= 2` the issue **must** go to `sdlc-debugger` before another fix attempt —
two failed fixes mean the cause was never found.

**Triage.** Route by cause, not by symptom: cause visible with `path:line` -> implementer; cause
unproven, intermittent, a regression, a crash, a security finding, or twice-reopened ->
`sdlc-debugger` **first**; contract violation -> architect decides; the spec is wrong -> product
owner or designer, not a code fix. Issues sharing one root cause are **one** fix, cross-linked.
Every blocker/major fix ships a regression test that fails before it and passes after.

## 4a. The test plan — a contract written before the code

`06-test-plan/plan.md` specifies the tests **before** implementation, authored by QA independently,
reviewed by the architect (technical gaps, wrong levels) and the product owner (uncovered criteria,
wrong expectations). Only an `approved` plan unlocks implementation. An implementer deriving its own
cases tests what it built rather than what was asked.

Header: `status: draft | in_review | approved | amended`, `cycle_approved`, `cases`.
One row per case:

| id | story | ac | level | type | owner | expected | test_file | status |
|---|---|---|---|---|---|---|---|---|
| TC-014 | STORY-003 | AC-2 | unit | negative | backend | single non-enumerating error, field cleared | — | planned |

`level`: `unit` | `integration` | `e2e` | `manual` (manual needs a stated reason).
`type`: `happy` | `boundary` | `negative` | `error` | `concurrency` | `security` | `performance` |
`a11y` | `regression`. `owner`: the implementer role, or `qa`.
`status`: `planned` -> `implemented` -> `passing` | `failing` | `not_run` | `withdrawn`.

Implementers fill `test_file` with `path::test name` and reference the `TC` id in the test so
traceability survives refactors. An implementer who thinks a case is wrong buses QA — never
silently drops it or weakens its assertion.

**Amendment, never quiet editing.** New cases are appended with a reason, the header goes to
`amended`, and a `test_plan_amended` event is logged. Cases are never deleted; an invalid one is
`withdrawn` with a rationale. The authoring checklist lives in `sdlc-qa-functional`.

## 5. The bus — directed questions

`bus/<NNNN>-<from>-to-<to>.md` with frontmatter (`seq`, `from`, `to`, `status: open|answered`,
`blocking`), then `## Question`, `## Why I need it`, `## My default if unanswered`. **Always state
a default** so the pipeline never deadlocks. The addressee appends `## Answer` and flips status.
Questions only a human can answer go to `00-intake/questions.md`.

## 6. ADRs

`docs/adr/NNNN-kebab-title.md` from the template, one decision each, for anything expensive to
reverse. The architect owns them. Register ids in `state.json`, append `adr_recorded`.

## 7. Fix authority and sign-off

**Who may change code.** The line is not about difficulty — it is about whether an independent
judge survives the change. An agent that fixes a logic defect becomes its author.

| Finding | Who fixes |
|---|---|
| `nit`, mechanical `minor` with one obvious correct form | the reviewing agent, inline |
| Anything touching logic, control flow, or data | `sdlc-implementer` only |
| `blocker` or `major`, any category | `sdlc-implementer` only, no exceptions |
| Security, concurrency, contract deviation | implementer, after the architect rules on contracts |
| A weak or missing test | the implementer who owed the `TC` — never the reviewer |
| Cause unproven | nobody, until `sdlc-debugger` proves it |

Mechanical means typos, comments, formatting, import order, dead code, unused variables,
misleading names, magic values, duplication with one obvious extraction. List every inline fix in
`## Fixed inline` and re-run the build; if your fix breaks anything, revert and open an issue.

**Sign-off.** Every verification agent ends with:

```markdown
## Sign-off
verdict: passed | failed
reviewed_by: <agent>
cycle: <n>
commit_or_files: <sha or file list>
design_version: <v<N> this covers, or none>
ran: <commands and real results>
verified: <what you established>
NOT verified: <what you could not check, and why — be specific>
```

`design_version` is the published Figma design version the sign-off covers, or `none` — it is what
lets the release gate tell a fresh pass from one that predates a design change, since these blocks
carry no timestamp. `NOT verified` is what makes a sign-off honest; one with no stated limits claims omniscience. A
sign-off is scoped to its own gate. **Only `sdlc-release-gate` declares ship-readiness**, by
auditing the others — rejecting any made stale by later changes, and any covering work its author
changed beyond mechanical fixes. Never state or imply ship-readiness outside your scope.

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

## 8. Scaling to the change — do not pay standard cost for a trivial change

The full pipeline is built for a feature. Running all of it on a copy change wastes time and money
without buying quality. The orchestrator picks a `track` and records it in `state.json`:

| Track | Fits | Phases | Review lenses |
|---|---|---|---|
| `trivial` | copy, config, a constant, a dependency bump | intake -> implement -> review -> release | correctness only |
| `small` | one contained change, no new surface or data | intake, product (stories only), test-plan, implement, review, qa | correctness + the one lens the change touches |
| `standard` | a normal feature | all phases | all five |
| `large` | new subsystem, migration, or auth/payment/data-model change | all phases, `max_cycles` raised | all five, plus a second security pass |

Two rules that keep this from becoming a quality hole:
- **Escalate freely, never silently downgrade.** Any agent that finds the track too small for what
  it is seeing says so and the orchestrator re-tracks upward. Discovering a change touches auth
  means it was never `trivial`.
- **Security and data integrity never get skipped by track.** A `trivial` change to an
  authorization check, a payment path, a migration, or anything handling personal data is
  `standard` at minimum, regardless of diff size.

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

## 10. Report economy

Long reports cost tokens on the way out and again on the way in when a synthesizer reads five of
them. Write less, without cutting substance:

- **Findings first, no preamble.** Do not restate the request, summarize what you read, or explain
  your methodology. The run record holds reasoning; the report holds conclusions.
- **Never quote code back at length.** `path:line` plus the one line that matters.
- **One finding, one entry.** No repeating a finding in a summary section as well.
- `## What is solid` is at most three bullets, and only where it changes someone's behavior.
- **Cycle 2 and later: review the delta only.** Read the diff since the last cycle and the issues
  from it — not the whole feature again. Say in your sign-off that you reviewed the delta and name
  the baseline.
- Omit a section rather than filling it with "none" — except `## Not covered`, which is always
  required, because an absent limits section reads as no limits.

## 11. Rules for every agent

- Read `.sdlc/project-conventions.md` before anything stack-specific. It holds the **exact** build,
  lint, type check, test, and dev-server commands. Use them verbatim; a guessed command produces a
  false failure, worse than no result. Missing? Say so and tell the human to run `/sdlc-init`.
- Read `state.json` and your declared inputs. Read the named files, not the whole workspace —
  reading what you do not need is the most common way a run gets expensive.
- Stay in your lane. Implementers do not rescope, designers do not change requirements, reviewers
  do not fix beyond section 7, and only the release gate declares readiness.
- Write files, not just prose in your reply. Your reply is a summary; the files are the work.
- Be concrete and falsifiable. A file, a line, a trigger, and a consequence — never "improve error
  handling".
- Record uncertainty explicitly rather than smoothing it over.
- Idempotence: revise your output in place for this cycle rather than duplicating it.
- Bracket every run with `phase_start` and `run_complete`, and put `duration_ms` on the latter
  (section 3). `/sdlc-timing` and every duration a human ever sees comes from this one field.
- Never mention tooling or AI assistance in any artifact, commit, or document.

## 12. Multi-repo programs

A **program** is one feature spanning several repositories — a backend, an admin, a web frontend, a
mobile app. The specification is written **once** in a shared workspace; each repository implements
its own slice against a published contract and keeps its own gates. See ADR-0002 for why.

### Where things live

**Shared workspace** — a dedicated specs repository by default, holding everything written once:

```
.sdlc/features/<slug>/
  state.json              # shared position + participant roll-up
  participants.json       # who is involved, their repos and roles
  00-intake/ … 04-ux-audit/          # as normal, written once
  05-architecture/
    architecture.md  workplan.md  test-strategy.md
    interfaces.md                    # the cross-boundary contract, in summary
    contracts/<boundary>/v<N>.md     # versioned, per boundary
    contracts/<boundary>/CHANGELOG.md
  06-test-plan/plan.md               # cases tagged with a participant, or `integration`
  participants/<repo>/
    tasks.md            # that repo's slice of the workplan and its TC ids
    contract-ack.md     # which contract version it targets
    status.md           # its gate roll-up, copied back from the repo
  12-integration/cycle-<n>/{conformance,journeys,deploy-order,integration-summary}.md
  issues/ bus/ history/                # spec-level and contract-level only
```

**Each participating repo** keeps `.sdlc/features/<slug>/` with:

```
spec-link.md            # shared workspace URL, path, and the commit it was read at
participants/self.md    # this repo's role, its tasks, its contract version
07-implementation/ 08-review/ 09-qa/   # its own cycles, its own gates
issues/                 # defects in THIS repo's code
```

**Issue routing, and it matters.** A defect in a repo's own code is a **local** issue. Anything about
the contract, the requirements, the design, or another participant is a **shared** issue in the spec
workspace, plus a bus message to the owning role. Filing a contract defect locally is how four repos
end up each working around the same problem.

### Contracts are versioned and published

`05-architecture/contracts/<boundary>/v<N>.md`:

```markdown
---
boundary: backend-api
version: 2
status: draft | published | deprecated
provider: backend
consumers: [admin, frontend, mobile]
supersedes: 1
breaking: true
compat_window: v1 honored until 2026-10-01
---
## Interface        (endpoints, types, error codes, events — exact shapes)
## Changes from v1
## Migration required, per consumer
```

Rules that hold without exception:

- **Consumers implement against `published` versions only, never a `draft`.** A draft is still moving.
- Publishing is what unblocks consumers. It is the provider's most schedule-critical act, and it does
  not require the provider's implementation to exist — that is the point.
- **A breaking change needs**: a version bump, `breaking: true`, a stated compatibility window, a
  per-consumer migration note, and an acknowledgement from every consumer in
  `participants/<repo>/contract-ack.md`.
- Every published change appends to the boundary's `CHANGELOG.md`. Never edit a published version in
  place — a consumer has already built against those exact words.
- A provider that needs to change a published contract mid-flight opens a bus message to every
  affected consumer with the default stated, exactly as protocol 5 requires.

### Awareness is pull, not push

No agent can notify another repository. A repo learns what changed by **reading the shared
workspace**, so make that cheap and routine:

- `spec-link.md` records the commit the repo last read. Comparing it against the shared workspace's
  current head is how drift is detected: "contract `v2` published, this repo targets `v1`".
- Any status check in a participating repo must report that drift. A repo silently building against a
  superseded contract is the failure mode this whole section exists to prevent.
- Optionally, a steward may open an issue or PR in each consumer repo when a contract publishes. That
  is an outward-facing action on someone else's repository: **confirm with a human first**, every
  time, and never make it automatic.

### Participants run their own cycles

Each repo runs implementation, review, and QA locally with its own conventions, commands, and track.
A participant's gates are its own. `participants/<repo>/status.md` in the shared workspace is a copy
of its roll-up so the program can be read from one place; the repo's own `state.json` remains
authoritative for that repo.

Participants proceed independently once their contract is published. Do not serialize a consumer
behind a provider's implementation — only behind its **contract**.

### The integration gate

After every participant passes its own gates, and never before, `sdlc-integration-qa` verifies what
no single repo can:

1. **Conformance, both directions.** Does the provider actually honor the published contract — every
   field, every error code, every event? And do consumers assume **only** what the contract promises,
   rather than an undocumented behavior they observed? The second direction is the one teams skip and
   the one that breaks on the next provider change.
2. **Cross-repo journeys.** The test plan's `integration` cases, run against all participants
   together.
3. **Version alignment.** Every `contract-ack.md` matches a published version, or a compat window
   covers the lag with a date that has not passed.
4. **Deploy order**, written to `deploy-order.md`. Expand-contract, always: the provider ships first
   and backward-compatible, consumers migrate, and the provider removes the old version **last**. Any
   order requiring simultaneous deployment is a finding — there is no cross-repo atomicity, so an
   ordering that assumes it will fail in production.

The program reaches `ready_to_ship` only when every participant is individually shippable by section
7a **and** the integration gate passes in the same round. A participant that regresses after
integration passed invalidates that pass, exactly as a code change invalidates a stale sign-off.
