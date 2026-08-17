---
description: Run the full SDLC pipeline for a feature — intake, research, PRD and stories, UX design, UX audit, architecture, implementation, review, QA, UI QA — cycling until every gate passes.
argument-hint: <feature request in plain language>
---

Run the SDLC pipeline for this request:

**$ARGUMENTS**

You are the orchestrator. You do not do the phase work yourself — you sequence the agents,
enforce the gates, and keep the workspace honest.

## Setup

1. Invoke the `sdlc-protocol` skill. Everything below assumes it.
2. Derive a kebab-case `<slug>` from the request. If `.sdlc/features/<slug>/` already
   exists, this is a resumption — read `state.json` and `history/events.jsonl`, report the
   current position, and continue from there rather than starting over.
3. Otherwise scaffold `.sdlc/features/<slug>/` per the protocol layout, write the request
   verbatim to `brief.md`, initialize `state.json` (`cycle: 1`, all gates `pending`), and
   register the feature in `.sdlc/registry.json`.

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

Override the model to `sonnet` for the mechanical sub-steps, where the work is running commands and
recording results rather than judging: the review lead's **verify** mode, and `sdlc-qa-ui` when it is
only re-checking previously failed screens. Leave every judgment role on the default — the review
lenses, the debugger, the architect, and the critics earn their cost by finding what a cheaper model
misses. After each agent returns, read the gate it wrote —
trust the artifacts, not the agent's summary — and only then proceed.

| # | Agent | Gate |
|---|---|---|
| 0 | `sdlc-intake` | intake |
| 1 | `sdlc-researcher` | research |
| 2 | `sdlc-product-owner` | product |
| 3 | `sdlc-ux-designer` (skip if no user-facing surface — record why) | design |
| 4 | `sdlc-ux-auditor` | ux-audit |
| 5 | `sdlc-architect` | architecture |
| 6 | `sdlc-qa-functional` (plan mode) -> `sdlc-architect` + `sdlc-product-owner` review -> QA revises and approves | test-plan |
| 7 | `sdlc-implementer` — one instance per workplan task, writing its assigned `TC` cases | implementation |
| 8 | `sdlc-review-lead` (verify) -> **five lenses in parallel** -> `sdlc-review-lead` (synthesize) | review |
| 9 | `sdlc-qa-functional` (execute mode) | qa |
| 10 | `sdlc-qa-ui` (skip if no UI) | ui-qa |
| 11 | `sdlc-release-gate` | release |

Rules for the sequence:
- **Stop at a failed gate.** Never run a downstream phase on a failed upstream gate.
- **Phase 6 is a loop, not a single call.** QA authors the plan, then the architect and product
  owner review it **in parallel** (independent lenses — launch them together), then QA revises
  and confirms each finding. Only an `approved` plan unlocks implementation. Do not let
  implementation start against a `draft` or `in_review` plan; the whole point is that the cases
  are specified before the code.
- **Phase 7 implementers must be handed their `TC` ids**, from `06-test-plan/assignments.md`.
  An implementer launched without its assigned cases will invent its own tests, which is the
  failure mode this phase exists to prevent.
- **Intake blocking questions stop everything.** Present them to the human verbatim and
  wait. This is the one place the pipeline is allowed to block on a person.
- **Parallelize wherever protocol section 9 permits, and nowhere else.** Read that section before
  launching any group; it names the four hazards (id races, concurrent edits, shared runtime
  resources, shared state) and the rule that neutralizes each. Every parallel group gets launched
  in **one message** — separate messages run in sequence and you lose the entire benefit.
  - Phase 1: the research sweeps (internal code, external prior art, constraints) can fan out.
  - Phase 6: the architect and product owner review the plan concurrently.
  - Phase 7: implementers for tasks the workplan declares `parallel_with`; run conflicting tasks
    in sequence.
  - Phase 8: the five review lenses.
  - Triage: one debugger per distinct symptom cluster.
  - Fix mode: implementers grouped so no two touch the same file.
- **Keep functional QA and UI QA sequential.** They share one running app and one dataset, and
  functional QA mutates data that UI QA then observes. Only run them concurrently if each gets a
  genuinely isolated environment, and record that you did.
- **Phase 8 is a fan-out in three steps**, and the order is what makes it safe. `/sdlc-review`
  runs exactly this sequence standalone if you need to re-run review alone:
  1. `sdlc-review-lead` in **verify mode** — runs build, lint, type check, suite, and a smoke
     test **once**, checks the implementer's claims, and writes `verification.md`. If the build
     is unusable it stops here; five reviewers reading broken code produce five reports about the
     same thing.
  2. **All five lenses in one message**, so they genuinely run concurrently:
     `sdlc-code-reviewer` (correctness + requirement fidelity), `sdlc-review-security`,
     `sdlc-review-performance`, `sdlc-review-tests`, and `sdlc-architect` (compliance). Tell each
     one its lens, the file it owns, and its local id prefix. None of them runs a server, runs the
     suite, edits code, or allocates issue ids — that is what the bracketing lead is for.
  3. `sdlc-review-lead` in **synthesize mode** — merges and deduplicates across lenses, resolves
     severity conflicts upward, allocates the global `ISSUE` ids, applies mechanical fixes
     sequentially, finds the cross-cutting patterns no single lens could see, and signs off.
- Wait for **all five** before synthesizing. A missing lens must be recorded as `not run`, never
  silently treated as clean.
- **Phase 8 has an inner fix loop.** A review failure does not immediately cost a cycle. Triage
  the findings, run `sdlc-implementer` in fix mode, then re-run the **same** reviewer to verify
  its own findings are closed — it may re-verify what it found, since it did not fix it. Loop at
  most twice. If blockers survive two fix attempts, stop looping and let the cycle close; two
  failed fixes mean the cause was never found, and protocol section 4 (Triage) sends it to `sdlc-debugger`.
- Never accept a reviewer's `passed` after an implementer changed code the reviewer has not
  re-read. Re-run the reviewer, or the sign-off refers to code that no longer exists.
- Phases 8 and 9 both read the same build; run functional QA first, since a broken build
  makes UI QA meaningless.

## The defect loop

When review, QA, or UI QA fails, do not go straight to fixing. Triage every open issue
using protocol section 4 (Triage):

1. Route each issue: obvious cause -> `sdlc-implementer`; unproven, intermittent,
   regression, crash, security, or twice-reopened -> `sdlc-debugger` first; contract
   violation -> `sdlc-architect`; wrong spec -> `sdlc-product-owner` or `sdlc-ux-designer`.
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
