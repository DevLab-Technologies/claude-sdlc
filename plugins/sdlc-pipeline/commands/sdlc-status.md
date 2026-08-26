---
description: Report the state of every SDLC feature — phase, cycle, gates, open issues, investigations, unanswered questions, and what runs next.
argument-hint: [feature slug, or blank for all]
---

Report SDLC status for: **$ARGUMENTS** (blank means every feature in `.sdlc/registry.json`).

For each feature, read `state.json`, `history/events.jsonl`, `issues/*.md`,
`11-investigations/*.md`, and `bus/*.md`, then present:

## <title> (`<slug>`)
- **Position** — phase, cycle `n` of `max_cycles`, `track`, status
- **Gates** — a single line: `intake ok | research ok | product ok | design ok | ux-audit ok | architecture ok | implementation ok | review FAILED | qa - | ui-qa - | release -`
- **Issues** — counts by severity and status; list every open blocker and major with its id,
  title, owner role, and whether it has a proven root cause
- **Investigations** — open investigations and their status; flag any issue with
  `reopened_count >= 2` that has no investigation, since that is a process violation
- **Test plan** — status (`draft`/`in_review`/`approved`/`amended`) and case counts by state. Flag
  any case still `planned` or `implemented` at QA time, and any `implemented` case whose `test_file`
  is empty — that is a claimed test with nothing behind it
- **Waiting on** — unanswered blocking bus messages and unanswered human questions, quoted
- **Recent activity** — the last five events from the log, one line each
- **Next action** — the exact agent to run next, and why
- **Elapsed** — one line: total wall-clock so far and current-cycle wall-clock, from the same
  `duration_ms` fields `/sdlc-timing` reports in full. Format both using that command's duration
  table (days/hours/minutes/seconds, milliseconds only under one second) — never print a raw
  millisecond figure. Point at `/sdlc-timing` for the per-agent and per-job breakdown rather than
  reproducing it here.
- **Interrupted runs** — any unpaired `phase_start`, or artifact lacking `status: complete`, ignoring
  `digest/` and `floor/`, since that output is derived and regenerated, not recovered. Say plainly that
  `/sdlc-resume` is needed rather than reporting the position as if the run finished

If this is a cross-repo program (`spec-link.md` or `participants.json` present), also report:

- **Participants** — role, track, and gate roll-up per repo, and which ones you could not read
- **Contracts** — per boundary: version, status, and who has acknowledged what
- **Drift** — this is the point of checking. Compare the commit in `spec-link.md` against the shared
  workspace's current head and say explicitly when a repo is building against a superseded contract, when
  a compatibility window has expired, and when an acknowledgement is missing entirely. A repo silently on
  an old contract is the failure this reporting exists to catch
- **Integration** — whether every participant is done, and whether the gate has run against the current
  participant commits or an older set

Then a portfolio summary: how many features are in progress, awaiting a human, blocked, or
ready to ship — and the single thing most worth attention right now.

Read only. Change nothing. If a workspace is inconsistent — a gate marked passed with no
artifact behind it, an issue verified with no verification record, a cycle counter that does
not match the history — report the inconsistency rather than smoothing over it.
