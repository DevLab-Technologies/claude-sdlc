# SDLC Pipeline for Claude Code

An automated software development lifecycle. A feature request enters; specialized agents
carry it through discovery, specification, design, architecture, implementation, and
verification; it leaves as reviewed, tested, traceable work — or it escalates to a human with
options instead of pretending to be done.

This repository is a **Claude Code plugin marketplace**. The plugin lives in
[`plugins/sdlc-pipeline/`](plugins/sdlc-pipeline).

## What you get

Fourteen commands and agents, coordinating through a durable filesystem workspace:

- `/sdlc <request>` — the full pipeline: intake, research, PRD and stories, UX design, UX
  audit, architecture with ADRs, a reviewed test plan written before the code, implementation,
  review, functional QA, UI QA, release gate
- `/sdlc-bug <report>` — the root-cause path: reproduce, prove the cause, fix the cause, add
  a regression test, verify, sweep the blast radius
- `/sdlc-status [slug]` — position, gates, issues, investigations, and the next action
- `/sdlc-init` — set up a project and learn its conventions

See [docs/sdlc/README.md](docs/sdlc/README.md) for the flow diagram and the role table, and
[ADR-0001](docs/adr/0001-filesystem-as-agent-communication-bus.md) for why agents coordinate
through the filesystem.

---

## Use it in your own projects

Published at **https://github.com/DevLab-Technologies/claude-sdlc**. The marketplace is named
`miza-sdlc`, which is the name after the `@` when installing — it is independent of the
repository name.

### 1. Add the marketplace once, per machine

```bash
claude plugin marketplace add DevLab-Technologies/claude-sdlc
```

```bash
claude plugin install sdlc-pipeline@miza-sdlc
```

Both are available as `/plugin marketplace add …` and `/plugin install …` inside an
interactive session. The plugin is now available in **every** project on that machine.

To develop against your working copy instead, add the local directory — it picks up your edits
as you make them, which is the right setup while you are still tuning the agents:

```bash
claude plugin marketplace add /Users/elkhayyat/Dev/SDLC
```

### 2. Initialize each project

From inside a project you want to run the pipeline in:

```bash
/sdlc-init
```

This scaffolds `.sdlc/`, installs the ADR template into `docs/adr/`, writes the pipeline
rules into that project's `CLAUDE.md`, and — the part that matters — records the project's
real build, lint, test, and dev-server commands into `.sdlc/project-conventions.md`. Agents
use those commands verbatim, so this step is what stops QA from reporting failures that are
not real.

Then start work:

```bash
/sdlc add email and password authentication with session persistence
```

---

## Share it with your team

### Option A — each person installs it (simplest)

Send them two commands:

```bash
claude plugin marketplace add DevLab-Technologies/claude-sdlc
```

```bash
claude plugin install sdlc-pipeline@miza-sdlc
```

The repository is public, so no credentials are needed. If you later make it private, access
uses each person's existing git credentials — `gh auth login`, the macOS Keychain, or an SSH
key already in `ssh-agent` all work without extra setup.

### Option B — per project, automatic (recommended for a team)

Commit this to the **target project's** `.claude/settings.json`. Anyone who trusts the folder
is prompted to install the marketplace, and the plugin is enabled for them:

```json
{
  "extraKnownMarketplaces": {
    "miza-sdlc": {
      "source": {
        "source": "github",
        "repo": "DevLab-Technologies/claude-sdlc"
      }
    }
  },
  "enabledPlugins": {
    "sdlc-pipeline@miza-sdlc": true
  }
}
```

Commit `.sdlc/project-conventions.md` alongside it and the whole team runs the pipeline with
the same commands, the same gates, and the same history. New joiners get it by cloning.

### Option C — organization-wide

An administrator puts the same `extraKnownMarketplaces` and `enabledPlugins` keys into
managed settings, and it is registered on every machine with no per-project step. Use this
once the pipeline has earned its place; Option B is the better place to start, because a
project can opt out.

For CI or container images, pre-populate the plugin cache at build time with
`CLAUDE_CODE_PLUGIN_SEED_DIR` so nothing is cloned at runtime.

## How your team gets updates

Push to this repository. Each person then runs:

```bash
claude plugin update sdlc-pipeline@miza-sdlc
```

Or `/plugin` inside a session, which lists what has an update available.

The manifest carries **no `version` field**, deliberately. That puts the plugin on
commit-tracked versioning: the resolved commit SHA is the version, so every push you make is an
available update — no version bumping, nothing to remember. This is the right mode while the
agents are still being tuned.

Two things follow from it:

- **Updates are not automatic.** Nobody's behavior changes until they run `update`. If a change
  matters, tell them; a pipeline where half the team is on an older protocol produces
  inconsistent artifacts.
- **Restart to pick it up.** Commands, agents, and skills register at session start, so an
  update mid-session takes effect in the next one.

Once the pipeline is stable and you want releases instead of a moving target, add
`"version": "1.0.0"` back to
[`plugin.json`](plugins/sdlc-pipeline/.claude-plugin/plugin.json). Installs then pin to that
string and only move when you bump it.

## Maintaining it

The marketplace name `miza-sdlc` is what your team types after the `@`. Renaming it means
every existing install has to be redone, so settle it before the team adopts it. The same
applies to the plugin name `sdlc-pipeline` — it keys `enabledPlugins` and `pluginConfigs`.

This repository is **public**. It carries the maintainer email in both manifests, and the gate
criteria in the `sdlc-protocol` skill are effectively the team's internal quality standards —
worth a read before pointing anyone outside the org at it.

Always validate before pushing; a malformed manifest breaks the install for everyone:

```bash
claude plugin validate ./plugins/sdlc-pipeline
```

## Adapting it

Every agent is a plain markdown file in [`plugins/sdlc-pipeline/agents/`](plugins/sdlc-pipeline/agents).
Edit them — that is the point.

- Swap `sdlc-implementer` for a stack specialist and keep the sections on contracts,
  verification, and the task record.
- Add a security phase by running your auditor alongside `sdlc-code-reviewer` in phase 8.
- Tune `max_cycles` per feature in `state.json`; lower it for exploratory work so it
  escalates sooner.
- The gate criteria in the `sdlc-protocol` skill are where a team's real standards belong.
  Tighten them there and every agent inherits the change.
