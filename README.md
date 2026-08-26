# SDLC Pipeline for Claude Code

A software development lifecycle built out of specialized agents. A feature request enters;
agents carry it through scoping, specification, design, architecture, a test plan written before
the code, implementation, review, and QA; it leaves as reviewed, tested, traceable work — or it
escalates to a human with options instead of pretending to be done.

It is a Claude Code plugin. The interesting part is not that it has many agents — it is the rules
that keep them honest with each other.

## Why it is built this way

Most multi-agent setups fail the same way: an agent does work, declares it good, and nobody
independent ever checks. This pipeline is mostly a set of constraints against that.

- **Nobody signs off on their own work.** Fix authority is bounded — a reviewer may fix a typo,
  never a logic defect, because an agent that fixes a defect becomes its author and no
  independent judge remains. Only the release gate declares ship-readiness, and it audits
  everyone else's sign-off rather than trusting it.
- **Every sign-off must state what it did *not* verify.** A sign-off with no stated limits is a
  claim of omniscience. The release gate reads that line hardest.
- **Tests are specified before the code, by someone who is not the implementer.** An implementer
  who writes their own cases tests what they built rather than what was asked. QA authors the plan
  from the acceptance criteria with no implementation to look at; the architect and product owner
  review it for missing failure modes and uncovered criteria; only then do the cases become
  scheduled work. Later, a lens checks that each test *asserts what the plan required* — a test
  narrowed to fit the implementation is a blocker, because it manufactures confidence.
- **Symptoms are not causes.** Any defect whose cause is not visible goes to a debugger that must
  *prove* the cause — make the defect appear and disappear on demand — and report three separate
  things: the proximate cause, the root cause that permitted it, and the detection gap that let it
  through. An issue reopened twice cannot be fixed again without an investigation.
- **Agents coordinate through the filesystem, not conversation.** Everything is on disk, so a run
  is resumable across sessions, inspectable by hand, and diffable in git next to the code it
  produced. See [ADR-0001](docs/adr/0001-filesystem-as-agent-communication-bus.md).
- **Verification claims are checked, not believed.** The review lead re-runs the build and suite
  and compares reality against what the implementer claimed. A claim of passing tests that do not
  pass is a blocker, because downstream agents were handed false information.

## Commands

| Command | What it does |
|---|---|
| `/sdlc <request>` | The full pipeline, cycling until every gate passes or it escalates |
| `/sdlc-product <request \| PRD \| stories>` | Specification work only — four parallel lenses, then a consolidated spec, a quoted before/after changelog, and a prioritized list of what still needs improving. Stops before design and engineering |
| `/sdlc-review [target]` | The whole review phase alone — a feature, branch, PR number, path, or the working diff |
| `/sdlc-bug <report>` | The root-cause path, with every verification gate intact |
| `/sdlc-digest [slug \| path]` | The long artifacts as short briefs a human can read in minutes — feature, stories, design, tests, status, release, and a one-pager |
| `/sdlc-status [slug]` | Position, gates, issues, investigations, and the next action |
| `/sdlc-resume [slug]` | Diagnose an interrupted run, quarantine partial output, re-run only what died |
| `/sdlc-init` | Set up a project and learn its build, lint, and test commands |
| `/sdlc-program <request>` | A feature spanning several repos — spec written once, versioned contracts published so consumers start immediately |
| `/sdlc-join <spec> [slug]` | Run in a participating repo: take its slice, implement against the published contract, run its own gates |
| `/sdlc-integrate [slug]` | The integration gate — conformance both ways, cross-repo journeys, deploy order |

Plugin commands are namespaced, so they appear as `/sdlc-pipeline:sdlc`, and so on.

## Install

Requires Claude Code and git. Nothing else — no services, no API keys, no infrastructure.

```bash
claude plugin marketplace add DevLab-Technologies/claude-sdlc
```

```bash
claude plugin install sdlc-pipeline@claude-sdlc
```

`claude-sdlc` is the marketplace id — the part after the `@`. Both commands also work as
`/plugin marketplace add …` and `/plugin install …` inside a session. **Restart afterward**;
commands and agents register at session start.

Then, from inside a project you want to run it in:

```bash
/sdlc-pipeline:sdlc-init
```

That scaffolds `.sdlc/`, installs an ADR template into `docs/adr/`, writes the pipeline rules into
that project's `CLAUDE.md`, and records the project's **real** build, lint, test, and dev-server
commands into `.sdlc/project-conventions.md`. Agents use those verbatim, which is what stops QA
from reporting failures that are not real.

Now run something:

```bash
/sdlc-pipeline:sdlc add email and password authentication with session persistence
```

Re-running `/sdlc` on an existing feature resumes it rather than starting over.

## How it works

Each feature gets a workspace at `.sdlc/features/<slug>/` holding the artifacts of every phase,
an append-only `history/events.jsonl`, a full record of every agent run, issues as individual
files, and `state.json` as the single source of truth for position and gate status. The contract
for all of it is the `sdlc-protocol` skill, which every agent reads and treats as binding.

**Interruption is expected, not exceptional.** Every agent brackets its run in the event log and
marks its artifacts `status: partial` until a final write flips them to `complete`, and `state.json`
is always written last. So a killed session leaves an unambiguous trace: an unpaired `phase_start`
means that agent was interrupted and its output is untrusted. `/sdlc-resume` reconciles state against
the log and the artifacts, quarantines the partial files rather than deleting them, and re-runs only
the agents that actually died — a half-finished fan-out re-runs the missing lenses, not all five.

A **gate** passes only when the artifact proving it exists — the orchestrator is told never to
mark a gate from an agent's summary. A **cycle** is one pass of implement → review → QA → UI QA;
failures become issues, issues get triaged by cause, and the loop repeats until all gates pass
together or `max_cycles` is hit, at which point it writes an escalation with options instead of
spinning.

Work runs in parallel wherever it is genuinely independent, and the pipeline is checked periodically
for places that claimed to parallelize but didn't:

- **Research runs as three concurrent lenses** — internal code, external prior art, and hard
  constraints — each owning its own file. It used to be one agent doing all three in sequence despite
  the docs claiming a fan-out; that gap is closed.
- **Research does not wait on the human.** Intake writes `scope.md` and `assumptions.md` in its single
  pass, before it even checks whether a blocking question remains open. Research needs only those two
  files, never the human's answer, so it launches the moment intake finishes — concurrently with the
  person still reading the blocking questions. Only the product phase actually waits.
- **Contract drafting fans out per boundary** in a multi-repo program, instead of one steward pass
  drafting `backend-api`, then `events`, then `webhooks` in sequence — unless one boundary's shape
  genuinely depends on another's.
- **Test-plan authoring overlaps architecture.** Most of the plan — cases from acceptance criteria
  and the edge-case checklist — needs only product and design; only the failure-mode and error-code
  cases need `interfaces.md`. QA starts the moment the UX audit passes and folds in the
  architecture-derived cases once they land, rather than waiting for the whole architecture phase.
- **Five review lenses at once**, bracketed by a lead that runs the build and suite **once** so five
  agents do not collide on ports and fixtures — split further into a fast stage (build, type check)
  that gates the fan-out and a slow stage (the suite) that runs *alongside* the four lenses that never
  read runtime results.
- One debugger per symptom cluster, implementers on file-disjoint tasks, the two test-plan reviewers.

Naive parallelism here corrupts state, so the protocol names four hazards and a rule for each: parallel
agents never allocate global ids (a synthesizer does it afterward), only one agent edits per phase, and
only the phase owner touches `state.json`.

### Artifacts agents can act on, briefs people can read

The artifacts are written for agents: complete, numbered, traceable, and long. A specification that
a reviewer three cycles later can rely on is not a document anyone reads on a Tuesday afternoon.

`/sdlc-digest` derives short briefs from them into `.sdlc/features/<slug>/digest/` — a feature brief
from the specification, a story brief, a design brief, a coverage brief from the test plan, a status
brief from review and QA, and a one-pager over all of it. Each states its reading time, leads with
the answer rather than the background, and ends with what it left out. The skill also carries the
vocabulary and sentence shapes that make writing read as generated, and every brief is checked
against that list — a summary that sounds like a brochure gets skimmed, and its facts get discounted
along with its voice.

Compression is bounded by one rule: it cuts explanation, never obligation or inventory. Open
questions, risks, blockers, deferrals, costs and deadlines survive at every budget, and so does the
full list of what is being built — every requirement, every story with its acceptance criteria,
every edge case, every dependency. The word ceilings bound the prose around that list, not the list,
so a brief for a big feature is longer and still reads in minutes, because length in a table costs
the reader almost nothing. Nothing may be inferred to fill a gap the source left — a specification with no success metric produces a brief that says the
metric is missing. The briefs are derived and non-authoritative: no agent reads them, no gate
depends on them, and deleting the directory costs nothing but regeneration.

[docs/sdlc/README.md](docs/sdlc/README.md) has the flow diagram and the full role table.

## Features that span repositories

Backend, admin, frontend, and mobile are four repos and one feature. Running the pipeline separately in
each produces four PRDs that drift and no shared contract, so programs work differently: **the
specification is written once, and each repo implements its own slice against a published contract.**

The shared workspace — a specs repository by default — holds intake through the test plan, plus
`participants.json` and the versioned contracts. Each participating repo keeps its own
implementation, review, and QA cycles, its own track, and its own gates, linked back by a
`spec-link.md` recording the commit it read.

**Publishing a contract is the schedule-critical act.** A published, versioned boundary contract is
precise enough to build a mock from, so consumers start as soon as it exists rather than when the
provider finishes. That serialization is the largest cost in multi-repo work and this is what removes it.
Consumers implement against `published` versions only — never a draft, whose words may still be taken
back — and a breaking change needs a version bump, a compatibility window, a per-consumer migration
note, and an acknowledgement from every consumer.

**Awareness is pull, not push.** No agent can notify another repository, so a repo learns what changed by
reading the shared workspace. `spec-link.md` records the commit last read, and `/sdlc-status` compares it
against the current head to say plainly "contract v2 published, this repo targets v1". A repo silently
building on a superseded contract is the failure this reporting exists to catch.

**The integration gate** verifies what no single repo can: that the provider honors its contract, and —
the direction teams skip — that consumers assume **only** what the contract promises rather than an
undocumented behavior they observed. Plus cross-repo journeys, deliberately induced version skew, and a
deploy order that follows expand-contract. An order requiring two repos to deploy simultaneously is
reported as a finding, not an instruction: there is no cross-repo atomicity.

Design rationale in [ADR-0002](docs/adr/0002-shared-spec-workspace-for-multi-repo-features.md).

## Cost and speed

The pipeline is expensive by design — it buys independent verification, and independence costs a
second opinion. It should only cost that when the change warrants it.

**It scales to the change.** The orchestrator picks a track and records it:

| Track | Fits | Phases | Lenses |
|---|---|---|---|
| `trivial` | copy, config, a constant, a dependency bump | intake, implement, review, release | correctness only |
| `small` | one contained change, no new surface or data | + product, test-plan, qa | correctness + the one lens it touches |
| `standard` | a normal feature | all | all five |
| `large` | new subsystem, migration, auth/payments/data model | all, higher `max_cycles` | all five + a second security pass |

Two rules stop that becoming a quality hole: escalation is free and always upward — any agent that
finds the track too small says so and it re-tracks — and **security, authorization, payments,
migrations, and personal data are `standard` at minimum whatever the diff size**.

Other things that keep cost down: the shared protocol is deliberately small, with role-specific
checklists living in the one agent that uses them rather than being loaded by all of them;
mechanical sub-steps run on a cheaper model while every judgment role stays on the default;
reports are findings-first with no preamble or methodology, which saves tokens writing them and
again when the lead reads five; and cycle 2 onward reviews the delta, not the whole feature.

**Two overlaps considered and rejected**, for honesty about where the limit is: reviewing a task the
moment its implementer finishes, while other tasks in the same cycle are still being built, was
rejected — the build and type check need the whole diff present, and a task reviewed against code
that will still change produces a verdict about a state that never shipped. Starting the PRD before
research lands was rejected too — unlike the file-level separations above, a good PRD's non-goals and
NFRs draw substantively on `constraints.md` and `prior-art.md`, so writing it blind and revising
later costs more rework than the overlap would save.

**Latency is barriers, not slow agents.** Wall-clock time is the sum of the slowest step in each
phase, so the wins come from removing waits:

- **The test suite is off the critical path for four of five review lenses.** Verification splits in
  two: build and type check (seconds) gate the fan-out, then the suite and smoke test run
  *alongside* the correctness, security, performance, and compliance lenses, which read source and
  need no runtime facts. Only the tests lens waits for results, since it compares them to the plan.
- **The architect may draft the data model while the UX audit runs**, since audit findings land on
  the interface rather than the schema, and it incorporates them before the contract is final.
- **The workplan is pushed toward wider parallel sets.** Every `depends_on` costs a serial step, so
  the architect has to justify each one — a dependency created by how the work was carved up is not
  a real dependency.
- Mechanical steps run on a faster model, which cuts latency as well as cost.

Barriers that stay, because removing them costs the property the pipeline exists for: the four
concurrency hazards in section 9, functional QA before UI QA, a reviewer re-verifying after a fix,
and the release gate last and alone.

**If you want it cheaper still**, the levers with their costs named:

- Drop the performance and test lenses from the fan-out for internal tooling — you lose N+1 and
  unbounded-growth detection, and the check that tests assert what the plan required.
- Lower `max_cycles` so it escalates to you sooner instead of iterating.
- Move a lens to a cheaper model in its agent file. Measure before trusting it; lenses earn their
  cost on subtle findings, which is what gets lost first.
- Use a single-agent review for small diffs instead of the seven-agent fan-out.

What is not a lever: skipping the release gate, or letting one agent both fix and sign off. Those
are the only defenses against a green light nobody earned.

## For teams

Commit this to a project's `.claude/settings.json` and anyone who trusts the folder is prompted to
install it, with the plugin enabled for them:

```json
{
  "extraKnownMarketplaces": {
    "claude-sdlc": {
      "source": { "source": "github", "repo": "DevLab-Technologies/claude-sdlc" }
    }
  },
  "enabledPlugins": { "sdlc-pipeline@claude-sdlc": true }
}
```

Adding the marketplace this way does not install the plugin for them — as of recent versions, a
plugin from an external source still needs `claude plugin install sdlc-pipeline@claude-sdlc` once.
Claude Code reports it as not installed and shows the command.

Commit `.sdlc/project-conventions.md` alongside it and everyone runs the same commands, the same
gates, and the same history. Administrators can put the same two keys in managed settings to cover
every machine; for CI or container images, pre-populate the plugin cache with
`CLAUDE_CODE_PLUGIN_SEED_DIR` so nothing is cloned at runtime.

### Updates

**Auto-update is off by default.** Official Anthropic marketplaces ship with it on; third-party ones
like this do not. So unless someone turns it on, nothing changes for them until they run:

```bash
claude plugin update sdlc-pipeline@claude-sdlc
```

To turn it on per person: `/plugin` -> **Marketplaces** -> select `claude-sdlc` -> **Enable
auto-update**. Administrators can turn it on for everyone by adding `"autoUpdate": true` to the
marketplace entry in managed settings, so nobody has to toggle it individually.

With auto-update on, Claude Code checks shortly after a session starts (a random delay of up to ten
minutes, so the running session keeps the versions it launched with), then either notifies you to run
`/reload-plugins` or loads the new version on the next launch. `DISABLE_AUTOUPDATER` switches it off
again; `FORCE_AUTOUPDATE_PLUGINS=1` keeps plugin updates while disabling Claude Code's own.

Either way there is a lag between a push and everyone running it. That matters here more than for
most plugins: the agents share a protocol, and a team split across two versions produces
inconsistent artifacts with **no error to signal it**. When a change touches the protocol or the
phase ordering, tell people rather than relying on the update landing.

## Adapting it

Every agent is a plain markdown file in
[`plugins/sdlc-pipeline/agents/`](plugins/sdlc-pipeline/agents), and every command is one in
[`commands/`](plugins/sdlc-pipeline/commands). Editing them is the intended use.

- Swap `sdlc-implementer` for a stack specialist; keep its sections on contracts, verification,
  and the task record.
- Add a review lens by writing one agent file and adding it to the fan-out. It inherits the
  parallel constraints from protocol section 9.
- **The gate criteria in the `sdlc-protocol` skill are where a team's real standards belong.**
  Tighten them there and every agent inherits the change.
- Tune `max_cycles` per feature; lower it for exploratory work so it escalates sooner.

Validate before you publish a fork — a malformed manifest breaks the install for everyone:

```bash
claude plugin validate ./plugins/sdlc-pipeline
```

## Project status

Early, and honest about it. The agents, protocol, and orchestration are complete and the plugin
validates and installs, but **this has not yet been run end to end on a large real feature**. The
gate criteria and phase handoffs are where the rough edges will show first.

Known limitations:

- There is no locking on the workspace. Parallel safety comes from declared file ownership and the
  workplan's conflict-free task sets. If that discipline slips, concurrent writes clobber.
- Functional QA and UI QA are deliberately sequential; they share one running app and one dataset.
- Model choices are tuned for quality over cost. Read the cost section before running it on
  everything.

If you run it on something real, the most useful thing you can report is which gate produced a
wrong verdict and what the artifacts said at the time.

## Contributing

Issues and pull requests welcome. Two things make a change easy to accept:

1. **Say which failure mode it addresses.** The design is a set of constraints against agents
   marking their own homework; a change that loosens one should say why the failure it prevents is
   not a real risk.
2. **Keep separation of duties intact.** Anything that lets one agent both produce and approve work
   needs a strong argument, because that is the property everything else rests on.

Run `claude plugin validate ./plugins/sdlc-pipeline` before opening a PR.

## License

MIT — see [LICENSE](LICENSE).
