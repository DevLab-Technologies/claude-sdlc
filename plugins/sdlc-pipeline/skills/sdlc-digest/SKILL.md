---
name: sdlc-digest
description: How to compress a long SDLC artifact — PRD, specification, user stories, architecture, test plan, review or QA report, release record — into a short brief a human can read in minutes, in a voice that reads as written rather than generated, without losing anything they are accountable for. Read this before writing any digest.
---

# SDLC Digest

Pipeline artifacts are written for agents: exhaustive, numbered, traceable, and long. That is
correct — a reviewer three cycles later needs every clause. It is also why nobody reads them.

A digest is a **derived, human-facing view** of an artifact that already exists. It is not a
rewrite, not an approval, and never the source of truth. The full artifact stays exactly as it is.

## 1. What a digest is for

One reader, one question: *what do I need to know, and what do I need to decide?*

A digest succeeds when someone who has read none of the workspace can, in the stated reading time,
say what is being built, for whom, what is settled, what is not, and what is being asked of them.
It fails the moment they have to open the source file to answer one of those.

## 2. The four compression rules

**Rule 1 — Cut explanation, never obligation.** Reasoning, methodology, restatement, hedging and
process language are compressible to nothing. These are not, at any budget:

- open questions and anything awaiting a human decision
- risks, and the blast radius of each
- blockers, and what they block
- deferred and out-of-scope decisions
- costs, deadlines, and dependencies on other teams or repos
- anything the reader is being asked to approve, pay for, or accept

If the budget cannot hold all of them, the digest says so in `Omitted` and keeps the obligations.
A brief that lost a blocker is worse than no brief, because it was believed.

**Rule 2 — Add nothing.** Every fact traces to the source. You may reorder, merge, and drop; you may
not infer, resolve, complete, or improve. Where the source is ambiguous, the digest is ambiguous:
name the ambiguity in one line rather than picking a reading. Where the source is silent on
something a reader will assume, say `not stated` — that is a fact about the source.

**Rule 3 — Answer first.** The first line is the answer, not the setup. Never open with background,
scope, or what the document contains. `Sign-in with email, so returning users stop re-registering.
Three stories, none started, one open decision on session length.` — then the detail.

**Rule 4 — Say what you dropped.** Every digest ends with `Omitted`: the sections summarized away,
in one line each, so a reader knows what exists that they are not seeing.

## 3. Plain-language mechanics

Effortless reading is mechanical. Apply all of these:

| Do | Instead of |
|---|---|
| One idea per sentence, under 25 words | Clause chains joined by semicolons |
| Active voice, present tense | "It was determined that…" |
| The concrete number, name, and date | "significant", "several", "soon" |
| Expand an acronym on first use, once | `SSO`, `PPR`, `TC-014` unexplained |
| The user's words | Internal or vendor vocabulary |
| One level of nesting, maximum | Three-deep bullet trees |
| Tables for anything with more than three parallel items | Prose lists of five things |
| A short sentence over a fragment | Telegraphic notes that need decoding |

Never carry over template scaffolding, section headers with nothing under them, `N/A` rows,
frontmatter, ids the reader does not need, or the phrase "as mentioned above". Keep an id only where
the reader may need to look something up — a story, an issue, an ADR, a contract version.

No emoji. Use plain text labels or icons, consistent with the rest of the project's documents.

## 4. Write like the person who did the work

A brief that reads as machine-written gets discounted on sight, and the reader stops trusting the
content along with the voice. The tells are consistent and avoidable.

**Vocabulary that gives it away.** Never use: delve, leverage (as a verb), robust, seamless,
comprehensive, holistic, streamline, utilize, facilitate, harness, unlock, elevate, empower,
underscore, pivotal, crucial, vital, myriad, plethora, landscape, realm, journey, ecosystem,
game-changer, best-in-class, cutting-edge, state-of-the-art, "at its core", "in today's world",
"it is worth noting", "it is important to note", "that said", "moreover", "furthermore",
"additionally" as a sentence opener. Say the plain word: use, strong, complete, whole, simplify.

**Constructions that give it away.** All of these are banned:

- The three-part list where two items would do, and the third exists for rhythm.
- "It is not just X, it is Y." Also "X is not merely Y — it is Z."
- "This means that…" and "In other words…" — if the first sentence needed a translation, write
  the translation and delete the first sentence.
- Every bullet opening with a bolded phrase, colon, then a matching-length sentence.
- Bullets that are all the same length. Real notes are uneven.
- A closing paragraph that restates the brief. Stop at the last fact.
- Rhetorical questions used as headings.
- Hedging stacked on hedging: "may potentially", "could possibly help to".
- Enthusiasm nobody expressed. The source says the login flow changes; it does not say this is
  exciting.

**What to do instead.** Take the wording from the source and from the people in it. If the PRD says
"returning users", do not upgrade it to "re-engaging cohorts". Vary sentence length — a nine-word
sentence after a twenty-word one is what human writing looks like. Let a fragment stand where a
fragment is what you would say out loud. State a number instead of characterizing it: "3 of 11
stories" beats "a small number of stories". Where something is annoying, ugly, or late, say so in
those words rather than in institutional ones. A brief reporting "the migration path is unpleasant
and nobody owns it" is more useful, and more obviously written by someone who read the thing.

**Do not write about the document.** No "this brief summarizes", no "the specification outlines", no
"the following sections cover". Report the content, not your handling of it. The one exception is
`Omitted`, which is about the document by design.

None of this licenses invention. Voice is the one thing you may choose; the facts are not yours to
touch, and a lively brief that added a fact is still a broken brief.

## 5. Budgets

Hard ceilings. A digest that runs over is not finished — it is unedited.

| Source | Digest | Ceiling | Stated as |
|---|---|---|---|
| `prd.md` / `specification.md` | Feature brief | 400 words | 2 min read |
| `stories/*` + `backlog.md` | Story brief | index table + 50 words per story | 3 min read |
| `architecture.md` + `interfaces.md` + ADRs | Design brief | 350 words | 2 min read |
| `06-test-plan/plan.md` | Test brief | coverage table + 150 words | 1 min read |
| `08-review/*` + `09-qa/*` | Status brief | 250 words | 1 min read |
| `10-release/*` | Release brief | 200 words | 1 min read |
| Whole feature | One-pager | 500 words, all of the above compressed further | 3 min read |

State the reading time on line two. If the honest count exceeds the ceiling because the obligations
alone fill it, keep them and say `over budget: N open items` — never trim an obligation to fit.

## 6. Shapes

Each digest is a file with this frontmatter, then the body:

```markdown
---
digest_of: 02-product/specification.md
source_state: <git sha, or file mtime if uncommitted>
generated_for: feature <slug>, cycle <n>
status: complete
---
```

`source_state` is what makes staleness detectable. A digest whose source has moved on is a lie with
a timestamp, so record what you read and check it before trusting an existing digest.

### Feature brief — from a PRD or specification

```markdown
# <Feature> — feature brief
2 min read · full specification: 02-product/specification.md

**What** one sentence, in the user's terms.
**Why now** one sentence, with the number that motivates it.
**Who it is for** the user group, and roughly how many.

## What it does
Up to five bullets, one line each, user-visible behavior only.

## What it does not do
The non-goals, one line each. Readers relax when this list exists.

## How we will know it worked
The metric, its baseline, its target, and when it is measured. If any of those is missing from
the source, write `not stated` rather than filling the gap.

## Decisions needed from you
Numbered, each answerable in one message, each with the default that applies if nobody answers.

## Risks
Top three only, each as: what could happen, and what it would cost.

## Omitted
```

### Story brief — from the stories and the backlog

Lead with the index, because the shape of the work is the thing a human wants first:

| Story | In one line | Priority | Size | Status |
|---|---|---|---|---|
| STORY-003 | Returning users sign in with email and password | P0 | M | in progress |

Then a card per story, `P0` first, at most 50 words each: the one-line story, the acceptance
criteria as plain outcomes (not Given/When/Then — that form is for QA, not for reading), and any
open question on that story. Stories at `P2` get the index row only, unless one carries an open
decision.

Never renumber, never merge two stories into one row, and never drop a story because it is small.
The count has to match the backlog, and a reader will check.

### Design brief — from the architecture

The approach in three sentences. Then the pieces as a table — component, what it does, who calls it.
Then decisions: one line per ADR, each stating the choice **and what it costs**, because a decision
without its trade-off reads as free. Then what is risky or reversible-at-a-price. No code, no
interface signatures, no directory trees — those are what the source is for.

### Test brief — from the test plan

Coverage per story as a table: story, cases, what level, and what is not covered. Then, in words,
the parts nobody is testing and why. A test brief exists to make the gaps visible; if the digest
reads as reassurance, it is wrong.

### Status brief — from review and QA

Ship-relevant only. Open blockers and majors, one line each with what they break. Then what passed
this cycle, what was not verified and why, and the single next action. No lens-by-lens tour.

### Release brief — from the release record

The decision in the first line: shipping, another cycle, or escalated. Then why, then everything
being deferred, each with its consequence. Deferred work a reader cannot see is hidden work.

## 7. Verify before you hand it over

Read your own digest cold and answer these. Any `no` means it is not done:

1. Does the first line answer the reader's question, without setup?
2. Can a reader who has seen nothing else act on this?
3. Does every fact appear in the source? Point at where, for the three most load-bearing.
4. Did every open question, risk, blocker, deferral and deadline survive?
5. Do the counts match — stories, issues, open questions?
6. Is it inside budget, or honestly marked over?
7. Is `Omitted` complete enough that nobody is surprised later by what it hides?
8. Would the artifact's author agree this says what they said?
9. Read it aloud. Does any sentence sound like a brochure, a press release, or a chatbot? Does any
   bullet exist only to make a set of three? Rewrite those and read it again.

## 8. Boundaries

- **A digest changes nothing.** No gate, no state, no issue, no source artifact. Digesting is a
  read-only act on everything except the digest file itself.
- **A digest never approves.** It may report a verdict that already exists; it may not reach one,
  soften one, or imply readiness. Only `sdlc-release-gate` declares ship-readiness.
- **A digest is not an input to an agent.** Downstream agents read the full artifacts. Compression
  loses precision, and a pipeline that starts consuming its own summaries drifts.
- **Where the source is bad, say so plainly.** A specification with no success metric produces a
  brief that says the success metric is missing. Do not write a well-formed brief over a hollow
  document — the digest's smoothness will be read as the document's quality.
