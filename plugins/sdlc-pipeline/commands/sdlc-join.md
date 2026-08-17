---
description: Join this repository to a cross-repo program — read the shared specification, take this repo's slice of the work, implement it against the published contract, and run this repo's own review and QA gates.
argument-hint: <shared workspace path or git URL> [slug]
---

Join this repository to the program: **$ARGUMENTS**

Run this **inside a participating repo** — backend, admin, frontend, or mobile. It gives this repo the
work it owes, and runs this repo's own cycle. It does not touch the shared specification.

## Step 1 — Read the shared spec

Invoke the `sdlc-protocol` skill; section 12 governs this.

Resolve the shared workspace from the argument, or from `sdlcSpecWorkspace` in `.sdlc/config.json`, or
ask. If it is a git URL, clone or pull it — you need current content, and a stale clone is how a repo
builds against a superseded contract.

Read from it: `participants.json`, the PRD and stories, the design specs for this repo's surface,
`architecture.md`, this repo's `participants/<repo>/tasks.md`, the test plan cases tagged for this repo,
and every **published** contract this repo provides or consumes.

**If this repo is not in `participants.json`, stop.** Either it was left out of the program — say so, and
it needs adding in the shared workspace — or you are in the wrong repo.

## Step 2 — Establish the local workspace

Create `.sdlc/features/<slug>/` **here**, and write:

- **`spec-link.md`** — the shared workspace location, and the **commit** you read it at. This is what
  later drift detection compares against, so record it precisely.
- **`participants/self.md`** — this repo's role, its boundaries provided and consumed, its tasks, its
  `TC` ids, and the contract version it targets.
- **`contract-ack.md`** — the version this repo is building against. Write it back into the shared
  workspace too, at `participants/<repo>/contract-ack.md`, since that is where the steward and integration
  QA look for it.

If `.sdlc/project-conventions.md` is missing here, run `/sdlc-init` first — this repo's real build and
test commands are what its own QA depends on.

## Step 3 — Check the contract before writing anything

For each boundary this repo consumes:

- Confirm the version is **`published`**. If it is a `draft`, **stop**: bus the steward and wait. Building
  against a draft means building against words that may be taken back.
- If a newer version is published than this repo targets, report the gap and ask whether to target the new
  one before starting, rather than after.

For each boundary this repo **provides**: the published contract is now binding on you. Anything it
promises must exist, exactly as written, including error codes and nullability.

Then pick this repo's **track** per protocol section 8 based on what *this repo's* slice touches — the
program's track does not automatically apply. A large program can have a small slice here, and a repo
touching auth is `standard` at minimum even if its slice is two files.

## Step 4 — Implement, review, and verify locally

Run the local cycle exactly as `/sdlc` does from phase 7 onward, in this repo:

1. `sdlc-implementer` per task, each handed its assigned `TC` ids from `tasks.md`.
   - **Consumers do not wait for the provider.** Build against the published contract using a mock or
     stub derived from it — a contract precise enough to build a mock from is the point of publishing.
     Record what you mocked in `handoff.md`, because integration QA needs to know what has never met the
     real provider.
   - **Providers must honor their published contract exactly.** A deviation is not a local decision; bus
     the steward.
2. Phase 8 review — the pipelined fan-out (protocol 9a), with this repo's own lenses and lead.
3. Phase 9 functional QA, and phase 10 UI QA if this repo has a surface.
4. This repo's release gate, for this repo's slice only.

**Issue routing, and get this right.** A defect in this repo's code is a **local** issue here. Anything
about the contract, the requirements, the design, or another participant is a **shared** issue in the
spec workspace plus a bus message to the owning role. A contract defect filed locally is how four repos
each build the same workaround.

## Step 5 — Report back to the program

Write this repo's gate roll-up to `participants/<repo>/status.md` in the shared workspace, and commit and
push if it is a git checkout — that file is how the program reads this repo's position.

Then report to the human:

- This repo's role, track, and slice
- Its gate results and its own sign-offs
- The contract version it targets, and whether that is current
- **What was built against a mock and has never met the real provider** — say this explicitly; it is
  exactly what integration QA must exercise
- Local issues still open, and any shared issues raised
- Whether this repo is ready for the integration gate

Do not claim the feature works. This repo's slice passing means this repo's slice passes. Whether the
pieces fit is `/sdlc-integrate`, and it needs every participant done first.
