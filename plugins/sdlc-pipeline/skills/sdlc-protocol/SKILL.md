---
name: sdlc-protocol
description: The shared filesystem contract every SDLC agent must follow — where artifacts live, how agents communicate, how state and history are recorded, and how the review/QA cycle terminates. Read this before doing any SDLC phase work.
---

# SDLC Protocol

Agents in this pipeline never talk to each other directly. They communicate **only**
through the feature workspace on disk. Every agent reads its predecessors' artifacts,
writes its own, appends to the history log, and updates state. This makes the pipeline
resumable, auditable, and safe to run across separate sessions.

## 1. Feature workspace layout

Every feature gets one directory: `.sdlc/features/<slug>/`

```
.sdlc/features/<slug>/
  state.json              # single source of truth for pipeline position
  brief.md                # the original request, verbatim
  00-intake/
    questions.md          # open questions for the human
    answers.md            # human's answers (may be partial)
    assumptions.md        # decisions taken when answers were unavailable
  01-research/
    findings.md
    prior-art.md
    constraints.md
  02-product/
    prd.md
    stories/STORY-001.md  # one file per story
    backlog.md            # ordered story list with priorities
    specification.md      # the consolidated, shareable final document
    changes.md            # every revision: quoted before -> after, and the finding that drove it
    recommendations.md    # what still needs improving, and what is needed to resolve each
    review/               # parallel product-review lenses, one file each
      product-critique.md   # uncovered scenarios, falsifiable criteria, story quality
      business-case.md      # problem evidence, value, metrics, cost, alternatives
      ux-review.md          # is this usable as specified
      feasibility.md        # architect's cost signal — not a design
  03-design/
    ux-spec.md
    flows.md
    screens/<screen>.md   # per-screen spec + ASCII/mermaid wireframe
    design-tokens.md
  04-ux-audit/
    audit.md              # findings against 03-design + a11y review
  05-architecture/
    architecture.md
    interfaces.md         # API/type contracts implementers must honor
    workplan.md           # ordered, parallelizable implementation tasks
    test-strategy.md      # levels, fixtures, what is worth testing
  06-test-plan/
    plan.md               # the binding test contract — every case, before code exists
    review.md             # adversarial edge-case review of the plan
    assignments.md        # which case each implementer owns, at which level
  07-implementation/
    TASK-001.md           # per-task record: files touched, decisions, deviations
    handoff.md            # what QA and review need to know
  08-review/
    cycle-<n>/verification.md    # build, suite, smoke — run ONCE by the lead, before fan-out
    cycle-<n>/correctness.md     # one file per parallel lens, local finding ids
    cycle-<n>/security.md
    cycle-<n>/performance.md
    cycle-<n>/tests.md
    cycle-<n>/compliance.md      # architect
    cycle-<n>/review-summary.md  # lead: merged findings, global ids, verdict, sign-off
  09-qa/
    cycle-<n>/functional-qa.md   # execution of the approved plan
    cycle-<n>/ui-qa.md
    cycle-<n>/exploratory.md     # cases discovered while executing
  10-release/
    traceability.md
    cycle-<n>-decision.md
    release-notes.md
  11-investigations/
    INV-001.md            # root-cause investigation per non-obvious defect
  issues/
    ISSUE-001.md          # one file per finding, any source
  bus/
    0001-architect-to-po.md    # directed questions between agents
  history/
    events.jsonl          # append-only event log
    runs/<ts>-<agent>.md  # full verbatim outcome of every agent run
```

Paths are relative to the repo root. Never write outside your own phase directory,
`issues/`, `bus/`, `history/`, and `state.json` — except the architect, who also owns
`docs/adr/`.

## 2. state.json

```json
{
  "slug": "user-auth",
  "title": "Email + password authentication",
  "created": "2026-08-10",
  "phase": "09-qa",
  "cycle": 2,
  "max_cycles": 5,
  "status": "in_progress",
  "gates": {
    "intake": "passed", "research": "passed", "product": "passed",
    "design": "passed", "ux-audit": "passed", "architecture": "passed",
    "test-plan": "passed", "implementation": "passed", "review": "failed",
    "qa": "pending", "ui-qa": "pending", "release": "pending"
  },
  "open_questions": 0,
  "issues": { "blocker": 1, "major": 2, "minor": 4, "nit": 3 },
  "adrs": ["ADR-0001", "ADR-0002"],
  "blocked_on": null
}
```

Gate values: `pending` | `passed` | `failed` | `skipped`.
Status values: `in_progress` | `awaiting_human` | `blocked` | `ready_to_ship` | `shipped`.

Read state.json before you start. Update it as your **last** action, in one write.
Never reset another phase's gate; only the orchestrator may do that when opening a
new cycle.

## 3. History — append-only, never rewritten

Append exactly one JSON line to `history/events.jsonl` per meaningful event:

```json
{"ts":"2026-08-10T14:22:05Z","cycle":2,"agent":"sdlc-code-reviewer","event":"run_complete","phase":"08-review","verdict":"failed","summary":"3 findings: 1 blocker (unbounded query), 2 major","artifacts":["08-review/cycle-2/code-review.md"],"issues_opened":["ISSUE-011","ISSUE-012","ISSUE-013"],"next":"sdlc-implementer"}
```

Event types: `phase_start`, `run_complete`, `question_asked`, `question_answered`,
`issue_opened`, `issue_triaged`, `investigation_started`, `investigation_complete`,
`root_cause_found`, `issue_fixed`, `issue_verified`, `issue_reopened`, `adr_recorded`,
`test_plan_approved`, `test_plan_amended`, `gate_passed`, `gate_failed`, `cycle_opened`, `cycle_closed`, `escalated`, `shipped`.

Also write the **full** narrative outcome of your run to
`history/runs/<ISO-timestamp>-<your-agent-name>.md` with this header:

```markdown
---
agent: sdlc-code-reviewer
phase: 08-review
cycle: 2
verdict: failed
inputs: [05-architecture/interfaces.md, 07-implementation/handoff.md]
outputs: [08-review/cycle-2/code-review.md]
---
```

The run record is the audit trail: what you read, what you concluded, what you were
uncertain about, and what you deliberately did not do. Be specific — a later agent or
a human reading only this file must be able to reconstruct your reasoning.

## 4. Issues

One file per finding, `issues/ISSUE-<NNN>.md`, monotonic numbering across the whole
feature (never reuse a number, even after a fix):

```markdown
---
id: ISSUE-011
title: Session lookup runs an unbounded query per request
severity: blocker        # blocker | major | minor | nit
source: sdlc-code-reviewer
phase_found: 08-review
cycle_found: 2
story: STORY-003
location: src/auth/session.ts:41
status: open             # open | investigating | fixing | fixed | verified | wontfix | deferred
cycle_fixed: null
root_cause: null         # INV-<NNN> once an investigation proves the cause
related_issues: []       # other issues sharing this root cause
reopened_count: 0
---

## What is wrong
## Why it matters
## How to reproduce / where to look
## Suggested direction (non-binding)
## Verification steps  <- QA uses this verbatim to confirm the fix
```

Rules:
- Only the agent that **opened** an issue, or a QA agent, may move it to `verified`.
- Implementers move `open` -> `fixed` and must name the commit/files in the issue body.
- `wontfix` and `deferred` require a one-line rationale and a human sign-off note.
- Every reopen increments `reopened_count`. At `reopened_count >= 2` the issue **must** go
  to `sdlc-debugger` before anyone attempts another fix — two failed fixes mean the cause
  was never found.

## 4a. Defect triage — routing a finding to the right response

Not every finding needs an investigation, and not every finding may skip one. When an issue
is opened, route it:

| Condition | Route |
|---|---|
| Cause is visible in the finding itself (`path:line` + obvious mechanism) | straight to `sdlc-implementer` |
| Symptom known, cause not proven | `sdlc-debugger` **first** |
| Intermittent, flaky, or timing-dependent | `sdlc-debugger`, always — never a direct fix |
| Regression (worked before, broken now) | `sdlc-debugger`, bisect against last known-good |
| Crash, data corruption, or security finding | `sdlc-debugger`, and severity is at least `major` |
| Reopened twice | `sdlc-debugger`, mandatory |
| Contract or boundary violation | `sdlc-architect` decides before any fix |
| Spec is wrong, not the code | `sdlc-product-owner` or `sdlc-ux-designer`, not a code fix |

A fix that lands without a proven cause is itself a defect. When an implementer cannot
state the mechanism, they must stop and bus the debugger rather than guess.

Every fix for a `blocker` or `major` defect must ship with a **regression test that fails
before the fix and passes after**. QA verifies the test exists and actually exercises the
cause. No regression test, no `verified`.

## 4b. Root cause vs symptom

Three distinct things, recorded separately in every investigation:
- **Proximate cause** — the code that misbehaves
- **Root cause** — the design, contract, or assumption that allowed it to exist
- **Detection gap** — the missing test, type, validation, or alert that let it get this far

Closing only the proximate cause is how the same defect returns in a later cycle under a
different symptom. When the root cause is architectural, the architect amends the contract
and the ADR record; when the detection gap is systemic, the architect amends
`test-strategy.md` so the whole class of defect is covered.

Related issues sharing one root cause are fixed **once** and cross-linked via
`related_issues`. Three symptoms and one cause is one fix, not three.

## 4c. The test plan is a contract, written before the code

Tests are specified **before** implementation, by QA, independently of the implementer. This
is deliberate: an implementer who derives their own test cases tests what they built, not what
was asked for, and the gaps only surface after the code is finished — as rework.

The order is: QA authors the plan -> the plan is reviewed adversarially for missing edge
cases -> approved cases are assigned to implementers as work -> implementers write those tests
alongside the code -> QA executes the approved plan and verifies each case is genuinely
covered.

### The plan

`06-test-plan/plan.md` opens with a status header and holds every case:

```markdown
---
status: draft          # draft | in_review | approved | amended
cycle_approved: 1
cases: 47
---
```

One row per case in an index table, plus a detail block for any case whose steps do not fit
on one line:

| id | story | ac | level | type | owner | expected | test_file | status |
|---|---|---|---|---|---|---|---|---|
| TC-014 | STORY-003 | AC-2 | unit | negative | backend | single non-enumerating error, password field cleared | — | planned |

- **level**: `unit` | `integration` | `e2e` | `manual` — manual only when automation is
  genuinely impractical, and the reason is stated
- **type**: `happy` | `boundary` | `negative` | `error` | `concurrency` | `security` |
  `performance` | `a11y` | `regression`
- **owner**: the implementer role that will write it (`backend`, `frontend`, `mobile`), or
  `qa` for cases QA automates itself
- **test_file**: empty until an implementer fills in `path::test name`
- **status**: `planned` -> `implemented` -> `passing` | `failing` | `not_run`

Every acceptance criterion must have at least one case at the lowest level that can prove it,
plus an `e2e` case for each P0 story's happy path. A case must be specific enough that two
different engineers would write the same assertion from it.

### Edge cases the plan must consider explicitly

Walk this list per story and either write a case or record why it does not apply. Silence is
not a decision:

boundaries (zero, one, maximum, one past maximum, empty, whitespace, very long) · absent and
null inputs · malformed and wrong-type inputs · duplicate submission and double-click ·
concurrent access to the same record · out-of-order and repeated events · interrupted flow
(navigate away, refresh, kill mid-request) · expired or revoked session · insufficient
permission · network failure, timeout, and partial response · dependency unavailable ·
idempotency of retries · pagination limits and empty pages · time and timezone, DST, clock
skew · unicode, emoji, and right-to-left text in every free-text field · numeric precision
and rounding on money · sort stability and tie-breaking · cache staleness after write ·
migration and rollback of any schema change

### The review

`06-test-plan/review.md`. Two independent lenses, both required before the plan is approved:

- **`sdlc-architect`** — technical gaps: the failure modes in `architecture.md` that have no
  case, the concurrency and boundary conditions the interfaces make possible, and whether each
  case is at the right level. A case written at `e2e` that belongs in `unit` is a finding.
- **`sdlc-product-owner`** — coverage gaps: any acceptance criterion with no case, any case
  that contradicts the intended behavior, and whether the expected results match the PRD
  rather than a guess.

Reviewers do not rewrite the plan; they record findings, QA revises, and the reviewer confirms.
Findings at `blocker` or `major` become issues like any other. When both lenses sign off, QA
sets `status: approved` and the plan is frozen for the cycle.

### Assignment and implementation

The architect folds the approved cases into `05-architecture/workplan.md` so tests are
scheduled work, not an afterthought — each task's definition of done names the `TC` ids it
must deliver. `06-test-plan/assignments.md` records the mapping.

Implementers write their assigned cases as real tests, reference the `TC` id in each test's
name or a comment so traceability survives, and fill in `test_file` on the plan row. An
implementer who believes a case is wrong buses QA — they do not silently drop it or weaken its
assertion.

Writing the test first, watching it fail, then implementing is encouraged and never required.
What is required is that the assigned cases exist and assert what the plan says.

### Amending an approved plan

Plans are amended, never quietly edited. QA appends new cases (including anything found
during execution, recorded in `09-qa/cycle-<n>/exploratory.md`) with `status: planned` and a
one-line reason, bumps the header to `amended`, and appends a `test_plan_amended` event. Cases
are never deleted — a case that turns out to be invalid is marked `withdrawn` with a rationale
so the history shows the reasoning.

## 5. The bus — directed agent-to-agent questions

When you need something only another role can decide, do not guess and do not stall.
Write `bus/<NNNN>-<from>-to-<to>.md`:

```markdown
---
seq: 0007
from: sdlc-architect
to: sdlc-product-owner
status: open        # open | answered
blocking: true
---
## Question
Does STORY-004 require offline write support, or is read-only offline acceptable?
## Why I need it
It decides whether we need a sync/conflict layer (large) or a cache (small).
## My default if unanswered
Read-only offline. I will record it as an assumption and an ADR consequence.
```

Always state a default so the pipeline never deadlocks. The addressed agent appends an
`## Answer` section and flips `status: answered`. Questions that only a **human** can
answer go to `00-intake/questions.md` instead, and set state `awaiting_human` only if
truly blocking.

## 6. ADRs

Architectural decisions live in `docs/adr/NNNN-kebab-title.md` (repo-wide, not per
feature) using `docs/adr/0000-template.md`. The architect owns them. Any agent that
makes a decision with lasting structural consequence must either request an ADR via the
bus or, if trivial and local, record it in its own run record. Reference ADRs by id in
state.json and in the affected story/task files.

## 7. Cycle and termination

A **cycle** is one pass of implement -> review -> QA -> UI QA. Findings become issues.
The orchestrator opens cycle `n+1` when any gate in `review`, `qa`, or `ui-qa` failed.

The feature reaches `ready_to_ship` when **all** hold:
1. Zero `open` or `fixing` issues at severity `blocker` or `major`.
2. `review`, `qa`, and `ui-qa` gates all `passed` **in the same cycle**.
3. Every story in `02-product/backlog.md` maps to at least one verified QA result.
4. Every `blocking: true` bus message is `answered`.
5. Minor/nit issues are either fixed or explicitly `deferred` with rationale.
6. Every `blocker`/`major` defect that was fixed has a named regression test, and every one
   that required investigation has a linked `INV-<NNN>` with a proven root cause.
7. No issue is sitting in `investigating` or `fixing`.

If `cycle > max_cycles`, do not start another cycle. Set `status: blocked`, append an
`escalated` event, and write `history/ESCALATION.md` explaining what keeps failing and
the two or three options the human must choose between.

## 8. Rules for every agent

- Read `.sdlc/project-conventions.md` before you do anything stack-specific. It holds this
  project's language, framework, layering, and the **exact** build, lint, type check, test,
  and dev-server commands. Use those commands verbatim rather than guessing at them; a
  guessed command produces a false failure, which is worse than no result. If the file is
  missing, say so and tell the human to run `/sdlc-init`.
- Read `state.json` and your input artifacts first. Never invent an input you could read.
- Stay in your lane, and know where the lane's edge is. See section 8a on fix authority. An
  implementer does not redefine scope; a designer does not change requirements; only the
  release gate declares ship-readiness.
- Write files, not just prose in your reply. Your reply is a summary; the files are the work.
- Be concrete and falsifiable. "Improve error handling" is not a finding; a file, a line,
  a trigger, and a consequence is.
- Record uncertainty explicitly rather than smoothing over it.
- Idempotence: if your output already exists for this cycle, revise it in place rather
  than duplicating.
- Never mention tooling or AI assistance in any artifact, commit, or document.

## 8a. Fix authority — who may change code, and why the line sits there

The line is not about difficulty. It is about whether an independent judge survives the change.
An agent that fixes a logic defect becomes that logic's author, and there is no longer anyone
positioned to say whether it is right.

| Finding | Who may fix it |
|---|---|
| `nit`, and mechanical `minor` with one obvious correct form | the reviewer who found it, inline |
| Anything touching logic, control flow, or data | `sdlc-implementer` only |
| `blocker` or `major`, any category | `sdlc-implementer` only, no exceptions |
| Security, concurrency, contract deviation | `sdlc-implementer`, after the architect rules on contract questions |
| A weak or missing test | the implementer who owed the `TC` — never the reviewer, or nobody independent judges it |
| Cause unproven | nobody, until `sdlc-debugger` proves it |

Mechanical means: typos, comments, formatting, import order, dead code, unused variables,
misleading names, magic values wanting a constant, duplication with one obvious extraction.

Any agent fixing inline must list every change in a `## Fixed inline` section with the file and
why it was mechanical, then re-run the build and suite. If your fix breaks anything, revert it
and open an issue — an inline fix must never be the reason a gate fails.

## 8b. Sign-off — scoped, evidenced, and never self-certified

Every verification agent ends its run with a sign-off block naming its verdict, exactly what it
ran, what it verified, and **what it could not verify and why**. The last line is the one that
makes a sign-off honest; a sign-off with no stated limits is a claim of omniscience.

A sign-off is scoped to that agent's own gate and nothing further:
- `sdlc-code-reviewer` signs off that the code is correct and is what was specified.
- `sdlc-qa-functional` signs off that the approved plan executed and the cases genuinely pass.
- `sdlc-qa-ui` signs off that the interface matches the spec across its states.
- **Only `sdlc-release-gate` signs off that the feature is ready to ship**, and only by auditing
  the other sign-offs plus the traceability matrix — all from the same cycle against the same
  code.

No agent may declare or imply ship-readiness outside its scope, and no agent signs off on work
it changed itself beyond mechanical fixes.

## 9. Parallel execution

Agents run concurrently wherever the work is genuinely independent. Concurrency is not free
though: several agents sharing one filesystem, one port range, and one database will corrupt each
other's work in ways that are hard to see afterward. These rules are what make it safe.

### The four hazards, and the rule for each

**1. Id allocation races.** Two agents that both read "the highest issue is ISSUE-010" both write
`ISSUE-011`, and one silently overwrites the other.

> Agents in a parallel group **never allocate global ids**. They emit findings with local,
> prefixed ids — `CORR-1`, `SEC-3`, `PERF-2`, `TEST-5`, `ARCH-1` — in their own report. A single
> synthesizing agent afterward assigns `ISSUE-<NNN>` numbers and records the local-to-global map.

**2. Concurrent edits to one tree.** Two agents applying fixes to the same file, or to files that
import each other, produce a state neither intended and a build that fails for no attributable
reason.

> Only **one** agent applies edits per phase. In review that is the lead; in implementation it is
> each implementer within its declared file boundary. Parallel reviewers propose fixes and never
> apply them.

**3. Shared runtime resources.** Four agents each starting the dev server fight over the port;
each seeding fixtures destroys the others' expected data; four suite runs is three wasted.

> Verification runs **once**, before the fan-out, and its output is written to a file the parallel
> agents read. No agent in a parallel group starts a server, seeds data, or runs the suite. An
> agent needing a measurement nobody took records that in `## Not covered` rather than taking it.

**4. Concurrent writes to shared state.** `state.json` written by two agents at once loses one of
them entirely.

> Only the phase's owning agent touches `state.json` and gates. Parallel members write their own
> report and nothing else. `history/events.jsonl` accepts concurrent single-line appends — one
> line, one write, never a rewrite of the file.

### File ownership under fan-out

Every parallel agent writes exactly one file, named for its lens, and reads freely. If two agents
could write the same path, the design is wrong — split the path, do not coordinate at runtime.
There is no locking here, and adding some would be worse than the constraint.

### What is safely parallel

| Phase | Parallel work | Why it is safe |
|---|---|---|
| 1 research | internal-code, external prior-art, and constraints sweeps | read-only, separate output files |
| 2 product review | product critique, business case, UX review, feasibility | read-only, one report each |
| 6 test plan review | architect and product owner | independent lenses, separate sections |
| 7 implementation | tasks the workplan declares `parallel_with` | file-level disjoint by construction |
| 8 review | correctness, security, performance, tests, compliance | read-only, one report each, verification pre-run |
| defect triage | one investigation per distinct symptom cluster | separate `INV` files, read-only analysis |
| fix mode | implementers grouped so no two touch one file | boundaries declared before launch |

### What must stay sequential, and why

- **Anything mutating shared state**: gates, `state.json`, id allocation, applying fixes.
- **Functional QA and UI QA** share one running application and one dataset. Functional QA seeds
  and mutates data that UI QA then observes, so running them concurrently makes both unreliable.
  Run them in sequence unless each has a genuinely isolated environment — and if you isolate them,
  say so in the run record so the results are interpretable.
- **A reviewer re-verifying after a fix.** The fix must land first; a review of code that has
  since changed is worthless.
- **The release gate**, always last and alone. It audits everyone else's output.

### Reviews outside a feature workspace

`/sdlc-review` can run on a bare diff, branch, or PR with no feature behind it. Those outputs go to
`.sdlc/reviews/<date>-<target>/` using the same file-per-lens layout, and there is no gate to set —
the merged verdict is the deliverable.

Standalone reviews are **weaker by construction** and must say so: with no stories there are no
acceptance criteria for requirement fidelity to check, and with no approved test plan the test lens
can only judge tests against the code's apparent intent. Both must state that in `## Not covered`.
A standalone review implying it verified requirements is a false signal, which is worse than an
absent one.

### Launching a parallel group

Launch the whole group in **one** message so they actually run concurrently rather than in
sequence. Give each member: the slug, the phase, the cycle, its lens, the exact file it owns, and
the local id prefix it must use. Then wait for all of them before synthesizing — a synthesis
missing a lens is worse than a late one, because the gap is invisible in the result.

If a member fails or returns nothing, the synthesizer records that lens as **not run**. An
unexamined angle is not a clean angle, and a sign-off must never imply otherwise.
