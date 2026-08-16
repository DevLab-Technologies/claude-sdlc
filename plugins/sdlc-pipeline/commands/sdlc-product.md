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

## Step 4b — Produce the three deliverables

The revision is not finished until these exist. A review whose output the human has to reconstruct
by diffing files has not delivered anything.

**1. `02-product/changes.md` — what actually changed.** One row per change, and the before/after
must be **quoted text**, not a description of a change:

```markdown
| # | What | Before | After | Driven by | Severity |
|---|---|---|---|---|---|
| 1 | AC-2 of STORY-003 made falsifiable | "the system handles invalid credentials gracefully" | "Given invalid credentials, when submitted, then a single non-enumerating error appears within 1s and the password field clears" | PROD-4 | blocker |
| 2 | Success metric given a baseline | "improve activation" | "activation (first project created within 24h) from 31% today to 40% by Q4" | BIZ-2 | blocker |
| 3 | Churned-user scenario added | *(absent)* | FR-09: users returning after 90+ days see a one-time summary of what changed | PROD-1 | major |
```

End it with three counts: changes applied, findings rejected (with reasons), and items deferred to
the human.

**2. `02-product/recommendations.md` — what should still be improved.** Everything not applied,
because it needs a human decision, more evidence, or a product call above your authority. Each with:
what to improve, why it matters, the impact if ignored, the effort, and **what specifically is
needed to resolve it**. Order by impact, not by the order the lenses reported them. This file is the
answer to "what should be improved" and must never be empty without saying explicitly that nothing
remains.

**3. `02-product/specification.md` — the final document.** One consolidated, shareable
specification: problem, goals and non-goals, users, requirements, the full story set with criteria,
success metrics, risks, open questions, and out-of-scope decisions. Self-contained — someone who has
read none of the review files should be able to act on it. This is the deliverable; `prd.md` and
`stories/` remain the working artifacts behind it.

## Step 5 — Report

Show the human the outcome, not a description of the outcome:

1. **The three deliverables, by path**, with `specification.md` named as the final document.
2. **The change table inline** — render `changes.md` in your reply, or the top 10 rows with a count
   of the rest if it is long. They should not have to open a file to see what you changed.
3. **The business analyst's verdict line, verbatim.**
4. **What should still be improved** — the top items from `recommendations.md`, each in one line with
   its impact.
5. **Open questions only a human can answer**, quoted and numbered so they can be answered in a
   single message.
6. **Findings rejected**, with the reason for each.
7. **What is ready** — whether `/sdlc <slug>` can pick this up at the design phase, or whether it
   needs another product pass or a human answer first.

Then offer, in one line, to print the full `specification.md` in the conversation — some people want
it in front of them rather than in a file.

Do not claim the specification is complete. Say what it now covers and what remains open — a PRD
presented as finished when its central assumption is unevidenced is worse than one that names the
gap.

## Boundaries

This command does not design, architect, plan tests, or write code. If the specification is sound
and you want to build it, hand off to `/sdlc` with the slug — it resumes from the existing product
artifacts rather than starting over.
