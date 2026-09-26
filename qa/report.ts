/**
 * findings/*.json → findings.json + report.md (draft of the evaluation document).
 * Deterministic templating only; wording can be polished by hand (or offline by an LLM) later.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cfg, QA_ROOT } from './config.ts';
import type { Finding } from './runner.ts';

const SYSTEM_DESIGN = `## 1. System design

A deterministic, black-box testing harness (TypeScript + Playwright) that drives the cockpit like an operator, reads independent ground truth from the backend, and judges the UI with rule-based oracles. **No LLM is called inside the test loop**, so runs are repeatable, fast and free.

| Part | What it does |
|---|---|
| **Condition driver** (\`driver.ts\`) | Puts the system in a known state and changes conditions through the kit's control API: clear faults, reset (every drone on its dock at 100 %), start the simulator (seed 42), take off / land, inject faults (\`sim-offline\`, \`socket-delay\`, …). Every call is logged and shown on screen. |
| **Truth observer** (\`truth.ts\`) | Independent ground truth: our own socket.io client (same handshake and topics as the cockpit) records every telemetry frame with its arrival time and timestamp; \`/api/control/state\` is polled straight from the simulator (it keeps moving even when the telemetry path is broken); \`/api/health\` gives the simulator link. |
| **Oracles** (\`oracles.ts\`) | Zero-LLM checks that compare *meaning*, not pixels or exact strings: UI value vs truth within a tolerance; freshness (when truth is stale, the UI must show a new stale/offline cue compared with a live baseline); reachability (visible, in viewport, not covered via \`elementFromPoint\`, enabled); cross-panel consistency (status pill vs device list vs simulator); internal consistency (claimed speed vs distance actually moved). Elements are found by test id, then role + name, then visible label/text, and the fallback used is recorded (so a renamed test id does not break the run). |
| **Evidence HUD** (\`overlay.ts\`) | Injected into the page for the recording: scenario id, brief line, starting state, steps ticking off, the API calls made, a live truth-vs-UI table, red boxes on the failing elements and a verdict banner. It lives in a closed shadow root with \`pointer-events:none\`, so it can never influence a check. |
| **Device harness** (\`device.ts\`) | Phone and tablet layouts: the cockpit runs in a frame whose viewport is exactly the device size (so the app's own responsive rules apply), shown next to the evidence panel. Results are cross-checked in real device emulation (touch, high-DPI, mobile browser). |
| **Invariant suite K + mutation runner** (\`scenarios/k-invariants.ts\`, \`mutants.ts\`) | Six cockpit rules that hold on the unmodified kit (presence, values vs backend, cross-panel status, no false offline, link loss shown, phone reachability vs the clean build). The runner plants bugs in the cockpit source, runs K on each, reverts, and scores caught / missed / false alarm. This is the net for the judges' mutations. |
| **Runner** (\`runner.ts\`) | Headed Chromium, real-time video at the viewport size plus a Playwright trace per scenario. A precondition that cannot be met (e.g. fault did not take effect) is reported as SETUP-FAILED, never as a bug. |
| **Reporter** (\`report.ts\`) | Turns findings JSON into this document: numbered scenarios with Title, Description, Approach, evidence and video link. Findings sharing a root cause are grouped. |

**How they work together:** driver sets a clean, seeded start → truth observer starts recording → runner opens the cockpit and performs the operator workflow → driver injects the changing condition → oracles sample UI and truth every second → HUD shows it live on the recording → verdict + artefacts → reporter.

**Scope and assumptions:** only the cockpit is under test; the control panel is out of scope and never opened. The backend (health, simulator state, socket) is treated as correct and is the reference the screen is compared against; it is also how conditions are set up, so setup works however the cockpit is mutated. Intended backend behaviour is not flagged: for example, Land returns the drone to its dock even though the kit README still says it lands where it is.

**Precision controls:** every scenario first checks the UI is correct while conditions are normal (a control phase), gives the UI a grace period before judging, requires the failure on every judged sample (not a single glitch), and verifies the fault really took effect from truth before judging the UI.
`;

function table(t: { columns: string[]; rows: (string | number | null)[][] }) {
  const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '\\|');
  return [`| ${t.columns.join(' | ')} |`, `|${t.columns.map(() => '---').join('|')}|`, ...t.rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

function scenarioMd(f: Finding, n: number) {
  const obs = f.observations as {
    table?: { columns: string[]; rows: (string | number | null)[][] };
    alsoObserved?: { rootCause: string; note: string }[];
  };
  const also = obs.alsoObserved?.length
    ? `\n**Also observed (reported under its own root cause, not counted again):**\n${obs.alsoObserved.map((a) => `- \`${a.rootCause}\`: ${a.note}`).join('\n')}\n`
    : '';
  const fallbacks = Object.entries(f.locators).filter(([, v]) => v !== 'testid');
  return `### ${n}. ${f.title}

**Verdict:** ${f.verdict.kind} · ${f.verdict.headline}
**Category:** ${f.category} · **Root cause key:** \`${f.rootCause}\`
**Video:** _<paste Drive link: ${f.evidence.video}>_

**Description.** ${f.description}

> Product brief: “${f.brief}”

**Approach.** ${f.approach}

**Starting state.** ${f.startState}

**Steps (as run, visible on the HUD).**
${f.steps.map((s, i) => `${i + 1}. ${s.label}${s.detail ? ` (${s.detail})` : ''}: ${s.state}`).join('\n')}

**API calls.**
${f.apiCalls.map((c) => `- t+${c.atS}s \`${c.method} ${c.path}${c.body ? ' ' + JSON.stringify(c.body) : ''}\` → ${c.status}`).join('\n')}

**Result.** ${f.verdict.sub ?? f.verdict.headline}
${obs.table ? `\n${table(obs.table)}\n` : ''}${also}${fallbacks.length ? `\nLocator fallbacks used (test id missing): ${fallbacks.map(([k, v]) => `${k} → ${v}`).join(', ')}\n` : ''}
_Evidence: video \`${f.evidence.video}\`, trace \`${f.evidence.trace}\` (open with \`npx playwright show-trace\`), screenshot \`${f.evidence.screenshot}\`. Run ${f.startedAt}, ${f.durationS} s, viewport ${f.env.viewport.width}×${f.env.viewport.height}, speed ${f.env.speed}×._
`;
}

const K_TEXT = `The invariant suite K is the regression net for *new* bugs, such as the judges' mutations. Every check passes on the unmodified kit:

| Check | Must hold |
|---|---|
| K1 Presence | Connection badge, every device row, status pill, all 9 telemetry values (with numbers), map, video tile and map toggles are displayed; every control reachable in the clean build still is (semantic diff against the clean baseline). |
| K2 Values | Battery, altitude, H-speed, distance from home and heading match the latest telemetry frame for the selected drone (2 of 3 samples within tolerance). |
| K3 Cross-panel | Device-list pill, telemetry status pill and backend agree on the flight state. |
| K4 No false offline | While data is live, there is no stale/offline cue anywhere and the connection badge says connected. |
| K5 Link loss shown | \`socket-refuse\` for 6 s gives a new stale/offline cue within 5 s, which clears after recovery. |
| K6 Phone | At 390 px every control reachable in the clean build at that size still is. |`;

const RECORDINGS = path.join(QA_ROOT, 'recordings');

function mutationSection(outDir: string) {
  // Prefer a local run; fall back to the matrix recorded in the cloud and committed in qa/recordings/.
  const p = [path.join(outDir, 'mutants.json'), path.join(RECORDINGS, 'mutants.json')].find((f) => existsSync(f)) ?? path.join(outDir, 'mutants.json');
  if (!existsSync(p)) return `### Mutation testing\n\n${K_TEXT}\n\n_No mutation run yet: \`KIT_DIR=… npm run mutants\`._\n`;
  const m = JSON.parse(readFileSync(p, 'utf8')) as {
    ranAt: string;
    summary: { caught: number; planted: number; falseAlarms: number; harmless: number; errors: number };
    rows: { id: string; title: string; planted: string; expected: string; failed: string[]; outcome: string; video: string }[];
  };
  const mark = (o: string) => (o === 'caught' || o === 'correctly passed' ? '✅' : '❌');
  return `### Mutation testing: planted bugs are caught, harmless changes are not flagged

${K_TEXT}

We planted ${m.summary.planted} bugs in the cockpit source (patches in \`qa/mutants/\`) and added ${m.summary.harmless - 1} harmless changes. Each build ran through K with a recording.
**Result: ${m.summary.caught}/${m.summary.planted} planted bugs caught, ${m.summary.falseAlarms} false alarms across ${m.summary.harmless} clean/harmless builds${m.summary.errors ? `, ${m.summary.errors} errors` : ''}.** _(run ${m.ranAt})_

${table({
  columns: ['Build', 'What was changed', 'Expected', 'Checks that failed', 'Outcome', 'Video'],
  rows: m.rows.map((r) => [r.title, r.planted, r.expected, r.failed.join(', ') || 'none', `${mark(r.outcome)} ${r.outcome}`, `_<link: ${r.video}>_`]),
})}
`;
}

function precisionSection(fs: Finding[]) {
  if (!fs.length) return '';
  return fs
    .map((f) => {
      const obs = f.observations as { table?: { columns: string[]; rows: (string | number | null)[][] } };
      return `### Precision check: ${f.title}

${f.description}

**How:** ${f.approach}

**Result: ${f.verdict.kind}: ${f.verdict.headline}.** ${f.verdict.sub ?? ''}
${obs.table ? `\n${table(obs.table)}\n` : ''}
**Video:** _<paste Drive link: ${f.evidence.video}>_
`;
    })
    .join('\n');
}

export function writeReport(outDir = cfg.outDir) {
  const load = (dir: string) =>
    existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Finding) : [];
  // Local runs win; anything not run locally (e.g. S1-fixed on a laptop) comes from the committed cloud recordings.
  const local = load(path.join(outDir, 'findings'));
  const cloud = load(path.join(RECORDINGS, 'findings')).filter((c) => !local.some((l) => l.id === c.id));
  const all: Finding[] = [...local, ...cloud].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const findings = all.filter((f) => (f.section ?? 'scenario') === 'scenario');
  const precision = all.filter((f) => f.section === 'precision');

  // One root cause = one finding: later scenarios with the same key are listed as symptoms of the first.
  const groups = new Map<string, Finding[]>();
  for (const f of findings.filter((f) => f.verdict.kind === 'BUG')) groups.set(f.rootCause, [...(groups.get(f.rootCause) ?? []), f]);

  const summary = table({
    columns: ['#', 'Scenario', 'Category', 'Verdict', 'Root cause'],
    rows: findings.map((f, i) => {
      const g = groups.get(f.rootCause);
      const dup = g && g.length > 1 && g[0] !== f ? ` (same root cause as ${g[0].id})` : '';
      return [i + 1, `${f.id} · ${f.title}`, f.category, f.verdict.kind, `\`${f.rootCause}\`${dup}`];
    }),
  });

  const md = `# Tireless Hand · Level 1 evaluation (draft)

_Generated ${new Date().toISOString()} by \`qa/report.ts\` from \`out/findings/*.json\` and \`out/mutants.json\`._

${SYSTEM_DESIGN}
${precisionSection(precision)}
${mutationSection(outDir)}
## 2. Scenarios

${summary}

${findings.map((f, i) => scenarioMd(f, i + 1)).join('\n---\n\n')}`;

  const mdPath = path.join(outDir, 'report.md');
  writeFileSync(mdPath, md);
  writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(all, null, 2));
  return { md: mdPath, count: findings.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = writeReport();
  console.log(`${r.count} finding(s) → ${r.md}`);
}
