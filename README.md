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
| `/sdlc-status [slug]` | Position, gates, issues, investigations, and the next action |
| `/sdlc-init` | Set up a project and learn its build, lint, and test commands |

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

A **gate** passes only when the artifact proving it exists — the orchestrator is told never to
mark a gate from an agent's summary. A **cycle** is one pass of implement → review → QA → UI QA;
failures become issues, issues get triaged by cause, and the loop repeats until all gates pass
together or `max_cycles` is hit, at which point it writes an escalation with options instead of
spinning.

Work runs in parallel where it is genuinely independent — research sweeps, the two test-plan
reviewers, implementers on file-disjoint tasks, one debugger per symptom cluster, and five review
lenses at once. Naive parallelism here corrupts state, so the protocol names four hazards and a
rule for each: parallel agents never allocate global ids (a synthesizer does it afterward), only
one agent edits per phase, the build and suite run **once** before the fan-out into a file the
group reads, and only the phase owner touches `state.json`.

[docs/sdlc/README.md](docs/sdlc/README.md) has the flow diagram and the full role table.

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
