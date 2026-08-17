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
```

Paths are relative to the repo root. Write only inside your own phase directory plus `issues/`,
`bus/`, `history/`, and `state.json` — except the architect, who also owns `docs/adr/`.

Standalone runs with no feature behind them go to `.sdlc/reviews/<date>-<target>/` or
`.sdlc/product/<date>-<slug>/`, same file-per-lens layout, no gate to set.

## 2. state.json — the single source of truth

```json
{
  "slug": "user-auth", "title": "…", "created": "2026-08-10",
  "phase": "09-qa", "cycle": 2, "max_cycles": 5,
  "track": "standard",
  "status": "in_progress",
  "gates": { "intake": "passed", "research": "skipped", "product": "passed",
    "design": "passed", "ux-audit": "passed", "architecture": "passed",
    "test-plan": "passed", "implementation": "passed", "review": "failed",
    "qa": "pending", "ui-qa": "pending", "release": "pending" },
  "issues": { "blocker": 1, "major": 2, "minor": 4, "nit": 3 },
  "open_questions": 0, "adrs": ["ADR-0001"], "blocked_on": null
}
```

Gates: `pending` | `passed` | `failed` | `skipped`. A `skipped` gate needs a recorded reason.
Status: `in_progress` | `awaiting_human` | `blocked` | `ready_to_ship` | `shipped`.
Track: `trivial` | `small` | `standard` | `large` — see section 8.

Read it before you start; update it as your **last** action, in one write. Never reset another
phase's gate; only the orchestrator does that when opening a cycle.

## 3. History — append-only, never rewritten

One JSON line per meaningful event in `history/events.jsonl`:

```json
{"ts":"2026-08-10T14:22:05Z","cycle":2,"agent":"sdlc-review-lead","event":"gate_failed","phase":"08-review","verdict":"failed","summary":"1 blocker (unbounded query), 2 major","artifacts":["08-review/cycle-2/review-summary.md"],"issues_opened":["ISSUE-011"],"next":"sdlc-implementer"}
```

Events: `phase_start`, `run_complete`, `question_asked`, `question_answered`, `issue_opened`,
`issue_triaged`, `investigation_started`, `investigation_complete`, `root_cause_found`,
`issue_fixed`, `issue_verified`, `issue_reopened`, `adr_recorded`, `test_plan_approved`,
`test_plan_amended`, `gate_passed`, `gate_failed`, `cycle_opened`, `cycle_closed`, `escalated`,
`shipped`.

Also write `history/runs/<ISO-ts>-<agent>.md` with frontmatter (`agent`, `phase`, `cycle`,
`verdict`, `inputs`, `outputs`) and the narrative: what you concluded, what you were uncertain
about, what you deliberately did not do. A human reading only that file must be able to
reconstruct your reasoning.

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
ran: <commands and real results>
verified: <what you established>
NOT verified: <what you could not check, and why — be specific>
```

`NOT verified` is what makes a sign-off honest; one with no stated limits claims omniscience. A
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
before declaring `interfaces.md` final. Declare the overlap in the run record so a reader knows the
audit was still open when the schema was drafted.

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
- Never mention tooling or AI assistance in any artifact, commit, or document.
