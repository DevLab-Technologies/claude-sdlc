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
`--port` if that is taken). It watches `history/events.jsonl`, `state.json`, the workplan, the task
records, `bus/` and `00-intake/questions.md`, and pushes every change to the open page over SSE, so
the floor tracks the pipeline without being regenerated and without a reload. The bus and the intake
questions are watched because a pipeline that stops to ask something writes a file and emits no
event at all — without them the floor would learn it had stopped only when something else moved.

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

- **Right now** — one row per agent with an open `phase_start`, each with the task it was given and
  its own elapsed clock, counting from the timestamp that agent recorded; and above them, every
  **open question**: who asked, who owes the answer, the question itself, the file it is written in
  and how long it has been outstanding.
- **Waiting** is a state of its own, and the most important one on the page. An agent that stopped
  to ask something looks in the event log exactly like an agent thinking hard — both are a
  `phase_start` with no `run_complete` — so the floor reads the four records that do say it: an open
  `bus/` file, a `question_asked` with no `question_answered`, blocking questions in
  `00-intake/questions.md` with no `answers.md` beside them, and `state.json`'s `status`,
  `blocked_on` and `open_questions`. A waiting desk is violet with its hand up, never the working
  amber; its gate reads `blocked`, not `pending`; the header says **waiting on you**; and the time
  spent waiting is never added to the agent's worked time — it is a person's turnaround, not the
  pipeline's. A question explicitly marked `blocking: false` has a default the asker may proceed
  under, so it is listed as open without stopping its desk.
- **Board** — the workplan tasks with their status, desk, time and token cost; every gate with its
  status, run count and cost; and **up next**, the gates still ahead in the order `/sdlc` runs them
  with the desks that will run them. Up next is the one thing no event can report — the log records
  what happened, never what is scheduled — so it is derived from the phase sequence and the gate map.
- **Agents** — every desk on the floor grouped into waiting, working, stalled, done, queued and
  not-run, with runs, total time and tokens used. Waiting is listed first: it is the only group a
  reader can act on this minute.
- **Feed** — the event log as it arrives, at the times the events actually carry.
- **Gaps** — what the floor cannot show honestly on its own, grouped by kind and marked with what
  kind of limit each one is. It is the same list you report in step 2, on the page itself, so a
  reader who never sees your report still knows what the desks are and are not claiming.
- Clicking a desk opens its record: status, what it is working on, total time across all its runs,
  tokens used, and its recent log lines.
- The footer carries elapsed wall-clock, summed agent time, total tokens, and the run count. Elapsed
  and agent time are different numbers whenever anything ran concurrently — protocol section 3.

**Token figures are reported, never estimated.** They come from the `run_usage` events the
orchestrator writes when an agent returns (protocol section 3). A run with no such event reads "not
reported" on its desk, and the totals say how many runs reported at all. Never fill a blank in with
an estimate when reporting to the human.

## Step 2 — Read the gaps and report them

The builder prints the gaps grouped (and puts both shapes on `state.json`: `gaps`, the flat list,
and `gapGroups`, the same lines filed by kind). The floor's own **gaps** tab shows the same grouping,
so the page and your report never disagree. Run it once with `--json` if the server swallowed the
output:

```bash
node "${CLAUDE_PLUGIN_ROOT}/templates/build-floor.mjs" --feature <slug> --json
```

**Report the groups, not the lines.** A real feature produces well over a hundred gap lines, and a
hundred loose sentences is the same information nobody reads. Lead with the count and the kind —
"29 completions with no matching start" — and quote individual lines only where one of them matters
on its own. Each group carries a `nature`, and that is the order to work through them:

- **`unresolved`** — the log contradicts itself, and somebody can go and fix the logging. Completions
  with no start anywhere, tasks with no usable record, runs that named no task, agent ids that are
  neither a desk nor a known alias of one, `run_usage` that matched no run. These are the ones worth
  raising.
- **`derived`** — the floor inferred something, and the line says exactly how. Open runs the log
  itself closed out (a cycle ended, a gate reached a verdict without them, the agent was re-run, or
  `/sdlc-resume` reconciled the workspace afterwards — the floor calls these **stalled**, not
  working, and `/sdlc-resume` is what clears them); a run whose two halves were bracketed under
  different phase labels and paired on its own `duration_ms`; an agent id mapped onto its desk; a
  duration derived from the timestamp gap.
- **`irreducible`** — no log could ever settle it, so it is a standing caveat rather than a defect.
  A `phase_start` with nothing after it at all, and no unanswered question behind it, is shown as
  working, because from the log alone "running now" and "interrupted a moment ago" are
  indistinguishable — say which you believe it is. An open run whose agent does have an unanswered
  question is shown as waiting instead; the log cannot prove the agent is still sitting on it, only
  that the question is unanswered. A question marked non-blocking is listed without stopping its
  desk, and whether the agent really proceeded under its default is not something the log records.
  Also: runs with no recorded token usage; more than three concurrent implementer tasks sharing
  desks A/B/C; `sdlc-debugger` and fix-mode `sdlc-implementer` time attributed to the most recently
  failed gate; pipeline machinery (`sdlc-orchestrator`, `sdlc-resume`) having no desk by design; a
  gate skipped by the feature's track, whose reason lives only in your report.

## Step 3 — Say what it is

In your reply, state:

- That it is **live** while the server runs, and that it stops when the session ends
- The real elapsed wall-clock and the current cycle — take these from `state.json`'s `wallClockMs`
  and `cycle`, which are the same numbers `/sdlc-timing` reports, so the two never disagree
- Whether anything is running right now, what it is working on, and how long it has been at it
- **Whether the pipeline is waiting on anybody** — take it from `state.json`'s `waiting`: every open
  question, who owes the answer, and how long it has been open. If it is waiting on the human, say
  so first, quote the questions, and say where they are written. A floor showing a stopped pipeline
  is worth nothing if the reply buries the reason it stopped.
- What runs next
- Everything from `gapGroups` — by group and count, in nature order, as step 2 describes

## Changing the visualization

`templates/pipeline-floor.html` renders; `templates/build-floor.mjs` derives. Keep that split.

- A new agent needs a desk in `DEPARTMENTS` and `ROLE_TINT` in the HTML **and** an entry in
  `DESK_IDS`, `AGENT_GATE` and `GATE_AGENTS` in the builder. Missing any part is reported as a gap
  rather than silently dropped, so check the gaps after adding one.
- A **renamed** agent does not need a new desk — add the old id to `AGENT_ALIASES` in the builder and
  its historical runs keep appearing on the desk that succeeded it. An id that runs the pipeline
  rather than a phase of it belongs in `MACHINERY_AGENTS`, which reports it as a deliberate omission
  instead of as an agent nobody gave a desk.
- A new gap kind needs an entry in `GAP_KINDS` — a title and one of the three natures. `gaps.add()`
  without one falls back to "other", which is honest but says nothing useful in a report.
- A new phase needs an entry in `GATES` in both files, and in `PHASE_GATE` and `GATE_AGENTS` in the
  builder.
- Roster changes are additive. Do not rewrite the layout or the rendering logic.
