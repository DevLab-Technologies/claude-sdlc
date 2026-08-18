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

**Rule 1 — Cut explanation, never obligation or inventory.** Reasoning, methodology, restatement,
hedging and process language are compressible to nothing. Two other things are not.

**The obligations**, at any budget:

- open questions and anything awaiting a human decision
- risks, and the blast radius of each
- blockers, and what they block
- deferred and out-of-scope decisions
- costs, deadlines, and dependencies on other teams or repos
- anything the reader is being asked to approve, pay for, or accept

**The inventory** — the complete list of what is being built, one line each, none dropped:

- every functional requirement, or the story that carries it
- every user story, with its acceptance criteria as plain outcomes
- every edge case and failure behavior the source names: what the user sees when it goes wrong
- every non-functional requirement a user would notice — speed, limits, permissions, offline,
  accessibility, what happens at scale
- every dependency, and everything explicitly out of scope

Nine requirements do not become "the main flows". Fourteen edge cases do not become "various error
states". Summarizing an inventory is how a brief ends up describing a different, smaller feature
than the one being built, and the reader cannot tell, because what is missing left no trace.

If the budget cannot hold the prose around all of this, cut the prose. If it still does not fit,
say so in `Omitted` and keep the obligations and the inventory. A brief that lost a blocker is worse
than no brief, because it was believed; a brief that lost four requirements is worse still, because
it will be approved.

**Rule 2 — Add nothing.** Every fact traces to the source. You may reorder, merge, and drop; you may
not infer, resolve, complete, or improve. Where the source is ambiguous, the digest is ambiguous:
name the ambiguity in one line rather than picking a reading. Where the source is silent on
something a reader will assume, say `not stated` — that is a fact about the source.

**Rule 3 — Answer first.** The first line is the answer, not the setup. Never open with background,
scope, or what the document contains. `Sign-in with email, so returning users stop re-registering.
Three stories, none started, one open decision on session length.` — then the detail.

**Rule 4 — Say what you dropped.** Every digest ends with `Omitted`: the sections summarized away,
in one line each, so a reader knows what exists that they are not seeing. It covers explanation and
detail — the rationale behind a requirement, the alternatives considered, the research it rests on.
It is not a place to record requirements, stories, criteria or edge cases you left out, because
under Rule 1 you did not leave any out.

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

**Ceilings apply to prose, not to inventory.** Requirement lines, story rows, acceptance criteria,
edge cases and dependencies are outside the word count entirely — a table of 14 one-line
requirements is scannable in seconds, and cutting it to 5 is not compression, it is loss. What the
ceilings bound is everything around them: framing, explanation, context, transitions.

So a brief for a large feature is longer than one for a small feature, and that is correct. It is
still effortless to read, because length in a table costs the reader almost nothing while length in
paragraphs costs them everything.

A digest whose prose runs over is not finished — it is unedited.

| Source | Digest | Prose ceiling, on top of the full inventory | Stated as |
|---|---|---|---|
| `prd.md` / `specification.md` | Feature brief | 400 words | count it |
| `stories/*` + `backlog.md` | Story brief | 50 words per story, criteria excluded | count it |
| `architecture.md` + `interfaces.md` + ADRs | Design brief | 350 words | count it |
| `06-test-plan/plan.md` | Test brief | 150 words | 1 min read |
| `08-review/*` + `09-qa/*` | Status brief | 250 words | 1 min read |
| `10-release/*` | Release brief | 200 words | 1 min read |
| Whole feature | One-pager | 500 words total, and it links out | 3 min read |

The one-pager is the exception that proves the split: it is genuinely a summary, so it **does**
compress the inventory — a count and the headline items rather than every line. That is only safe
because it names the brief holding the full list beside every section it compresses. It is the way
in, never the whole picture, and it never ships as the only brief.

State the reading time on line two, derived from what you actually wrote at roughly 250 words a
minute, rounded up to the half minute. The times in the table are what a fixed budget works out to;
never copy one onto a brief whose ceiling scales, because a 24-story index labelled `3 min read`
teaches the reader to distrust every other brief's number.

If the honest count exceeds the ceiling because the obligations alone fill it, keep them and say
`over budget: N open items` — never trim an obligation to fit.

## 6. Shapes

Each digest is a file with this frontmatter, then the body:

```markdown
---
digest_of: 02-product/specification.md
source_state: <`git hash-object <source path>`, or mtime and byte size if untracked>
generated_for: feature <slug>, cycle <n>
status: partial          # flipped to `complete` in your final write
---
```

Write `status: partial` from the moment you create the file and flip it to `complete` last, as
protocol 3a requires of any artifact. A partial brief is **not** an interrupted pipeline run: the
recovery path ignores `digest/` entirely, so an unfinished brief is overwritten on the next run
rather than quarantined, and it never makes `/sdlc-status` report the feature as interrupted.

`source_state` is what makes staleness detectable. A digest whose source has moved on is a lie with
a timestamp, so record what you read and check it before trusting an existing digest.

It is the hash of **that source file's own content**, never `HEAD` and never a commit sha. A
repo-wide sha changes on every unrelated commit, which would mark every brief stale and regenerate
all of them to produce identical text, and it survives a checkout that quietly changed the file
underneath. One source per digest, one hash per source; a brief built from several sources records
one line per source.

### Feature brief — from a PRD or specification

```markdown
# <Feature> — feature brief
2 min read · full specification: 02-product/specification.md

**What** one sentence, in the user's terms.
**Why now** one sentence, with the number that motivates it.
**Who it is for** the user group, and roughly how many.

## What it does
Every functional requirement, one line each, in user-visible terms. All of them — group them under
sub-headings if there are many, but never truncate the list. Carry the `FR-` id only where a reader
may need to look one up.

## What happens when things go wrong
Every edge case and failure behavior the source names, as: the situation, then what the user sees.
Two columns, one row each. This is the section people skip writing and the section that decides
whether the thing is usable, so it is never summarized into "error states are handled". Where the
source names an edge case but not the behavior, write the situation and `behavior not stated` —
that gap is the most useful thing on the page.

## What it must do well
The non-functional requirements a user would notice: speed, limits, who can see what, offline,
accessibility, behavior at scale. One line each, with the number where the source gives one.
Omit the ones that are purely internal.

## What it does not do
The non-goals, one line each. Readers relax when this list exists.

## Depends on
Other teams, other repos, external services, and anything that has to land first. One line each,
with who owns it. Absent from the source means `no dependencies stated`, which is itself worth
knowing.

## How we will know it worked
The metric, its baseline, its target, and when it is measured. If any of those is missing from
the source, write `not stated` rather than filling the gap.

## Decisions needed from you
Numbered, each answerable in one message, each with the default that applies if nobody answers.

## Risks
Every risk the source records, ordered by what it would cost, each as: what could happen, and what
it would cost. Where there are more than six, keep all of them and drop to one clause each.

## Omitted
```

Nothing in that shape is optional because the feature is small. A section with no content in the
source gets one line saying the source does not cover it — an absent section reads as "there was
nothing to say", which is a different claim entirely.

### Story brief — from the stories and the backlog

Lead with the index, because the shape of the work is the thing a human wants first:

| Story | In one line | Priority | Size | Status |
|---|---|---|---|---|
| STORY-003 | Returning users sign in with email and password | P0 | M | in progress |

Then a card for **every** story, `P0` first — not just the big ones, not just the ones in this
cycle:

- the story in one line
- **every** acceptance criterion, as a plain outcome. Strip the Given/When/Then scaffolding, which
  is a form for QA rather than for reading, but keep the substance of each one: `wrong password
  shows one error and clears the field` carries the same fact as the three-clause version at a
  third of the length. Never merge two criteria, and never replace a list of seven with "validation
  rules apply"
- anything out of scope for that story, where the source says so
- any open question on that story

50 words is the target for a card, not a cap that licenses dropping criteria. A story with eleven
criteria gets a longer card; a story with two gets a shorter one.

Never renumber, never merge two stories into one row, and never drop a story because it is small or
low priority. The count has to match the backlog, and a reader will check.

### Design brief — from the architecture

The approach in three sentences. Then **every** component as a table row — component, what it does,
who calls it — not the interesting ones. Then decisions: one line per ADR, each stating the choice
**and what it costs**, because a decision without its trade-off reads as free. Then what is risky or
reversible-at-a-price, and every contract or boundary another team has to build against. No code, no
interface signatures, no directory trees — those are what the source is for.

### Test brief — from the test plan

Coverage per story as a table: story, cases, what level, and what is not covered. Then, in words,
the parts nobody is testing and why.

Say explicitly how many cases are negative, error, boundary, concurrency, security, and
accessibility — a plan that is 90% happy path is the single most useful thing this brief can
surface, and a raw case count hides it. Name every acceptance criterion with no case against it.
A test brief exists to make gaps visible; if it reads as reassurance, it is wrong.

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
5. Do the counts match the source — requirements, stories, acceptance criteria, edge cases, issues,
   open questions? Count them, do not estimate. This is the check that catches a brief describing a
   smaller feature than the one being built.
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
