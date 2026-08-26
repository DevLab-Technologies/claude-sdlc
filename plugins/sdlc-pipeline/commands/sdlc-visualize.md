---
description: Render a real feature's history as the Pipeline Floor visualization — a played-back replay of what actually happened, built from history/events.jsonl, not a scripted demo. Regenerate-on-demand, not live.
argument-hint: [feature slug, or blank for the one feature in this workspace]
---

Visualize the real run for: **$ARGUMENTS**

This produces a **replay**, not a live view. It reads `history/events.jsonl` once, builds an
animated timeline from what actually happened, and writes a self-contained HTML file. Re-run this
command to refresh it after more of the pipeline runs — nothing here watches the log or updates on
its own. Say this plainly in your final report; presenting a replay as live is a false signal.

## Step 0 — Resolve the target and load the engine

Invoke the `sdlc-protocol` skill; section 3 defines the event schema and `duration_ms` this whole
command is built on.

Resolve the feature slug as `/sdlc-timing` does: the given slug, or the one feature in
`.sdlc/registry.json`, or ask if there are several. This command needs a real
`history/events.jsonl` to read — if the feature has no events yet (nothing has run), say so and
stop rather than generating an empty or fabricated floor.

Read `${CLAUDE_PLUGIN_ROOT}/templates/pipeline-floor.html`. This is the exact rendering engine from
the demo prototype, already fixed for the bugs found in its review — canvas floor, gate rail,
click-to-inspect modal, duration formatting. **You are replacing its `SCRIPT` array only.**
Everything else — `DEPARTMENTS`, `DESKS`, `ROLE_TINT`, `GATES`, every CSS rule, every function —
stays byte-for-byte as shipped. Reproducing the engine from scratch instead of reusing this file is
a defect; the whole point of shipping the template is that the hard part is already built and
already reviewed.

## Step 1 — Read the real event log

Read every `phase_start` and `run_complete` line from `history/events.jsonl`, plus every
`gate_passed`, `gate_failed`, `issue_opened`, `cycle_opened`, and `cycle_closed`. Pair
`phase_start`/`run_complete` by `agent` + `phase` + `cycle`, exactly as `/sdlc-timing` does.

An unpaired `phase_start` (protocol 3a — an interrupted run) gets one of two treatments: if a later
`run_complete` for the same agent/phase/cycle exists, use that pairing and ignore the interruption;
if none exists, render that agent as **still working**, frozen at whatever the log's last state was,
and say so in your report. Do not invent a `run_complete` that never happened.

## Step 2 — Group into steps, exactly like /sdlc-timing groups for wall-clock

This is the same grouping rule `/sdlc-timing` already uses, applied here to drive the animation
instead of a report:

- Group paired runs by `phase` + `cycle`.
- Within a group, if any two runs' `[phase_start.ts, run_complete.ts]` windows overlap, they are one
  **concurrent step** — one entry in the generated `SCRIPT` array with all those agents in `desks`.
- Non-overlapping runs in the same phase/cycle are **separate sequential steps**, ordered by
  `phase_start.ts`.

For each step, set:

- `desks`: the agent ids in the group. Most real agent ids are already `sdlc-*` and map straight to
  desk ids in `DESKS`. `sdlc-implementer` is the one routine exception: `DESKS` only has per-slot
  `sdlc-implementer-a`/`-b`/`-c` entries, so assign each distinct implementer task in the group to a
  slot in first-seen order, cycling back to `-a` past three concurrent tasks and noting the collision
  in `## Gaps`. Any other agent id with no matching desk (a role added since this template shipped)
  gets skipped with a note in `## Gaps`, not silently dropped without comment.
- `state`: `"working"` if this is the still-in-progress frozen step from Step 1; `"done"` if the
  paired `run_complete` exists and no `gate_failed`/blocker `issue_opened` landed against this
  agent/phase/cycle; `"bad"` if one did.
- `real`: the actual `duration_ms` (summed across the group's individual durations is wrong here —
  use each desk's own `duration_ms`; if desks in one step have different durations because the
  group's overlap was partial, attribute each desk its own recorded value, not the group's). `real`
  has no way to represent "ran, but unrecorded" — it renders identically to `0`, which the template's
  desk modal shows as "not started yet." When `duration_ms` is genuinely missing, still set `real: 0`
  but say so in that step's `current` line (e.g. "duration unrecorded") so the replay doesn't read as
  a desk that never worked, in addition to listing it in `## Gaps`.
- `phase`: map the event's `phase` directory (`"08-review"`) to the gate name (`"review"`) the
  template's `GATES` array uses. Resolve by agent id first, phase directory second, using the
  Agent → Gate table in `sdlc.md` as the source of truth — it is what puts `sdlc-qa-ui`'s runs toward
  `"ui-qa"` rather than `"qa"` even though both may log under the same `phase` directory. `sdlc.md`
  has no entry for `sdlc-debugger` or fix-mode `sdlc-implementer`; treat those as counting toward
  whichever gate is currently contested (the most recent `gate_failed` in this cycle) — the same
  approximation the original demo's phase-bucketing already accepted; note it in `## Gaps` once, not
  per-step.
- `gate`: set only on the step containing that phase's `gate_passed`/`gate_failed` event, using the
  real event's outcome — this drives the gate-rail coloring the review fixed to actually show `bad`.
- `ticker`: build from the real event data — `["start", agentShort, "phase_start"]` /
  `["done", agentShort, "run_complete → " + (artifacts joined) ]` / `["bad", agentShort, summary]`.
  `agentShort` is the template's `WHO_TO_DESK` key, not the full agent id — strip the `sdlc-` prefix
  (`"sdlc-review-lead"` → `"review-lead"`); the three research desks use the aliases `WHO_TO_DESK`
  already defines (`research-findings`/`research-prior-art`/`research-constraints`). Getting this
  wrong breaks click-to-inspect silently: the desk's log just never receives the line. Use the
  event's own `summary` and `artifacts` fields verbatim where present. Never invent a ticker line's
  content — an empty or terse real line is more honest than a fabricated detailed one.
- `current`: one line describing the step, generated from the same data — not scripted prose.
- `signoff`: if a `## Sign-off` block's `NOT verified` line is available from the corresponding
  `history/runs/*.md` file for this step's agent, surface it here. This is the single most
  characteristic thing this pipeline does — do not skip it because it takes an extra file read.

Track `cycle` transitions from `cycle_opened`/`cycle_closed` events. The template's cycle badge is
hardcoded to two states — it starts at "1" and the first step that carries `gate: "review"` and
`state: "done"` flips it to "2"; nothing in `SCRIPT` can drive it past that. Make sure the step
carrying that cycle's own review-gate outcome is set that way so the badge at least distinguishes
cycle 1 from every cycle after it, and state the feature's real cycle count in your final report and
in `## Gaps` if it went past 2 — the badge cannot show it, so the report is where that fact has to
live.

## Step 3 — Handle skipped and never-reached phases

A `trivial`/`small` track (protocol section 8) skips phases. For a skipped gate, do not synthesize a
fake step and do not try to recolor its gate pill — the template only ever sets a pill's class from
inside `applyStep()` when a `SCRIPT` step carries that `gate`, and there is no `skipped` class or
code path for one, so reaching into that logic would mean editing the rendering code Step 4 already
forbids touching. Leave the pill in its default unlit state and call out every skipped gate by name
in `## Gaps` and in your final report instead — the honest signal here is the written note, not a
pill color the engine has no way to produce. A phase the feature simply hasn't reached yet (still in
progress) stays in that same default unlit state — the template already handles "never activated"
correctly, and a reader tells "skipped" apart from "not yet reached" only via the Gaps note, which
must say which one it is.

## Step 4 — Generate and write the file

Take the template's full content, replace only the array literal between `var SCRIPT = [` and its
closing `];`, and write the result to `.sdlc/features/<slug>/floor/pipeline-floor.html`. Build each
entry with the template's own `step(desks, opts)` helper (already defined just above `SCRIPT` in the
file) rather than a raw object literal — it supplies required defaults, including `dur` (the
animation's per-step pacing, distinct from `real`), that the fields listed in Step 2 don't cover on
their own; a raw object literal missing `dur` stalls playback.

This directory follows the same rule as `digest/` (protocol section 1): derived, human-facing, outside
the interruption-and-resume machinery in 3a — a killed session regenerates it on the next run rather
than needing recovery, and it affects no gate.

Do not edit any other part of the copied template. If the real data genuinely requires a roster
change (an agent id with no desk, from Step 2), that is the one exception — and it must be a small,
additive change (a new desk entry), never a rewrite of the layout or rendering logic.

## Step 5 — Show it

Open the generated file via the Browser preview tool, or offer to publish it as an Artifact if the
human wants a shareable link rather than a local file. Either way, state plainly in your reply:

- This is a replay ending at the last event in the log, not a live view
- The real total elapsed time and the current cycle (pull these from `/sdlc-timing`'s own numbers so
  the two commands never disagree)
- Anything from `## Gaps`: interrupted runs frozen mid-step, agent ids with no desk, phases skipped
  by track, any `duration_ms` that was missing and had to be treated as unrecorded rather than zero

## What this command will not do

It will not start a server, watch the file for changes, or auto-refresh. If the human wants that,
say plainly that it is a different, larger piece of work — the first real infrastructure this
plugin would need — and do not build it without being asked.
