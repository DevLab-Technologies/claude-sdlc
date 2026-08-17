---
description: Start or drive a feature that spans several repositories — writes the specification once in a shared workspace, publishes versioned contracts so consumers can start immediately, then tracks each participant to the integration gate.
argument-hint: <feature request> [--participants backend,admin,frontend,mobile]
---

Run the cross-repo program for: **$ARGUMENTS**

A **program** is one feature spanning several repositories. The specification is written once; each
repository implements its own slice against a published contract and keeps its own gates. You are the
program orchestrator — you own the shared workspace and the contracts, not any repo's implementation.

## Step 0 — Locate the shared workspace

Invoke the `sdlc-protocol` skill; section 12 is your mandate.

The shared workspace is **not** this repo's `.sdlc/`. Resolve it in this order and say which you used:

1. `sdlcSpecWorkspace` in `.sdlc/config.json`, if present — an absolute path or a git URL
2. A sibling checkout matching `*specs*` or `*contracts*` alongside this repo
3. Ask the human where it is, offering to create one

If it does not exist, propose creating a specs repository and **wait for agreement** — creating a
repository is outward-facing. Then write `.sdlc/config.json` here with `sdlcSpecWorkspace` so later
runs resolve it without asking. If it is a git URL, clone it locally and work in the clone; commit and
push changes there as you go, since other repos read it over git.

## Step 1 — Establish the program

Derive a `<slug>`. If `.sdlc/features/<slug>/` exists in the shared workspace, this is a resumption:
read its `state.json`, `participants.json`, and history, report the position, and continue. Check for
interrupted runs per protocol 3a before continuing anything.

Otherwise scaffold it per the section 12 layout and write **`participants.json`**:

```json
{
  "participants": [
    { "repo": "backend",  "url": "org/backend",  "role": "provider",
      "boundaries_provided": ["backend-api", "events"], "boundaries_consumed": [] },
    { "repo": "frontend", "url": "org/frontend", "role": "consumer",
      "boundaries_provided": [], "boundaries_consumed": ["backend-api"] }
  ]
}
```

Derive participants from `--participants`, or from the request, or ask. Getting this list wrong is
expensive later: a repo you forgot has no contract and no tasks, and discovers the feature after it
ships. Ask rather than guess when the surface is unclear.

## Step 2 — Shared phases, written once

Run intake, research, product, design, UX audit, and architecture in the **shared workspace**, exactly
as `/sdlc` does — same agents, same gates, same track selection from protocol section 8. One PRD, one
design, one architecture for the whole program.

Two additions the architect must handle here:

- **Tag every workplan task with its participant.** A task belongs to exactly one repo.
- **Name every boundary** between participants, so the steward has its list.

## Step 3 — Contracts, and publish early

Launch `sdlc-contract-steward`. It drafts a versioned contract per boundary and publishes each when the
shape is settled.

**Publication is the schedule-critical act of this whole command.** A published contract unblocks every
consumer, and it does not require the provider's implementation to exist. Do not wait for backend to
build something before frontend can start — that serialization is the cost this design exists to remove.

Hold a contract at `draft` while its shape is still moving, and never let a consumer implement against a
draft.

## Step 4 — One test plan, tagged

Run the phase 6 loop in the shared workspace: `sdlc-qa-functional` authors, architect and product owner
review in parallel, QA revises and approves. Tag every case with the participant that owns it, or
`integration` for cases that can only be verified with several participants running together.

The integration cases are the ones nobody writes without being made to. Insist on them: cross-repo
journeys, partial failure across a boundary, version skew inside a compat window, auth crossing the
boundary.

## Step 5 — Hand each participant its slice

Write `participants/<repo>/tasks.md` per repo — its workplan tasks, its `TC` ids, its contract version —
and `contract-ack.md` as a stub for that repo to fill.

Then tell the human the exact command to run in each repo:

```
/sdlc-join <shared-workspace-location> <slug>
```

**You cannot start work in another repository**, and you should not try. Awareness is pull, not push
(protocol 12). Report the list of commands for the human to distribute. If they want consumer repos
notified actively — an issue or PR opened there — ask first; that is an outward action on someone else's
repository.

## Step 6 — Track, then integrate

Participants run their own cycles at their own pace. On each invocation with an existing slug:

1. Refresh `participants/<repo>/status.md` from each participant's `state.json` where you can reach it,
   and say plainly which participants you could not read.
2. Run `sdlc-contract-steward` in drift-detection mode: consumers on superseded versions, expired compat
   windows, missing acknowledgements, a provider drifted from its own contract.
3. When **every** participant has passed its own gates, run `/sdlc-integrate <slug>`. Not before — see
   that command.

## Step 7 — Report

- The shared workspace location, the slug, the track
- Participants, their roles, and each one's gate roll-up
- Contracts by boundary: version, status, and who has acknowledged what
- Drift: anyone on an old version, any expired window, any missing ack
- Blocking bus messages and human questions
- The next action per participant, and whether integration can run yet

Never report a program as ready because the shared phases are done. A program is only as ready as its
least-ready participant plus a passing integration gate.
