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
const AGENT_GATE = {
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
};

// Phase directory -> gate, the fallback when the agent id is unknown or
// context-dependent (sdlc-qa-functional plans in phase 6 and executes in phase 9).
const PHASE_GATE = {
  "00-intake": "intake", "01-research": "research", "02-product": "product",
  "03-design": "design", "03b-figma": "figma-design", "04-ux-audit": "ux-audit",
  "05-architecture": "architecture", "06-test-plan": "test-plan",
  "07-implementation": "implementation", "08-review": "review",
  "09-qa": "qa", "10-ui-qa": "ui-qa", "11-release": "release",
};

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
  let slugs = [];
  const registry = path.join(root, ".sdlc", "registry.json");
  if (fs.existsSync(registry)) {
    try {
      const reg = JSON.parse(fs.readFileSync(registry, "utf8"));
      const list = Array.isArray(reg) ? reg : reg.features || [];
      slugs = list.map((f) => (typeof f === "string" ? f : f.slug)).filter(Boolean);
    } catch { /* fall through to directory listing */ }
  }
  if (!slugs.length && fs.existsSync(featuresDir)) {
    slugs = fs.readdirSync(featuresDir, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name);
  }
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
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const e = JSON.parse(trimmed);
      e._line = i + 1;
      e._t = Date.parse(e.ts);
      if (Number.isNaN(e._t)) {
        gaps.push(`events.jsonl line ${i + 1}: unparseable ts '${e.ts}' — event ignored.`);
        return;
      }
      events.push(e);
    } catch {
      gaps.push(`events.jsonl line ${i + 1}: not valid JSON — line ignored.`);
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
        // run_complete with no start — render it as an instant, and say so.
        gaps.push(`${e.agent} in ${e.phase} (cycle ${e.cycle ?? 1}): run_complete with no matching phase_start — rendered as a zero-length step.`);
        runs.push(makeRun({ ...e, _t: e._t - (e.duration_ms || 0) }, e, gaps));
      }
    }
  }

  // Anything still open at the end of the log is rendered as still working,
  // frozen at the log's last state. Protocol 3a calls an unpaired phase_start an
  // interrupted run, and from the log alone the two are indistinguishable — so
  // show the desk as working and say which it might be, rather than inventing a
  // run_complete that never happened.
  for (const [, queue] of open) {
    for (const start of queue) {
      gaps.push(`${start.agent} in ${start.phase} (cycle ${start.cycle ?? 1}): phase_start with no run_complete — shown as still working; it is either running now or was interrupted.`);
      runs.push(makeRun(start, null, gaps));
    }
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
    gaps.push(`${agent} in ${phase} (cycle ${cycle}): run_complete carried no duration_ms — derived ${duration}ms from the timestamp gap.`);
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
    const agent = m[2];
    let text;
    try { text = fs.readFileSync(path.join(runsDir, name), "utf8"); } catch { continue; }
    const block = text.match(/##\s*Sign-off([\s\S]*?)(?=\n##\s|\s*$)/i);
    if (!block) continue;
    const line = block[1].split("\n").map((l) => l.trim())
      .find((l) => /NOT verified/i.test(l));
    if (!line) continue;
    if (!byAgent.has(agent)) byAgent.set(agent, []);
    byAgent.get(agent).push({ ts: Date.parse(m[1].replace(/-/g, ":").replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")) || 0, text: line.replace(/^[-*]\s*/, "") });
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
  const gaps = [];
  const now = Date.now();

  const events = readEvents(logPath, gaps);
  if (!events.length) {
    return { slug, empty: true, generatedAt: now,
      gaps: [`no events in ${logPath} — nothing has run yet.`],
      steps: [], desks: {}, plan: [], upNext: [], roster: [], tasks: [], nowRunning: [],
      gateStatus: {}, skippedGates: [], gates: GATES,
      tokens: { total: 0, reportedRuns: 0, totalRuns: 0 } };
  }

  const issueMeta = loadIssueMeta(featureDir);
  const runs = pairRuns(events, gaps);
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
          gaps.push(`a step ran more than ${slotNames.length} implementer tasks concurrently — the extra tasks share desks A/B/C, so those desks show merged logs.`);
          slotCollisionNoted = true;
        }
        implSlots.set(taskKey, slotNames[used % slotNames.length]);
      }
      return implSlots.get(taskKey);
    }
    if (DESK_IDS.has(run.agent)) return run.agent;
    if (!unknownAgentsNoted.has(run.agent)) {
      gaps.push(`agent '${run.agent}' has no desk on this floor — its runs are omitted from the visualization (it still counts in /sdlc-timing).`);
      unknownAgentsNoted.add(run.agent);
    }
    return null;
  }

  function gateFor(run) {
    if (FLOATING_AGENTS.has(run.agent) && run.agent !== "sdlc-implementer") {
      // Count toward whichever gate was most recently failed before this run.
      const contested = gateEvents.filter((g) => g.event === "gate_failed" && g._t <= run.start).pop();
      if (!floatingNoted) {
        gaps.push(`sdlc-debugger has no fixed gate — its time is attributed to the most recently failed gate, an approximation. Fix-mode sdlc-implementer is not separable from ordinary implementation in the log, so its time counts toward the implementation gate.`);
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
    const live = cluster.some((r) => r.running);

    const desks = [];
    const real = {};
    const durationsRecorded = {};
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
      durationsRecorded[desk] = run.durationRecorded;
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
    if (live) state = "working";
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
        const tail = run.artifacts.length ? " → " + run.artifacts.join(", ") : "";
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
    const unrecorded = Object.entries(durationsRecorded).filter(([, v]) => v === false).length;
    steps.push({
      id: idx,
      desks, real, state, phase: gate, cycle,
      gate: gateEvent ? gate : null,
      gateState: gateEvent ? (gateEvent.event === "gate_failed" ? "bad" : "done") : null,
      ticker, signoff, live,
      // Snapshot past the gate event this step carries, so a step that failed a
      // gate shows the blocker it opened rather than the count from a second earlier.
      issuesAt: tallyAt(events, windowEnd, issueMeta),
      startedAt, endedAt: endedAtRaw,
      caption: live
        ? `${names.join(", ")} — working now in ${cluster[0].phase}.`
        : (cluster.length > 1
          ? `${cluster.length} agents ran concurrently in ${cluster[0].phase}.`
          : `${names[0]} in ${cluster[0].phase}.`)
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
    gaps.push(`gate '${g}' was skipped by this feature's track — the floor marks its pill "skipped".`);
  }

  const firstTs = events[0]._t;
  const lastTs = events[events.length - 1]._t;
  const anyRunning = runs.some((r) => r.running);
  const cycles = Math.max(1, ...events.map((e) => e.cycle ?? 1));
  if (cycles > 2) {
    gaps.push(`this feature reached cycle ${cycles}; the floor's cycle badge shows the real number, but the gate rail only reflects the latest cycle's outcomes.`);
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
  const gateStatus = readStateGates(featureDir);
  for (const g of gateEvents) {
    const gate = PHASE_GATE[g.phase] || AGENT_GATE[g.agent];
    if (!gate) continue;
    if ((g.cycle ?? 1) !== cycles) {
      if (!gateStatus[gate]) gateStatus[gate] = g.event === "gate_failed" ? "failed" : "passed";
      continue;
    }
    gateStatus[gate] = g.event === "gate_failed" ? "failed" : "passed";
  }
  skipped.forEach((g) => { gateStatus[g] = "skipped"; });

  const tasks = loadTasks(featureDir, gaps);
  attachTaskRuns(tasks, runs, gaps);
  const roster = buildRoster(runs, gateStatus, now);
  const { plan, upNext } = buildPlan(gateStatus, runs, skipped, now);
  const nowRunning = buildNow(runs, now);

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
    gates: GATES,
    skippedGates: skipped,
    gateStatus,
    plan,
    upNext,
    roster,
    tasks,
    nowRunning,
    steps,
    gaps,
  };
}

// Wall-clock for a step: concurrent desks waited once, together, so the group's
// elapsed time is its longest desk, never the sum.
function stepRealMs(real) {
  const vals = Object.keys(real).map((k) => real[k] || 0);
  return vals.length ? Math.max(...vals) : 0;
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
    gaps.push(`state.json could not be parsed — skipped gates could not be identified.`);
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
    const pool = runs.filter((r) => r.agent === u.agent && r.phase === u.phase
      && (r.cycle ?? 1) === (u.cycle ?? 1) && r.tokens == null
      && (!u.task || !r.task || r.task === u.task));
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
    gaps.push(`${unmatched} run_usage event(s) matched no run — their token cost is not shown on any desk.`);
  }
  const missing = runs.filter((r) => !r.running && r.tokens == null).length;
  if (missing) {
    gaps.push(`${missing} completed run(s) carry no token usage — those desks read "not reported". The total is the sum of what was recorded, never an estimate of what was not.`);
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
      const status = (fm && (fm[1].match(/^status:\s*(\w+)/m) || [])[1]) || "complete";
      let t = byId.get(id);
      if (!t) {
        // A task record with no workplan entry still describes real work; show it
        // rather than dropping it, and say where it came from.
        gaps.push(`${id} has an implementation record but no entry in 05-architecture/workplan.md — shown on the board from the task record alone.`);
        t = { id, title: "", ownerRole: null, stories: [], dependsOn: [], parallelWith: [],
          status: "pending", recorded: false,
          desk: null, startedAt: null, endedAt: null, ms: 0, tokens: null, running: false };
        tasks.push(t); byId.set(id, t);
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
  for (const r of runs) {
    if (r.agent !== "sdlc-implementer") continue;
    if (!r.task) { unattributed++; continue; }
    const t = byId.get(r.task);
    if (!t) continue;
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
    gaps.push(`${unattributed} implementer run(s) named no task — the board cannot say which workplan task they built, so they appear only on the desks.`);
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
    gaps.push(`${unrecorded.length} task(s) ran to completion with no 07-implementation/TASK-<NNN>.md behind them — the board shows them "unknown", since the log proves the run finished but nothing records what it produced.`);
  }
}

/* ============================================================
   ROSTER, PLAN, NOW — done / doing / remaining, per agent
   ============================================================ */

// One row per desk: everything it has ever done in this feature, what it is doing
// this instant, and whether it is still expected to run. A desk with no runs is
// only "queued" if its gate has not been passed or skipped — otherwise the
// pipeline is simply never going to reach it.
function buildRoster(runs, gateStatus, now) {
  const rows = [];
  for (const deskId of DESK_IDS) {
    const mine = runs.filter((r) => r._desk === deskId);
    const running = mine.find((r) => r.running) || null;
    const done = mine.filter((r) => !r.running);
    const recent = running || (done.length ? done[done.length - 1] : null);
    // sdlc-qa-functional has no fixed gate — it plans in phase 6 and executes in
    // phase 9 — so fall back to the phase its own last run logged under.
    const gate = AGENT_GATE[deskId] || AGENT_GATE[deskId.replace(/-[abc]$/, "")]
      || (recent ? PHASE_GATE[recent.phase] : null) || null;
    const tokenRuns = done.filter((r) => typeof r.tokens === "number");
    const last = done.length ? done[done.length - 1] : null;
    let status;
    if (running) status = "working";
    else if (mine.length) status = "done";
    else if (ON_DEMAND_DESKS.has(deskId)) status = "idle";
    else if (gate && (gateStatus[gate] === "passed" || gateStatus[gate] === "skipped")) status = "idle";
    else status = "queued";
    rows.push({
      desk: deskId, gate, status,
      runs: mine.length,
      // Clamped: a phase_start timestamped slightly ahead of this machine's clock
      // would otherwise render as negative elapsed time, which reads as a bug in
      // the floor rather than as the clock skew it is.
      totalMs: done.reduce((a, r) => a + (r.durationMs || 0), 0) + (running ? Math.max(0, now - running.start) : 0),
      liveSince: running ? running.start : null,
      task: running ? running.task : (last ? last.task : null),
      phase: running ? running.phase : (last ? last.phase : null),
      cycle: running ? running.cycle : (last ? last.cycle : null),
      model: running ? running.model : (last ? last.model : null),
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
function buildPlan(gateStatus, runs, skipped, now) {
  const runningGates = new Set(runs.filter((r) => r.running)
    .map((r) => AGENT_GATE[r.agent] || PHASE_GATE[r.phase]).filter(Boolean));
  const rows = GATES.map((g) => {
    const mine = runs.filter((r) => (AGENT_GATE[r.agent] || PHASE_GATE[r.phase]) === g);
    const doneRuns = mine.filter((r) => !r.running);
    const tokenRuns = doneRuns.filter((r) => typeof r.tokens === "number");
    let status = gateStatus[g] || "pending";
    if (skipped.indexOf(g) > -1) status = "skipped";
    else if (runningGates.has(g)) status = "working";
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
    .filter((r) => r.status !== "skipped" && r.status !== "working")
    .map((r) => ({ gate: r.gate, agents: r.agents }));
  return { plan: rows, upNext };
}

// What is happening this instant, with its own clock. Read straight off the
// unpaired phase_starts, which is also why the floor cannot tell "running" from
// "interrupted" — both look exactly like this in the log.
function buildNow(runs, now) {
  return runs.filter((r) => r.running).map((r) => ({
    agent: r.agent, desk: r._desk || null, phase: r.phase, cycle: r.cycle,
    gate: AGENT_GATE[r.agent] || PHASE_GATE[r.phase] || null,
    task: r.task, model: r.model,
    startedAt: r.start, elapsedMs: Math.max(0, now - r.start),
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
   SERVE — state.json over HTTP, updates over SSE
   ============================================================ */

function serve(root, slug, port) {
  const featureDir = path.join(root, ".sdlc", "features", slug);
  const logPath = path.join(featureDir, "history", "events.jsonl");
  const runsDir = path.join(featureDir, "history", "runs");
  const tplPath = path.join(HERE, "pipeline-floor.html");

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
      // The board and the roster move on file writes that emit no event at all —
      // a workplan landing, a task record flipping to complete, a gate reset in
      // state.json. Leaving them out of the fingerprint is what would make the
      // page sit on a stale task list while claiming to be live.
      plan: s.plan, tasks: s.tasks, tokens: s.tokens,
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
    } catch (err) {
      process.stderr.write(`build-floor: rebuild failed: ${err.message}\n`);
    }
  }

  // fs.watchFile polls, which is what an append-only log on macOS needs to be
  // seen reliably; fs.watch misses appends on some filesystems.
  // Wrapped, not passed directly: watchFile hands the listener (curr, prev) Stats,
  // which would arrive as a truthy `force` and push on every poll.
  fs.watchFile(logPath, { interval: 1000 }, () => rebuild());
  if (fs.existsSync(runsDir)) fs.watchFile(runsDir, { interval: 2000 }, () => rebuild());
  // The task board and the gate rail are read off files, not events. Watch them
  // too, or the floor shows a workplan that landed minutes ago as still absent.
  // watchFile on a path that does not exist yet is legal and fires when it appears.
  [path.join(featureDir, "state.json"),
   path.join(featureDir, "05-architecture", "workplan.md"),
   path.join(featureDir, "07-implementation")]
    .forEach((target) => fs.watchFile(target, { interval: 2000 }, () => rebuild()));
  // A run in progress needs its elapsed clock to keep advancing even when the log
  // is quiet, so force a push periodically while anything is running.
  setInterval(() => { if (state.running) rebuild(true); }, 5000).unref?.();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/" || url.pathname === "/pipeline-floor.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(fs.readFileSync(tplPath, "utf8"));
      return;
    }
    if (url.pathname === "/state.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(state));
      return;
    }
    if (url.pathname === "/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      });
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      const ka = setInterval(() => res.write(": keep-alive\n\n"), 20000);
      req.on("close", () => { clearInterval(ka); clients.delete(res); });
      return;
    }
    res.writeHead(404).end("not found");
  });

  server.listen(port, () => {
    process.stdout.write(`floor: http://localhost:${port}  (feature: ${slug}, live)\n`);
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
  --serve            serve the floor and push updates as the pipeline runs
  --port <n>         port for --serve (default 4317)
  --root <dir>       project root containing .sdlc (default: cwd)
  --json             print the built state to stdout instead of writing files
`);
  process.exit(0);
}

const slug = resolveFeature(args.root, args.feature);

if (args.serve) {
  serve(args.root, slug, args.port);
} else {
  const state = buildState(args.root, slug);
  if (args.json) {
    process.stdout.write(JSON.stringify(state, null, 2) + "\n");
  } else {
    const dir = writeStatic(args.root, slug, state);
    process.stdout.write(`floor: wrote ${path.join(dir, "pipeline-floor.html")}\n`);
    if (state.gaps.length) {
      process.stdout.write(`gaps (${state.gaps.length}):\n`);
      state.gaps.forEach((g) => process.stdout.write(`  - ${g}\n`));
    }
  }
}
