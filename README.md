# SDLC Pipeline for Claude Code

An automated software development lifecycle. A feature request enters; specialized agents
carry it through discovery, specification, design, architecture, implementation, and
verification; it leaves as reviewed, tested, traceable work — or it escalates to a human with
options instead of pretending to be done.

This repository is a **Claude Code plugin marketplace**. The plugin lives in
[`plugins/sdlc-pipeline/`](plugins/sdlc-pipeline).

## What you get

Thirteen commands and agents, coordinating through a durable filesystem workspace:

- `/sdlc <request>` — the full pipeline: intake, research, PRD and stories, UX design, UX
  audit, architecture with ADRs, implementation, review, functional QA, UI QA, release gate
- `/sdlc-bug <report>` — the root-cause path: reproduce, prove the cause, fix the cause, add
  a regression test, verify, sweep the blast radius
- `/sdlc-status [slug]` — position, gates, issues, investigations, and the next action
- `/sdlc-init` — set up a project and learn its conventions

See [docs/sdlc/README.md](docs/sdlc/README.md) for the flow diagram and the role table, and
[ADR-0001](docs/adr/0001-filesystem-as-agent-communication-bus.md) for why agents coordinate
through the filesystem.

---

## Use it in your own projects

### 1. Publish this repository

Push it to a git host your team can reach. It works from GitHub, GitLab, Bitbucket, or a
plain git URL, public or private.

```bash
cd /Users/elkhayyat/Dev/SDLC && git init && git add . && git commit -m "Add SDLC pipeline plugin and marketplace"
```

```bash
gh repo create your-org/claude-sdlc --private --source . --push
```

### 2. Add the marketplace once, per machine

```bash
claude plugin marketplace add your-org/claude-sdlc
```

```bash
claude plugin install sdlc-pipeline@miza-sdlc
```

Both are available as `/plugin marketplace add …` and `/plugin install …` inside an
interactive session. The plugin is now available in **every** project on that machine.

To try it before publishing, add the local directory instead — it picks up your edits as you
make them, which is the right setup while you are still tuning the agents:

```bash
claude plugin marketplace add /Users/elkhayyat/Dev/SDLC
```

### 3. Initialize each project

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
claude plugin marketplace add your-org/claude-sdlc
```

```bash
claude plugin install sdlc-pipeline@miza-sdlc
```

Private repository access uses their existing git credentials — `gh auth login`, the macOS
Keychain, or an SSH key already in `ssh-agent` all work without extra setup.

### Option B — per project, automatic (recommended for a team)

Commit this to the **target project's** `.claude/settings.json`. Anyone who trusts the folder
is prompted to install the marketplace, and the plugin is enabled for them:

```json
{
  "extraKnownMarketplaces": {
    "miza-sdlc": {
      "source": {
        "source": "github",
        "repo": "your-org/claude-sdlc"
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

## Updating

Push changes to this repository, then:

```bash
claude plugin update sdlc-pipeline@miza-sdlc
```

The plugin has `"version": "0.1.0"` in its manifest, so installs are pinned to that string
and your team receives updates only when you bump it. While the pipeline is still under
active development, remove the `version` field from
[`plugin.json`](plugins/sdlc-pipeline/.claude-plugin/plugin.json) and the marketplace entry —
then every push reaches the team on their next update.

## Before you commit

Replace the placeholder identity in two files: `owner` in
[`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) and `author` in
[`plugin.json`](plugins/sdlc-pipeline/.claude-plugin/plugin.json). The marketplace name
`miza-sdlc` is what your team types after the `@`, so change it before anyone installs —
renaming it later means every install has to be redone.

Validate before pushing:

```bash
claude plugin validate ./plugins/sdlc-pipeline
```

## Adapting it

Every agent is a plain markdown file in [`plugins/sdlc-pipeline/agents/`](plugins/sdlc-pipeline/agents).
Edit them — that is the point.

- Swap `sdlc-implementer` for a stack specialist and keep the sections on contracts,
  verification, and the task record.
- Add a security phase by running your auditor alongside `sdlc-code-reviewer` in phase 7.
- Tune `max_cycles` per feature in `state.json`; lower it for exploratory work so it
  escalates sooner.
- The gate criteria in the `sdlc-protocol` skill are where a team's real standards belong.
  Tighten them there and every agent inherits the change.
