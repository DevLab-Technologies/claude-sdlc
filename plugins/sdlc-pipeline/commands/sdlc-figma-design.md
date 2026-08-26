---
description: Turn the requirements into a versioned Figma design — generate the frames, or import an existing Figma file — then export the whole design into the feature workspace so implementers and QA can build and check against it without Figma access.
argument-hint: <feature slug | path to requirements> [generate | import | sync | link]
---

Produce a Figma design version for: **$ARGUMENTS**

The design lives in Figma. The **deliverable** is a published design version on disk that an agent
with no Figma access can build from. Getting frames into Figma and forgetting the export is the
failure this command exists to prevent.

## Setup

1. Invoke the `sdlc-figma-design` skill. Everything below assumes it, especially the authority split
   in section 3 and the access paths in section 6.

2. **Resolve the target.**
   - A feature slug, or `.sdlc/features/<slug>/` exists — work in that workspace.
   - A path to requirement documents with no feature behind it — work in
     `.sdlc/design/<date>-<slug>/`, same layout, and say there is no feature attached.
   - Nothing given — read `.sdlc/registry.json` and ask which feature, rather than guessing at the
     most recent one.

3. **Find out whether there is a Figma file at all, and ask if nobody has.** Read
   `.sdlc/figma.json`, then branch on what it says and on the mode:

   - **`link` mode — always ask, whatever is recorded.** Changing that record is the entire job of
     this mode, so a stored `available: false` is the normal case for it, not a reason to stop.
   - **Missing, or `available: unknown`** — ask.
   - **`available: false`, any other mode** — stop and say so. The project has already answered;
     there is nothing to design against, the pipeline runs on the markdown specification, and
     launching the designer would only re-probe access the project recorded as absent and overwrite
     the feature's `figma-link.md`. Point at `/sdlc-figma-design link` and end there.
   - **`available: true`** — go on to the requirements check below.

   When you ask, ask the human directly — you are in the main session and you can:

   > Does this project have Figma design files?
   > · Yes — I have Figma file URLs · No Figma · Not yet, but we will add them

   On **yes**, ask for the URLs and, for each, what it holds (product screens, design system,
   flows) and which surfaces it covers. Then verify each one by actually reading its metadata
   through Figma before recording it — a URL that does not resolve is worse than no URL, because
   everything downstream will trust it. Write `.sdlc/figma.json` per skill section 1.

   On **no** or **not yet**, write `.sdlc/figma.json` with `available: false` and the reason, so
   nobody asks again on every run, tell the human that `/sdlc-figma-design link` adds files later —
   and that it asks again even once `false` is recorded — and stop. There is nothing to design
   against, and the pipeline runs on the markdown specification with no loss except visual
   precision.

4. **`link` mode ends here.** It exists to record or update `.sdlc/figma.json` and nothing else:
   ask, verify, write, report. Do not produce a version.

## Requirements are the input — check they exist

The design version renders a specification; it does not invent one. Before running, confirm what
you have:

| Available | What to do |
|---|---|
| `03-design/*.md` (flows, screens, states, copy) | The normal path. Render or reconcile against it |
| PRD and stories, no UX specification | Say so, and run `sdlc-ux-designer` first. A design version built straight from stories will invent states and copy that nothing audited |
| Loose requirement documents, standalone | Work from them, and list in `coverage.md` every screen and state you had to infer. Inferred is not specified, and the report must not blur them |
| Nothing but a one-line request | Stop. Point at `/sdlc <request>` |

The one exception is `import` mode: an existing Figma file can be extracted before any markdown
exists — but the reconciliation column will be empty, so say clearly that nothing has been checked
against a specification yet.

## Run it

Launch `sdlc-figma-designer` with: the slug, the phase (`03b-figma`), the cycle, the mode if the
human named one, the absolute paths of its inputs, and the entries from `.sdlc/figma.json` it may
touch. Pass only the paths it needs.

Let the agent pick the mode when the human did not name one — `import` where frames exist,
`generate` where they do not, `sync` where a published version has gone stale. Mixed across screens
is normal and expected.

**Generating or syncing writes into someone's Figma file.** That is outward-facing. Name the exact
file and page and confirm with the human before launching the agent in `generate` or `sync` mode.
Read-only `import` needs no confirmation.

## After it returns

Read the artifacts, not the agent's summary:

1. `03b-figma/v<N>/manifest.json` — is `status` actually `published`, and does every frame it lists
   have a shot on disk?
2. `reconciliation.md` — any unresolved conflict means the gate is `failed`, whatever the agent
   concluded. Route each behavioral conflict to `sdlc-ux-designer` and each contract-shaped one to
   the architect.
3. `coverage.md` — every P0 screen either covered or recorded as a gap. A screen that appears in
   neither list was silently dropped.
4. `state.json` — `gates.figma-design` and `design_version` set.

Then **report what this publish invalidated**, in your reply and not only in a file. A new published
version makes every `review`, `qa`, and `ui-qa` pass recorded before it stale (skill section 5). Name
those gates. If this ran inside a feature that had already passed QA, say plainly that those gates
must re-run in the current cycle — that is the cost of a design change, and burying it is how a
feature ships against a design nobody checked.

## Reporting to the human

Four or five lines: mode and access path, the version published, screens covered versus gaps,
conflicts opened and who owns them, and the gates now stale. Then the single most useful next
command — `/sdlc <slug>` to continue the pipeline, or `/sdlc-figma-design <slug> sync` after the
designer changes the file again.

Never report a design version as published when `reconciliation.md` still holds a conflict, and never
report measurements as observed when the access path was `none`.
