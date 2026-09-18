---
name: sdlc-protocol
description: The shared filesystem contract every SDLC agent must follow — where artifacts live, how agents communicate, how state and history are recorded, and the rules for issues, fix authority, sign-off, and parallel safety. Read this before doing any SDLC phase work.
---

# SDLC Protocol

Agents never talk to each other directly. They communicate **only** through the feature workspace on
disk: read your inputs, write your outputs, append to history, update state. That is what makes the
pipeline resumable and auditable across sessions.

This file is the shared core — sections 1 to 7, 10 and 11. **Every agent loads it, on every turn of
its run, so it stays short on purpose.** Role-specific detail lives in the agent that owns it: your
own agent definition carries the checklists and formats for your job.

## 0. Sections held outside the core

The remaining numbered sections live in their own files under
`${CLAUDE_PLUGIN_ROOT}/skills/sdlc-protocol/sections/`. They keep their original numbers, so a
reference to "section 9" means the same thing it always did.

| § | File | Load it if |
|---|---|---|
| 2a | `design-authority.md` | you read or write design artifacts, or build a user-facing surface |
| 3a | `resume.md` | you are recovering an interrupted run (`/sdlc-resume`, or the orchestrator reconciling state) |
| 4a | `test-plan.md` | you author, review, amend, or implement test cases |
| 7a | `termination.md` | you decide whether the feature is done (`sdlc-release-gate`, the orchestrator) |
| 8 | `tracks-and-models.md` | you pick the track or the model for a phase — orchestrator only |
| 9, 9a, 9b | `parallel-safety.md` | you launch a parallel group, or you are a member of one |
| 12 | `multi-repo.md` | the work spans more than one repository |

**Read the ones your agent definition names, in a single batch, before you start work** — not one at
a time as you hit them. Do not go browsing the rest: loading all of them costs more than the
undivided file did.

That list is a default, not a wall. **If the core points you at a section you were not granted, or
you find you genuinely need one to do your job, read it and note in your run record which section and
why** — a protocol you had to guess at is worse than a slightly more expensive read. Those notes are
how a missing grant gets found and fixed.

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
floor/          pipeline-floor.html
```

Paths are relative to the repo root. Write only inside your own phase directory plus `issues/`,
`bus/`, `history/`, and `state.json` — except the architect, who also owns `docs/adr/`,
`/sdlc-digest`, which owns `digest/`, and `/sdlc-visualize`, which owns `floor/` — neither writes
anywhere else in the workspace.

`digest/` and `floor/` are derived, human-facing, and owned by nobody but their generating command.
Neither affects a gate, neither is read as input by any agent, and deleting either costs nothing but
regeneration. **Both are outside 3a**: output left `partial` by a killed session is regenerated on
the next run of its command, never quarantined, and never reported as an interrupted run — so every
scan for unpaired runs or partial artifacts skips both directories. The rules for generating them
live in `/sdlc-digest` and `/sdlc-visualize`.

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
Track: `trivial` | `small` | `standard` | `large` — see section 8, `sections/tracks-and-models.md`.
`design_version`: the published Figma design version number, or `null` when there is none — see
section 2a (`sections/design-authority.md`) and the `sdlc-figma-design` skill.

Read it before you start; update it as your **last** action, in one write. Never reset another
phase's gate; only the orchestrator does that when opening a cycle.

## 3. History — append-only, never rewritten

One JSON line per meaningful event in `history/events.jsonl`:

```json
{"ts":"2026-08-10T14:20:41Z","cycle":2,"agent":"sdlc-review-security","event":"phase_start","phase":"08-review"}
{"ts":"2026-08-10T14:22:05Z","cycle":2,"agent":"sdlc-review-security","event":"run_complete","phase":"08-review","duration_ms":84000,"summary":"1 blocker (SEC-2), 0 major","artifacts":["08-review/cycle-2/security.md"]}
{"ts":"2026-08-10T14:22:11Z","cycle":2,"agent":"sdlc-review-lead","event":"gate_failed","phase":"08-review","verdict":"failed","summary":"1 blocker (unbounded query), 2 major","artifacts":["08-review/cycle-2/review-summary.md"],"issues_opened":["ISSUE-011"],"next":"sdlc-implementer"}
```

Events: `phase_start`, `run_complete`, `run_usage`, `question_asked`, `question_answered`, `issue_opened`,
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

**Name the work on the bracket.** When you were launched for a specific unit of work with an id —
an implementer given `TASK-003`, a debugger given `INV-002` — put it on both your `phase_start` and
your `run_complete` as `"task"`. It costs one field and it is the only thing that ties a run to the
work it did; without it a log with three concurrent implementers cannot say which one built what.

**Token cost is the orchestrator's to record, not yours.** An agent cannot observe its own usage, so
never write a token figure on your own `run_complete` — a number you cannot measure is a number you
guessed. The orchestrator sees each agent's usage the moment it returns, and appends one extra line
for that run:

```json
{"ts":"2026-08-10T14:22:07Z","cycle":2,"agent":"sdlc-review-security","event":"run_usage","phase":"08-review","tokens":128400,"model":"sonnet"}
```

`tokens` is the run's total token usage as reported to the orchestrator; `model` is what it ran on;
`task` names the unit of work when there is one. If the usage is not reported to the orchestrator,
**write no `run_usage` line at all** — a missing line reads as "not reported" everywhere downstream,
and an invented one reads as fact.

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
3. **If you own the phase, update `state.json` as your very last action**, in one write. A gate
   therefore never claims `passed` for work that did not finish. **If you are one of several agents
   running concurrently in a phase, you do not own it: write your own artifacts and touch neither
   `state.json` nor any gate.** Exactly one agent per phase writes state — the synthesizer where the
   group has one, otherwise the orchestrator. Concurrent writers silently overwrite each other, and
   the surviving write decides the gate.

Those three rules are all any agent needs. The procedure for **recovering** an interrupted run — what
each signal means, what to quarantine, what to re-run — is `sections/resume.md`, and belongs to
`/sdlc-resume` and the orchestrator. Do not attempt recovery from inside a phase agent.

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

## 5. The bus — directed questions

`bus/<NNNN>-<from>-to-<to>.md` with frontmatter (`seq`, `from`, `to`, `status: open|answered`,
`blocking`), then `## Question`, `## Why I need it`, `## My default if unanswered`. **Always state
a default** so the pipeline never deadlocks. The addressee appends `## Answer` and flips status.
Questions only a human can answer go to `00-intake/questions.md`.

`blocking: true` means you stopped; `blocking: false` means you went on under your default. Say
which — the Pipeline Floor shows a blocking question as a stopped desk waiting on its addressee,
and a desk that stopped without saying so is drawn as one still working. Append `question_asked`
when you write the file and `question_answered` when it is answered, both carrying the `seq`, so
the floor can time the wait from the ask rather than from the file's mtime.

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
