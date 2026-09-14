# Protocol — tracks and model policy

Loaded by the orchestrator only. Core protocol section 8.

## 8. Scaling to the change — do not pay standard cost for a trivial change

The full pipeline is built for a feature. Running all of it on a copy change wastes time and money
without buying quality. The orchestrator picks a `track` and records it in `state.json`:

| Track | Fits | Phases | Review lenses |
|---|---|---|---|
| `trivial` | copy, config, a constant, a dependency bump | intake -> implement -> review -> release | correctness only |
| `small` | one contained change, no new surface or data | intake, product (stories only), test-plan, implement, review, qa | correctness + the one lens the change touches |
| `standard` | a normal feature | all phases | all five |
| `large` | new subsystem, migration, or auth/payment/data-model change | all phases, `max_cycles` raised | all five, plus a second security pass |

Two rules that keep this from becoming a quality hole:
- **Escalate freely, never silently downgrade.** Any agent that finds the track too small for what
  it is seeing says so and the orchestrator re-tracks upward. Discovering a change touches auth
  means it was never `trivial`.
- **Security and data integrity never get skipped by track.** A `trivial` change to an
  authorization check, a payment path, a migration, or anything handling personal data is
  `standard` at minimum, regardless of diff size.

## 8a. Model policy — pay Opus for judgment, not for production

Track scales *how many* phases run. This scales *what each one costs*. The two are independent, and
the second is the larger lever: a standard-track feature run entirely on the strongest model spends
most of its budget on agents that were following a contract, not forming one.

The line is **whether the agent is forming a judgment nobody else will re-form.** An agent producing
an artifact that a second, independent agent then audits does not need to be the stronger model —
the audit is where the quality comes from, and that is the shape this pipeline is built in:

| Producer (cheaper) | Its independent auditor (stronger) |
|---|---|
| `sdlc-product-owner` writes the PRD and stories | `sdlc-product-critic`, `sdlc-business-analyst` |
| `sdlc-ux-designer` writes the specification | `sdlc-ux-auditor` |
| `sdlc-implementer` builds to `interfaces.md` and assigned `TC` ids | four review lenses, then QA |
| `sdlc-qa-functional` authors the plan | `sdlc-architect` and `sdlc-product-owner` review it |

So the defaults, which agent frontmatter already carries:

| Role | Default | Why |
|---|---|---|
| `sdlc-intake`, the three researchers, `sdlc-product-owner`, `sdlc-ux-designer`, `sdlc-figma-designer`, `sdlc-implementer`, `sdlc-qa-functional`, `sdlc-qa-ui` | `sonnet` | produce against a contract or a spec, and are audited |
| `sdlc-architect`, `sdlc-contract-steward`, `sdlc-debugger`, `sdlc-ux-auditor`, `sdlc-product-critic`, `sdlc-business-analyst`, the five review lenses, `sdlc-review-lead`, `sdlc-integration-qa`, `sdlc-release-gate` | `opus` | form the judgment, or are the last check before a gate |

**Two overrides the orchestrator applies, and no others:**

- **Down to `sonnet` for mechanical sub-steps**: the review lead's **verify** mode, and `sdlc-qa-ui`
  when it is only re-checking previously failed screens. Running commands and recording results is
  not judgment.
- **Up to `opus` for every producer on the `large` track.** A new subsystem, a migration, or an
  auth/payment/data-model change is where a producer's own judgment starts to matter, because the
  contract it is handed is itself new. `trivial`, `small`, and `standard` keep the defaults.

**Never downgrade an auditor.** The saving from a cheaper review lens is small and the cost is the
whole point of having the lens: it exists to find what a cheaper reading misses. If the budget is the
problem, drop the track, not the model — running fewer phases honestly beats running all of them
badly.
