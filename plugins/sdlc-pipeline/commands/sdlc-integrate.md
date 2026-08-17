---
description: Run the integration gate for a cross-repo program — contract conformance in both directions, cross-repo journeys, version alignment, and a deploy order that never needs simultaneous deployment.
argument-hint: [slug, or blank for the program in progress]
---

Run the integration gate for: **$ARGUMENTS**

This verifies what no single repository can. Four repos that each pass their own tests can still be
broken together, and that gap is the only thing this command is for.

## Step 1 — Refuse to run early

Invoke the `sdlc-protocol` skill; section 12 governs this.

Resolve the shared workspace and the slug, then read `participants.json` and every
`participants/<repo>/status.md`.

**Every participant must have passed its own gates.** If any has not, stop and report which, with what
each still owes. Integration testing a repo that has not verified itself produces findings that belong
to that repo, and it wastes the one pass only this gate can make.

Also check for interrupted runs across the program per protocol 3a — an unpaired `phase_start` in the
shared workspace or in any participant means something died mid-flight. Run `/sdlc-resume` before
integrating; integrating on top of partial output produces a verdict about a state that never existed.

## Step 2 — Establish what you are integrating

Record the **exact commit** of every participant. Integration passes for a *set of versions*, not for a
feature name, and this list is what makes the sign-off meaningful later.

Read every `published` contract and every `contract-ack.md`. Note any participant you cannot reach or
stand up — that is a limit on the whole gate, not a detail.

## Step 3 — Run the gate

Launch `sdlc-integration-qa` with the participant list, the commits, the published contracts, the acks,
and the `integration`-tagged test cases. It covers, in order:

1. **Conformance both directions** — the provider honors its contract, and consumers assume only what
   the contract promises. The second direction is the one teams skip and the one that breaks on the next
   provider change.
2. **Cross-repo journeys**, including partial failure across a boundary, deliberately induced version
   skew inside a compat window, auth crossing the boundary, and whether a consumer retry duplicates
   anything in the provider.
3. **Version alignment** — every ack names a published version; no expired compatibility windows.
4. **Deploy order** — expand-contract, with the halfway state answered: after step 2 of 4, is the system
   working for users? If not, the order is wrong.

Launch `sdlc-contract-steward` alongside it, in drift-detection mode, so contract drift and conformance
are established together rather than one after the other.

## Step 4 — Route the findings correctly

This is where an integration gate usually goes wrong:

- **Contract and cross-repo defects** → shared issues in the spec workspace, plus a bus message to the
  owning participant.
- **A defect that is really in one repo's own code** → a local issue in that repo, plus a bus message.
  Do not fix it here, and do not leave it in the shared tracker where its owner will never look.
- **A contract that turned out to be wrong** → the steward's call, not a workaround in a consumer. A
  consumer patching around a bad contract is how the contract stops meaning anything.

## Step 5 — Report

- The exact participant commits and contract versions integrated
- Verdict and findings by severity, each routed to its owner
- Conformance results per boundary, **both directions stated separately**
- Journeys run, and the ones you could not stand up
- Version alignment, drift, expired windows
- The deploy order, with the rollback trigger and the halfway-state answer
- The `NOT verified` line from the sign-off, verbatim — with several repos in play it is easy to imply
  everything was exercised, so do not summarize away what was not
- Whether the program can ship, or which participant it is waiting on

If integration passes, hand to `sdlc-release-gate` for the program-level ship decision. Integration
passing means the pieces fit; it does not mean the program is ready.

**A participant that changes after this pass invalidates it**, exactly as a code change invalidates a
stale review sign-off. Say so in your report, and name the commits the pass is valid for.
