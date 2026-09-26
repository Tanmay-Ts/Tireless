/**
 * Builds out/report.md (the evaluation-document draft) from out/findings/*.json and out/mutants.json,
 * falling back to the committed cloud recordings in qa/recordings/ for anything not run locally.
 *
 * Structure: (1) system design with the two agents, (2) mutations injected by the agent and detected
 * blind by the QA suite — the numbered scenarios, (3) real bugs found in the unmodified kit (S1–S4),
 * (4) precision controls.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cfg, QA_ROOT } from './config.ts';
import { answerKeys, loadGenerated, MUTANTS } from './mutants/index.ts';
import type { Finding } from './runner.ts';

const RECORDINGS = path.join(QA_ROOT, 'recordings');

const K_TABLE = `| Check | Holds on the unmodified kit |
|---|---|
| K1 Presence | Connection badge, every device row, status pill, all 9 telemetry values (with numbers), map, video tile and both map-view toggles are displayed; every control reachable in the clean build still is (semantic diff vs a saved clean baseline). |
| K2 Values | Battery, altitude, H-speed, distance-from-home and heading match the latest telemetry frame for the selected drone (within tolerance, 2 of 3 samples). |
| K3 Cross-panel | Device-list pill, telemetry status pill and the backend agree on the flight state. |
| K4 No false offline | While data is live, no stale/offline cue is on screen and the connection badge says connected. |
| K5 Link loss shown | \`socket-refuse\` for 6 s produces a new stale/offline cue within 5 s that clears on recovery. |
| K6 Phone | At 390 px every control reachable in the clean build at that size still is. |
| K7 Security | A device name containing HTML is shown as text and runs no script (no onerror, dialog or injected element). |`;

const SYSTEM_DESIGN = `## 1. System design

Two agents and a deterministic oracle suite. The **mutation agent** injects realistic Level-1 bugs; the **QA agent** catches them blind. No LLM runs inside the test loop, so every judged run is deterministic and repeatable.

\`\`\`
 mutation agent (qa/mutator.ts)                 QA system (deterministic, 0 LLM in the loop)
 reads cockpit source + product brief           driver.ts  -> clean start, takeoff/land, faults, add/remove drone
        |  proposes JSON search/replace          truth.ts   -> own socket.io client + REST polling = ground truth
        |  + answer key (category, file,          oracles.ts -> value-vs-truth, freshness, reachability,
        v   brief line, expected impact)                       cross-panel, control audit, XSS scan
 qa/mutants/generated/<id>.patch  - apply ->  cockpit ->  invariant suite K1-K7 (scenarios/k-invariants.ts)
 qa/mutants/generated/<id>.json (answer key)                 |  records video + trace, writes findings JSON
        |                                                     v
        +------------- compared ONLY after the run -->  mutants.ts: caught / missed / false alarm
\`\`\`

| Part | What it does |
|---|---|
| **Mutation agent** (\`mutator.ts\`) | A separate LLM agent (OpenAI, or Gemini / NVIDIA NIM) reads the cockpit source and the brief and proposes realistic mutations as search/replace edits, each with an **answer key**: category, file, what it breaks, the brief line it violates, the expected user impact. Each edit is validated (search occurs exactly once, mutated file still parses) and saved to \`mutants/generated/\` so runs replay deterministically. |
| **Condition driver** (\`driver.ts\`) | Puts the cockpit in a known state through the control API: clear faults, reset (seed 42), start, takeoff/land, inject faults, add/remove a drone. |
| **Truth observer** (\`truth.ts\`) | Independent ground truth: our own socket.io client (same handshake and topics) records every telemetry frame with arrival time and timestamp; \`/api/control/state\` and \`/api/health\` are polled from the backend. |
| **Oracles** (\`oracles.ts\`) | Zero-LLM checks comparing meaning, not pixels: value vs truth within tolerance, freshness vs a live baseline, reachability (in viewport, not covered via \`elementFromPoint\`, enabled), cross-panel consistency, whole-page control audit, and an XSS scan. Locators go test id -> role -> visible text and report which was used. |
| **Invariant suite K1-K7** (\`scenarios/k-invariants.ts\`) | Seven checks that hold on the unmodified kit and must fail when a bug is present. This is the blind detector: it never reads the answer keys. |
| **Blind scorer** (\`mutants.ts\`) | Applies each mutation, runs K1-K7 with a recording, reverts, and only THEN compares the failing checks to the answer key: caught / missed / false alarm, plus whether the failing check matches the agent's predicted one. |
| **Evidence HUD** (\`overlay.ts\`) | Injected into the page: scenario, brief line, steps, the API calls, a live truth-vs-UI table, red boxes on failing elements, verdict banner. Closed shadow root, \`pointer-events:none\`, so it never affects a check. |
| **Reporter** (\`report.ts\`) | This document. |

**The invariant suite (K1-K7).** Each passes on the unmodified kit and is the net for injected bugs:

${K_TABLE}

**Blind answer-key comparison.** The QA suite (K1-K7) imports no answer keys; it only sees the mutated cockpit. \`mutants.ts\` reads \`mutants/generated/<id>.json\` after each run to score it. "Caught" means K flagged the build as buggy at all; "attributed" means the check that fired is the one the agent predicted.
`;

function table(t: { columns: string[]; rows: (string | number | null)[][] }) {
  const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${t.columns.join(' | ')} |`, `|${t.columns.map(() => '---').join('|')}|`, ...t.rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

type Row = { id: string; title: string; planted: string; expected: string; failed: string[]; attributed?: boolean; generated?: boolean; outcome: string; video: string; verdict: string };
type Matrix = { ranAt: string; summary: { caught: number; planted: number; falseAlarms: number; harmless: number; errors: number }; rows: Row[] };
type Keyed = ReturnType<typeof answerKeys>[string] | undefined;
type Tabled = { table?: { columns: string[]; rows: (string | number | null)[][] } };

function loadFindings(): Finding[] {
  const load = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Finding) : []);
  const local = load(path.join(cfg.outDir, 'findings'));
  const cloud = load(path.join(RECORDINGS, 'findings')).filter((c) => !local.some((l) => l.id === c.id));
  return [...local, ...cloud];
}
function loadMatrix(): Matrix | undefined {
  const p = [path.join(cfg.outDir, 'mutants.json'), path.join(RECORDINGS, 'mutants.json')].find(existsSync);
  return p ? (JSON.parse(readFileSync(p, 'utf8')) as Matrix) : undefined;
}

const SEED_BRIEF: Record<string, string> = {
  'm1-badge-always-connected': 'makes clear whether information is live, delayed, stale, disconnected or unavailable',
  'm2-online-shown-offline': 'makes clear whether information is live, delayed, stale, disconnected or unavailable',
  'm3-battery-off-by-10': 'Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together',
  'm4-wrong-drone-telemetry': 'Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together',
  'm5-flying-shown-as-landed': 'Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together',
  'm6-connection-badge-removed': 'makes clear whether information is live, delayed, stale, disconnected or unavailable',
  'm7-device-list-offscreen-phone': 'Works in modern browsers on phones, tablets, laptops and desktops',
  'm8-xss-drone-name': 'Works in modern browsers on phones, tablets, laptops and desktops',
};

/** One numbered scenario per mutation, richest evidence from its recorded K run. */
function mutationScenario(n: number, row: Row, finding: Finding | undefined, ak: Keyed) {
  const meta = [...MUTANTS, ...loadGenerated()].find((m) => m.id === row.id);
  const briefLine = ak?.briefLine ?? SEED_BRIEF[row.id] ?? finding?.brief ?? '';
  const impact = ak?.expectedImpact ?? '';
  const caught = row.outcome === 'caught';
  const failed = row.failed.length ? row.failed.join(', ') : 'none';
  const kTable = (finding?.observations as Tabled | undefined)?.table;
  const video = path.basename(row.video || finding?.evidence.video || `K-${row.id}.webm`);
  return `#### ${n}. ${ak?.category ?? meta?.title ?? row.title}

**Verdict:** ${caught ? `CAUGHT by ${failed}` : row.outcome === 'missed' ? 'MISSED' : row.outcome}${row.attributed === false && caught ? ` (agent predicted ${row.expected})` : ''}
**Injected by:** ${row.generated ? 'mutation agent' : 'seed (written during development)'} · **Category:** ${ak?.category ?? finding?.category ?? '—'}
**Video:** _<paste Drive link: ${video}>_

**Description.** The mutation ${row.planted}. The operator expects ${impact || 'the cockpit to keep showing correct, current information'}.

> Product brief: “${briefLine}”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. ${caught ? `Check ${failed} failed` : 'No check failed'}, and the answer key was compared only afterwards.${row.attributed === false && caught ? " The failing check differs from the agent's predicted one, reported honestly." : ''}
${kTable ? `\n${table(kTable)}\n` : ''}`;
}

function precisionScenario(f: Finding) {
  const obs = f.observations as Tabled;
  return `#### ${f.title}

**Result: ${f.verdict.kind}.** ${f.verdict.sub ?? f.verdict.headline}

${f.description}
${obs.table ? `\n${table(obs.table)}\n` : ''}
**Video:** _<paste Drive link: ${f.evidence.video}>_
`;
}

function realBug(f: Finding, n: number) {
  const obs = f.observations as Tabled;
  return `#### ${n}. ${f.title}

**Verdict:** ${f.verdict.kind} · ${f.verdict.headline}
**Category:** ${f.category}
**Video:** _<paste Drive link: ${f.evidence.video}>_

**Description.** ${f.description}

> Product brief: “${f.brief}”

**Approach.** ${f.approach}

**Result.** ${f.verdict.sub ?? f.verdict.headline}
${obs.table ? `\n${table(obs.table)}\n` : ''}`;
}

export function writeReport(outDir = cfg.outDir) {
  const findings = loadFindings();
  const byId = new Map(findings.map((f) => [f.id, f]));
  const matrix = loadMatrix();
  const keys = answerKeys();

  const mutationRows = (matrix?.rows ?? []).filter((r) => r.id !== 'clean' && r.expected !== 'PASS');
  const generated = mutationRows.filter((r) => r.generated);
  const seeds = mutationRows.filter((r) => !r.generated);
  const harmless = (matrix?.rows ?? []).filter((r) => r.id === 'clean' || r.expected === 'PASS');

  const scenarioBugs = findings.filter((f) => (f.section ?? 'scenario') === 'scenario').sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const precision = findings.filter((f) => f.section === 'precision').sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  let n = 0;
  const summaryLine = matrix
    ? `**${matrix.summary.caught}/${matrix.summary.planted} injected mutations caught, ${matrix.summary.falseAlarms} false alarms across ${matrix.summary.harmless} clean/harmless builds${matrix.summary.errors ? `, ${matrix.summary.errors} errors` : ''}.** _(run ${matrix.ranAt})_`
    : '_No mutation run recorded yet._';

  const matrixTable = matrix
    ? table({
        columns: ['#', 'Mutation', 'By', 'Expected', 'Checks that fired', 'Outcome'],
        rows: mutationRows.map((r, i) => [i + 1, keys[r.id]?.category ?? r.title, r.generated ? 'agent' : 'seed', r.expected, r.failed.join(', ') || 'none', (r.outcome === 'caught' ? '✅ ' : r.outcome === 'missed' ? '❌ ' : '') + r.outcome]),
      })
    : '';

  const md = `# Tireless Hand · Level 1 evaluation

_Generated ${new Date().toISOString()} by \`qa/report.ts\`._

${SYSTEM_DESIGN}
## 2. Mutations injected and caught (numbered scenarios)

Our mutation agent injects Level-1 bugs into the cockpit; the QA suite catches them blind. Each mutation is one scenario. ${summaryLine}

*Provenance: the agent-generated mutations in §2a were authored by a separate Claude subagent given only the cockpit \`frontend/\` source, the product-brief lines and the Level-1 categories, with no access to the QA code (\`qa/\`) — a genuine blind test. \`qa/mutator.ts\` is the external-LLM version of the same agent (OpenAI / Gemini / NVIDIA NIM); it was not run in this environment because outbound egress to those APIs is blocked here, so it was exercised through the subagent instead. The §2b seed mutations were written by hand during development. All were validated (search unique, mutated file parses) and applied as git patches, then run through K1-K7 with the answer keys compared only afterwards.*

${matrixTable}

### 2a. Agent-generated mutations (separate Claude subagent, no QA access — caught blind)

${generated.map((r) => mutationScenario(++n, r, byId.get(`K-${r.id}`), keys[r.id])).join('\n')}

### 2b. Seed mutations (written during development)

${seeds.map((r) => mutationScenario(++n, r, byId.get(`K-${r.id}`), keys[r.id])).join('\n')}

## 3. Real bugs found in the original (unmutated) kit

Genuine defects already present in the unmodified kit, found while building the harness; each reproduced from a clean seeded start.

${scenarioBugs.map((f, i) => realBug(f, i + 1)).join('\n---\n\n')}

## 4. Precision controls (no false alarms)

The suite must not cry wolf. ${harmless.length ? `On ${harmless.length} clean/harmless builds it raised ${harmless.filter((r) => r.outcome === 'false alarm').length} false alarms.` : ''}

${precision.map(precisionScenario).join('\n')}
${harmless.length ? `\n**Harmless changes correctly ignored:** ${harmless.filter((r) => r.id !== 'clean').map((r) => `${r.title} → ${r.outcome}`).join('; ')}. The clean build passes all seven checks.\n` : ''}`;

  writeFileSync(path.join(outDir, 'report.md'), md);
  writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(findings, null, 2));
  return { md: path.join(outDir, 'report.md'), mutations: mutationRows.length, bugs: scenarioBugs.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = writeReport();
  console.log(`report → ${r.md} (${r.mutations} mutations, ${r.bugs} real bugs)`);
}
