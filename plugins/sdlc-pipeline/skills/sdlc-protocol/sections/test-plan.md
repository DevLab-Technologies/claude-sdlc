# Protocol — the test plan

Loaded by QA, the architect, the product owner, implementers, and the tests lens. Core protocol section 4a.

## 4a. The test plan — a contract written before the code

`06-test-plan/plan.md` specifies the tests **before** implementation, authored by QA independently,
reviewed by the architect (technical gaps, wrong levels) and the product owner (uncovered criteria,
wrong expectations). Only an `approved` plan unlocks implementation. An implementer deriving its own
cases tests what it built rather than what was asked.

Header: `status: draft | in_review | approved | amended`, `cycle_approved`, `cases`.
One row per case:

| id | story | ac | level | type | owner | expected | test_file | status |
|---|---|---|---|---|---|---|---|---|
| TC-014 | STORY-003 | AC-2 | unit | negative | backend | single non-enumerating error, field cleared | — | planned |

`level`: `unit` | `integration` | `e2e` | `manual` (manual needs a stated reason).
`type`: `happy` | `boundary` | `negative` | `error` | `concurrency` | `security` | `performance` |
`a11y` | `regression`. `owner`: the implementer role, or `qa`.
`status`: `planned` -> `implemented` -> `passing` | `failing` | `not_run` | `withdrawn`.

Implementers fill `test_file` with `path::test name` and reference the `TC` id in the test so
traceability survives refactors. An implementer who thinks a case is wrong buses QA — never
silently drops it or weakens its assertion.

**Amendment, never quiet editing.** New cases are appended with a reason, the header goes to
`amended`, and a `test_plan_amended` event is logged. Cases are never deleted; an invalid one is
`withdrawn` with a rationale. The authoring checklist lives in `sdlc-qa-functional`.
