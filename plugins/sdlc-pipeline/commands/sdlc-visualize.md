---
description: Show a real feature's pipeline as the live Pipeline Floor — who has finished, who is working and on what, how long the running task has taken, what runs next, and what each agent cost. Built from history/events.jsonl and the workspace by a deterministic script, not hand-assembled.
argument-hint: [feature slug, or blank for the one feature in this workspace]
---

Visualize the real run for: **$ARGUMENTS**

`/sdlc`, `/sdlc-bug` and `/sdlc-resume` already start this floor at setup, so a pipeline started in
this session is normally on screen before you get here. Use this command to open the floor for a
feature nobody started in this session, to re-open one after the server was stopped, or to write a
static snapshot to keep.

The floor shows the pipeline **where it actually is right now**, and keeps showing it as more of the
pipeline runs. It does not animate, pace, pause or rewind — there is one view, and it is the truth
at this instant.

Every derivation — pairing runs, detecting concurrency, mapping agents to desks and gates, reading
the workplan, tallying issues and tokens — is done by
`${CLAUDE_PLUGIN_ROOT}/templates/build-floor.mjs`. Do not do that work yourself. It is arithmetic
over the event log and the workspace, the script already does it correctly, and doing it in your
head is what used to make this command take minutes and produce inconsistent output.

## Step 0 — Resolve the target

Resolve the feature slug as `/sdlc-timing` does: the given slug, the one feature in
`.sdlc/registry.json`, or ask if there are several. The builder resolves it the same way, so you can
usually just pass `--feature` through — or omit it entirely for a single-feature workspace.

This command needs a real `history/events.jsonl`. If the feature has no events yet, the builder says
so and renders an empty floor with that stated on it; report that plainly and stop rather than
implying there is something to look at.

## Step 1 — Start the live floor

```bash
node "${CLAUDE_PLUGIN_ROOT}/templates/build-floor.mjs" --feature <slug> --serve
```

Run it in the background — it stays up. It prints the URL (default `http://localhost:4317`; pass
`--port` if that is taken). It watches `history/events.jsonl`, `state.json`, the workplan and the
task records, and pushes every change to the open page over SSE, so the floor tracks the pipeline
without being regenerated and without a reload.

Then open that URL with the Browser preview tool.

The page is live for as long as the server runs. Say that explicitly, and say that closing the
session stops it — a page that has silently stopped updating while still looking live is a false
signal, which is why the page itself flips its header to a disconnected state rather than freezing
on the last good frame.

**Static snapshot instead.** Drop `--serve` and the builder writes
`.sdlc/features/<slug>/floor/{pipeline-floor.html,state.json}` and exits. Use this when the human
wants a file to keep or share rather than a live view. It shows the same current state, but it stops
there — re-run the command to refresh it. `floor/` follows the same rule as `digest/` (protocol
section 1): derived, human-facing, outside the interruption-and-resume machinery in 3a, and it
affects no gate.

## What the floor shows

The desks are the live picture; the panel is the record.

- **Working right now** — one row per agent with an open `phase_start`, each with the task it was
  given and its own elapsed clock, counting from the timestamp that agent recorded.
- **Board** — the workplan tasks with their status, desk, time and token cost; every gate with its
  status, run count and cost; and **up next**, the gates still ahead in the order `/sdlc` runs them
  with the desks that will run them. Up next is the one thing no event can report — the log records
  what happened, never what is scheduled — so it is derived from the phase sequence and the gate map.
- **Agents** — every desk on the floor grouped into working, done, queued and not-run, with runs,
  total time and tokens used.
- **Feed** — the event log as it arrives, at the times the events actually carry.
- Clicking a desk opens its record: status, what it is working on, total time across all its runs,
  tokens used, and its recent log lines.
- The footer carries elapsed wall-clock, summed agent time, total tokens, and the run count. Elapsed
  and agent time are different numbers whenever anything ran concurrently — protocol section 3.

**Token figures are reported, never estimated.** They come from the `run_usage` events the
orchestrator writes when an agent returns (protocol section 3). A run with no such event reads "not
reported" on its desk, and the totals say how many runs reported at all. Never fill a blank in with
an estimate when reporting to the human.

## Step 2 — Read the gaps and report them

The builder prints a `gaps` list (and puts the same list on `state.json`). Run it once with `--json`
if the server swallowed the output:

```bash
node "${CLAUDE_PLUGIN_ROOT}/templates/build-floor.mjs" --feature <slug> --json
```

Every gap is something the visualization cannot show honestly on its own, so it has to live in your
written report. Expect any of:

- a `phase_start` with no `run_complete` — the desk shows as still working, and from the log alone
  "running now" and "interrupted" are indistinguishable; say which you believe it is
- an agent id with no desk on the floor, whose runs are therefore not drawn
- a `run_complete` with no `duration_ms`, where the timestamp gap was used instead
- completed runs with no recorded token usage, and `run_usage` events that matched no run
- implementer runs that named no `task`, which the board therefore cannot attribute
- a task record with no workplan entry behind it
- a gate skipped by the feature's track — the floor marks its pill "skipped", but the reason it was
  skipped lives only in your report
- more than three concurrent implementer tasks sharing desks A/B/C
- `sdlc-debugger` and fix-mode `sdlc-implementer` time attributed to the most recently failed gate

## Step 3 — Say what it is

In your reply, state:

- That it is **live** while the server runs, and that it stops when the session ends
- The real elapsed wall-clock and the current cycle — take these from `state.json`'s `wallClockMs`
  and `cycle`, which are the same numbers `/sdlc-timing` reports, so the two never disagree
- Whether anything is running right now, what it is working on, and how long it has been at it
- What runs next
- Everything from `gaps`

## Changing the visualization

`templates/pipeline-floor.html` renders; `templates/build-floor.mjs` derives. Keep that split.

- A new agent needs a desk in `DEPARTMENTS` and `ROLE_TINT` in the HTML **and** an entry in
  `DESK_IDS`, `AGENT_GATE` and `GATE_AGENTS` in the builder. Missing any part is reported as a gap
  rather than silently dropped, so check the gaps after adding one.
- A new phase needs an entry in `GATES` in both files, and in `PHASE_GATE` and `GATE_AGENTS` in the
  builder.
- Roster changes are additive. Do not rewrite the layout or the rendering logic.
