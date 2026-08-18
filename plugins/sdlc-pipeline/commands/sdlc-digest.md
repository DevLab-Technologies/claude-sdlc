---
description: Turn the long pipeline artifacts — PRD, specification, stories, architecture, test plan, review and QA, release record — into short briefs a human can read in minutes, without losing any open question, risk, or blocker.
argument-hint: [feature slug | path to a document] [brief type: feature | stories | design | tests | status | release | all]
---

Produce human-readable briefs for: **$ARGUMENTS**

The pipeline writes for agents — complete, numbered, traceable, long. This command writes for a
person who has ten minutes. It derives briefs from artifacts that already exist. It writes nothing
else and changes nothing else.

## Step 0 — Load the rules

Invoke the `sdlc-digest` skill and follow it exactly. It carries the compression rules, the
plain-language mechanics, the banned vocabulary and constructions that make writing read as
generated, the word budgets, and the shape of each brief. Invoke `sdlc-protocol` too if you need the
workspace layout.

## Step 1 — Work out what you were given

| Input | What to do |
|---|---|
| A feature slug | Digest that feature's workspace |
| Blank, one feature in `.sdlc/registry.json` | Digest it |
| Blank, several features | List them and ask which — do not digest all of them |
| A path to a document | Digest that one file, whatever it is |
| A slug plus a brief type | Digest only that type |
| A path outside `.sdlc/` | Fine. Any long document can be digested; pick the closest shape in the skill |

For a feature, pick the brief types from what exists and is `status: complete`:

| Brief | Sources | Skip when |
|---|---|---|
| `feature-brief.md` | `02-product/specification.md`, else `prd.md` | Neither exists |
| `stories-brief.md` | `02-product/stories/*`, `02-product/backlog.md` | No stories |
| `design-brief.md` | `05-architecture/architecture.md`, `interfaces.md`, `docs/adr/*` referenced in `state.json` | No architecture yet |
| `test-brief.md` | `06-test-plan/plan.md` | No plan, or track declared none |
| `status-brief.md` | `08-review/cycle-<n>/review-summary.md`, `09-qa/cycle-<n>/*`, `issues/*` | No cycle has run |
| `release-brief.md` | `10-release/cycle-<n>-decision.md`, `traceability.md` | No release decision |
| `one-pager.md` | All of the above | Only one brief was produced |

Produce `one-pager.md` whenever two or more briefs exist — it is what most people will actually read.

**In a participating repo, the sources are not all local.** If `spec-link.md` is present, the
product, design, and architecture artifacts live in the shared workspace, and only
`07-implementation/`, `08-review/`, `09-qa/`, `issues/` and `participants/self.md` are here. Resolve
`spec-link.md` and read the shared workspace at the commit it records, so the feature, story, and
design briefs come from there while the status brief comes from this repo. Cannot reach it? Say so
in one line and produce the local briefs — do not silently skip the three that answer *what are we
building*, which is why someone ran this.

For a cross-repo program (`participants.json` or `spec-link.md` present), add `program-brief.md`:
who is building what, which contract version each repo targets, where the drift is, and what the
deploy order will be. Drift is the point — name any repo building against a superseded contract in
the first three lines, not in a table at the bottom.

## Step 2 — Read the sources, and check them

Read the full sources, not other digests. Never digest a digest.

Two checks before you write, and both are reportable findings, not blockers:

- **Incomplete artifacts.** Anything without `status: complete` is untrusted per protocol 3a. Digest
  it if it is all there is, and mark it `draft — this work was interrupted` at the top of the brief.
- **Existing digests.** If `digest/` already holds a brief, compare its `source_state` against the
  source now. Unchanged means you can leave it; changed means regenerate it in place. Say which you
  did for each.

## Step 3 — Write the briefs

To `.sdlc/features/<slug>/digest/`, one file per brief, with the frontmatter the skill specifies.
For a bare file path inside this repository, write `<name>-brief.md` beside the source. For a source
outside it, print the brief in your reply and ask where it should go — do not write into someone
else's tree uninvited.

`digest/` is a derived directory. It never affects gates, state, issues, or history — do not update
`state.json`, do not append events, and do not touch the sources. Deleting the whole directory must
cost nothing but regeneration.

The four rules from the skill are the ones to hold under pressure, so hold them literally:

1. Cut explanation, never obligation or inventory. Open questions, risks, blockers, deferrals,
   costs and deadlines survive at every budget — and so does the full list of what is being built:
   every requirement, every story with its acceptance criteria, every edge case and failure
   behavior, every dependency. Ceilings bound the prose around that list, never the list. Nine
   requirements do not become "the main flows".
2. Add nothing. No inference, no resolved ambiguity, no filled gap. `not stated` where the source
   is silent.
3. Answer first. No preamble, ever.
4. End with `Omitted`.

Then the part most drafts fail, which is the voice. It has to read as though a colleague wrote it
after reading the source, not as though it was generated from it. Section 4 of the skill lists the
vocabulary and the sentence shapes that give that away — read your draft back against that list and
rewrite whatever trips it. A brief that sounds like a brochure gets skimmed, and the facts inside it
get discounted along with the voice.

## Step 4 — Report

Print the **one-pager in full in your reply**, or the single brief if only one was produced. The
point of this command is that the human does not have to open a file, so opening a file must not be
the first thing you ask of them.

Then, briefly:

- the paths written, one line each
- **decisions needed** — every open question and blocking bus message, numbered, quoted, each with
  the default that applies if nobody answers, so they can all be answered in one message
- **what the sources are missing** — a specification with no metric, a story with no criteria, a
  cycle with no QA record. Name them. Do not let a smooth brief stand in for a hollow document
- anything you marked draft because its source was interrupted

## Boundaries

**It writes briefs and nothing else.** Two destinations, both from step 3: `digest/` for a feature,
or `<name>-brief.md` beside the source for a document inside this repository. Every other file it
touches it only reads — no source, no state, no gate, no issue, no event.

This command does not review, revise, approve, or advance anything, and it never states or implies
ship-readiness — a brief reports a verdict that already exists, and reaches none of its own. If a
source document is wrong, the fix belongs with the agent that owns it, not here.
