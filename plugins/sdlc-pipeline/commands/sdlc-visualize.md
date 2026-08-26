---
description: Show a real feature's pipeline as the live Pipeline Floor — desks, gates and cycle at their current state, updating as the pipeline runs. Built from history/events.jsonl by a deterministic script, not hand-assembled.
argument-hint: [feature slug, or blank for the one feature in this workspace]
---

Visualize the real run for: **$ARGUMENTS**

This shows the pipeline **where it actually is right now**, and keeps showing it as more of the
pipeline runs. It does not animate from the beginning — a replay of how the feature got here is a
button on the page, not the default view.

Every derivation — pairing runs, detecting concurrency, mapping agents to desks and gates, tallying
issues — is done by `${CLAUDE_PLUGIN_ROOT}/templates/build-floor.mjs`. Do not do that work yourself.
It is arithmetic over the event log, the script already does it correctly, and doing it in your head
is what used to make this command take minutes and produce inconsistent output.

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
`--port` if that is taken). It watches `history/events.jsonl` and pushes every new event to the open
page over SSE, so the floor tracks the pipeline without being regenerated and without a reload.

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
- a gate skipped by the feature's track — the floor marks its pill "skipped", but the reason it was
  skipped lives only in your report
- more than three concurrent implementer tasks sharing desks A/B/C
- `sdlc-debugger` and fix-mode `sdlc-implementer` time attributed to the most recently failed gate

## Step 3 — Say what it is

In your reply, state:

- That it is **live** while the server runs, and that it stops when the session ends
- The real elapsed wall-clock and the current cycle — take these from `state.json`'s `wallClockMs`
  and `cycle`, which are the same numbers `/sdlc-timing` reports, so the two never disagree
- Whether anything is running right now, and what
- Everything from `gaps`

Do not describe the replay button as the main view. It exists so a human can watch how the feature
got to its current state; the default and the point of the command is where it is now.

## Changing the visualization

`templates/pipeline-floor.html` renders; `templates/build-floor.mjs` derives. Keep that split.

- A new agent needs a desk in `DEPARTMENTS` and `ROLE_TINT` in the HTML **and** an entry in
  `DESK_IDS` and `AGENT_GATE` in the builder. Missing either half is reported as a gap rather than
  silently dropped, so check the gaps after adding one.
- A new phase needs an entry in `GATES` in both files and in `PHASE_GATE` in the builder.
- Roster changes are additive. Do not rewrite the layout or the rendering logic.
