---
description: Report how long things actually took and what they cost — per feature, per cycle, per agent, and per individual run — computed from the duration_ms every agent records on run_complete and the tokens the orchestrator records on run_usage. Read-only.
argument-hint: [feature slug, or blank for the program/feature in this workspace]
---

Report timing for: **$ARGUMENTS**

This is a read-only report over `history/events.jsonl`. It changes nothing, and it only reports what
the log actually contains — if an agent never recorded `duration_ms`, or no `run_usage` line was
written for a run, say so instead of guessing.

Time and cost are reported together because they are the same question asked twice: a phase that is
fast because five agents ran at once is not cheap, and the only way to see that is to put the token
figure next to the wall-clock.

## Step 0 — Locate the log

Invoke the `sdlc-protocol` skill; section 3 defines `duration_ms`, the `run_usage` event, and the
sum-vs-wall-clock rule this whole report rests on — read it before computing anything.

The protocol core is all you need; read from its `sections/` directory only if the core points you at something — protocol section 0.

Resolve the target:
- A feature slug, or blank with exactly one feature in `.sdlc/registry.json` → that feature's
  `history/events.jsonl`.
- Blank with several features → list them and ask which.
- A program (`participants.json` present) → report the shared workspace's log, and offer to also
  report a named participant's local log — they are separate files with separate cycle numbering.
- A standalone run (`.sdlc/reviews/<date>-<target>/` or `.sdlc/product/<date>-<slug>/`, no feature
  behind it) → there is no feature or cycle to report on; skip straight to the per-job table for
  that one run.

## Step 1 — Pair the events

Read every `phase_start` and `run_complete` line. Pair them by matching `agent` + `phase` + `cycle`.
An unpaired `phase_start` is an interrupted run (protocol 3a) — exclude it from timing and name it
in `## Gaps`, since it has no duration, not a zero duration.

For each paired run, you have: `agent`, `phase`, `cycle`, `phase_start.ts`, `run_complete.ts`,
`task` if the run named one, and `duration_ms` if the agent recorded it. If `duration_ms` is missing
but both timestamps exist, compute it yourself from the timestamps and note in `## Gaps` that it was
derived, not recorded — that gap is worth surfacing to whoever owns the agent that skipped it.

Then attach cost. Every `run_usage` line carries `tokens`, `model`, and `task` where there is one
(protocol section 3). Match each one to a run by `agent` + `phase` + `cycle`, and where several runs
share that key — three concurrent implementers do — match on `task` first, then on the nearest
timestamp to the run's `run_complete.ts`. Same matching rule the Pipeline Floor uses, so the two
never disagree about what a run cost.

## Step 2 — The one rule that makes this report honest

**Never sum durations across agents that ran concurrently and call it elapsed time.** Group paired
runs by `phase` + `cycle`. Within a group, if any two runs' `[phase_start.ts, run_complete.ts]`
windows overlap, that group ran in parallel (or partially so). For a parallel group, report **both**
numbers, never one standing in for the other:

- **wall-clock** — `max(run_complete.ts) - min(phase_start.ts)` across the group. This is how long
  the phase actually took to wait for.
- **agent-time** — `sum(duration_ms)` across the group. This is the total work performed, and it is
  routinely 3-5x the wall-clock for a five-lens review fan-out. It answers "how much did this cost,"
  not "how long did we wait."

For a group with one agent, the two numbers are the same — report one.

## Step 2a — Format every duration for humans, not machines

`duration_ms` is the stored, sortable, summable source of truth — keep computing with it. But never
print a raw millisecond figure in the report. Convert every duration you display with this rule,
applied to the single value being shown (a sum, a wall-clock gap, an average — each formatted on its
own terms, not the raw feature-total scale applied to a five-second job):

| Magnitude | Format | Example |
|---|---|---|
| < 1 second | milliseconds | `840ms` |
| < 1 minute | seconds, rounded | `47s` |
| < 1 hour | minutes, plus seconds if any | `6m`, `6m 12s` |
| < 1 day | hours, plus minutes if any | `2h`, `2h 15m` |
| ≥ 1 day | days, plus hours if any | `1d`, `1d 6h` |

At most two units, largest first, and drop the second unit when it is zero — `1h`, not `1h 0m`. This
is a display rule only: sort tables, compute sums and averages, and compare against `max_cycles` or
anything else using the raw `duration_ms`, and format only at the moment a number is written into the
report.

## Step 2b — Cost is reported, never estimated

Tokens sum cleanly where durations do not: concurrency changes how long you waited, never what the
work cost. So a phase's token total is always the plain sum of its runs, parallel or not — the one
number in this report that needs no wall-clock counterpart.

What it does need is honesty about coverage:

- A run with no matching `run_usage` line is **not reported**, not zero. Never infer a figure from a
  sibling run, a model default, or a duration — a token count is not derivable from elapsed time.
- Every table carrying a token column also carries how many of its runs reported at all
  (`412k across 6 of 7 runs`). A total that silently covers half the runs is worse than no total.
- If no run in the whole log carries usage, say so once, drop the token columns entirely, and report
  timing alone. Do not print a table of dashes.

Format token counts the way the floor does — `840` under a thousand, `41k` and `4.1k` in thousands,
`1.20M` in millions — and keep the raw integers for sorting and summing. Match that spelling exactly:
the point of this section is that a figure on the page and the same figure in this report read
identically.

## Step 3 — Build the four views

**Per feature.** One line: track, cycle count, and total wall-clock. If `shipped` exists, use its
`duration_ms`. If not, the feature is still in progress — report elapsed so far (now minus the
first event's `ts`) and say plainly that it is a running total, not a final number.

**Per cycle.** A row per cycle number: opened, closed (or "in progress"), duration (from
`cycle_closed.duration_ms`, or elapsed-so-far if the cycle is still open), tokens spent in it, which
gates it covered, and issues found/fixed in it. Sort newest first — the current cycle is usually what
someone wants to see first. A second cycle's token cost against the issues it closed is the sharpest
number this report produces: it is what a failed gate actually cost to recover from.

**Per agent, aggregated.** Group every paired run by `agent` name across the whole log: invocation
count, agent-time sum, average, min, max, tokens summed, and the model(s) its runs report. **Sort by
agent-time sum, descending** — the agent at the top of this table is where the time is going, which
is the question this view exists to answer. Then say explicitly whether the token column ranks the
same agents in the same order: where it does not, the cheapest agent to wait for is not the cheapest
agent to run, and that is the finding. Note next to any agent whose runs were mostly concurrent with
siblings that its time sum overstates its impact on wall-clock (point at the phase-level view in
step 2 for the real number) — its token sum carries no such caveat.

**Per job.** A flat chronological table, one row per paired run: timestamp, agent, phase, cycle,
`task` where there is one, duration, tokens, model, and a one-line result (verdict, gate, or the
artifact produced). This is the finest-grained
view — every individual invocation, in order. For a long-running feature, this can be long; show it
in full rather than truncating, since the whole point of this view is not losing an individual run in
an average.

## Step 4 — Report

Lead with the three numbers a human actually wants first: **total elapsed**, **total tokens** (with
the reported-run coverage next to it), and **where the time and the money went** — the top three rows
of the per-agent view by each measure. Then the four tables from step 3, phase-level wall-clock
called out wherever it differs meaningfully from summed agent-time — that gap is usually the most
interesting number in the whole report, since it is the parallelism actually paying off, and the
token total is what that parallelism cost to buy.

Close with `## Gaps`: interrupted runs excluded, any `duration_ms` you had to derive rather than
read, every run with no `run_usage` line behind it, any `run_usage` line that matched no run, and
anything you could not compute. An empty report section here should say so explicitly —
absence of a gaps section reads as "there were no gaps," which must be true, not assumed.

Never present a derived or partial number as final without saying so. A running total mislabeled as
a final duration is worse than no number at all, and an estimated token count is worse still — a
duration can at least be re-derived from the timestamps, where an invented cost cannot be checked
against anything.
