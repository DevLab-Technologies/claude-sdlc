---
description: Product-only work — takes a feature request, a PRD, or a set of user stories, reviews it through four parallel lenses for uncovered scenarios and business impact, then produces an improved specification. Stops before any design or engineering.
argument-hint: <feature request | path to a PRD or stories | feature slug>
---

Do product work on: **$ARGUMENTS**

This command produces a **specification**, not software. It stops before design and engineering —
no architecture, no test plan, no code. Use it to get a request into a shape worth building, or to
harden a PRD someone already wrote.

You are the orchestrator. You sequence the agents and report; you do not write the PRD yourself.

## Step 0 — Classify the input and pick the entry point

1. Invoke the `sdlc-protocol` skill. Section 9 governs the parallel group you will launch.

2. **Work out what you were given.** Read it before deciding — the argument may be a path, a slug,
   or the request itself:

   | Input | Entry point |
   |---|---|
   | A raw feature request, one or two sentences | Start at scoping — there is nothing to review yet |
   | An existing PRD (file, or `.sdlc/features/<slug>/02-product/prd.md`) | Skip authoring; go straight to review |
   | A set of user stories with no PRD | Review as-is, and flag the missing problem statement — stories without a PRD have no shared "why" |
   | A feature slug with existing product artifacts | Review and improve them in place |
   | A ticket or issue body pasted in | Treat as a raw request, but mine it for constraints already stated |

3. **Set the output location** and say which you chose:
   - Feature workspace exists -> `.sdlc/features/<slug>/02-product/`, with lens reports under
     `02-product/review/`
   - No workspace -> create `.sdlc/features/<slug>/` with just `brief.md` and `02-product/`, so the
     work can later flow into `/sdlc` without being redone. Register it in `.sdlc/registry.json`
     with `phase: 02-product`.

## Step 1 — Scope, only if the input is raw

For a raw request, launch `sdlc-intake` first. It produces the scope, the assumptions, and the
blocking questions. **If it returns blocking questions, stop and put them to the human** — a PRD
built on unresolved blocking questions is a PRD that will be rewritten.

For an existing PRD or stories, skip this. Do not re-scope work someone already scoped; review it
instead and let the critics find what the scoping missed.

Optionally launch `sdlc-researcher` alongside intake when the request touches an unfamiliar domain,
a competitive space, or a regulated area. Skip it for a small change to an understood surface.

## Step 2 — Author or load the specification

Launch `sdlc-product-owner`:
- **Raw request** -> write the PRD, the stories with Given/When/Then criteria, and the backlog.
- **Existing artifacts** -> do not rewrite them yet. Read them, normalize them into the standard
  shape so the critics review a consistent artifact, and note what is structurally absent
  (no non-goals, no success metrics, no priorities). Preserve the author's intent and wording;
  reshaping is not improving, and silently rewriting someone's spec destroys their reasoning.

## Step 3 — Four lenses, in one message

Launch all four **in a single message** so they run concurrently.

| Agent | Lens | Report file | Id prefix |
|---|---|---|---|
| `sdlc-product-critic` | uncovered scenarios, falsifiable criteria, story quality | `product-critique.md` | `PROD-` |
| `sdlc-business-analyst` | problem evidence, value, metrics, cost, alternatives | `business-case.md` | `BIZ-` |
| `sdlc-ux-auditor` | whether this is usable as specified, and the flows it implies | `ux-review.md` | `UX-` |
| `sdlc-architect` | feasibility and rough cost signal — **no design work** | `feasibility.md` | `ARCH-` |

Tell each: the artifacts under review, its report file, its id prefix, and that it must not edit the
PRD or stories or allocate global issue ids.

Two scoping notes worth passing on explicitly:
- The **UX auditor** is reviewing a specification, not a design. Its job here is to say whether the
  described experience can work and what interaction problems the requirements already imply — not
  to design screens.
- The **architect** gives a feasibility and cost signal only: what is hard, what is expensive, what
  conflicts with existing architecture, and where a requirement would be far cheaper if stated
  slightly differently. That last one is the highest-value thing it can find at this stage. It must
  not produce architecture; that is phase 5.

## Step 4 — Revise

Launch `sdlc-product-owner` again with all four reports. It is the author, so revision is its lane:

- Address every `blocker` and `major`, or record why not — a rejected finding needs a reason, not
  silence.
- Add the missing scenarios as requirements or explicit non-goals. **Deciding something is out of
  scope counts as covering it**; leaving it undecided does not.
- Rewrite every unfalsifiable acceptance criterion into an observable one.
- Fix the metrics: baseline, target, measurement mechanism, counter-metric.
- Split any story the critic found too large or not independently valuable.
- Where the business analyst found the case unsupported, do **not** paper over it. Record it
  prominently and surface it to the human — proceeding to build something whose value nobody can
  evidence is the expensive outcome this command exists to prevent.

Write a `## Revision log` recording what changed, what was rejected and why, and what remains open.

## Step 5 — Report

Give the human:

- Input type, entry point taken, and where the artifacts are
- The business analyst's verdict line, verbatim
- The count of uncovered scenarios found, and the five that matter most
- What changed in the specification
- **Open questions only a human can answer**, quoted and numbered so they can be answered in one
  message
- Findings deliberately not addressed, and why
- Whether this is ready for `/sdlc` to pick up at the design phase, or needs another product pass

Do not claim the specification is complete. Say what it now covers and what remains open — a PRD
presented as finished when its central assumption is unevidenced is worse than one that names the
gap.

## Boundaries

This command does not design, architect, plan tests, or write code. If the specification is sound
and you want to build it, hand off to `/sdlc` with the slug — it resumes from the existing product
artifacts rather than starting over.
