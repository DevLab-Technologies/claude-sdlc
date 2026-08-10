---
description: Report the state of every SDLC feature — phase, cycle, gates, open issues, investigations, unanswered questions, and what runs next.
argument-hint: [feature slug, or blank for all]
---

Report SDLC status for: **$ARGUMENTS** (blank means every feature in `.sdlc/registry.json`).

For each feature, read `state.json`, `history/events.jsonl`, `issues/*.md`,
`11-investigations/*.md`, and `bus/*.md`, then present:

## <title> (`<slug>`)
- **Position** — phase, cycle `n` of `max_cycles`, status
- **Gates** — a single line: `intake ok | research ok | product ok | design ok | ux-audit ok | architecture ok | implementation ok | review FAILED | qa - | ui-qa - | release -`
- **Issues** — counts by severity and status; list every open blocker and major with its id,
  title, owner role, and whether it has a proven root cause
- **Investigations** — open investigations and their status; flag any issue with
  `reopened_count >= 2` that has no investigation, since that is a process violation
- **Waiting on** — unanswered blocking bus messages and unanswered human questions, quoted
- **Recent activity** — the last five events from the log, one line each
- **Next action** — the exact agent to run next, and why

Then a portfolio summary: how many features are in progress, awaiting a human, blocked, or
ready to ship — and the single thing most worth attention right now.

Read only. Change nothing. If a workspace is inconsistent — a gate marked passed with no
artifact behind it, an issue verified with no verification record, a cycle counter that does
not match the history — report the inconsistency rather than smoothing over it.
