#!/usr/bin/env node
/*
 * build-floor.mjs — turn a feature's real history/events.jsonl into the Pipeline
 * Floor's live state, and optionally serve it so the floor tracks the pipeline
 * as it runs.
 *
 * This is the deterministic half of /sdlc-visualize. Pairing runs, detecting
 * concurrency, bucketing to gates and mapping agent ids to desks is arithmetic,
 * not judgement — doing it here instead of in the model's head is what makes the
 * command fast and repeatable.
 *
 *   node build-floor.mjs --feature <slug>              write floor/state.json once
 *   node build-floor.mjs --feature <slug> --serve      serve + push updates live
 *   node build-floor.mjs --serve                       serve every feature: a home
 *                                                      screen listing them, each
 *                                                      opening its own floor
 *
 * Zero dependencies. Node 18+.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ============================================================
   ROSTER — must stay in step with pipeline-floor.html's DESKS
   and GATES. A desk id here with no counterpart there renders
   nothing; the mismatch is reported as a gap rather than
   silently dropped.
   ============================================================ */

const GATES = ["intake", "research", "product", "design", "figma-design", "ux-audit",
  "architecture", "test-plan", "implementation", "review", "qa", "ui-qa", "release"];

const DESK_IDS = new Set([
  "sdlc-intake",
  "sdlc-researcher-findings", "sdlc-researcher-prior-art", "sdlc-researcher-constraints",
  "sdlc-product-owner", "sdlc-business-analyst", "sdlc-product-critic",
  "sdlc-ux-designer", "sdlc-figma-designer", "sdlc-ux-auditor",
  "sdlc-architect", "sdlc-qa-functional",
  "sdlc-implementer-a", "sdlc-implementer-b", "sdlc-implementer-c",
  "sdlc-review-lead", "sdlc-code-reviewer", "sdlc-review-security",
  "sdlc-review-performance", "sdlc-review-tests",
  "sdlc-debugger", "sdlc-qa-ui", "sdlc-release-gate",
]);

// Agent id -> gate. Source of truth is the Agent → Gate table in commands/sdlc.md.
// Resolved by agent first because sdlc-qa-ui and sdlc-qa-functional can log under
// the same phase directory while counting toward different gates.
//
// Null-prototype, like AGENT_ALIASES and for the same reason: the key is an
// agent id or a phase directory straight out of the log. A plain literal answers
// `valueOf` or `constructor` with an inherited function, which is truthy, so it
// walks past every `if (!gate)` guard and lands in gateStatus as a key no gate
// rail can read — taking the real outcome with it.
const AGENT_GATE = Object.assign(Object.create(null), {
  "sdlc-intake": "intake",
  "sdlc-researcher-findings": "research",
  "sdlc-researcher-prior-art": "research",
  "sdlc-researcher-constraints": "research",
  "sdlc-product-owner": "product",
  "sdlc-business-analyst": "product",
  "sdlc-product-critic": "product",
  "sdlc-ux-designer": "design",
  "sdlc-figma-designer": "figma-design",
  "sdlc-ux-auditor": "ux-audit",
  "sdlc-architect": "architecture",
  "sdlc-implementer": "implementation",
  "sdlc-review-lead": "review",
  "sdlc-code-reviewer": "review",
  "sdlc-review-security": "review",
  "sdlc-review-performance": "review",
  "sdlc-review-tests": "review",
  "sdlc-qa-ui": "ui-qa",
  "sdlc-release-gate": "release",
});

// Phase directory -> gate, the fallback when the agent id is unknown or
// context-dependent (sdlc-qa-functional plans in phase 6 and executes in phase 9).
const PHASE_GATE = Object.assign(Object.create(null), {
  "00-intake": "intake", "01-research": "research", "02-product": "product",
  "03-design": "design", "03b-figma": "figma-design", "04-ux-audit": "ux-audit",
  "05-architecture": "architecture", "06-test-plan": "test-plan",
  "07-implementation": "implementation", "08-review": "review",
  "09-qa": "qa", "10-ui-qa": "ui-qa", "11-release": "release",
});

// Which desks a gate is expected to occupy. This is the only place the floor can
// learn what has NOT happened yet: the event log records what ran, never what is
// still to come, so "up next" is read off the phase sequence in commands/sdlc.md.
const GATE_AGENTS = {
  "intake": ["sdlc-intake"],
  "research": ["sdlc-researcher-findings", "sdlc-researcher-prior-art", "sdlc-researcher-constraints"],
  "product": ["sdlc-product-owner", "sdlc-business-analyst", "sdlc-product-critic"],
  "design": ["sdlc-ux-designer"],
  "figma-design": ["sdlc-figma-designer"],
  "ux-audit": ["sdlc-ux-auditor"],
  "architecture": ["sdlc-architect"],
  "test-plan": ["sdlc-qa-functional"],
  "implementation": ["sdlc-implementer-a", "sdlc-implementer-b", "sdlc-implementer-c"],
  "review": ["sdlc-review-lead", "sdlc-code-reviewer", "sdlc-review-security",
    "sdlc-review-performance", "sdlc-review-tests"],
  "qa": ["sdlc-qa-functional"],
  "ui-qa": ["sdlc-qa-ui"],
  "release": ["sdlc-release-gate"],
};

// Desks nothing schedules. The debugger runs only when triage sends it a defect,
// so a feature that never fails a gate never runs one — showing its desk as
// "queued" would assert a run that nothing is going to launch.
const ON_DEMAND_DESKS = new Set(["sdlc-debugger"]);

// Agents with no fixed gate — they run against whichever gate is currently
// contested. Resolved at grouping time from the most recent gate_failed.
const FLOATING_AGENTS = new Set(["sdlc-debugger", "sdlc-implementer"]);

/* ============================================================
   AGENT IDS — what the log wrote, mapped to what the floor has
   ============================================================ */

// An id in the log is not always a roster id, and every mismatch used to cost a
// whole desk: the runs were dropped from the floor, their time vanished from it
// while still counting in /sdlc-timing, and the only trace was a gap line. Three
// shapes recur, and the first two are mechanical:
//
//   sdlc-implementer-TASK-020   a per-task instance id — the work is IN the id
//   sdlc-debugger-INV-002       the same shape, per investigation
//   sdlc-review-correctness     an earlier name for a desk that still exists
//   sdlc-orchestrator           pipeline machinery that never had a desk
//
// Instance ids and old names are normalised to the roster id at read time, so
// pairing, tokens, the task board and the desks all see one id per agent.
// Machinery is not a defect in the log and never will be, so it is reported as a
// deliberate omission rather than as an unknown agent nobody can act on.
// Null-prototype: the id comes from the log, and a plain literal answers to
// `constructor`, `toString` and `valueOf` with an inherited function, which was
// then written back onto the event as its agent and carried into the desk
// lookups, the roster keys and the state the floor renders.
const AGENT_ALIASES = Object.assign(Object.create(null), {
  "sdlc-research-internal": "sdlc-researcher-findings",
  "sdlc-research-findings": "sdlc-researcher-findings",
  "sdlc-research-external": "sdlc-researcher-prior-art",
  "sdlc-research-prior-art": "sdlc-researcher-prior-art",
  "sdlc-research-constraints": "sdlc-researcher-constraints",
  "sdlc-review-correctness": "sdlc-code-reviewer",
  "sdlc-reviewer-correctness": "sdlc-code-reviewer",
  "sdlc-ux-audit": "sdlc-ux-auditor",
  "sdlc-qa-func": "sdlc-qa-functional",
});

// Machinery: it runs the pipeline rather than a phase of it. Omitted from the
// floor by design, which is a different statement from "this agent is unknown".
const MACHINERY_AGENTS = new Set(["sdlc-orchestrator", "sdlc-resume"]);

// A run the floor actually draws. Machinery has no desk by design, and the
// omission has to hold everywhere the floor speaks for itself: an orchestrator
// bracket with no run_complete — it keeps none — would otherwise leave the
// header reading "1 agent working" for the life of the feature, pointing at a
// desk nobody can see and no stall rule can ever close.
function isDrawn(run) { return !MACHINERY_AGENTS.has(run.agent); }

// The subset that RECONCILES the workspace. Machinery is not the same claim:
// the orchestrator launching the next phase settles nothing, and treating its
// bracket as a recovery marked every live desk stalled behind it.
const RECOVERY_AGENTS = new Set(["sdlc-resume"]);

// -> { agent, task, alias }. `task` is set only when the id carried one, and
// `alias` only when the id was rewritten — both so the gap can say so.
function normaliseAgent(raw) {
  const id = String(raw || "").trim();
  if (!id) return { agent: id, task: null, alias: null };
  // The `-a`/`-b`/`-c` desk suffixes are not instance ids, so the prefix is
  // required rather than matching any trailing token. Protocol section 3 names
  // both shapes together — an implementer given TASK-003, a debugger given
  // INV-002 — so both desks are matched here or the debugger's runs are dropped.
  const m = id.match(/^(sdlc-implementer|sdlc-debugger)-((?:TASK|ISSUE|INV)-[A-Za-z0-9.]+)$/i);
  if (m) return { agent: m[1].toLowerCase(), task: m[2].toUpperCase(), alias: id };
  if (AGENT_ALIASES[id]) return { agent: AGENT_ALIASES[id], task: null, alias: id };
  return { agent: id, task: null, alias: null };
}

/* ============================================================
   GAPS — what the floor cannot show, recorded in kinds
   ============================================================ */

// A real feature produces a lot of these: one per unpaired run, per orphan
// completion, per unattributed task. A flat list of 142 sentences is not a
// disclosure anybody reads — it is a wall that hides the two lines in it that
// matter. Every gap is therefore filed under a kind and a nature, so the same
// facts can be reported as "29 completions with no matching start" with the
// detail underneath, and so the standing caveats are told apart from the
// logging defects somebody could go and fix.
//
//   derived      the floor inferred something, and the line says exactly how
//   unresolved   the log contradicts itself; the remedy is to fix the logging
//   irreducible  no log could ever answer this — it is a permanent caveat
const GAP_KINDS = {
  "log-unreadable":    { nature: "unresolved",  title: "event log lines that could not be read" },
  "log-empty":         { nature: "irreducible", title: "the log is empty" },
  "open-run-live":     { nature: "irreducible", title: "open runs shown as working" },
  "open-run-settled":  { nature: "derived",     title: "open runs the log itself closed out" },
  "orphan-complete":   { nature: "unresolved",  title: "completions with no matching start" },
  "cross-label-pair":  { nature: "derived",     title: "runs bracketed under two different labels" },
  "derived-duration":  { nature: "derived",     title: "durations derived from timestamps" },
  "agent-alias":       { nature: "derived",     title: "agent ids mapped onto a desk" },
  "agent-machinery":   { nature: "irreducible", title: "pipeline machinery, which has no desk" },
  "agent-no-desk":     { nature: "unresolved",  title: "agent ids with no desk on this floor" },
  "desk-shared":       { nature: "irreducible", title: "desks showing merged logs" },
  "gate-attributed":   { nature: "irreducible", title: "time attributed to a gate by approximation" },
  "gate-skipped":      { nature: "irreducible", title: "gates skipped by this feature's track" },
  "gate-unmapped":     { nature: "unresolved",  title: "gate outcomes that map to no gate" },
  "cycle-rail":        { nature: "irreducible", title: "what the gate rail covers" },
  "tokens-missing":    { nature: "irreducible", title: "runs with no token usage recorded" },
  "tokens-unmatched":  { nature: "unresolved",  title: "run_usage events that matched no run" },
  "task-no-workplan":  { nature: "derived",     title: "tasks shown from the record alone" },
  "task-unrecorded":   { nature: "unresolved",  title: "tasks with no usable record behind them" },
  "task-unattributed": { nature: "unresolved",  title: "runs that named no task" },
  "task-unplaceable":  { nature: "unresolved",  title: "runs naming a task the board has no row for" },
  "state-unreadable":  { nature: "unresolved",  title: "state.json could not be read" },
  "waiting-human":     { nature: "derived",     title: "questions read as answered" },
  "waiting-agent":     { nature: "irreducible", title: "open questions that do not stop a desk" },
  "waiting-addressee": { nature: "derived",     title: "questions whose addressee had to be read as a person" },
  "waiting-pairing":   { nature: "unresolved",  title: "answers matched to a question by order alone" },
  "bus-unreadable":    { nature: "unresolved",  title: "bus files that could not be read" },
  "other":             { nature: "unresolved",  title: "other" },
};

// Defects first: they are the ones somebody can act on. Standing caveats last.
const NATURE_ORDER = ["unresolved", "derived", "irreducible"];

function createGaps() {
  const entries = [];
  const g = {
    add(kind, text) {
      const meta = GAP_KINDS[kind] || GAP_KINDS.other;
      entries.push({ kind, nature: meta.nature, text });
      return g;
    },
    // Legacy shape. Callers that have nothing better to say still land in a kind.
    push(text) { return g.add("other", text); },
    get length() { return entries.length; },
    lines() { return entries.map((e) => e.text); },
    groups() {
      const byKind = new Map();
      for (const e of entries) {
        if (!byKind.has(e.kind)) byKind.set(e.kind, []);
        byKind.get(e.kind).push(e.text);
      }
      return Array.from(byKind, ([kind, lines]) => {
        const meta = GAP_KINDS[kind] || GAP_KINDS.other;
        return { kind, title: meta.title, nature: meta.nature, count: lines.length, lines };
      }).sort((a, b) =>
        NATURE_ORDER.indexOf(a.nature) - NATURE_ORDER.indexOf(b.nature) || b.count - a.count);
    },
  };
  return g;
}

/* ============================================================
   ARGS
   ============================================================ */

function parseArgs(argv) {
  const out = { serve: false, port: 4317, open: false, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--feature" || a === "-f") out.feature = argv[++i];
    else if (a === "--serve") out.serve = true;
    else if (a === "--port") {
      const raw = argv[++i];
      const n = Number(raw);
      // listen() throws ERR_SOCKET_BAD_PORT synchronously on a bad value, which
      // server.on("error") cannot catch — validate here so it fails like every
      // other bad input.
      if (!Number.isInteger(n) || n < 0 || n > 65535) fail(`--port needs an integer 0-65535, got '${raw ?? ""}'`);
      out.port = n;
    }
    else if (a === "--root") out.root = path.resolve(argv[++i]);
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function resolveFeature(root, given) {
  const featuresDir = path.join(root, ".sdlc", "features");
  if (given) {
    const dir = path.join(featuresDir, given);
    if (!fs.existsSync(dir)) fail(`no feature '${given}' under ${featuresDir}`);
    return given;
  }
  // The same list the home screen shows, minus the entries with nothing to
  // render: a registered slug whose workspace was never created cannot be the
  // one feature here, and offering it as a choice sends the caller to a 404.
  const slugs = listFeatures(root).filter((f) => f.hasWorkspace).map((f) => f.slug);
  if (slugs.length === 1) return slugs[0];
  if (!slugs.length) fail(`no features found under ${featuresDir}`);
  fail(`several features found — pass --feature <slug>. Available: ${slugs.join(", ")}`);
}

function fail(msg) {
  process.stderr.write(`build-floor: ${msg}\n`);
  process.exit(1);
}

/* ============================================================
   READ — events.jsonl, leniently
   ============================================================ */

function readEvents(logPath, gaps) {
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, "utf8").split("\n");
  const events = [];
  const aliasNoted = new Set();
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const e = JSON.parse(trimmed);
      e._line = i + 1;
      e._t = Date.parse(e.ts);
      if (Number.isNaN(e._t)) {
        gaps.add("log-unreadable", `events.jsonl line ${i + 1}: unparseable ts '${e.ts}' — event ignored.`);
        return;
      }
      // Once, here, so pairing, token matching, the task board and the desks can
      // never disagree about who an event belongs to.
      const norm = normaliseAgent(e.agent);
      if (norm.alias) {
        e._alias = norm.alias;
        e.agent = norm.agent;
        // A per-task instance id carries the task the run was given. Reading it
        // off the id is what lets the board attribute runs that named no `task`.
        if (norm.task && !e.task) e.task = norm.task;
        if (!aliasNoted.has(norm.alias)) {
          aliasNoted.add(norm.alias);
          gaps.add("agent-alias", `agent id '${norm.alias}' is not a roster id — read as '${norm.agent}'` +
            (norm.task ? ` working on ${norm.task}` : "") + `, so its runs appear on that desk rather than being dropped.`);
        }
      }
      events.push(e);
    } catch {
      gaps.add("log-unreadable", `events.jsonl line ${i + 1}: not valid JSON — line ignored.`);
    }
  });
  // The log is append-only and should already be chronological; sorting defends
  // against concurrent agents appending a hair out of order.
  events.sort((a, b) => a._t - b._t || a._line - b._line);
  return events;
}

/* ============================================================
   PAIR — phase_start with run_complete
   ============================================================ */

function pairRuns(events, gaps) {
  const open = new Map();          // key -> [phase_start, ...] in arrival order
  const runs = [];
  const orphans = [];              // run_complete with no start under its own key
  const key = (e) => `${e.agent} ${e.phase} ${e.cycle ?? 1}`;

  for (const e of events) {
    if (e.event === "phase_start") {
      const k = key(e);
      if (!open.has(k)) open.set(k, []);
      open.get(k).push(e);
    } else if (e.event === "run_complete") {
      const k = key(e);
      const queue = open.get(k);
      if (queue && queue.length) {
        // Several starts can be open under one key at once: sdlc-implementer runs
        // one instance per workplan task, all logging the same agent/phase/cycle.
        // Pair on duration_ms — the start whose timestamp is closest to
        // (complete.ts - duration_ms) is the run that actually finished. Closing
        // the earliest open start unconditionally would mis-attribute every
        // concurrent fan-out and read the others as interrupted.
        let idx = 0;
        if (typeof e.duration_ms === "number") {
          const target = e._t - e.duration_ms;
          let best = Infinity;
          queue.forEach((st, i) => {
            const d = Math.abs(st._t - target);
            if (d < best) { best = d; idx = i; }
          });
        }
        const start = queue.splice(idx, 1)[0];
        runs.push(makeRun(start, e, gaps));
      } else {
        // Held, not rendered yet: the start it belongs to may have been written
        // under a different label, and the pass below is what finds it.
        orphans.push(e);
      }
    }
  }

  // Second pass — the two halves of one run, bracketed under different labels.
  //
  // A phase_start and its run_complete do not always agree on the phase. An
  // agent that plans in one phase and executes in another (qa-functional), one
  // resumed under a different mode, a debugger that opened under the issue it
  // was chasing and closed under the phase it fixed — each writes the bracket
  // under two keys. The first pass then sees two separate faults: a run that was
  // never closed, and a completion out of nowhere. They are one run, and the
  // floor was reporting that desk as still working days later while drawing a
  // zero-length step for the same work beside it.
  //
  // Pair only on the completion's own duration_ms. That number is the agent's
  // measurement of when it began; landing on a start it never named is evidence,
  // not a guess. Without it there is nothing to test against, so the halves stay
  // apart and both are reported.
  const taken = new Set();
  const stillOpen = [];
  for (const [, queue] of open) for (const st of queue) stillOpen.push(st);
  stillOpen.sort((a, b) => a._t - b._t);

  const stillOrphan = [];
  for (const c of orphans) {
    if (typeof c.duration_ms !== "number") { stillOrphan.push(c); continue; }
    const target = c._t - c.duration_ms;
    // Generous on long runs, tight on short ones: an agent writes both stamps
    // itself, so the only spread is the write, not the work.
    const tolerance = Math.max(60000, c.duration_ms * 0.05);
    let best = null, bestD = Infinity;
    for (const st of stillOpen) {
      if (taken.has(st)) continue;
      if (st.agent !== c.agent) continue;
      if ((st.cycle ?? 1) !== (c.cycle ?? 1)) continue;
      if (st.phase === c.phase) continue;      // same key — the first pass owns it
      if (st._t > c._t) continue;
      // Two halves of one run name one task. Where both name one and they
      // differ, the arithmetic lining up is a coincidence, not evidence.
      if (st.task && c.task && st.task !== c.task) continue;
      const d = Math.abs(st._t - target);
      if (d < bestD) { bestD = d; best = st; }
    }
    if (best && bestD <= tolerance) {
      taken.add(best);
      gaps.add("cross-label-pair", `${c.agent} (cycle ${c.cycle ?? 1}): phase_start under '${best.phase}' and run_complete under '${c.phase}' — paired as one run because the completion's own duration_ms lands on that start (within ${Math.round(bestD / 1000)}s). The desk is neither shown as still working nor drawn twice.`);
      const paired = makeRun(best, c, gaps);
      // The run keeps the phase its start named, so the other label survives for
      // anything matching on phase — the usage events, in practice.
      paired.altPhase = c.phase;
      runs.push(paired);
    } else {
      stillOrphan.push(c);
    }
  }

  for (const c of stillOrphan) {
    // run_complete with no start anywhere — render it as an instant, and say so.
    gaps.add("orphan-complete", `${c.agent} in ${c.phase} (cycle ${c.cycle ?? 1}): run_complete with no matching phase_start — rendered as a zero-length step.`);
    runs.push(makeRun({ ...c, _t: c._t - (c.duration_ms || 0) }, c, gaps));
  }

  // Anything still open is a run with no run_complete under any label. Whether it
  // is live or interrupted is decided by classifyOpenRuns below, which can often
  // tell from what the rest of the log did afterwards.
  for (const start of stillOpen) {
    if (taken.has(start)) continue;
    runs.push(makeRun(start, null, gaps));
  }

  runs.sort((a, b) => a.start - b.start);
  return runs;
}

function makeRun(start, complete, gaps) {
  const agent = start.agent || complete?.agent;
  const phase = start.phase || complete?.phase;
  const cycle = start.cycle ?? complete?.cycle ?? 1;
  let duration = complete?.duration_ms;
  let durationRecorded = typeof duration === "number";
  if (!durationRecorded && complete) {
    // Fall back to the timestamp gap rather than dropping the desk to zero, which
    // the floor's modal renders as "not started yet" — a false statement about a
    // desk that demonstrably ran.
    duration = complete._t - start._t;
    gaps.add("derived-duration", `${agent} in ${phase} (cycle ${cycle}): run_complete carried no duration_ms — derived ${duration}ms from the timestamp gap.`);
  }
  return {
    agent, phase, cycle,
    start: start._t,
    end: complete ? complete._t : null,
    running: !complete,
    durationMs: durationRecorded ? duration : (complete ? duration : null),
    durationRecorded,
    summary: complete?.summary || "",
    artifacts: Array.isArray(complete?.artifacts) ? complete.artifacts : [],
    verdict: complete?.verdict || "",
    // What this run is actually working on. Implementers carry a TASK id; every
    // other agent carries whatever the orchestrator wrote, or nothing.
    task: start.task || complete?.task || null,
    // Token cost. An agent cannot see its own usage, so this normally arrives on
    // a separate run_usage event the orchestrator writes (protocol 3). null means
    // "not reported" and is rendered as exactly that — never estimated.
    tokens: typeof complete?.tokens === "number" ? complete.tokens : null,
    model: complete?.model || start.model || null,
  };
}

/* ============================================================
   CLASSIFY — running now, or interrupted and never closed
   ============================================================ */

// An unpaired phase_start is either an agent working this second or a run whose
// session died (protocol 3a). Rendering every one as "working" is how a floor
// ends up claiming sixteen concurrent agents, four of them for days.
//
// The log cannot say directly, but four times it says so by implication:
//
//   1. the run belongs to a cycle older than the current one — opening the next
//      cycle closed that one, and nothing in a closed cycle is still working;
//   2. a gate outcome for the run's own phase and cycle was recorded after it
//      started — the phase reached a verdict without it;
//   3. the same unit of work — the same task id — was started again under that
//      agent, phase and cycle. Per protocol 3a that is what happens TO an
//      interrupted run, and the re-run is the bracket that counts. The named
//      task is what makes it evidence: a whole parallel fan-out shares one
//      agent, one phase and one cycle between its members (see pairRuns), so
//      where no task is named a later start is just as likely to be a colleague
//      still working alongside this one;
//   4. /sdlc-resume ran after it started — reconciling the workspace is the act
//      of settling everything left open before it, so a run the resume record
//      covers is finished business whatever its own bracket says.
//
// Rules 3 and 4 are why a floor could show a dozen desks working: the pipeline
// had already dealt with every one of them, in the log, in a way the first two
// rules do not look at.
//
// Anything no rule catches is treated as live, which is the only safe default:
// calling a working agent dead would hide the thing the floor exists to show.
// Live is not the same as working: buildWaiting runs next and demotes every live
// run whose agent has an unanswered question to waiting, which is the difference
// between a desk somebody has to come back to and a desk getting on with it.
function classifyOpenRuns(runs, events, currentCycle, gaps) {
  const gateEvents = events.filter((e) => e.event === "gate_passed" || e.event === "gate_failed");
  // Recovery runs, in time order. The first one after an open start settles it.
  const recoveries = events.filter((e) => e.event === "phase_start" && RECOVERY_AGENTS.has(e.agent));
  // Every phase_start, by the key a re-run would reuse — with the task it named,
  // because that key is also what a whole parallel fan-out shares. Three
  // implementers running concurrently write one agent, one phase and one cycle
  // between them (see pairRuns), and none of them need name a task, so a later
  // start is a re-run only where both brackets name the SAME one. Matching two
  // absent tasks to each other read a live fan-out as each member re-running the
  // last — every desk but one stalled while all of them were working. Where
  // neither names a task the log genuinely cannot tell the two apart: rules 1
  // and 2 still catch most of those, and what is left is disclosed as the
  // coin-toss it is rather than guessed at.
  const startsByKey = new Map();
  for (const e of events) {
    if (e.event !== "phase_start") continue;
    const k = `${e.agent} ${e.phase} ${e.cycle ?? 1}`;
    if (!startsByKey.has(k)) startsByKey.set(k, []);
    startsByKey.get(k).push({ t: e._t, task: e.task || null });
  }
  const stalled = [];
  for (const r of runs) {
    if (!r.running) continue;
    const cycle = r.cycle ?? 1;
    let why = null;
    if (cycle < currentCycle) {
      why = `cycle ${cycle} closed while it was still open`;
    } else {
      const g = gateEvents.find((e) => e.phase === r.phase && (e.cycle ?? 1) === cycle && e._t > r.start);
      if (g) why = `the ${r.phase} gate was recorded ${g.event === "gate_failed" ? "failed" : "passed"} while it was still open`;
    }
    if (!why) {
      const again = r.task && (startsByKey.get(`${r.agent} ${r.phase} ${cycle}`) || [])
        .some((st) => st.t > r.start && st.task === r.task);
      if (again) why = `${r.task} was started again in ${r.phase} in this cycle, which is how an interrupted run is re-run`;
    }
    if (!why) {
      const rec = recoveries.find((e) => e._t > r.start);
      if (rec) why = `${rec.agent} reconciled this workspace afterwards, which settles every run left open before it`;
    }
    if (why) {
      r.stalled = true;
      r.stalledWhy = why;
      // Give it no span at all. We know it stopped; we do not know when, and an
      // open-ended run stretches to now — which pulled every later run in the
      // same phase and cycle into one step that never ends, reporting runs hours
      // apart as concurrent. `running` stays true, so no duration is counted and
      // no run_complete is invented.
      r.end = r.start;
      stalled.push(r);
    }
  }
  for (const r of stalled) {
    gaps.add("open-run-settled", `${r.agent} in ${r.phase} (cycle ${r.cycle ?? 1}): phase_start with no run_complete, and ${r.stalledWhy} — shown as stalled, not working. Its time is not counted.`);
  }
  return stalled.length;
}

/* ============================================================
   GROUP — phase+cycle, then split into concurrent clusters
   ============================================================ */

function groupRuns(runs, now) {
  const byGroup = new Map();
  for (const r of runs) {
    const k = `${r.phase} ${r.cycle}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(r);
  }

  const steps = [];
  for (const [, group] of byGroup) {
    group.sort((a, b) => a.start - b.start);
    let cluster = [];
    let clusterEnd = -Infinity;
    for (const r of group) {
      const rEnd = r.end ?? now;
      if (cluster.length && r.start < clusterEnd) {
        // Overlaps the cluster's span — same concurrent step.
        cluster.push(r);
        clusterEnd = Math.max(clusterEnd, rEnd);
      } else {
        if (cluster.length) steps.push(cluster);
        cluster = [r];
        clusterEnd = rEnd;
      }
    }
    if (cluster.length) steps.push(cluster);
  }

  steps.sort((a, b) => Math.min(...a.map((r) => r.start)) - Math.min(...b.map((r) => r.start)));
  return steps;
}

/* ============================================================
   SIGN-OFF — the "NOT verified" line out of history/runs/*.md
   ============================================================ */

function loadSignoffs(runsDir) {
  const byAgent = new Map();       // agent -> [{ts, notVerified}]
  if (!fs.existsSync(runsDir)) return byAgent;
  for (const name of fs.readdirSync(runsDir)) {
    if (!name.endsWith(".md")) continue;
    const m = name.match(/^(.+?)-(sdlc-.+)\.md$/);
    if (!m) continue;
    // Run files are named from the same id the events carry, aliases included,
    // so normalise here too or a renamed agent's caveat never finds its desk.
    const agent = normaliseAgent(m[2]).agent;
    let text;
    try { text = fs.readFileSync(path.join(runsDir, name), "utf8"); } catch { continue; }
    const block = text.match(/##\s*Sign-off([\s\S]*?)(?=\n##\s|\s*$)/i);
    if (!block) continue;
    const line = block[1].split("\n").map((l) => l.trim())
      .find((l) => /NOT verified/i.test(l));
    if (!line) continue;
    if (!byAgent.has(agent)) byAgent.set(agent, []);
    // The card already prints a "NOT verified —" label, and agents write the line
    // as "NOT verified: I did not run make test". Keeping both renders the words
    // twice in a row, which reads as a rendering fault rather than a caveat.
    const caveat = line
      .replace(/^[-*]\s*/, "")
      .replace(/^\**\s*NOT\s+verified\**\s*[:\u2014-]?\s*/i, "");
    // A line that was nothing but the label leaves nothing to say after it.
    // Falling back to the original text would print the label twice — the very
    // thing the strip above exists to prevent.
    byAgent.get(agent).push({ ts: Date.parse(m[1].replace(/-/g, ":").replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")) || 0, text: caveat || "no detail given" });
  }
  for (const list of byAgent.values()) list.sort((a, b) => a.ts - b.ts);
  return byAgent;
}

/* ============================================================
   BUILD — the whole state object the floor renders
   ============================================================ */

function buildState(root, slug) {
  const featureDir = path.join(root, ".sdlc", "features", slug);
  const logPath = path.join(featureDir, "history", "events.jsonl");
  const runsDir = path.join(featureDir, "history", "runs");
  const gaps = createGaps();
  const now = Date.now();

  const events = readEvents(logPath, gaps);
  if (!events.length) {
    // Through `gaps`, not around it: anything readEvents already filed — an
    // unreadable line, a bad timestamp — is why the log looks empty, and the
    // CLI prints from the groups.
    gaps.add("log-empty", `no events in ${logPath} — nothing has run yet.`);
    return { slug, ...readFeatureMeta(root, slug), empty: true, generatedAt: now,
      gaps: gaps.lines(),
      gapGroups: gaps.groups(),
      steps: [], desks: {}, plan: [], upNext: [], roster: [], tasks: [], nowRunning: [],
      gateStatus: {}, skippedGates: [], gates: GATES, stalled: 0, blocked: 0, blockedDesks: 0,
      waiting: { waiting: false, blocking: false, onHuman: false, humanCount: 0,
        blockingCount: 0, count: 0,
        status: null, blockedOn: null, openQuestions: null, items: [], byAgent: {} },
      tokens: { total: 0, reportedRuns: 0, totalRuns: 0 } };
  }

  const issueMeta = loadIssueMeta(featureDir);
  const runs = pairRuns(events, gaps);
  // The current cycle is needed before the steps are built: it decides which
  // open runs are live and which the pipeline left behind.
  const cycles = Math.max(1, ...events.map((e) => e.cycle ?? 1));
  const stalledCount = classifyOpenRuns(runs, events, cycles, gaps);
  // Before anything is drawn: which of the runs still open are open because an
  // agent asked a question and stopped. A blocked run is not a working one, and
  // every tally below — the header, the desks, the roster, the elapsed clocks —
  // reads that flag rather than deciding for itself.
  const waiting = buildWaiting(featureDir, events, gaps);
  const blockedCount = markBlockedRuns(runs, waiting);
  discloseOpenRuns(runs, gaps);
  attachTokens(runs, events, gaps);
  const clusters = groupRuns(runs, now);
  const signoffs = loadSignoffs(runsDir);
  const signoffTaken = new Map();   // agent -> Set of consumed indices
  const SIGNOFF_SLACK_MS = 5 * 60 * 1000;

  // Gate events, keyed by phase+cycle so a step can claim the one that belongs to it.
  const gateEvents = events.filter((e) => e.event === "gate_passed" || e.event === "gate_failed");
  const issueEvents = events.filter((e) => e.event === "issue_opened");
  const cycleOpened = events.filter((e) => e.event === "cycle_opened");
  const cycleClosed = events.filter((e) => e.event === "cycle_closed");
  const shipped = events.find((e) => e.event === "shipped");

  // Implementer desk slots are assigned per cycle, first-seen order, so the same
  // task keeps the same desk across the steps it spans.
  const implSlots = new Map();     // `${cycle} ${taskKey}` -> desk id
  const slotNames = ["sdlc-implementer-a", "sdlc-implementer-b", "sdlc-implementer-c"];
  let slotCollisionNoted = false;
  let unknownAgentsNoted = new Set();
  let floatingNoted = false;

  function deskFor(run, cycleSlotCounter) {
    if (run.agent === "sdlc-implementer") {
      const taskKey = `${run.cycle} ${run.phase} ${run.start}`;
      if (!implSlots.has(taskKey)) {
        const used = cycleSlotCounter.n++;
        if (used >= slotNames.length && !slotCollisionNoted) {
          gaps.add("desk-shared", `a step ran more than ${slotNames.length} implementer tasks concurrently — the extra tasks share desks A/B/C, so those desks show merged logs.`);
          slotCollisionNoted = true;
        }
        implSlots.set(taskKey, slotNames[used % slotNames.length]);
      }
      return implSlots.get(taskKey);
    }
    if (DESK_IDS.has(run.agent)) return run.agent;
    // Machinery has no desk by design. Filing it under "unknown agent" invited
    // somebody to go looking for a desk that was never meant to exist.
    if (MACHINERY_AGENTS.has(run.agent)) {
      if (!unknownAgentsNoted.has(run.agent)) {
        gaps.add("agent-machinery", `'${run.agent}' runs the pipeline rather than a phase of it, so it has no desk on this floor by design — its runs are omitted here and still counted in /sdlc-timing.`);
        unknownAgentsNoted.add(run.agent);
      }
      return null;
    }
    if (!unknownAgentsNoted.has(run.agent)) {
      gaps.add("agent-no-desk", `agent '${run.agent}' has no desk on this floor and is not a known alias of one — its runs are omitted from the visualization (they still count in /sdlc-timing). Add it to DESK_IDS, or to AGENT_ALIASES if it is another name for a desk that exists.`);
      unknownAgentsNoted.add(run.agent);
    }
    return null;
  }

  function gateFor(run) {
    if (FLOATING_AGENTS.has(run.agent) && run.agent !== "sdlc-implementer") {
      // Count toward whichever gate was most recently failed before this run.
      const contested = gateEvents.filter((g) => g.event === "gate_failed" && g._t <= run.start).pop();
      if (!floatingNoted) {
        gaps.add("gate-attributed", `sdlc-debugger has no fixed gate — its time is attributed to the most recently failed gate, an approximation. Fix-mode sdlc-implementer is not separable from ordinary implementation in the log, so its time counts toward the implementation gate.`);
        floatingNoted = true;
      }
      if (contested) return PHASE_GATE[contested.phase] || AGENT_GATE[contested.agent] || null;
    }
    return AGENT_GATE[run.agent] || PHASE_GATE[run.phase] || null;
  }

  const steps = [];
  const claimedGates = new Set();

  // A gate event belongs to the LAST cluster of its phase and cycle that started
  // at or before it — the run that recorded the outcome. Scanning clusters in
  // start order and letting the first match claim the gate put a phase's verdict
  // on its earliest step and left the step that actually failed carrying none.
  const gateByCluster = new Map();
  const clusterStart = clusters.map((c) => Math.min(...c.map((r) => r.start)));
  for (const g of gateEvents) {
    let best = -1;
    clusters.forEach((cluster, i) => {
      if ((cluster[0].cycle ?? 1) !== (g.cycle ?? 1)) return;
      if (cluster[0].phase !== g.phase) return;
      if (clusterStart[i] > g._t) return;
      if (best === -1 || clusterStart[i] >= clusterStart[best]) best = i;
    });
    // One gate marker per step. A second outcome for the same step is left
    // unclaimed so the pass below renders it as its own beat rather than
    // silently dropping it.
    if (best === -1 || gateByCluster.has(best)) continue;
    gateByCluster.set(best, g);
    claimedGates.add(`${g.phase} ${g.cycle ?? 1} ${g._line}`);
  }

  clusters.forEach((cluster, idx) => {
    const cycle = cluster[0].cycle;
    // One counter per step: desks A/B/C only collide when tasks are genuinely
    // concurrent. Sequential implementer runs each start again at A, and the
    // memo in implSlots keeps a given task on its desk wherever it is read.
    const counter = { n: 0 };

    const startedAt = Math.min(...cluster.map((r) => r.start));
    const endedAtRaw = cluster.every((r) => r.end != null) ? Math.max(...cluster.map((r) => r.end)) : null;
    const live = cluster.some((r) => r.running && !r.stalled);
    // Open, and open for a reason somebody has to act on. A step where every
    // live run is waiting on an answer must not wear the working look — that is
    // exactly the desk this floor was drawing as busy while nothing moved.
    const working = cluster.some((r) => r.running && !r.stalled && !r.blocked);
    const blockedRuns = cluster.filter((r) => r.blocked);

    const desks = [];
    const real = {};
    for (const run of cluster) {
      const desk = deskFor(run, counter);
      if (!desk) continue;
      // Memoised on the run itself: the roster, the task board and the token
      // tallies all need the same answer, and deskFor's slot counter cannot be
      // replayed a second time without handing out different desks.
      run._desk = desk;
      if (!desks.includes(desk)) desks.push(desk);
      const ms = run.running ? null : (run.durationMs ?? 0);
      // A desk hit twice in one step (implementer slot collision) accrues both.
      real[desk] = (real[desk] || 0) + (ms ?? 0);
    }
    if (!desks.length) return;   // whole cluster was off-roster; already reported

    const gate = gateFor(cluster[0]);
    const gateEvent = gateByCluster.get(idx) || null;

    // Upper bound of this step's own window, stretched to cover the gate event it
    // carries — a gate is normally logged a few seconds after the last run ends.
    const windowEnd = Math.max(endedAtRaw ?? now, gateEvent ? gateEvent._t : 0);

    // A blocker opened inside this step's window turns it bad. Matching on
    // phase and cycle alone, with no time bound, painted every step in a phase
    // red for a defect raised after some of them had already finished cleanly.
    const blocker = issueEvents.find((e) => (e.cycle ?? 1) === cycle && e.phase === cluster[0].phase
      && e._t >= startedAt && e._t <= windowEnd
      && severityOf(e, issueIdsOf(e)[0] || null, issueMeta) === "blocker");

    let state;
    if (working) state = "working";
    else if (live && blockedRuns.length) state = "blocked";
    else if (gateEvent?.event === "gate_failed" || blocker) state = "bad";
    else state = "done";

    const ticker = [];
    for (const run of cluster) {
      const who = shortName(run.agent, deskFor(run, counter));
      if (!who) continue;
      // The fourth element is the event's own epoch ms. The feed renders that,
      // not the clock at render time — a replay of last week's run must read
      // back last week's timestamps.
      ticker.push(["start", who, "phase_start", run.start]);
      if (!run.running) {
        // A review synthesis can name thirty issue files. Listing them all turns
        // one feed line into a paragraph and buries the summary that follows it;
        // the artifacts are on disk, and the count is what a reader needs here.
        const tail = run.artifacts.length ? " → " + summariseArtifacts(run.artifacts) : "";
        const kind = (gateEvent?.event === "gate_failed" || blocker) ? "bad" : "done";
        const cost = typeof run.tokens === "number" ? ` · ${fmtTokens(run.tokens)} tokens` : "";
        ticker.push([kind, who, "run_complete" + (run.task ? ` (${run.task})` : "") + tail +
          (run.summary ? " — " + run.summary : "") + cost, run.end]);
      }
    }
    if (gateEvent) {
      const who = shortName(gateEvent.agent, gateEvent.agent);
      if (who) ticker.push([gateEvent.event === "gate_failed" ? "bad" : "done", who,
        gateEvent.event + (gateEvent.summary ? " — " + gateEvent.summary : ""), gateEvent._t]);
    }

    // Sign-off: the run file whose own timestamp falls inside this run's window.
    // Indexing by agent and consuming in step order pinned a later cycle's caveat
    // to that agent's earliest step, and left the run that wrote it showing none.
    let signoff = null;
    for (const run of cluster) {
      const list = signoffs.get(run.agent);
      if (!list || !list.length) continue;
      const lo = run.start - SIGNOFF_SLACK_MS;
      const hi = (run.end ?? now) + SIGNOFF_SLACK_MS;
      const taken = signoffTaken.get(run.agent) || new Set();
      // ts 0 means the filename timestamp did not parse; such an entry keeps the
      // old first-come behaviour rather than being dropped entirely.
      const i = list.findIndex((entry, j) => !taken.has(j) &&
        (entry.ts === 0 || (entry.ts >= lo && entry.ts <= hi)));
      if (i === -1) continue;
      signoff = list[i].text;
      taken.add(i);
      signoffTaken.set(run.agent, taken);
      break;
    }

    const names = cluster.map((r) => shortName(r.agent, deskFor(r, counter))).filter(Boolean);
    // "duration unrecorded" is about a run_complete that omitted duration_ms —
    // a logging slip in the agent. A stalled run has no duration for a different
    // reason, with a different remedy (/sdlc-resume), so it gets its own note.
    const unrecorded = cluster.filter((r) => r._desk && !r.stalled && r.durationRecorded === false).length;
    const stalledHere = cluster.filter((r) => r.stalled).length;
    steps.push({
      id: idx,
      desks, real, state, phase: gate, cycle,
      gate: gateEvent ? gate : null,
      gateState: gateEvent ? (gateEvent.event === "gate_failed" ? "bad" : "done") : null,
      ticker, signoff, live,
      // Who the step is waiting on, in the words the caption and the desk cards
      // both use. Empty on every step that is not waiting.
      blockedOn: blockedRuns.length ? blockedRuns[0].blockedOn : null,
      blockedWhy: blockedRuns.length ? blockedRuns[0].blockedWhy : null,
      blockedSince: blockedRuns.length ? blockedRuns[0].blockedSince : null,
      // Snapshot past the gate event this step carries, so a step that failed a
      // gate shows the blocker it opened rather than the count from a second earlier.
      issuesAt: tallyAt(events, windowEnd, issueMeta),
      startedAt, endedAt: endedAtRaw,
      caption: (live && blockedRuns.length && !working)
        ? `${names.join(", ")} — waiting on ${blockedRuns[0].blockedOn} in ${cluster[0].phase}: ${blockedRuns[0].blockedWhy}`
        : live
        ? `${names.join(", ")} — working now in ${cluster[0].phase}.`
        : (cluster.length > 1
          ? `${cluster.length} agents ran concurrently in ${cluster[0].phase}.`
          : `${names[0]} in ${cluster[0].phase}.`)
          + (stalledHere ? " (never closed)" : "")
          + (unrecorded ? " (duration unrecorded)" : ""),
    });
  });

  // Gate events whose phase never produced a step (a gate recorded without any
  // paired run) still need to light their pill.
  for (const g of gateEvents) {
    const k = `${g.phase} ${g.cycle ?? 1} ${g._line}`;
    if (claimedGates.has(k)) continue;
    const gate = PHASE_GATE[g.phase] || AGENT_GATE[g.agent];
    if (!gate) continue;
    steps.push({
      id: steps.length, desks: [], real: {},
      state: g.event === "gate_failed" ? "bad" : "done",
      phase: gate, cycle: g.cycle ?? 1, gate,
      gateState: g.event === "gate_failed" ? "bad" : "done",
      ticker: [[g.event === "gate_failed" ? "bad" : "done", shortName(g.agent, g.agent) || "gate",
        g.event + (g.summary ? " — " + g.summary : ""), g._t]],
      signoff: null, live: false,
      issuesAt: tallyAt(events, g._t, issueMeta),
      startedAt: g._t, endedAt: g._t,
      caption: `${gate} gate ${g.event === "gate_failed" ? "failed" : "passed"}.`,
    });
  }
  steps.sort((a, b) => a.startedAt - b.startedAt);
  steps.forEach((s, i) => { s.id = i; });

  // Skipped gates — recorded in state.json by the pipeline, not derivable here.
  const skipped = readSkippedGates(featureDir, gaps);
  for (const g of skipped) {
    gaps.add("gate-skipped", `gate '${g}' was skipped by this feature's track — the floor marks its pill "skipped".`);
  }

  const firstTs = events[0]._t;
  const lastTs = events[events.length - 1]._t;
  // Stalled runs are not running, whatever their missing run_complete implies.
  // Counting them here is what kept a header reading "pipeline running" on a
  // feature whose last real activity was days earlier.
  // Waiting is not running. A floor that counts a blocked desk as running keeps
  // the header green and the clock moving over a pipeline that stopped.
  const anyRunning = runs.some((r) => isDrawn(r) && r.running && !r.stalled && !r.blocked);
  if (cycles > 2) {
    gaps.add("cycle-rail", `this feature reached cycle ${cycles}; the floor's cycle badge shows the real number, but the gate rail only reflects the latest cycle's outcomes.`);
  }

  // state.json is the pipeline's own record of what is still open; the event
  // ledger is the only source for how many were verified.
  const derivedIssues = tallyAt(events, Infinity, issueMeta);
  const stateIssues = readStateIssues(featureDir);
  const issues = stateIssues
    ? {
        blocker: typeof stateIssues.blocker === "number" ? stateIssues.blocker : derivedIssues.blocker,
        major: typeof stateIssues.major === "number" ? stateIssues.major : derivedIssues.major,
        verified: derivedIssues.verified,
      }
    : derivedIssues;

  const sumAgentMs = runs.reduce((acc, r) => acc + (r.durationMs || 0), 0);
  // Never negative: a log whose newest event is stamped ahead of this machine's
  // clock would otherwise report a negative elapsed time. The log's own span is
  // the floor under it — that much demonstrably happened.
  const wallClockMs = (shipped?.duration_ms)
    ?? (Math.max(anyRunning ? Date.now() : lastTs, lastTs) - firstTs);

  // Gate status: state.json's map, overruled by any outcome the log recorded in
  // the current cycle. state.json is the pipeline's claim about the gates; the
  // log is what happened to them, and the log wins — an agent appends
  // gate_failed before it updates state.json, and a session that dies between
  // the two would otherwise leave the board reporting the stale "passed" while
  // the gate rail beside it paints the same gate red.
  //
  // Only the current cycle's events overrule: opening cycle n+1 resets gates to
  // pending in state.json, and an outcome from a closed cycle is not a claim
  // about this one.
  // A gate outcome whose phase and agent are both off the map lights no pill and
  // sets no status. Passing over it in silence is the one thing this floor must
  // not do: the record would show a gate that never reached a verdict, which is
  // a different claim from the one the log actually makes. Collected here and
  // named once per phase — this loop sees every gate event, including the ones
  // the step pass above skipped for the same reason.
  const unmapped = new Map();
  const gateStatus = readStateGates(featureDir);
  for (const g of gateEvents) {
    const gate = PHASE_GATE[g.phase] || AGENT_GATE[g.agent];
    if (!gate) {
      const k = `${g.phase}\u0000${g.agent}`;
      const seen = unmapped.get(k) || { phase: g.phase, agent: g.agent, n: 0 };
      seen.n++;
      unmapped.set(k, seen);
      continue;
    }
    if ((g.cycle ?? 1) !== cycles) {
      if (!gateStatus[gate]) gateStatus[gate] = g.event === "gate_failed" ? "failed" : "passed";
      continue;
    }
    gateStatus[gate] = g.event === "gate_failed" ? "failed" : "passed";
  }
  for (const u of unmapped.values()) {
    gaps.add("gate-unmapped", `${u.n} gate outcome(s) recorded by '${u.agent}' under phase '${u.phase}', which maps to no gate on this floor — no pill is lit and no gate status is set, so that verdict is missing from the rail entirely. Add the phase to PHASE_GATE, or the agent to AGENT_GATE.`);
  }
  skipped.forEach((g) => { gateStatus[g] = "skipped"; });

  const tasks = loadTasks(featureDir, gaps);
  attachTaskRuns(tasks, runs, gaps);
  const roster = buildRoster(runs, gateStatus, now, waiting);
  const { plan, upNext } = buildPlan(gateStatus, runs, skipped, waiting);
  const nowRunning = buildNow(runs, now);
  const nowBlocked = buildBlockedNow(runs, now);
  // Desks, not open runs: the commonest stuck pipeline is an agent that asked,
  // finished its run and stopped, which leaves nothing open to count.
  const blockedDesks = roster.filter((r) => r.status === "blocked").length;

  // Both halves of the coverage ratio count completed runs, and the total sums
  // the same set. A run_usage written for a run whose run_complete has not landed
  // — or never will, because it was interrupted — would otherwise be counted in
  // the numerator only, printing a ratio like "7 of 6 runs reported".
  const doneRuns = runs.filter((r) => !r.running);
  const tokenRuns = doneRuns.filter((r) => typeof r.tokens === "number");
  const tokens = {
    total: tokenRuns.reduce((a, r) => a + r.tokens, 0),
    reportedRuns: tokenRuns.length,
    totalRuns: doneRuns.length,
  };

  return {
    slug,
    // Title, kind, status, phase and track — the pipeline's own words for what
    // this run is, read off the registry and state.json. The floor puts the
    // title in its header and the home screen files the run under its kind.
    ...readFeatureMeta(root, slug),
    empty: false,
    generatedAt: Date.now(),
    firstEventTs: firstTs,
    lastEventTs: lastTs,
    running: anyRunning,
    shipped: !!shipped,
    cycle: cycles,
    cyclesClosed: cycleClosed.length,
    cyclesOpened: cycleOpened.length,
    wallClockMs,
    sumAgentMs,
    issues,
    tokens,
    stalled: stalledCount,
    blocked: blockedCount,
    blockedDesks,
    waiting,
    gates: GATES,
    skippedGates: skipped,
    gateStatus,
    plan,
    upNext,
    roster,
    tasks,
    nowRunning,
    nowBlocked,
    steps,
    // Both shapes of the same record: the flat list every existing reader
    // expects, and the same lines filed by kind and nature so a report can lead
    // with "29 completions with no matching start" instead of 29 sentences.
    gaps: gaps.lines(),
    gapGroups: gaps.groups(),
  };
}

// Wall-clock for a step: concurrent desks waited once, together, so the group's
// elapsed time is its longest desk, never the sum.
function stepRealMs(real) {
  const vals = Object.keys(real).map((k) => real[k] || 0);
  return vals.length ? Math.max(...vals) : 0;
}

// First few paths, then a count. Three is enough to see which phase directory the
// run wrote into, which is all the feed is being asked.
function summariseArtifacts(list) {
  if (list.length <= 3) return list.join(", ");
  return list.slice(0, 3).join(", ") + ` + ${list.length - 3} more`;
}

// Same thousands form the floor's own panels use, so a feed line and a desk row
// never disagree about what a run cost.
function fmtTokens(n) {
  if (typeof n !== "number") return "?";
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + "k";
  return (n / 1000000).toFixed(2) + "M";
}

// The issue ledger as it stood at a moment in time. Counting per-step deltas
// instead would leave an issue opened in cycle 1 and verified in cycle 3 reading
// as still open for the rest of the replay.
function tallyAt(events, untilTs, issueMeta) {
  const ledger = new Map();        // issue id -> {severity, status}
  for (const e of events) {
    if (e._t > untilTs) break;
    if (!/^issue_/.test(e.event || "")) continue;
    const ids = issueIdsOf(e);
    // An issue event that names no id at all still happened; key it by position
    // so it is counted once rather than dropped. It can never be closed by a
    // later event, which is why issueIdsOf works so hard to find a real id.
    const list = ids.length ? ids : [`${e.phase}:${e.cycle ?? 1}:${e._line}`];
    for (const id of list) {
      const prev = ledger.get(id);
      const severity = (prev && prev.severity) || severityOf(e, ids.length ? id : null, issueMeta);
      if (e.event === "issue_opened" || e.event === "issue_reopened") {
        ledger.set(id, { severity, status: "open" });
      } else if (e.event === "issue_fixed") {
        ledger.set(id, { severity, status: "fixed" });
      } else if (e.event === "issue_verified") {
        ledger.set(id, { severity, status: "verified" });
      }
    }
  }
  const out = { blocker: 0, major: 0, verified: 0 };
  for (const v of ledger.values()) {
    if (v.status === "verified") out.verified++;
    else if (v.status === "open") out[v.severity === "blocker" ? "blocker" : "major"]++;
  }
  return out;
}

// Issue severity lives in the issues/ISSUE-<NNN>.md frontmatter (protocol 4),
// never on the event, so it has to be read from disk to be known at all.
function loadIssueMeta(featureDir) {
  const dir = path.join(featureDir, "issues");
  const meta = new Map();
  if (!fs.existsSync(dir)) return meta;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    let text;
    try { text = fs.readFileSync(path.join(dir, name), "utf8"); } catch { continue; }
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    const id = (fm[1].match(/^id:\s*(\S+)/m) || [])[1] || name.replace(/\.md$/, "");
    meta.set(id, {
      severity: (fm[1].match(/^severity:\s*(\w+)/m) || [])[1] || null,
      status: (fm[1].match(/^status:\s*(\w+)/m) || [])[1] || null,
    });
  }
  return meta;
}

// The protocol defines no id field on issue_opened/issue_fixed/issue_verified,
// so recover the id from the text agents do write. Without this an opened issue
// is keyed positionally and no later fix event can ever match it, leaving the
// same issue counted as both open and verified.
function issueIdsOf(e) {
  if (Array.isArray(e.issues_opened) && e.issues_opened.length) return e.issues_opened;
  if (e.issue) return [e.issue];
  const text = [e.summary || "", ...(Array.isArray(e.artifacts) ? e.artifacts : [])].join(" ");
  const found = text.match(/\bISSUE-\d+\b/g);
  return found ? Array.from(new Set(found)) : [];
}

function severityOf(e, id, issueMeta) {
  const recorded = id && issueMeta.get(id) && issueMeta.get(id).severity;
  if (recorded) return recorded === "blocker" ? "blocker" : "major";
  // No issue file to read — fall back to whatever the event text says.
  return /blocker/i.test(e.severity || e.summary || "") ? "blocker" : "major";
}

// state.json carries the pipeline's own authoritative open-issue counts.
function readStateIssues(featureDir) {
  const statePath = path.join(featureDir, "state.json");
  if (!fs.existsSync(statePath)) return null;
  try {
    const st = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!st.issues || typeof st.issues !== "object") return null;
    return st.issues;
  } catch { return null; }
}

function readSkippedGates(featureDir, gaps) {
  const statePath = path.join(featureDir, "state.json");
  if (!fs.existsSync(statePath)) return [];
  try {
    const st = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const g = st.gates || {};
    return Object.keys(g).filter((k) => {
      const v = g[k];
      return v === "skipped" || (v && v.status === "skipped");
    });
  } catch {
    gaps.add("state-unreadable", `state.json could not be parsed — skipped gates could not be identified.`);
    return [];
  }
}

// The floor addresses agents by the short form its WHO_TO_DESK map defines:
// the desk id with the sdlc- prefix stripped. Getting this wrong is silent —
// the desk's own log just never receives the line.
function shortName(agentId, deskId) {
  if (!deskId) return null;
  return deskId.replace(/^sdlc-/, "");
}

/* ============================================================
   TOKENS — cost per run, from the orchestrator's run_usage events
   ============================================================ */

// A subagent cannot observe its own token usage, so it cannot write it on its own
// run_complete. The orchestrator can — it sees the usage the moment the agent
// returns — and records it as a separate run_usage event (protocol section 3).
// Matching is by agent+phase+cycle, then by nearest timestamp, which is what
// keeps three concurrent implementers' costs on the right three desks.
function attachTokens(runs, events, gaps) {
  const usage = events.filter((e) => e.event === "run_usage");
  let unmatched = 0;
  for (const u of usage) {
    const free = (r) => r.tokens == null && (!u.task || !r.task || r.task === u.task);
    let pool = runs.filter((r) => r.agent === u.agent && r.phase === u.phase
      && (r.cycle ?? 1) === (u.cycle ?? 1) && free(r));
    // A run whose two halves were written under different labels keeps the
    // phase its start named, which the orchestrator's usage event need not
    // share — it normally carries the other one. Match on that second label
    // too, rather than throwing away cost that was recorded. Only cross-labelled
    // runs are eligible, so a usage event can never drift onto an unrelated run
    // of the same agent in the same cycle.
    if (!pool.length) {
      pool = runs.filter((r) => r.agent === u.agent && r.altPhase === u.phase
        && (r.cycle ?? 1) === (u.cycle ?? 1) && free(r));
    }
    if (!pool.length) { unmatched++; continue; }
    let best = pool[0], bestD = Infinity;
    for (const r of pool) {
      const d = Math.abs((r.end ?? r.start) - u._t);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (typeof u.tokens === "number") best.tokens = u.tokens;
    if (u.model) best.model = u.model;
    if (u.task && !best.task) best.task = u.task;
  }
  if (unmatched) {
    gaps.add("tokens-unmatched", `${unmatched} run_usage event(s) matched no run — their token cost is not shown on any desk.`);
  }
  const missing = runs.filter((r) => !r.running && r.tokens == null).length;
  if (missing) {
    gaps.add("tokens-missing", `${missing} completed run(s) carry no token usage — those desks read "not reported". The total is the sum of what was recorded, never an estimate of what was not.`);
  }
}

/* ============================================================
   TASKS — the workplan, and what has been built against it
   ============================================================ */

// The event log says what ran; it never says what the work was. The workplan is
// the only place the task list exists, and 07-implementation/TASK-<NNN>.md is the
// only place a task's outcome is recorded — so the board is read off both.
function loadTasks(featureDir, gaps) {
  const wpPath = path.join(featureDir, "05-architecture", "workplan.md");
  const tasks = [];
  if (fs.existsSync(wpPath)) {
    let text = "";
    try { text = fs.readFileSync(wpPath, "utf8"); } catch { text = ""; }
    // `## TASK-003 — Session store and middleware`, then key: value lines until
    // the next heading. Written by the architect (agents/sdlc-architect.md).
    const parts = text.split(/\r?\n(?=##\s)/);
    for (const part of parts) {
      const head = part.match(/^##\s+(TASK-\d+)\s*[—:-]?\s*(.*)$/m);
      if (!head) continue;
      const field = (name) => {
        const m = part.match(new RegExp("^" + name + ":\\s*(.+)$", "m"));
        return m ? m[1].trim() : "";
      };
      const list = (name) => field(name).replace(/^\[|\]$/g, "").split(",")
        .map((v) => v.trim()).filter(Boolean);
      tasks.push({
        id: head[1],
        title: head[2].trim(),
        ownerRole: field("owner_role") || null,
        stories: list("stories"),
        dependsOn: list("depends_on"),
        parallelWith: list("parallel_with"),
        status: "pending", recorded: false,
        desk: null, startedAt: null, endedAt: null, ms: 0, tokens: null, running: false,
      });
    }
  }

  // Outcome, straight from the record the implementer writes.
  const implDir = path.join(featureDir, "07-implementation");
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (fs.existsSync(implDir)) {
    for (const name of fs.readdirSync(implDir)) {
      if (!/^TASK-\d+\.md$/.test(name)) continue;
      let text = "";
      try { text = fs.readFileSync(path.join(implDir, name), "utf8"); } catch { continue; }
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const id = (fm && (fm[1].match(/^task:\s*(\S+)/m) || [])[1]) || name.replace(/\.md$/, "");
      // No status to read means no outcome was recorded — an empty file, or one
      // whose frontmatter block was never closed, which is exactly the partial
      // artifact protocol 3a quarantines. Defaulting it to "complete" reported
      // an interrupted write as finished work.
      const status = fm && (fm[1].match(/^status:\s*(\w+)/m) || [])[1];
      let t = byId.get(id);
      if (!t) {
        // A task record with no workplan entry still describes real work; show it
        // rather than dropping it, and say where it came from.
        gaps.add("task-no-workplan", `${id} has an implementation record but no entry in 05-architecture/workplan.md — shown on the board from the task record alone.`);
        t = { id, title: "", ownerRole: null, stories: [], dependsOn: [], parallelWith: [],
          status: "pending", recorded: false,
          desk: null, startedAt: null, endedAt: null, ms: 0, tokens: null, running: false };
        tasks.push(t); byId.set(id, t);
      }
      if (!status) {
        gaps.add("task-unrecorded", `${id}: 07-implementation/${name} carries no readable status frontmatter — the record is empty or partial, so the board cannot say what the task produced.`);
        continue;
      }
      t.status = status;                       // complete | partial | blocked
      t.recorded = true;                       // a record exists, so the status is real
    }
  }
  return tasks;
}

// Fold the runs that named a task into the board. A run with no `task` field
// cannot be attributed to one — that is a gap, not a guess.
function attachTaskRuns(tasks, runs, gaps) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let unattributed = 0;
  const unplaceable = new Set();
  for (const r of runs) {
    if (r.agent !== "sdlc-implementer") continue;
    if (!r.task) { unattributed++; continue; }
    const t = byId.get(r.task);
    // The run names its work and the board still cannot place it: no workplan
    // entry and no task record. Dropping that silently is the one thing this
    // floor must not do — the desks show the time with nothing to attach it to.
    if (!t) { unplaceable.add(r.task); continue; }
    t.desk = r._desk || t.desk;
    t.startedAt = t.startedAt == null ? r.start : Math.min(t.startedAt, r.start);
    if (r.running) { t.running = true; t.status = "running"; }
    else {
      t.endedAt = Math.max(t.endedAt ?? 0, r.end ?? 0) || null;
      t.ms += r.durationMs || 0;
    }
    if (typeof r.tokens === "number") t.tokens = (t.tokens || 0) + r.tokens;
  }
  if (unattributed) {
    gaps.add("task-unattributed", `${unattributed} implementer run(s) named no task — the board cannot say which workplan task they built, so they appear only on the desks.`);
  }
  if (unplaceable.size) {
    gaps.add("task-unplaceable", `${Array.from(unplaceable).sort().join(", ")} — named by an implementer run but absent from both 05-architecture/workplan.md and 07-implementation/, so the board has no row to put that run on and it appears only on the desks.`);
  }
  // A task whose run started and finished, with no 07-implementation/TASK-<NNN>.md
  // behind it, has an outcome nobody recorded. Leaving it "pending" states the
  // opposite of what the log shows — the row would read "never started" while
  // carrying the time and tokens of a completed run — and undercounts the board's
  // "N of M complete".
  const unrecorded = tasks.filter((t) => !t.recorded && !t.running && t.endedAt != null);
  for (const t of unrecorded) {
    t.status = "unknown";
  }
  if (unrecorded.length) {
    gaps.add("task-unrecorded", `${unrecorded.length} task(s) ran to completion with no usable outcome behind them — 07-implementation/TASK-<NNN>.md is missing or unreadable — so the board shows them "unknown": the log proves the run finished, but nothing records what it produced.`);
  }
}

/* ============================================================
   WAITING — the questions nobody has answered yet
   ============================================================ */

// The one thing the floor was getting plainly wrong about a paused pipeline: an
// agent that stopped to ask a question looks, in the event log, exactly like an
// agent thinking hard. Both are a phase_start with no run_complete. So the floor
// drew a lit desk and an advancing clock over a pipeline that had been waiting on
// a person since yesterday — the single state that needs a human, rendered as the
// one state that needs nothing from them.
//
// The run bracket cannot say it, but four records can, and none of them is an
// event pair:
//
//   1. `bus/<NNNN>-<from>-to-<to>.md` whose frontmatter still says `status: open`
//      — the directed-question protocol, section 5;
//   2. a `question_asked` event with no `question_answered` after it;
//   3. `00-intake/questions.md` with a non-empty `## Blocking` section and no
//      `answers.md` beside it — intake's own documented stop condition;
//   4. `state.json`'s `status: awaiting_human | blocked`, its `blocked_on` and
//      its `open_questions` — the pipeline's own claim that it stopped.
//
// Any one of them is enough to say the pipeline is waiting. Together they say
// who is waiting and on whom. None of them is inferred from silence: a desk that
// has simply gone quiet is not called blocked, because a quiet desk and a
// thinking desk are the same desk, and only these four records tell them apart.

// Who counts as a person. Everything else is checked against the roster, because
// the difference that matters to a reader is "somebody has to go and answer
// this" versus "another agent owes it, and the pipeline will get there itself".
const HUMAN_ADDRESSEES = /^(human|humans|user|you|person|people|requester|owner|stakeholder|maintainer|operator|caller|pm)$/i;

function isHumanAddressee(to, gaps, where) {
  const id = String(to || "").trim();
  // A question with no addressee at all is the human's: no agent was named to
  // pick it up, so nothing in the pipeline is going to.
  if (!id) return true;
  if (HUMAN_ADDRESSEES.test(id)) return true;
  const norm = normaliseAgent(id).agent;
  if (DESK_IDS.has(norm) || AGENT_GATE[norm] || MACHINERY_AGENTS.has(norm)) return false;
  gaps.add("waiting-addressee", `${where}: addressed to '${id}', which is not an agent this pipeline knows — read as a person, so the floor says the wait is on you.`);
  return true;
}

// Frontmatter as a flat map. Every reader here wants two or three scalar keys
// out of a block the protocol writes by hand, so a shared shallow parse is
// closer to the files than another per-field regex in each caller.
function parseFrontmatter(text) {
  const m = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// The question itself, short enough for a desk card. A reader deciding whether
// to go and answer something needs the ask, not the whole memo.
function firstLine(text, limit) {
  const line = String(text || "").split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*>]\s*/, "").replace(/^#{1,6}\s*/, ""))
    .find(Boolean);
  if (!line) return "";
  const cap = limit || 140;
  return line.length > cap ? line.slice(0, cap - 1) + "…" : line;
}

function mtimeOf(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return null; }
}

// Same id on both sides of a question wherever a seq exists, so the bus file and
// the event that announced it are one wait rather than two.
function questionId(e) {
  if (e.id) return String(e.id);
  if (e.question_id) return String(e.question_id);
  if (e.seq != null) return `bus-${e.seq}`;
  const text = [e.summary || "", e.question || "", ...(Array.isArray(e.artifacts) ? e.artifacts : [])].join(" ");
  const m = text.match(/bus\/(\d+)-/);
  return m ? `bus-${Number(m[1])}` : null;
}

function loadBusWaits(featureDir, gaps) {
  const dir = path.join(featureDir, "bus");
  const items = [];
  if (!fs.existsSync(dir)) return items;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const full = path.join(dir, name);
    let text;
    try { text = fs.readFileSync(full, "utf8"); } catch {
      gaps.add("bus-unreadable", `bus/${name} could not be read — if it holds an open question, the floor cannot show that anybody is waiting on it.`);
      continue;
    }
    const fm = parseFrontmatter(text) || {};
    const byName = name.match(/^(\d+)-(.+?)-to-(.+)\.md$/);
    const status = String(fm.status || "open").toLowerCase();
    if (status === "answered" || status === "closed" || status === "resolved") continue;
    const seq = fm.seq != null ? Number(fm.seq) : (byName ? Number(byName[1]) : null);
    const from = normaliseAgent(fm.from || (byName ? byName[2] : "")).agent || null;
    const to = fm.to || (byName ? byName[3] : "") || null;
    const question = (text.match(/##\s*Question\s*\r?\n([\s\S]*?)(?=\n##\s|\s*$)/i) || [])[1] || "";
    items.push({
      kind: "bus",
      id: seq != null ? `bus-${seq}` : `bus-${name}`,
      from, to,
      human: isHumanAddressee(to, gaps, `bus/${name}`),
      // Every bus question carries a default so the pipeline never deadlocks
      // (protocol section 5), so an explicitly non-blocking one does NOT stop
      // the desk that asked it — it is listed as open and the agent carries on
      // under its default. Anything else is read as blocking: a question whose
      // frontmatter forgot to say is far more likely to be a real stop than a
      // desk this floor should quietly paint as working.
      blocking: !/^(false|no|non-blocking|nonblocking)$/i.test(String(fm.blocking || "")),
      text: firstLine(question) || `open question in bus/${name}`,
      source: `bus/${name}`,
      since: mtimeOf(full),
    });
  }
  return items;
}

// question_asked with nothing closing it. The protocol names both events but
// fixes no id field on either, so the pairing is: an explicit id or seq first,
// then an answer that names one of the two parties, and only then order —
// which is disclosed, because order is a guess wherever two are open at once.
function loadEventWaits(events, gaps) {
  const open = [];
  let byOrder = 0;
  for (const e of events) {
    if (e.event === "question_asked") {
      const to = e.to || e.addressee || null;
      open.push({
        kind: "question",
        id: questionId(e),
        from: e.agent || null,
        to,
        human: isHumanAddressee(to, gaps, `question_asked at ${new Date(e._t).toISOString()}`),
        blocking: e.blocking !== false,
        text: firstLine(e.question || e.summary || "") || "a question with no text recorded",
        source: "history/events.jsonl",
        since: e._t,
      });
    } else if (e.event === "question_answered") {
      if (!open.length) continue;
      const id = questionId(e);
      let i = id ? open.findIndex((q) => q.id === id) : -1;
      if (i === -1) {
        i = open.findIndex((q) => (e.agent && (q.from === e.agent || q.to === e.agent))
          || (e.to && (q.from === e.to || q.to === e.to)));
      }
      if (i === -1) { i = 0; byOrder++; }
      open.splice(i, 1);
    }
  }
  if (byOrder) {
    gaps.add("waiting-pairing", `${byOrder} question_answered event(s) named neither an id nor a party, so each closed the oldest question still open. Where two were open at once, which one it answered is a guess.`);
  }
  return open;
}

// Intake's stop condition, which is a pair of files rather than an event: it
// writes the blocking questions and stops, and the human answers by putting
// 00-intake/answers.md beside them.
function loadIntakeWait(featureDir, gaps) {
  const qPath = path.join(featureDir, "00-intake", "questions.md");
  if (!fs.existsSync(qPath)) return null;
  let text = "";
  try { text = fs.readFileSync(qPath, "utf8"); } catch { return null; }
  const block = (text.match(/##\s*Blocking\s*\r?\n([\s\S]*?)(?=\n##\s|\s*$)/i) || [])[1] || "";
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  // Two things settle these, and neither is a per-question record. answers.md is
  // the human coming back; a passed intake gate is intake's own criterion —
  // it passes only when no blocking question is unanswered (agents/sdlc-intake.md).
  // Without the second one, a human who answered in the session and never had
  // the answers written down would leave this desk waiting for the rest of the
  // feature.
  const answered = fs.existsSync(path.join(featureDir, "00-intake", "answers.md"));
  const intakeGate = readStateGates(featureDir).intake;
  if (answered || intakeGate === "passed" || intakeGate === "skipped") {
    gaps.add("waiting-human", `00-intake/questions.md lists blocking questions and ${answered ? "00-intake/answers.md exists" : `state.json records the intake gate '${intakeGate}'`} — the floor reads that as all of them settled. Nothing maps an answer to a question, so it cannot check that.`);
    return null;
  }
  const count = lines.filter((l) => /^(#{3,}\s|[-*]\s|\d+[.)]\s)/.test(l)).length || 1;
  return {
    kind: "intake",
    id: "intake-questions",
    from: "sdlc-intake",
    to: "human",
    human: true,
    blocking: true,
    count,
    text: firstLine(lines.filter((l) => /^(#{3,}\s|[-*]\s|\d+[.)]\s)/.test(l))[0] || lines[0])
      || `${count} blocking question(s) in 00-intake/questions.md`,
    source: "00-intake/questions.md",
    since: mtimeOf(qPath),
  };
}

// The pipeline's own claim about itself. It is the only record that survives a
// session dying mid-phase, and the only one that can say "blocked" for a reason
// that was never a question.
function readStateWait(featureDir, gaps) {
  const statePath = path.join(featureDir, "state.json");
  if (!fs.existsSync(statePath)) return {};
  try {
    const st = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      status: typeof st.status === "string" ? st.status : null,
      blockedOn: st.blocked_on || null,
      openQuestions: typeof st.open_questions === "number" ? st.open_questions : null,
    };
  } catch {
    gaps.add("state-unreadable", `state.json could not be parsed — the pipeline's own record of whether it is waiting on somebody could not be read.`);
    return {};
  }
}

function buildWaiting(featureDir, events, gaps) {
  const items = [];
  const seen = new Set();
  // The bus file and the event that announced it are the same question. The file
  // is kept because it carries the current status, which the event never had —
  // but the event carries the real moment of asking, where the file has only an
  // mtime that any later edit resets. So each keeps the half it actually knows.
  const fromEvents = loadEventWaits(events, gaps);
  const askedAt = new Map(fromEvents.filter((it) => it.id).map((it) => [it.id, it.since]));
  for (const it of loadBusWaits(featureDir, gaps).concat(fromEvents)) {
    if (it.id && seen.has(it.id)) continue;
    if (it.id) seen.add(it.id);
    if (it.kind === "bus" && askedAt.has(it.id)) it.since = askedAt.get(it.id);
    items.push(it);
  }
  const intake = loadIntakeWait(featureDir, gaps);
  if (intake) items.push(intake);

  const st = readStateWait(featureDir, gaps);
  const stateSaysWaiting = st.status === "awaiting_human" || st.status === "blocked"
    || (st.openQuestions || 0) > 0;
  if (stateSaysWaiting && !items.length) {
    // state.json says it stopped and no question survives to say what on. That
    // is still the fact a reader needs; it just comes with less detail.
    const on = st.status === "blocked" && st.blockedOn ? String(st.blockedOn) : "human";
    items.push({
      kind: "state",
      id: "state",
      from: null,
      to: on,
      human: on === "human" || isHumanAddressee(on, gaps, "state.json blocked_on"),
      blocking: true,
      text: st.blockedOn ? `blocked on ${st.blockedOn}`
        : st.openQuestions ? `${st.openQuestions} open question(s) recorded in state.json`
        : `state.json records status: ${st.status}`,
      source: "state.json",
      since: mtimeOf(path.join(featureDir, "state.json")),
    });
  }

  // Blocking first, and a person's questions before an agent's: the card is read
  // top-down, and the top of it should be the thing that has actually stopped.
  const rank = (it) => (it.blocking ? 0 : 2) + (it.blocking && it.human ? 0 : 1);
  items.sort((a, b) => (rank(a) - rank(b)) || ((a.since || 0) - (b.since || 0)));

  const byAgent = {};
  for (const it of items) {
    if (!it.from) continue;
    if (!byAgent[it.from]) byAgent[it.from] = [];
    byAgent[it.from].push(it);
  }

  const blocking = items.filter((it) => it.blocking);
  const onHuman = blocking.filter((it) => it.human);
  // The waits themselves are shown on the floor, so they are not gaps. What
  // belongs here is only what the floor had to decide for itself.
  for (const it of items) {
    if (it.blocking) continue;
    gaps.add("waiting-agent", `${it.source}: ${it.from || "an agent"} has an open question for ${it.human ? "a person" : it.to} — "${it.text}" — marked non-blocking, so its desk is not shown as waiting. Whether it really proceeded under its default is not something the log records.`);
  }

  return {
    // Anything open at all: the card lists non-blocking questions too, because
    // "nobody has answered this" is worth seeing even where work continued.
    waiting: items.length > 0,
    // Somebody has to act before the pipeline moves.
    blocking: blocking.length > 0 || st.status === "awaiting_human",
    onHuman: onHuman.length > 0 || st.status === "awaiting_human",
    humanCount: onHuman.length,
    blockingCount: blocking.length,
    count: items.length,
    status: st.status || null,
    blockedOn: st.blockedOn || null,
    openQuestions: st.openQuestions,
    items,
    byAgent,
  };
}

// What is left open once the waits are known: runs shown as working, and runs
// shown as waiting. Written here rather than in classifyOpenRuns because until
// the questions are read, the floor cannot say which of the two an open run is —
// and "shown as working" was the wrong disclosure for half of them.
function discloseOpenRuns(runs, gaps) {
  const open = runs.filter((r) => r.running && !r.stalled);
  const working = open.filter((r) => !r.blocked).length;
  const blocked = open.length - working;
  if (working) {
    gaps.add("open-run-live", `${working} run(s) have a phase_start with no run_complete, nothing in the log that closed them, and no unanswered question behind them — shown as working. From the log alone, running now and interrupted a moment ago look identical.`);
  }
  if (blocked) {
    gaps.add("open-run-live", `${blocked} run(s) are open with an unanswered question from the same agent — shown as waiting rather than working. The log cannot prove the agent is still sitting on that question; the question being unanswered is what it can prove.`);
  }
}

// A live run whose own agent has an unanswered question is not working — it is
// waiting, and the difference is the whole point of this. Time spent waiting is
// never added to the agent's worked time: the desk's clock would otherwise bill
// a person's weekend to the pipeline.
function markBlockedRuns(runs, waiting) {
  let n = 0;
  for (const r of runs) {
    if (!r.running || r.stalled) continue;
    const mine = (waiting.byAgent[r.agent] || [])
      // Only a blocking question stops a desk. A non-blocking one has a default
      // the agent is entitled to proceed under, and calling that desk stopped
      // would be the same false statement in the other direction.
      .filter((it) => it.blocking)
      // Asked before this run even started, and it belongs to an earlier run of
      // the same desk; this one is not waiting on it.
      .filter((it) => it.since == null || it.since >= r.start);
    if (!mine.length) continue;
    const it = mine[mine.length - 1];
    r.blocked = true;
    r.blockedOn = it.human ? "you" : String(it.to || "another desk").replace(/^sdlc-/, "");
    r.blockedWhy = it.text;
    r.blockedSource = it.source;
    r.blockedSince = it.since || r.start;
    n++;
  }
  return n;
}

/* ============================================================
   ROSTER, PLAN, NOW — done / doing / remaining, per agent
   ============================================================ */

// One row per desk: everything it has ever done in this feature, what it is doing
// this instant, and whether it is still expected to run. A desk with no runs is
// only "queued" if its gate has not been passed or skipped — otherwise the
// pipeline is simply never going to reach it.
function buildRoster(runs, gateStatus, now, waiting) {
  const rows = [];
  const waits = (waiting && waiting.byAgent) || {};
  for (const deskId of DESK_IDS) {
    const mine = runs.filter((r) => r._desk === deskId);
    const running = mine.find((r) => r.running && !r.stalled && !r.blocked) || null;
    const blockedRun = mine.find((r) => r.blocked) || null;
    const stalledRuns = mine.filter((r) => r.stalled);
    // A question outlives the run that asked it: the agent writes the bus file,
    // finishes its run, and the pipeline sits there with the desk reading
    // "done". So a desk is blocked either because a run of its own is waiting,
    // or because its agent has an unanswered question at all. The implementer
    // desks are excluded from the second case on purpose — A, B and C share one
    // agent id, so a question nobody's open run claimed would light all three
    // when only one of them asked it.
    const baseAgent = deskId.replace(/-[abc]$/, "");
    const agentWaits = (waits[baseAgent] || []).filter((it) => it.blocking);
    const deskWaits = (baseAgent === "sdlc-implementer" && !blockedRun) ? [] : agentWaits;
    const blockedWait = blockedRun
      ? { text: blockedRun.blockedWhy, to: blockedRun.blockedOn, since: blockedRun.blockedSince,
          source: blockedRun.blockedSource }
      : (deskWaits.length
        ? { text: deskWaits[deskWaits.length - 1].text,
            to: deskWaits[deskWaits.length - 1].human ? "you"
              : String(deskWaits[deskWaits.length - 1].to || "another desk").replace(/^sdlc-/, ""),
            since: deskWaits[deskWaits.length - 1].since,
            source: deskWaits[deskWaits.length - 1].source }
        : null);
    const done = mine.filter((r) => !r.running);
    const recent = running || blockedRun || (done.length ? done[done.length - 1] : null);
    // sdlc-qa-functional has no fixed gate — it plans in phase 6 and executes in
    // phase 9 — so fall back to the phase its own last run logged under.
    const gate = AGENT_GATE[deskId] || AGENT_GATE[deskId.replace(/-[abc]$/, "")]
      || (recent ? PHASE_GATE[recent.phase] : null) || null;
    const tokenRuns = done.filter((r) => typeof r.tokens === "number");
    const last = done.length ? done[done.length - 1] : null;
    let status;
    // Blocked outranks everything, including a second run of the same desk that
    // is genuinely working: the question is the thing a reader has to act on,
    // and nothing else on the row will prompt them to.
    if (blockedWait) status = "blocked";
    else if (running) status = "working";
    // A desk with an unclosed run ranks above its finished ones: something it
    // started was never accounted for, and that is the fact worth surfacing.
    else if (stalledRuns.length) status = "stalled";
    else if (mine.length) status = "done";
    else if (ON_DEMAND_DESKS.has(deskId)) status = "idle";
    else if (gate && (gateStatus[gate] === "passed" || gateStatus[gate] === "skipped")) status = "idle";
    else status = "queued";
    rows.push({
      desk: deskId, gate, status,
      runs: mine.length,
      // What it is waiting on and since when, so the row can say so without the
      // reader opening anything.
      waitingOn: blockedWait ? blockedWait.to : null,
      blockedWhy: blockedWait ? blockedWait.text : null,
      blockedSince: blockedWait ? blockedWait.since : null,
      blockedSource: blockedWait ? blockedWait.source : null,
      stalledRuns: stalledRuns.length,
      stalledWhy: stalledRuns.length ? stalledRuns[stalledRuns.length - 1].stalledWhy : null,
      // Clamped: a phase_start timestamped slightly ahead of this machine's clock
      // would otherwise render as negative elapsed time, which reads as a bug in
      // the floor rather than as the clock skew it is.
      // A blocked run's elapsed time is deliberately absent from this: it is a
      // person's turnaround, not the agent's work, and adding it would bill a
      // weekend of waiting to the pipeline's agent time.
      totalMs: done.reduce((a, r) => a + (r.durationMs || 0), 0) + (running ? Math.max(0, now - running.start) : 0),
      liveSince: running ? running.start : null,
      task: (running || blockedRun) ? (running || blockedRun).task : (last ? last.task : null),
      phase: (running || blockedRun) ? (running || blockedRun).phase : (last ? last.phase : null),
      cycle: (running || blockedRun) ? (running || blockedRun).cycle : (last ? last.cycle : null),
      model: (running || blockedRun) ? (running || blockedRun).model : (last ? last.model : null),
      tokens: tokenRuns.length ? tokenRuns.reduce((a, r) => a + r.tokens, 0) : null,
      tokensMissing: done.length - tokenRuns.length,
      lastSummary: last ? last.summary : "",
    });
  }
  return rows;
}

// The gate rail as a sequence with a position in it: what is finished, what is
// being worked, and — the part no event can tell you — what is still to come and
// who will do it.
function buildPlan(gateStatus, runs, skipped, waiting) {
  const runningGates = new Set(runs.filter((r) => r.running && !r.stalled && !r.blocked)
    .map((r) => AGENT_GATE[r.agent] || PHASE_GATE[r.phase]).filter(Boolean));
  // A gate with nothing running but a blocked run open is not in progress and is
  // not pending either — it is stopped, waiting on an answer. So is a gate whose
  // agent asked a blocking question and then finished its run, which is how
  // intake stops: the run closes cleanly and the gate stays shut until somebody
  // answers. "Pending" reads as "its turn has not come yet", which is the
  // opposite of what has happened.
  const blockedGates = new Set(runs.filter((r) => r.blocked)
    .map((r) => AGENT_GATE[r.agent] || PHASE_GATE[r.phase]).filter(Boolean));
  for (const it of ((waiting && waiting.items) || [])) {
    if (!it.blocking || !it.from) continue;
    const g = AGENT_GATE[it.from];
    if (g) blockedGates.add(g);
  }
  const rows = GATES.map((g) => {
    const mine = runs.filter((r) => (AGENT_GATE[r.agent] || PHASE_GATE[r.phase]) === g);
    const doneRuns = mine.filter((r) => !r.running);
    const tokenRuns = doneRuns.filter((r) => typeof r.tokens === "number");
    let status = gateStatus[g] || "pending";
    if (skipped.indexOf(g) > -1) status = "skipped";
    else if (runningGates.has(g)) status = "working";
    else if (blockedGates.has(g) && status !== "passed" && status !== "failed") status = "blocked";
    return {
      gate: g, status,
      agents: GATE_AGENTS[g] || [],
      runs: mine.length,
      // Summed agent time, which the panel labels as such. It is larger than the
      // gate's elapsed time whenever a fan-out ran concurrently — protocol
      // section 3 — so it must never be presented as how long the gate took.
      realMs: doneRuns.reduce((a, r) => a + (r.durationMs || 0), 0),
      tokens: tokenRuns.length ? tokenRuns.reduce((a, r) => a + r.tokens, 0) : null,
    };
  });
  // Everything still ahead, in the order commands/sdlc.md runs it.
  const firstUnfinished = rows.findIndex((r) => r.status !== "passed" && r.status !== "skipped");
  const upNext = rows
    .slice(firstUnfinished === -1 ? rows.length : firstUnfinished)
    // Nothing already settled, nothing in flight, and nothing stopped on a
    // question — a gate that passed earlier is not "up next" just because a gate
    // before it is still open.
    .filter((r) => r.status !== "skipped" && r.status !== "passed"
      && r.status !== "working" && r.status !== "blocked")
    .map((r) => ({ gate: r.gate, agents: r.agents }));
  return { plan: rows, upNext };
}

// What is happening this instant, with its own clock. Read straight off the
// unpaired phase_starts, which is also why the floor cannot tell "running" from
// "interrupted" — both look exactly like this in the log.
function buildNow(runs, now) {
  return runs.filter((r) => isDrawn(r) && r.running && !r.stalled && !r.blocked).map((r) => ({
    agent: r.agent, desk: r._desk || null, phase: r.phase, cycle: r.cycle,
    gate: AGENT_GATE[r.agent] || PHASE_GATE[r.phase] || null,
    task: r.task, model: r.model,
    startedAt: r.start, elapsedMs: Math.max(0, now - r.start),
  }));
}

// The other half of "what is happening now": the runs that are open and going
// nowhere until somebody answers. Same shape as buildNow, with the wait on it,
// so the panel can render the two lists side by side.
function buildBlockedNow(runs, now) {
  return runs.filter((r) => isDrawn(r) && r.blocked).map((r) => ({
    agent: r.agent, desk: r._desk || null, phase: r.phase, cycle: r.cycle,
    gate: AGENT_GATE[r.agent] || PHASE_GATE[r.phase] || null,
    task: r.task, model: r.model,
    on: r.blockedOn, why: r.blockedWhy, source: r.blockedSource,
    startedAt: r.start,
    since: r.blockedSince || r.start,
    waitingMs: Math.max(0, now - (r.blockedSince || r.start)),
  }));
}

// The gate map state.json records, which is authoritative for anything the event
// log never emitted an outcome for (a skip, a gate reset when a cycle opened).
function readStateGates(featureDir) {
  const statePath = path.join(featureDir, "state.json");
  if (!fs.existsSync(statePath)) return {};
  try {
    const st = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const g = st.gates || {};
    const out = {};
    Object.keys(g).forEach((k) => {
      const v = g[k];
      out[k] = typeof v === "string" ? v : (v && v.status) || "pending";
    });
    return out;
  } catch { return {}; }
}

/* ============================================================
   WRITE
   ============================================================ */

function writeStatic(root, slug, state) {
  const outDir = path.join(root, ".sdlc", "features", slug, "floor");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "state.json"), JSON.stringify(state, null, 2));

  // The HTML is otherwise copied verbatim — no SCRIPT array is spliced into it,
  // which is what keeps regeneration cheap. The one insertion is the state itself:
  // a page opened from disk cannot fetch state.json (file:// requests are blocked
  // as cross-origin), so the snapshot has to travel inside the file.
  const tpl = fs.readFileSync(path.join(HERE, "pipeline-floor.html"), "utf8");
  const inlined = `<script>window.FLOOR_STATE = ${
    JSON.stringify(state).replace(/</g, "\\u003c")
  };</script>\n`;
  const marker = "<script>\n(function () {";
  if (!tpl.includes(marker)) fail("pipeline-floor.html has no recognizable script block to precede");
  fs.writeFileSync(path.join(outDir, "pipeline-floor.html"), tpl.replace(marker, inlined + marker));
  return outDir;
}

/* ============================================================
   FEATURES — what the registry and each workspace say a run is
   ============================================================ */

// A slug is a directory name under .sdlc/features and, when serving, a URL
// segment. Anything else — a path separator, a dot-dot — is refused rather than
// resolved, so a request can never read outside the features directory.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isSlug(s) { return typeof s === "string" && SLUG_RE.test(s) && s !== "." && s !== ".."; }

function readRegistry(root) {
  const registry = path.join(root, ".sdlc", "registry.json");
  if (!fs.existsSync(registry)) return [];
  try {
    const reg = JSON.parse(fs.readFileSync(registry, "utf8"));
    const list = Array.isArray(reg) ? reg : reg.features || [];
    return list.map((f) => (typeof f === "string" ? { slug: f } : f)).filter((f) => f && isSlug(f.slug));
  } catch { return []; }
}

function readStateFile(featureDir) {
  const statePath = path.join(featureDir, "state.json");
  if (!fs.existsSync(statePath)) return null;
  try {
    const st = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return st && typeof st === "object" ? st : null;
  } catch { return null; }
}

// The registry entry and state.json describe the same run; state.json is the
// pipeline's source of truth and wins wherever both speak. `kind` is the one
// thing only the registry records — /sdlc-bug writes it, and older registries
// carry only the bug- prefix on the slug, so that is the fallback.
function readFeatureMeta(root, slug, registry) {
  const entry = (registry || readRegistry(root)).find((f) => f.slug === slug) || {};
  const st = readStateFile(path.join(root, ".sdlc", "features", slug)) || {};
  const kind = entry.kind || entry.type || st.kind
    || (/^bug-/.test(slug) ? "bug" : "feature");
  return {
    title: st.title || entry.title || slug,
    kind: kind === "bug" ? "bug" : "feature",
    status: st.status || entry.status || null,
    phase: st.phase || entry.phase || null,
    track: st.track || entry.track || null,
    created: st.created || entry.created || null,
  };
}

// Every run this workspace knows about: the registry's list joined with the
// directories that actually exist. A registered slug with no directory is still
// listed — it was asked for and never started, which is worth seeing — but it
// has nothing to open, and the home screen says so instead of linking to a 404.
function listFeatures(root, registry) {
  const featuresDir = path.join(root, ".sdlc", "features");
  const seen = new Map();
  for (const f of (registry || readRegistry(root))) {
    seen.set(f.slug, { slug: f.slug, hasWorkspace: fs.existsSync(path.join(featuresDir, f.slug)) });
  }
  if (fs.existsSync(featuresDir)) {
    for (const e of fs.readdirSync(featuresDir, { withFileTypes: true })) {
      if (e.isDirectory() && isSlug(e.name) && !seen.has(e.name)) {
        seen.set(e.name, { slug: e.name, hasWorkspace: true });
      }
    }
  }
  return [...seen.values()];
}

// One home-screen row, cut from the same state the floor renders so the two
// pages never disagree about whether a run is working, waiting or shipped.
function summarizeFeature(root, slug, state, hasWorkspace, registry, error) {
  const meta = readFeatureMeta(root, slug, registry);
  const st = state || {};
  const w = st.waiting || {};
  const nowRunning = st.nowRunning || [];
  // One word a reader can sort by. Waiting on a person outranks everything —
  // it is the only row somebody can act on this minute. state.json's own
  // status is read after the derived waits: when the pipeline wrote that it
  // stopped on somebody and no question survives to say what on, the band
  // still has to agree with the status word printed on the same card.
  const activity = !hasWorkspace ? "not-started"
    : error ? "unreadable"
    : st.shipped ? "shipped"
    : w.blocking && w.onHuman ? "waiting-human"
    : w.blocking ? "waiting"
    : meta.status === "awaiting_human" ? "waiting-human"
    : meta.status === "blocked" ? "waiting"
    : st.running ? "running"
    : st.empty ? "not-started"
    : meta.status === "ready_to_ship" ? "ready"
    : "idle";
  return {
    slug,
    ...meta,
    hasWorkspace,
    error: error || null,
    empty: !!st.empty || !hasWorkspace,
    activity,
    running: !!st.running,
    shipped: !!st.shipped,
    cycle: st.cycle || null,
    wallClockMs: st.wallClockMs || 0,
    generatedAt: st.generatedAt || Date.now(),
    lastEventTs: st.lastEventTs || null,
    agentsWorking: nowRunning.length,
    workingOn: nowRunning.slice(0, 4).map((r) => ({
      desk: (r.desk || r.agent || "").replace(/^sdlc-/, ""), task: r.task || r.gate || r.phase || null,
    })),
    stalled: st.stalled || 0,
    waiting: {
      count: w.count || 0, blocking: !!w.blocking, onHuman: !!w.onHuman,
      blockingCount: w.blockingCount || 0,
      // The first question in full: a home screen that says "waiting on you" and
      // makes the reader open the floor to learn what for has not saved a click.
      first: (() => {
        // The question the header is about: a blocking one, addressed to a
        // person when the header says "waiting on you" — not whichever item
        // happens to come first in the list.
        const items = w.items || [];
        const it = items.find((i) => i.blocking && (!w.onHuman || i.human))
          || items.find((i) => i.blocking) || items[0];
        return it ? { from: it.from || null, text: it.text || "" } : null;
      })(),
    },
    gates: st.gates || GATES,
    gateStatus: st.gateStatus || {},
    skippedGates: st.skippedGates || [],
    // The gates with a desk at them right now, so the home strip can light the
    // same pill the floor's rail marks active or blocked.
    activeGates: [...new Set(nowRunning.map((r) => r.gate).filter(Boolean))],
    blockedGates: [...new Set((st.nowBlocked || []).map((r) => r.gate).filter(Boolean))],
    issues: st.issues || { blocker: 0, major: 0, verified: 0 },
    tokens: st.tokens || { total: 0, reportedRuns: 0, totalRuns: 0 },
    gapCount: (st.gaps || []).length,
  };
}

// Sort order is the order somebody should look: waiting on a person, then
// waiting on another desk, then working, then idle, ready, shipped, and last the
// ones that never started. Within a band, the most recently active first.
const ACTIVITY_ORDER = { "waiting-human": 0, "waiting": 1, "running": 2, "idle": 3, "ready": 4, "shipped": 5, "not-started": 6, "unreadable": 7 };

// `errors` maps a slug to why its floor could not be built. Such a run is
// listed as unreadable rather than silently classified from an empty state,
// which read as "idle" and linked to a floor that did not exist.
function buildHome(root, states, errors = new Map()) {
  // Read once per rebuild, not once per feature: the registry is the same file
  // for every row.
  const registry = readRegistry(root);
  const features = listFeatures(root, registry).map((f) => {
    const state = f.hasWorkspace ? (states.get(f.slug) || null) : null;
    const error = f.hasWorkspace && !state ? (errors.get(f.slug) || "no floor session") : null;
    return summarizeFeature(root, f.slug, state, f.hasWorkspace, registry, error);
  });
  features.sort((a, b) => (ACTIVITY_ORDER[a.activity] - ACTIVITY_ORDER[b.activity])
    || ((b.lastEventTs || 0) - (a.lastEventTs || 0)) || a.slug.localeCompare(b.slug));
  const count = (k) => features.filter((f) => f.activity === k).length;
  return {
    generatedAt: Date.now(),
    root: path.basename(root),
    features,
    totals: {
      features: features.filter((f) => f.kind === "feature").length,
      bugs: features.filter((f) => f.kind === "bug").length,
      running: count("running"),
      waitingHuman: count("waiting-human"),
      waiting: count("waiting"),
      shipped: count("shipped"),
      agentsWorking: features.reduce((a, f) => a + f.agentsWorking, 0),
    },
  };
}

/* ============================================================
   SERVE — state.json over HTTP, updates over SSE
   ============================================================ */

// One feature's live floor: its state, the watchers that rebuild it, and the
// pages listening for pushes. The home screen owns one of these per feature so
// its rows are cut from exactly the state each floor renders.
function createFloorSession(root, slug, onChange) {
  const featureDir = path.join(root, ".sdlc", "features", slug);
  const logPath = path.join(featureDir, "history", "events.jsonl");
  const runsDir = path.join(featureDir, "history", "runs");

  let state = buildState(root, slug);
  const clients = new Set();

  // Everything the floor renders, minus the fields that change on every rebuild
  // whether or not anything happened. Comparing only the event count suppressed
  // a new sign-off, a gate flipped to skipped in state.json, and a changed issue
  // tally — none of which touch the event log.
  function fingerprint(s) {
    return JSON.stringify({
      steps: s.steps, gaps: s.gaps, skippedGates: s.skippedGates,
      issues: s.issues, running: s.running, cycle: s.cycle, empty: s.empty,
      title: s.title, status: s.status, phase: s.phase,
      // The board and the roster move on file writes that emit no event at all —
      // a workplan landing, a task record flipping to complete, a gate reset in
      // state.json. Leaving them out of the fingerprint is what would make the
      // page sit on a stale task list while claiming to be live.
      plan: s.plan, tasks: s.tasks, tokens: s.tokens, stalled: s.stalled,
      // A question being asked or answered moves nothing else in here: no run
      // starts, no run completes, no gate flips. Leaving the waits out is what
      // would leave the page showing a working desk for as long as the answer
      // took to arrive — the exact failure this is here to prevent.
      blocked: s.blocked, blockedDesks: s.blockedDesks,
      waiting: (s.waiting && s.waiting.items || []).map((i) => i.id + ":" + i.source + ":" + i.text),
      waitingState: s.waiting && (s.waiting.status + ":" + s.waiting.onHuman + ":" + s.waiting.count),
      roster: (s.roster || []).map((r) => r.desk + ":" + r.status + ":" + r.runs + ":" + r.tokens),
    });
  }

  function rebuild(force) {
    try {
      const next = buildState(root, slug);
      const changed = fingerprint(next) !== fingerprint(state);
      // Adopt the new state either way, so a forced push carries a fresh elapsed
      // clock rather than re-sending the one built at startup.
      state = next;
      if (!changed && !force) return;
      const payload = `data: ${JSON.stringify(state)}\n\n`;
      for (const res of clients) res.write(payload);
      if (changed && onChange) onChange(slug);
    } catch (err) {
      process.stderr.write(`build-floor: rebuild of ${slug} failed: ${err.message}\n`);
    }
  }

  // fs.watchFile polls, which is what an append-only log on macOS needs to be
  // seen reliably; fs.watch misses appends on some filesystems.
  // Wrapped, not passed directly: watchFile hands the listener (curr, prev) Stats,
  // which would arrive as a truthy `force` and push on every poll.
  // watchFile on a path that does not exist yet is legal and fires when it appears.
  const watched = [
    [logPath, 1000], [runsDir, 2000],
    // The task board and the gate rail are read off files, not events. Watch them
    // too, or the floor shows a workplan that landed minutes ago as still absent.
    [path.join(featureDir, "state.json"), 2000],
    [path.join(featureDir, "05-architecture", "workplan.md"), 2000],
    [path.join(featureDir, "07-implementation"), 2000],
    // The bus and the intake questions are files, not events: an agent that stops
    // to ask something writes one of these and nothing else. Watch them or the
    // floor learns the pipeline is waiting only when the next run happens to start.
    [path.join(featureDir, "bus"), 2000],
    [path.join(featureDir, "00-intake", "questions.md"), 2000],
    [path.join(featureDir, "00-intake", "answers.md"), 2000],
  ];
  watched.forEach(([target, interval]) => fs.watchFile(target, { interval }, () => rebuild()));

  return {
    slug,
    get state() { return state; },
    rebuild,
    subscribe(res) { clients.add(res); },
    unsubscribe(res) { clients.delete(res); },
    get listeners() { return clients.size; },
    // Whether the elapsed clocks on this floor are moving, so the server knows
    // to push a fresh state periodically even while the log is quiet.
    get ticking() { return !!(state.running || (state.waiting && state.waiting.waiting)); },
    stop() {
      watched.forEach(([target]) => fs.unwatchFile(target));
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}

function sseHeaders(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
  });
}

function attachSse(req, res, first, sessions) {
  sseHeaders(res);
  res.write(`data: ${JSON.stringify(first)}\n\n`);
  sessions.subscribe(res);
  const ka = setInterval(() => res.write(": keep-alive\n\n"), 20000);
  req.on("close", () => { clearInterval(ka); sessions.unsubscribe(res); });
}

// Serve every feature in the workspace: the home screen at /, and each
// feature's floor under /f/<slug>/. `focus` is the feature the caller asked
// for — its floor URL is what gets printed, and the legacy root paths
// (/state.json, /stream, /pipeline-floor.html) keep answering for it so a link
// handed out before the home screen existed still works.
function serve(root, focus, port) {
  const tplFloor = path.join(HERE, "pipeline-floor.html");
  const tplHome = path.join(HERE, "pipeline-home.html");
  const featuresDir = path.join(root, ".sdlc", "features");

  const floors = new Map();          // slug -> session
  const failed = new Map();          // slug -> why its floor could not be built
  const homeClients = new Set();
  let home = null;

  function homeFingerprint(h) {
    return JSON.stringify(h.features.map((f) => [f.slug, f.title, f.kind, f.status, f.phase, f.activity, f.error,
      f.cycle, f.agentsWorking, f.stalled, f.waiting, f.gateStatus, f.skippedGates, f.activeGates, f.blockedGates, f.issues,
      f.tokens, f.hasWorkspace, f.workingOn]));
  }

  function pushHome(force) {
    try {
      const states = new Map([...floors.values()].map((s) => [s.slug, s.state]));
      const next = buildHome(root, states, failed);
      const changed = !home || homeFingerprint(next) !== homeFingerprint(home);
      home = next;
      if (!changed && !force) return;
      const payload = `data: ${JSON.stringify(home)}\n\n`;
      for (const res of homeClients) res.write(payload);
    } catch (err) {
      process.stderr.write(`build-floor: home rebuild failed: ${err.message}\n`);
    }
  }

  // Open a floor for every feature that has a workspace, and close the ones
  // whose directory has gone. Called at start and whenever the registry or the
  // features directory changes, so a feature registered after the server came
  // up appears on the home screen without a restart.
  function syncFloors() {
    const present = new Set(listFeatures(root).filter((f) => f.hasWorkspace).map((f) => f.slug));
    for (const slug of present) {
      if (!floors.has(slug)) {
        try {
          floors.set(slug, createFloorSession(root, slug, () => pushHome()));
          failed.delete(slug);
        } catch (err) {
          failed.set(slug, err.message);
          process.stderr.write(`build-floor: could not open a floor for ${slug}: ${err.message}\n`);
        }
      }
    }
    for (const [slug, session] of floors) {
      if (!present.has(slug)) { session.stop(); floors.delete(slug); }
    }
  }

  syncFloors();
  if (focus && !floors.has(focus)) fail(`no feature '${focus}' under ${featuresDir}`);
  pushHome(true);

  [path.join(root, ".sdlc", "registry.json"), featuresDir]
    .forEach((target) => fs.watchFile(target, { interval: 2000 }, () => { syncFloors(); pushHome(); }));

  // A run in progress needs its elapsed clock to keep advancing even when the log
  // is quiet, so force a push periodically while anything is running — but only
  // to pages that are open. Each rebuild re-parses that feature's whole log, and
  // both pages tick their clocks locally between pushes, so a floor nobody is
  // watching is left to its file watchers. The home is pushed on the same beat
  // when it has a reader.
  setInterval(() => {
    let any = false;
    for (const s of floors.values()) {
      if (!s.ticking) continue;
      any = true;
      if (s.listeners) s.rebuild(true);
    }
    if (any && homeClients.size) pushHome(true);
  }, 5000).unref?.();

  function sendHtml(res, file) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(fs.readFileSync(file, "utf8"));
  }
  function sendJson(res, obj) {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(obj));
  }
  function notFound(res, msg) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(msg || "not found");
  }

  function floorRoute(res, session, rest, req) {
    if (rest === "" || rest === "pipeline-floor.html") return sendHtml(res, tplFloor);
    if (rest === "state.json") return sendJson(res, session.state);
    if (rest === "stream") return attachSse(req, res, session.state, session);
    return notFound(res);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    if (p === "/") return sendHtml(res, tplHome);
    if (p === "/home.json") return sendJson(res, home);
    if (p === "/home-stream") {
      return attachSse(req, res, home, {
        subscribe: (r) => homeClients.add(r), unsubscribe: (r) => homeClients.delete(r),
      });
    }

    const m = p.match(/^\/f\/([^/]+)(?:\/(.*))?$/);
    if (m) {
      // decodeURIComponent throws on a malformed escape, and an uncaught throw
      // here would take the whole server down with it.
      let slug;
      try { slug = decodeURIComponent(m[1]); } catch { return notFound(res, "malformed feature path"); }
      if (!isSlug(slug) || !floors.has(slug)) return notFound(res, `no feature '${slug}' on this floor`);
      // The page fetches "stream" and "state.json" relative to its own URL, so
      // the floor has to live under a trailing slash for those to land here.
      if (m[2] === undefined) {
        res.writeHead(302, { location: `/f/${encodeURIComponent(slug)}/` });
        return res.end();
      }
      return floorRoute(res, floors.get(slug), m[2], req);
    }

    // Legacy root paths: the floor for the focused feature, as before the home
    // screen existed. Without a focus there is nothing they can honestly answer.
    if (p === "/pipeline-floor.html" || p === "/state.json" || p === "/stream") {
      if (!focus) return notFound(res, "no --feature given — open / for the list of features, or /f/<slug>/ for one floor");
      return floorRoute(res, floors.get(focus), p.slice(1), req);
    }
    notFound(res);
  });

  server.listen(port, () => {
    const base = `http://localhost:${port}`;
    if (focus) {
      process.stdout.write(`floor: ${base}/f/${encodeURIComponent(focus)}/  (feature: ${focus}, live)\n`);
      process.stdout.write(`home:  ${base}/  (every feature and bug in this workspace)\n`);
    } else {
      process.stdout.write(`floor: ${base}/  (${floors.size} feature${floors.size === 1 ? "" : "s"}, live — each opens its own floor)\n`);
    }
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") fail(`port ${port} is in use — pass --port <n>`);
    fail(err.message);
  });
}

/* ============================================================
   MAIN
   ============================================================ */

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`build-floor — render a feature's real history as the Pipeline Floor

  --feature <slug>   feature to render (default: the only one in .sdlc/registry.json)
  --serve            serve the floor and push updates as the pipeline runs. With
                     --feature the printed URL is that feature's floor; without
                     it, the home screen listing every feature and bug, each
                     opening its own floor. Either way both are served.
  --port <n>         port for --serve (default 4317)
  --root <dir>       project root containing .sdlc (default: cwd)
  --json             print the built state to stdout instead of writing files
`);
  process.exit(0);
}

if (args.serve) {
  // Serving without --feature is the home screen, not an error: every feature
  // is listed and each opens its own floor. A given feature is validated inside
  // serve() and becomes the URL that gets printed.
  serve(args.root, args.feature || null, args.port);
} else {
  const slug = resolveFeature(args.root, args.feature);
  const state = buildState(args.root, slug);
  if (args.json) {
    process.stdout.write(JSON.stringify(state, null, 2) + "\n");
  } else {
    const dir = writeStatic(args.root, slug, state);
    process.stdout.write(`floor: wrote ${path.join(dir, "pipeline-floor.html")}\n`);
    // Said before the gaps, and said plainly: a paused pipeline is the one thing
    // a reader has to act on, and it is worth nothing buried under a hundred
    // disclosure lines.
    if (state.waiting && state.waiting.waiting) {
      process.stdout.write(`waiting on ${state.waiting.onHuman ? "you" : "another desk"} (${state.waiting.count}):\n`);
      state.waiting.items.forEach((i) => {
        process.stdout.write(`  - ${i.from ? i.from + " → " : ""}${i.human ? "you" : i.to} · ${i.text}  [${i.source}]\n`);
      });
    }
    // Grouped, defects first. A hundred and forty loose sentences is the same
    // information nobody reads; the kind and the count are what belong in a
    // report, with the detail underneath them.
    if (state.gaps.length) {
      process.stdout.write(`gaps (${state.gaps.length}):\n`);
      (state.gapGroups || []).forEach((g) => {
        process.stdout.write(`  [${g.nature}] ${g.count > 1 ? g.count + " · " : ""}${g.title}\n`);
        g.lines.forEach((l) => process.stdout.write(`      - ${l}\n`));
      });
    }
  }
}
