# SDLC Pipeline

This repository runs an automated software development lifecycle: a feature request enters,
specialized agents carry it through discovery, specification, design, architecture,
implementation, and verification, and it leaves as reviewed, tested, traceable work.

## Entry points

| Command | Use for |
|---|---|
| `/sdlc <request>` | A new feature, from scratch through release gate |
| `/sdlc-bug <report>` | A defect — root-cause path with the verification gates intact |
| `/sdlc-status [slug]` | Where everything stands and what runs next |
| `/sdlc-init` | Re-run after the project's stack or commands change |

Re-running `/sdlc` on an existing feature resumes it rather than restarting it.

`.sdlc/project-conventions.md` holds this project's stack, layering, and the exact build,
lint, type check, test, and dev-server commands. Every agent reads it. Keep it accurate —
a stale test command makes QA report failures that are not real.

## How it works

Agents never talk to each other. They communicate through `.sdlc/features/<slug>/`, and the
contract for that is the `sdlc-protocol` skill — read it before doing any
phase work, and treat it as binding.

- `.sdlc/project-conventions.md` carries the stack and the exact verification commands.
- `state.json` is the single source of truth for pipeline position and gate status.
- `history/events.jsonl` is append-only and never rewritten; `history/runs/` holds the full
  outcome of every agent run.
- Findings from any source become `issues/ISSUE-NNN.md` with a severity and executable
  verification steps.
- Defects whose cause is not obvious go to `sdlc-debugger` before anyone writes a fix, and
  produce `11-investigations/INV-NNN.md` with a **proven** root cause.
- Decisions that are expensive to reverse become ADRs in `docs/adr/`.

## The cycle

Implementation, then review, then functional QA, then UI QA, then the release gate. Failures
become issues, issues get triaged to the right role, root causes get proven, fixes get
verified in the same cycle, and the loop repeats until every gate passes together — or until
`max_cycles`, at which point it escalates to a human with options instead of spinning.

## Non-negotiables

- A gate passes only when the artifact proving it exists. Never mark a gate from an agent's
  summary alone.
- Stay in your lane: reviewers do not fix, implementers do not rescope, the debugger does not
  implement, and only the release gate declares readiness.
- Fix root causes, never symptoms. Issues sharing a cause are one fix.
- Every blocker or major fix ships with a regression test that fails before it and passes
  after.
- Report faithfully. If tests fail, show the output. If a step was skipped, say so. Never
  claim verification you did not perform.
- Never mention tooling or AI assistance in any artifact, commit, comment, or document.
- Use icons, not emoji, in documents and UI.
