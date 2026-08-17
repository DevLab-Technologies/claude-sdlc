# ADR-0002 — A shared spec workspace, with versioned contracts, for features spanning repositories

- **Status**: accepted
- **Date**: 2026-08-17
- **Deciders**: architecture
- **Feature**: multi-repo programs

## Context

A single feature routinely spans four repositories — backend, admin, frontend, mobile. The pipeline
was per-repo: `.sdlc/` lived in one checkout and agents only see the repo they run in. Running
`/sdlc` in each repo produces four disconnected features, four PRDs that drift, and no shared
contract — which is the coordination failure the pipeline exists to prevent, reproduced at a larger
scale.

Three things have to work: the other repos must become **aware** a feature exists, they must be able
to **implement their side** without waiting for the provider to finish, and someone must verify the
pieces actually **fit** before anything ships.

The hard constraint is that agents cannot push notifications. Whatever we build, awareness has to be
something a repo can discover by reading.

## Decision

We will separate the **shared specification** from **per-repo implementation**.

One shared workspace — by default a dedicated specs repository — holds everything written once:
intake, research, product, design, architecture, the interface contracts, and the test plan. Each
participating repository runs its own implementation, review, and QA cycle locally against a
**published, versioned contract**, and links back to the shared spec by URL and commit.

Contracts are versioned per boundary with an explicit provider, consumer list, and status
(`draft` | `published` | `deprecated`). Consumers implement against `published` versions only.
A new integration phase verifies conformance in both directions and the cross-repo journeys before
release.

## Options considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Dedicated specs repo (chosen) | Single source of truth; versioned and reviewable in PRs; no repo owns another; survives a participant being archived | One more repository to create and grant access to | chosen |
| Spec lives in the provider repo | No new repo | Backend becomes a dependency of everyone; ownership is wrong when a feature is frontend-led; consumers need read access to a repo they may not otherwise touch | rejected |
| Shared local directory outside git | Simplest to start | No history, no review, does not survive across machines or CI, and cannot be the source of truth for a distributed team | rejected — acceptable only for a spike |
| Duplicate the spec into each repo | Each repo self-contained | Four copies diverge immediately; this is the problem, not a solution | rejected |
| A service or database for coordination | Real notifications, real locking | Infrastructure to run a pipeline; contradicts ADR-0001 | rejected — revisit only if polling proves insufficient |

## Consequences

**Positive** — one PRD and one contract for the whole feature. Consumers start as soon as a contract
is published rather than when the provider finishes, which is the largest latency win available in
multi-repo work. Contract changes have a version, a consumer list, and a migration note, so a
breaking change cannot quietly ship ahead of the repos that depend on it. Each repo keeps its own
gates, cadence, and conventions.

**Negative** — the shared workspace must be reachable from every participant, which means a clone,
a submodule, or a path, and someone has to keep that access working. Awareness is **pull, not push**:
a repo learns about a contract change when it next looks. There is no cross-repo atomicity, so
ordering discipline replaces it.

**Neutral** — a feature now has two kinds of state: shared position and per-participant position.
`/sdlc-status` has to roll both up.

**Constraints created** — consumers implement against `published` contract versions only, never a
draft. A breaking change requires a version bump, `breaking: true`, a compatibility window, and an
acknowledgement from every consumer. Issues about the contract or the spec belong to the shared
workspace; issues about a repo's own code stay local. Nothing ships until the integration gate
passes, and deployment follows expand-contract: provider first and backward-compatible, consumers
migrate, provider removes the old version last.

## Reversibility

Moderate. The shared workspace is a git repository of markdown, so it can move hosts or collapse
back into a single repo cheaply. Moving to a coordination *service* would mean rewriting how every
agent reads its inputs, which is the expensive direction — and ADR-0001's reasoning applies.

## Validation

The test is a two-repo feature where the provider publishes a contract and the consumer implements
against it **before** the provider's implementation is finished, and the integration gate catches a
deliberate conformance break — a provider response that omits a field the contract promises. If the
integration gate passes that build, this design has failed at the only job it uniquely has.
