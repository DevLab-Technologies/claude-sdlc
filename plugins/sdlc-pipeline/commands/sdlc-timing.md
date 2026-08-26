---
description: Report how long things actually took — per feature, per cycle, per agent, and per individual run — computed from the duration_ms every agent already records on its run_complete event. Read-only.
argument-hint: [feature slug, or blank for the program/feature in this workspace]
---

Report timing for: **$ARGUMENTS**

This is a read-only report over `history/events.jsonl`. It changes nothing, and it only reports what
the log actually contains — if an agent never recorded `duration_ms`, say so instead of guessing.

## Step 0 — Locate the log

Invoke the `sdlc-protocol` skill; section 3 defines `duration_ms` and the sum-vs-wall-clock rule
this whole report rests on — read it before computing anything.

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

For each paired run, you have: `agent`, `phase`, `cycle`, `phase_start.ts`, `run_complete.ts`, and
`duration_ms` if the agent recorded it. If `duration_ms` is missing but both timestamps exist,
compute it yourself from the timestamps and note in `## Gaps` that it was derived, not recorded —
that gap is worth surfacing to whoever owns the agent that skipped it.

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

## Step 3 — Build the four views

**Per feature.** One line: track, cycle count, and total wall-clock. If `shipped` exists, use its
`duration_ms`. If not, the feature is still in progress — report elapsed so far (now minus the
first event's `ts`) and say plainly that it is a running total, not a final number.

**Per cycle.** A row per cycle number: opened, closed (or "in progress"), duration (from
`cycle_closed.duration_ms`, or elapsed-so-far if the cycle is still open), which gates it covered,
and issues found/fixed in it. Sort newest first — the current cycle is usually what someone wants to
see first.

**Per agent, aggregated.** Group every paired run by `agent` name across the whole log: invocation
count, agent-time sum, average, min, max. **Sort by sum, descending** — the agent at the top of this
table is where the time is actually going, which is the question this view exists to answer. Note
next to any agent whose runs were mostly concurrent with siblings that its sum overstates its impact
on wall-clock (point at the phase-level view in step 2 for the real number).

**Per job.** A flat chronological table, one row per paired run: timestamp, agent, phase, cycle,
duration, and a one-line result (verdict, gate, or the artifact produced). This is the finest-grained
view — every individual invocation, in order. For a long-running feature, this can be long; show it
in full rather than truncating, since the whole point of this view is not losing an individual run in
an average.

## Step 4 — Report

Lead with the two numbers a human actually wants first: **total elapsed** and **where the time went**
(the top three rows of the per-agent view). Then the four tables from step 3, phase-level wall-clock
called out wherever it differs meaningfully from summed agent-time — that gap is usually the most
interesting number in the whole report, since it is the parallelism actually paying off.

Close with `## Gaps`: interrupted runs excluded, any `duration_ms` you had to derive rather than
read, and anything you could not compute. An empty report section here should say so explicitly —
absence of a gaps section reads as "there were no gaps," which must be true, not assumed.

Never present a derived or partial number as final without saying so. A running total mislabeled as
a final duration is worse than no number at all.
