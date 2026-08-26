# Pipeline Floor — animated status visualization, prototype

Status: **prototype for a decision, not a shipped feature.** Nothing in this directory is wired
into the plugin — it does not install as a command, is not referenced by any agent, and installing
`sdlc-pipeline` does not add it.

## What this is

A single self-contained `index.html`: a pixel-art "office floor" where desks light up as agents
work, next to a technical telemetry panel running the real event-log format (`phase_start` /
`run_complete`, gate names, severities, sign-off text). Open it in a browser — no build step, no
server.

The script it plays through is a compressed but representative pass over the real phase sequence,
including the two genuine parallel fan-outs (three research lenses, five review lenses), the phase
5/6 overlap where the test plan starts before architecture finishes, and one full defect-loop beat
through the debugger.

## What is real and what is not

- **Real**: the agent roster, department grouping, phase order, gate names, the two fan-outs, the
  5/6 overlap, the defect-loop shape, and the event-log line format.
- **Simulated**: every timestamp, duration, and specific finding. There is no connection to
  `.sdlc/features/<slug>/` — it does not read `state.json` or `history/events.jsonl`. It is a
  scripted timeline (`SCRIPT` in the JS), not a live view.

## The actual question this is meant to answer

Is the "agents in an office" visual metaphor worth the cost of wiring it to a real, live pipeline
run? That would mean:

- A local server that watches `history/events.jsonl` and `state.json` for changes and streams them
  to the page (websocket or polling) — the plugin currently needs no services or infrastructure at
  all, and this would be the first thing that does.
- Mapping every one of the ~20 agents' real states, not the ~24 scripted beats here.
- Deciding whether it lives as a plugin command (`/sdlc-watch`), a standalone dev-time tool, or
  something else entirely.

This prototype exists to let that decision get made by looking at the thing, not by imagining it.

## Removing this

If the answer is no, delete `prototypes/` — nothing else in the repository references it.
