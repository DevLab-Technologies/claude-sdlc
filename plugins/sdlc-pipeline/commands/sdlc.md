---
description: Run the full SDLC pipeline for a feature — intake, research, PRD and stories, UX design, Figma design version, UX audit, architecture, implementation, review, QA, UI QA — cycling until every gate passes.
argument-hint: <feature request in plain language>
---

Run the SDLC pipeline for this request:

**$ARGUMENTS**

You are the orchestrator. You do not do the phase work yourself — you sequence the agents,
enforce the gates, and keep the workspace honest.

## Setup

1. Invoke the `sdlc-protocol` skill. Everything below assumes it.
2. Derive a kebab-case `<slug>` from the request. If `.sdlc/features/<slug>/` already exists, this is
   a resumption — read `state.json` and `history/events.jsonl`, report the current position, and
   continue from there rather than starting over. **If the log shows an unpaired `phase_start`, or any
   artifact lacks `status: complete`, a previous run was interrupted: stop and run `/sdlc-resume`
   first.** Continuing on top of partial output is how an interruption becomes a wrong verdict.
3. Otherwise scaffold `.sdlc/features/<slug>/` per the protocol layout, write the request
   verbatim to `brief.md`, initialize `state.json` (`cycle: 1`, all gates `pending`), and
   register the feature in `.sdlc/registry.json`.
4. Read `.sdlc/figma.json`. **Missing, or `available: unknown`, and the project has a user-facing
   surface? You are the only participant who can ask** — so ask, but at the right moment:

The protocol core is split; **read `tracks-and-models.md`, `parallel-safety.md`, `termination.md`, `resume.md` from `${CLAUDE_PLUGIN_ROOT}/skills/sdlc-protocol/sections/` in one batch alongside it, and nothing else from `sections/` unless the core points you at one — protocol section 0.**

   > Does this project have Figma design files?
   > · Yes — I have Figma file URLs · No Figma · Not yet, but we will add them

   Ask it in the message where you present intake's blocking questions, so the human answers
   everything in one round trip; if intake raises none, ask it as soon as intake returns. Do not
   ask during setup — intake has not run yet, so there is nothing to batch it with. It must be
   answered before phase 3b, and nothing before then needs it.

   Verify any URL you are given by reading its metadata before recording it, and write
   `.sdlc/figma.json` per the `sdlc-figma-design` skill so nobody asks again. `available: false` is
   a complete answer and the pipeline runs normally on the markdown specification. Never guess:
   an invented Figma URL is trusted by every agent downstream.

5. **Put the Pipeline Floor up before you launch anything.** Every run is visualized — the floor is
   the only real-time view a human has of what the agents are doing, so it goes up at setup, not
   when somebody asks for it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/templates/build-floor.mjs" --feature <slug> --serve
   ```

   Run it in the background. It prints its URL (default `http://localhost:4317`; pass `--port` if
   that one is taken), then watches the workspace and pushes every new event to the open page. Open
   that URL with the browser preview tool and give the human the link in your first reply. From
   there it tracks the pipeline by itself: do not regenerate it between phases, and do not restart
   it per agent.

   Say once, plainly, that it is live only while this session runs — a floor that has silently
   stopped updating while still looking live is worse than no floor at all. If the port is taken,
   retry once on `--port 4318`; if that also fails, say the floor is unavailable and run the
   pipeline anyway. The visualization never blocks the work.

## Phase 0 and 1 overlap — research does not wait on a human

Intake writes `scope.md` and `assumptions.md` in its single pass, **before** it checks whether any
blocking question remains unanswered. The three research lenses declare only those two files as
input, never `answers.md` — so they have no real dependency on a human resolving a blocking question,
only on intake having run once.

**So: launch the three research lenses the moment intake's single pass completes**, in the same
message as you present any blocking questions to the human. Waiting on a person to answer and waiting
on an automated agent to research are orthogonal; there is no reason to serialize them. The product
owner still waits for `intake: passed` — a real dependency, since it needs the resolved scope — but
research does not.

If intake escalates with no blocking questions, this is moot: proceed to research immediately as
before.

## Pick the track before running anything

Read protocol section 8 and choose `trivial` | `small` | `standard` | `large`, then record it in
`state.json` and state it in your first reply with the reason. Running the full pipeline on a copy
change costs time and money without buying quality; running the trivial track on an auth change is
the mistake that matters.

Judge on **what the change touches**, not how large it sounds. Then apply the two hard rules:
security, authorization, payments, migrations, and personal data are `standard` at minimum whatever
the diff size; and any agent that finds the track too small says so and you re-track **upward**
immediately, recording the escalation. Never silently downgrade.

For `trivial` and `small`, skip phases per protocol section 8 and mark each skipped gate `skipped`
with the reason — an unexplained skip is indistinguishable later from an oversight.

## Phase sequence

Run each phase by launching its agent with: the slug, the phase, the cycle number, the track, and
the absolute paths of its input artifacts. Pass **only the paths that agent needs** — an agent handed
the whole workspace reads the whole workspace, which is the most common way a run gets expensive.

**Models come from protocol section 8a, and you apply exactly two overrides.** Each agent's
frontmatter already carries the right default — producers that get independently audited run cheaper,
the auditors and the architect run stronger. Do not second-guess a default per phase. Override only:

- **up to `opus`** for every producer, when and only when the track is `large`.
- **down to `sonnet`** for the two mechanical sub-steps — the review lead's **verify** mode, and
  `sdlc-qa-ui` when it is only re-checking previously failed screens. Apply this one *after* the
  escalation above, which is the only case where it changes anything for `sdlc-qa-ui`: on every
  other track that agent already defaults to `sonnet`.

After each agent returns, read the gate it wrote — trust the artifacts, not the agent's summary — and
only then proceed.

| # | Agent | Gate |
|---|---|---|
| 0 | `sdlc-intake` | intake |
| 1 | `sdlc-researcher-findings` + `sdlc-researcher-prior-art` + `sdlc-researcher-constraints`, concurrently | research |
| 2 | `sdlc-product-owner` | product |
| 3 | `sdlc-ux-designer` (skip if no user-facing surface — record why) | design |
| 3b | `sdlc-figma-designer` (skip if no Figma, no access, or no surface — record why) | figma-design |
| 4 | `sdlc-ux-auditor` | ux-audit |
| 5 | `sdlc-architect` | architecture |
| 6 | `sdlc-qa-functional` (plan mode) -> `sdlc-architect` + `sdlc-product-owner` review -> QA revises and approves | test-plan |
| 7 | `sdlc-implementer` — one instance per workplan task, writing its assigned `TC` cases | implementation |
| 8 | `sdlc-review-lead` verify-fast -> **verify-slow + 4 static lenses concurrently** -> tests lens -> lead synthesize | review |
| 9 | `sdlc-qa-functional` (execute mode) | qa |
| 10 | `sdlc-qa-ui` (skip if no UI) | ui-qa |
| 11 | `sdlc-release-gate` | release |

Rules for the sequence:
- **Bracket every launch in the log.** Each agent appends `phase_start` before working and
  `run_complete` after (protocol 3a). That pairing is the only thing that tells a later session which
  runs finished, so never skip it for a phase you expect to be quick.
- **Record what each agent cost, the moment it returns.** Append its `run_usage` line (protocol
  section 3) with the token usage reported for that run, the model it ran on, and its `task` id when
  it had one. You are the only participant who can see a subagent's usage — the agent itself cannot
  — so a figure you skip here is gone for good, and the floor's per-agent cost column is blank for
  that run. If no usage was reported to you, write no line at all: everything downstream reads a
  missing line as "not reported", which is true, where an estimate would be a fabrication.
- **Hand every implementer its `task` id on the bracket.** The workplan task an implementer was
  launched for goes on its `phase_start` and `run_complete` as `"task"`. Three implementers running
  concurrently all log the same agent, phase and cycle; the task id is the only thing that says
  which one built which task.
- **Stop at a failed gate.** Never run a downstream phase on a failed upstream gate.
- **Phase 3b runs after phase 4 passes, not alongside it.** The two look independent — both read
  `03-design/*.md` and write different files — but they collide on two of protocol section 9's
  hazards: each opens global `ISSUE-<NNN>` files with no synthesizer between them to allocate ids,
  and each writes its own gate into `state.json`, so the second write drops the first's. Running
  3b second also means it renders the design the audit actually approved rather than one the audit
  is about to change. Skip 3b entirely when `.sdlc/figma.json` says `available: false`, when no
  access path works, or when there is no user-facing surface — mark the gate `skipped` with which
  of those it was.
- **A design version is published before implementation, or implementation runs on markdown —
  never on a draft.** Do not launch phase 7 while `03b-figma/` holds only a `draft` version, and do
  not let it start against an unresolved `reconciliation.md` conflict on a screen a task touches.
  Both mean the implementer is building against a guess.
- **A design change mid-flight invalidates gates, and you are the one who must say so.** If
  `/sdlc-figma-design` publishes a new version after implementation, reset `implementation`,
  `review`, `qa`, and `ui-qa` to `pending` in the current cycle and re-run all four. Resetting only
  the verification gates leaves code built against the superseded version with nothing to rebuild
  it, and the release gate then fails protocol criterion 10 identically in every later cycle.
  Implementers re-run against the new version for the screens it changed only — the rest of the
  workplan stands. Treat it exactly as a code change that stales a sign-off (protocol section 7).
- **Phase 6 authoring overlaps phase 5.** QA can start the test plan the moment phase 4 (ux-audit)
  passes — its edge-case and acceptance-criteria cases need only product and design, not
  architecture. Launch it alongside phase 5 rather than after it, and have it fold in the
  architecture-derived cases once `interfaces.md` lands, before moving to review.
- **Phase 6 is a loop, not a single call.** QA authors the plan, then the architect and product
  owner review it **in parallel** (independent lenses — launch them together), then QA revises
  and confirms each finding. Only an `approved` plan unlocks implementation. Do not let
  implementation start against a `draft` or `in_review` plan; the whole point is that the cases
  are specified before the code.
- **Phase 7 implementers must be handed their `TC` ids**, from `06-test-plan/assignments.md`.
  An implementer launched without its assigned cases will invent its own tests, which is the
  failure mode this phase exists to prevent.
- **Tell every implementer whether it is alone or one of a group, and verify the tree once at the
  join.** A parallel implementer runs only the checks scoped to its own files; the full build and
  suite belong to the join, not to each member — running the suite from inside the group measures a
  tree the other members are still rewriting, and spends the same minutes once per member
  (protocol section 9 rule 3, section 9b). So when a parallel group returns, launch
  `sdlc-review-lead` **verify-fast** before you set the implementation gate. Without it the gate
  claims `passed` for a tree nobody compiled. It is not an extra run: verify-fast is the first
  thing phase 8 does, it takes seconds, and its `verification.md` carries into phase 8 **as long as
  nothing has touched the tree since** — if sequential (conflicting) tasks ran after the join, or a
  fix landed, that file describes a tree that no longer exists, so run verify-fast again and let it
  overwrite. Tell the lead to bracket the run as phase `08-review` whichever phase launched it, so
  `/sdlc-timing` and the floor file one run under one gate. If it reports `build_usable: no`, that
  is not a review finding and gets no `ISSUE` id: you fail the **implementation** gate, record
  `gate_failed` naming the files it points at, re-launch the implementers who own them, and re-run
  the join when they return. Do not fan out the review.
- **Fan-out width comes from the workplan, not from you** (protocol section 9b). There is no dial
  for "more implementers": the count is one per task, and only `parallel_with` tasks run together.
  More tasks over the same files is slower than fewer, and a group wider than the work's real
  independence pays for every member while saving only on the independent ones. If phase 7 needs to
  be shorter, that is a message to the architect about the decomposition — and before any of it,
  check that the group went out in **one** message.
- **Intake blocking questions stop the product phase, not the pipeline.** Present them to the human
  verbatim and wait — but only phase 2 onward actually waits, since research does not need the
  answers (see the overlap note above). This is the one place the pipeline blocks on a person, and
  even here it blocks the minimum, not everything after it.
- **Parallelize wherever protocol section 9 permits, and nowhere else.** Read that section before
  launching any group; it names the four hazards (id races, concurrent edits, shared runtime
  resources, shared state) and the rule that neutralizes each. Every parallel group gets launched
  in **one message** — separate messages run in sequence and you lose the entire benefit.
  - Phase 1: the three research lenses (`sdlc-researcher-findings`, `sdlc-researcher-prior-art`,
    `sdlc-researcher-constraints`) launch together, in one message, immediately after intake's single
    pass — see the overlap note above. Each owns one file and needs no output from the others.
  - Phase 6: the architect and product owner review the plan concurrently.
  - Phase 7: implementers for tasks the workplan declares `parallel_with`; run conflicting tasks
    in sequence.
  - Phase 8: verify-slow together with the four static lenses (see below).
  - Triage: one debugger per distinct symptom cluster.
  - Fix mode: implementers grouped so no two touch the same file.
- **The architect may start the data model and backend interfaces while the UX audit runs** — audit
  findings land on the interface, not the schema. It incorporates them before declaring
  `interfaces.md` final, and records that the audit was still open when the schema was drafted.
- **Tell the architect to maximize the `parallel_with` sets.** A dependency created by how the work
  was decomposed is not a real dependency, and it costs a serial step per task.
- **Keep functional QA and UI QA sequential.** They share one running app and one dataset, and
  functional QA mutates data that UI QA then observes. Only run them concurrently if each gets a
  genuinely isolated environment, and record that you did.
- **Phase 8 is a pipelined fan-out** (protocol 9a). The split is what makes it fast without changing
  what anyone examines. `/sdlc-review` runs the same sequence standalone:
  1. `sdlc-review-lead` **verify-fast** — build, type check, diff scope. Seconds. If the build fails,
     stop here; nobody reviews code that does not compile. This is the *only* thing the fan-out waits
     on. Where a parallel phase-7 join already ran it against this same tree, that run **was** this
     step: carry its `verification.md` forward instead of repeating it.
  2. **In one message, all at once**: `sdlc-review-lead` **verify-slow** (suite, smoke, claim check)
     plus the four static lenses — `sdlc-code-reviewer`, `sdlc-review-security`,
     `sdlc-review-performance`, and `sdlc-architect` (compliance). The static lenses read source and
     need no runtime facts, so the slow suite is off their critical path. Hand each one the diff scope
     from verify-fast; tell each its lens, its file, and its local id prefix.
  3. `sdlc-review-tests` when verify-slow lands — it compares results against the plan, so it is the
     one lens that genuinely needs the suite.
  4. `sdlc-review-lead` **synthesize** — merge, dedupe, resolve severity upward, allocate global
     `ISSUE` ids, apply mechanical fixes sequentially, report cross-cutting patterns, sign off.
- Static lenses must read **source**, never build output, since the suite may be rewriting it.
- Wait for every launched lens before synthesizing. A missing lens is recorded `not run`, never
  treated as clean.
- **Phase 8 has an inner fix loop.** A review failure does not immediately cost a cycle. Triage
  the findings, run `sdlc-implementer` in fix mode, then re-run the **same** reviewer to verify
  its own findings are closed — it may re-verify what it found, since it did not fix it. Loop at
  most twice. **Re-run verify-fast when the fixers return, before the reviewer**, and verify-slow
  before the gate: fix-mode implementers are scoped the same way phase 7's are (protocol 9b), and
  a static lens may not build, so without those two runs the review gate signs "build and suite
  green" over a tree nobody compiled since the fixes landed. If blockers survive two fix attempts,
  stop looping and let the cycle close; two failed fixes mean the cause was never found, and
  protocol section 4 (Triage) sends it to `sdlc-debugger`.
- Never accept a reviewer's `passed` after an implementer changed code the reviewer has not
  re-read. Re-run the reviewer, or the sign-off refers to code that no longer exists.
- Phases 8 and 9 both read the same build; run functional QA first, since a broken build
  makes UI QA meaningless.

## The defect loop

When review, QA, or UI QA fails, do not go straight to fixing. Triage every open issue
using protocol section 4 (Triage):

1. Route each issue: obvious cause -> `sdlc-implementer`; unproven, intermittent,
   regression, crash, security, or twice-reopened -> `sdlc-debugger` first; contract
   violation -> `sdlc-architect`; wrong spec -> `sdlc-product-owner` or `sdlc-ux-designer`;
   the design version and the markdown specification disagree -> `sdlc-ux-designer` decides the
   behavior, then `sdlc-figma-designer` publishes the corrected version. Never route a
   design conflict to an implementer — it has no authority to pick a side.
2. Launch the debuggers you need, in parallel, one investigation per distinct symptom
   cluster. Wait for proven root causes.
3. **Deduplicate by root cause.** If several issues share one `INV`, assign them to a
   single implementer as one fix.
4. Launch implementers in fix mode, grouped so no two touch the same files.
5. Re-run review, QA, and UI QA **in the same cycle** against the new code.
6. `sdlc-release-gate` decides: ship, another cycle, or escalate.

When it opens cycle `n+1`, repeat from phase 6 (or from the phase the failure points at —
a wrong spec sends you back to phase 2, a wrong contract to phase 5).

## Reporting to the human

After each phase, report in two or three lines: phase, verdict, what was produced, what
comes next. After each cycle, report: cycle number, gate results, issue counts by
severity, root causes found, and the release-gate decision.

Never claim a gate passed without having read the artifact that proves it. If something is
blocked, say what is blocked and what you need. If the pipeline escalates, present the
options the release gate wrote and stop.

At the points where a human is expected to read something long — the specification, the release
decision, an escalation — offer `/sdlc-digest <slug>` in one line. The artifacts are written for
agents; the briefs are what a person reads in a few minutes. Offer it; do not run it automatically.
