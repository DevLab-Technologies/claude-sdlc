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
    test-strategy.md
  06-implementation/
    TASK-001.md           # per-task record: files touched, decisions, deviations
    handoff.md            # what QA and review need to know
  07-review/
    cycle-<n>/code-review.md
    cycle-<n>/security-review.md
  08-qa/
    cycle-<n>/test-plan.md
    cycle-<n>/functional-qa.md
    cycle-<n>/ui-qa.md
  09-release/
    traceability.md
    cycle-<n>-decision.md
    release-notes.md
  10-investigations/
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
  "phase": "08-qa",
  "cycle": 2,
  "max_cycles": 5,
  "status": "in_progress",
  "gates": {
    "intake": "passed", "research": "passed", "product": "passed",
    "design": "passed", "ux-audit": "passed", "architecture": "passed",
    "implementation": "passed", "review": "failed", "qa": "pending",
    "ui-qa": "pending", "release": "pending"
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
{"ts":"2026-08-10T14:22:05Z","cycle":2,"agent":"sdlc-code-reviewer","event":"run_complete","phase":"07-review","verdict":"failed","summary":"3 findings: 1 blocker (unbounded query), 2 major","artifacts":["07-review/cycle-2/code-review.md"],"issues_opened":["ISSUE-011","ISSUE-012","ISSUE-013"],"next":"sdlc-implementer"}
```

Event types: `phase_start`, `run_complete`, `question_asked`, `question_answered`,
`issue_opened`, `issue_triaged`, `investigation_started`, `investigation_complete`,
`root_cause_found`, `issue_fixed`, `issue_verified`, `issue_reopened`, `adr_recorded`,
`gate_passed`, `gate_failed`, `cycle_opened`, `cycle_closed`, `escalated`, `shipped`.

Also write the **full** narrative outcome of your run to
`history/runs/<ISO-timestamp>-<your-agent-name>.md` with this header:

```markdown
---
agent: sdlc-code-reviewer
phase: 07-review
cycle: 2
verdict: failed
inputs: [05-architecture/interfaces.md, 06-implementation/handoff.md]
outputs: [07-review/cycle-2/code-review.md]
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
phase_found: 07-review
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
- Stay in your lane. A reviewer does not fix code. An implementer does not redefine scope.
- Write files, not just prose in your reply. Your reply is a summary; the files are the work.
- Be concrete and falsifiable. "Improve error handling" is not a finding; a file, a line,
  a trigger, and a consequence is.
- Record uncertainty explicitly rather than smoothing over it.
- Idempotence: if your output already exists for this cycle, revise it in place rather
  than duplicating.
- Never mention tooling or AI assistance in any artifact, commit, or document.
