# SDLC Pipeline

This repository runs an automated software development lifecycle: a feature request enters,
specialized agents carry it through discovery, specification, design, architecture,
implementation, and verification, and it leaves as reviewed, tested, traceable work.

## Entry points

| Command | Use for |
|---|---|
| `/sdlc <request>` | A new feature, from scratch through release gate |
| `/sdlc-bug <report>` | A defect — root-cause path with the verification gates intact |
| `/sdlc-product <request or PRD>` | Specification work alone — review and improve a request, PRD, or stories |
| `/sdlc-figma-design <slug>` | Turn the requirements into a versioned Figma design, or import an existing file, and export it for implementers and QA |
| `/sdlc-review [target]` | The full parallel review alone — a feature, branch, PR, path, or working diff |
| `/sdlc-digest [slug]` | The long artifacts as short briefs — for reading, sharing, and deciding |
| `/sdlc-status [slug]` | Where everything stands and what runs next |
| `/sdlc-visualize [slug]` | Real-data replay of a feature's history in the Pipeline Floor view |
| `/sdlc-timing [slug]` | Duration breakdown — feature, cycle, agent, and individual run |
| `/sdlc-resume [slug]` | After an interrupted run — diagnose, quarantine partials, continue |
| `/sdlc-init` | Re-run after the project's stack or commands change |
| `/sdlc-program <request>` | A feature spanning several repos — one spec, versioned contracts |
| `/sdlc-join <spec> [slug]` | This repo's slice of a program, against the published contract |
| `/sdlc-integrate [slug]` | The integration gate, once every participant has passed its own |

Re-running `/sdlc` on an existing feature resumes it rather than restarting it.

`.sdlc/figma.json` records whether this project has Figma design files, their URLs, and which
access path reaches them. `available: false` is a real answer — the pipeline runs on the markdown
design specification with no loss except visual precision. It is asked once and then trusted.

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
- Where there is a Figma design, `sdlc-figma-designer` is the only agent that touches Figma. It
  publishes a versioned design into `03b-figma/v<N>/` — extracted per-screen specs, reference
  renders, tokens, and a Figma-to-code component mapping — and everyone else reads those files.
  Implementers and QA check for a published version and use it; with none, they use
  `03-design/*.md`.

## The cycle

Implementation, then review, then functional QA, then UI QA, then the release gate. Failures
become issues, issues get triaged to the right role, root causes get proven, fixes get
verified in the same cycle, and the loop repeats until every gate passes together — or until
`max_cycles`, at which point it escalates to a human with options instead of spinning.

## Non-negotiables

- A gate passes only when the artifact proving it exists. Never mark a gate from an agent's
  summary alone.
- Stay in your lane: implementers do not rescope, the debugger does not implement, and only the
  release gate declares ship-readiness.
- Fix authority is bounded. A reviewer may fix mechanical issues inline — typos, dead code,
  misleading names, obvious duplication — and must list them. Anything touching logic, control
  flow, data, security, concurrency, contracts, or test assertions goes back to the implementer,
  because an agent that fixes a logic defect becomes its author and no independent judge remains.
- Every verification agent signs off with what it ran, what it verified, and **what it could not
  verify and why**. A sign-off is scoped to that agent's own gate.
- Two design artifacts, one authority split: visual properties follow the published Figma design
  version when one exists; which states exist, validation, copy strings, focus order, and
  accessibility semantics follow `03-design/*.md`, always, because that is what the UX audit ran
  against. Where they disagree, follow the markdown, open a `major` issue naming both, and send it
  to the designer — never split the difference.
- A newly published design version stales every later sign-off, exactly as a code change does.
- Fix root causes, never symptoms. Issues sharing a cause are one fix.
- Every blocker or major fix ships with a regression test that fails before it and passes
  after.
- Report faithfully. If tests fail, show the output. If a step was skipped, say so. Never
  claim verification you did not perform.
- Never mention tooling or AI assistance in any artifact, commit, comment, or document.
- Use icons, not emoji, in documents and UI.
