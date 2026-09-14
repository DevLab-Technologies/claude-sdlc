# Protocol — multi-repo programs

Loaded only for work spanning more than one repository. Core protocol section 12.

## 12. Multi-repo programs

A **program** is one feature spanning several repositories — a backend, an admin, a web frontend, a
mobile app. The specification is written **once** in a shared workspace; each repository implements
its own slice against a published contract and keeps its own gates. See ADR-0002 for why.

### Where things live

**Shared workspace** — a dedicated specs repository by default, holding everything written once:

```
.sdlc/features/<slug>/
  state.json              # shared position + participant roll-up
  participants.json       # who is involved, their repos and roles
  00-intake/ … 04-ux-audit/          # as normal, written once
  05-architecture/
    architecture.md  workplan.md  test-strategy.md
    interfaces.md                    # the cross-boundary contract, in summary
    contracts/<boundary>/v<N>.md     # versioned, per boundary
    contracts/<boundary>/CHANGELOG.md
  06-test-plan/plan.md               # cases tagged with a participant, or `integration`
  participants/<repo>/
    tasks.md            # that repo's slice of the workplan and its TC ids
    contract-ack.md     # which contract version it targets
    status.md           # its gate roll-up, copied back from the repo
  12-integration/cycle-<n>/{conformance,journeys,deploy-order,integration-summary}.md
  issues/ bus/ history/                # spec-level and contract-level only
```

**Each participating repo** keeps `.sdlc/features/<slug>/` with:

```
spec-link.md            # shared workspace URL, path, and the commit it was read at
participants/self.md    # this repo's role, its tasks, its contract version
07-implementation/ 08-review/ 09-qa/   # its own cycles, its own gates
issues/                 # defects in THIS repo's code
```

**Issue routing, and it matters.** A defect in a repo's own code is a **local** issue. Anything about
the contract, the requirements, the design, or another participant is a **shared** issue in the spec
workspace, plus a bus message to the owning role. Filing a contract defect locally is how four repos
end up each working around the same problem.

### Contracts are versioned and published

`05-architecture/contracts/<boundary>/v<N>.md`:

```markdown
---
boundary: backend-api
version: 2
status: draft | published | deprecated
provider: backend
consumers: [admin, frontend, mobile]
supersedes: 1
breaking: true
compat_window: v1 honored until 2026-10-01
---
## Interface        (endpoints, types, error codes, events — exact shapes)
## Changes from v1
## Migration required, per consumer
```

Rules that hold without exception:

- **Consumers implement against `published` versions only, never a `draft`.** A draft is still moving.
- Publishing is what unblocks consumers. It is the provider's most schedule-critical act, and it does
  not require the provider's implementation to exist — that is the point.
- **A breaking change needs**: a version bump, `breaking: true`, a stated compatibility window, a
  per-consumer migration note, and an acknowledgement from every consumer in
  `participants/<repo>/contract-ack.md`.
- Every published change appends to the boundary's `CHANGELOG.md`. Never edit a published version in
  place — a consumer has already built against those exact words.
- A provider that needs to change a published contract mid-flight opens a bus message to every
  affected consumer with the default stated, exactly as protocol 5 requires.

### Awareness is pull, not push

No agent can notify another repository. A repo learns what changed by **reading the shared
workspace**, so make that cheap and routine:

- `spec-link.md` records the commit the repo last read. Comparing it against the shared workspace's
  current head is how drift is detected: "contract `v2` published, this repo targets `v1`".
- Any status check in a participating repo must report that drift. A repo silently building against a
  superseded contract is the failure mode this whole section exists to prevent.
- Optionally, a steward may open an issue or PR in each consumer repo when a contract publishes. That
  is an outward-facing action on someone else's repository: **confirm with a human first**, every
  time, and never make it automatic.

### Participants run their own cycles

Each repo runs implementation, review, and QA locally with its own conventions, commands, and track.
A participant's gates are its own. `participants/<repo>/status.md` in the shared workspace is a copy
of its roll-up so the program can be read from one place; the repo's own `state.json` remains
authoritative for that repo.

Participants proceed independently once their contract is published. Do not serialize a consumer
behind a provider's implementation — only behind its **contract**.

### The integration gate

After every participant passes its own gates, and never before, `sdlc-integration-qa` verifies what
no single repo can:

1. **Conformance, both directions.** Does the provider actually honor the published contract — every
   field, every error code, every event? And do consumers assume **only** what the contract promises,
   rather than an undocumented behavior they observed? The second direction is the one teams skip and
   the one that breaks on the next provider change.
2. **Cross-repo journeys.** The test plan's `integration` cases, run against all participants
   together.
3. **Version alignment.** Every `contract-ack.md` matches a published version, or a compat window
   covers the lag with a date that has not passed.
4. **Deploy order**, written to `deploy-order.md`. Expand-contract, always: the provider ships first
   and backward-compatible, consumers migrate, and the provider removes the old version **last**. Any
   order requiring simultaneous deployment is a finding — there is no cross-repo atomicity, so an
   ordering that assumes it will fail in production.

The program reaches `ready_to_ship` only when every participant is individually shippable by section
7a **and** the integration gate passes in the same round. A participant that regresses after
integration passed invalidates that pass, exactly as a code change invalidates a stale sign-off.
