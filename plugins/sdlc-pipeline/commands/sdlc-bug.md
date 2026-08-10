---
description: Investigate and fix a reported defect through the root-cause path — reproduce, diagnose, fix the cause, add a regression test, verify, and sweep the blast radius.
argument-hint: <the bug report, error message, or stack trace>
---

Handle this defect:

**$ARGUMENTS**

This is the bug entry point into the SDLC pipeline. It skips the product and design phases
but keeps every verification gate — a fix is a change, and unverified changes are how one
defect becomes two.

## Procedure

1. Invoke the `sdlc-protocol` skill.

2. **Locate or create the workspace.** If the defect belongs to an existing feature, work
   inside that `.sdlc/features/<slug>/` and open a new cycle. If it is standalone, create
   `.sdlc/features/bug-<slug>/` with the same layout and `brief.md` holding the report
   verbatim — including the exact error text, never a paraphrase.

3. **Open the issue first.** Write `issues/ISSUE-<NNN>.md` with everything the reporter
   gave you and an honest severity. If the report is too vague to act on, list precisely
   what you need — what they did, what they expected, what happened, when it started, how
   often — and ask before burning effort on a guess.

4. **Triage per protocol 4a.** Unless the cause is already visible with a `path:line` and a
   stated mechanism, this goes to `sdlc-debugger` before anyone touches code. Crashes,
   data corruption, security findings, regressions, and anything intermittent always go to
   the debugger.

5. **Investigate.** Launch `sdlc-debugger`. Wait for `11-investigations/INV-<NNN>.md` with
   `status: root_cause_found`. Do not accept a hypothesis as a cause — the investigation
   must show the defect switching on and off with the cause, the detection gap, and the
   blast radius.
   - If it comes back `not_reproduced`, report that plainly with what was ruled out, and
     ask the human for the missing conditions rather than fixing something at random.
   - If it comes back `not_a_defect`, explain why the observed behavior is correct and
     close the issue.

6. **Decide the fix owner.** Architectural root cause -> `sdlc-architect` amends the
   contract and records an ADR first. Otherwise -> `sdlc-implementer` in fix mode, fixing
   the **root cause**, adding the regression test the investigation specified, and clearing
   every blast-radius site as its own linked issue.

7. **Verify.** `sdlc-code-reviewer` reviews the fix; `sdlc-qa-functional` runs the
   investigation's reproduction steps plus the regression test, and re-runs the surrounding
   cases for regressions; `sdlc-qa-ui` if the defect was user-facing. The issue reaches
   `verified` only when the regression test exists, fails without the fix, and passes with it.

8. **Close the loop.** `sdlc-release-gate` confirms the criteria, then record in the
   investigation what the detection gap was and what changed so this class of defect is
   caught next time — a test, a type, a validation, an assertion, or an alert. A fix that
   leaves the detection gap open is incomplete.

Report to the human: the root cause in one sentence, the fix, the regression test, other
sites found, any data that needs repair, and what now prevents recurrence.
