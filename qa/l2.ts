/**
 * Level 2 (Performance): run L2-1 on this machine, then write out/WRITEUP-L2.md from the finding.
 *   npm run l2                      # fleet sizes 4 → 8 → 16 → 32 → 48 → 64 (stops at the first "poor" size)
 *   L2_LEVELS=4,16,32 npm run l2    # custom sizes (first = the kit's 4-drone baseline)
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cfg } from './config.ts';
import { runScenario, type Finding } from './runner.ts';
import { L2_1 } from './scenarios/l2-fleet-load.ts';

console.log(`\n▶ ${L2_1.id} · ${L2_1.title}`);
const f = await runScenario(L2_1);
console.log(`  ${f.verdict.kind}: ${f.verdict.headline}`);
if (f.verdict.sub) console.log(`  ${f.verdict.sub}`);
console.log(`  video ${f.evidence.video} · trace ${f.evidence.trace} · ${f.durationS} s`);

const table = f.observations.table as { columns: string[]; rows: (string | number)[][] } | undefined;
const md = writeup(f, table);
const out = path.join(cfg.outDir, 'WRITEUP-L2.md');
writeFileSync(out, md);
console.log(`\nwrite-up → ${out}`);

function writeup(f: Finding, t?: { columns: string[]; rows: (string | number)[][] }) {
  const cpu = os.cpus()[0]?.model?.trim() ?? 'unknown CPU';
  const machine = `${os.type()} ${os.release()} · ${cpu} · ${os.cpus().length} logical cores · ${Math.round(os.totalmem() / 2 ** 30)} GB RAM`;
  const tbl = t
    ? [`| ${t.columns.join(' | ')} |`, `|${t.columns.map(() => ' --- ').join('|')}|`, ...t.rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
    : '_no measurements (the run stopped before the baseline was measured)_';
  const steps = f.steps.map((s, i) => `${i + 1}. ${s.label}${s.detail ? `: ${s.detail}` : ''} (${s.state})`).join('\n');
  return `# Level 2 · Performance testing · {{TEAM_NAME}}

**Domain chosen:** Performance. The brief's "What should be tested" table lists it as: _"${f.brief}"_.

**Video:** {{VIDEO_LINK}}

**Code:** https://github.com/Tanmay-Ts/Tireless/tree/claude/flytbase-testing-harness-iwr6ar/qa (scenario \`qa/scenarios/l2-fleet-load.ts\`, probes \`qa/perf.ts\`, runner \`qa/l2.ts\`)

## System design: what Level 2 adds to the Level 1 harness

- **Same harness, no new framework.** The Level 1 runner (headed Chromium, real-time video, Playwright trace, on-screen HUD, finding JSON), the kit driver and the verdict rules are reused unchanged. Level 2 adds one probe module (\`perf.ts\`) and one scenario.
- **Zero LLM in the test loop.** The run is deterministic Playwright code.
- **Real load, not synthetic.** The load comes from the kit itself: drones are added through the kit's control API (\`POST /api/control/drones\`) and commanded to take off, so the cockpit receives real simulator telemetry for every drone.
- **Black-box probes, measured in the running cockpit:** main-thread busy % and script share (Chrome DevTools Protocol \`Performance.getMetrics\`, TaskDuration and ScriptDuration over a 6 s window), frame rate (\`requestAnimationFrame\`), long tasks (\`PerformanceObserver\`), JS heap and DOM nodes, and **click → result latency**: a real click on the device list, timed inside the page the way Core Web Vitals INP times an interaction, from the click's input timestamp (so time queued behind a busy main thread counts) to the first frame in which the telemetry panel shows the clicked drone. That is the delay the operator feels, and Playwright's own round trips are not part of it.
- **Thresholds from Core Web Vitals INP:** ≤ ${200} ms is good, > ${500} ms is poor.
- **Baseline rule (carried over from Level 1):** a check only counts if the unmodified kit passes it at its default size. The kit's default 4 drones must pass the same check (click ≤ 500 ms); if they do not, the run is SETUP-FAILED (the machine is too slow to judge), never a bug.
- **Clean up:** the added drones are removed and the simulator is reset after the recording.

## Scenario L2-1 · ${f.title}

**Category:** ${f.category}

**Result:** **${f.verdict.kind}**: ${f.verdict.headline}${f.verdict.sub ? `\n\n${f.verdict.sub}` : ''}

**Description:** ${f.description}

**Starting state:** ${f.startState}

**How to run:** from the repository, \`cd qa\`, \`npm install\`, \`npm run l2\` (kit running: cockpit on :4010, backend on :4000).

**Steps performed:**

${steps}

**Approach:** ${f.approach}

**Measurements (this run):**

${tbl}

**Environment:** cockpit ${f.env.cockpitUrl} · Chromium headed · ${f.env.viewport.width}×${f.env.viewport.height} · sim speed ${f.env.speed}× · ${machine} · ${f.startedAt} · ${f.durationS} s

**Evidence:** the video above (the HUD shows the table filling in as the fleet grows); \`qa/out/traces/L2-1.zip\` (Playwright trace); \`qa/out/findings/L2-1.json\` (every sample, including all click timings).

${f.verdict.kind === 'BUG' ? `**Likely root cause (read from the kit source after the test; the test itself is black-box):** \`DeviceList.tsx\` and \`TelemetryPanel.tsx\` both subscribe to the whole telemetry map (\`useTelemetryStore((s) => s.data)\`), and the store replaces that map on every message (\`data: { ...s.data, [deviceId]: next }\`). So every telemetry message from any drone or dock re-renders both panels. The work grows with fleet size × message rate, the main thread saturates, and clicks queue behind renders. A fix is to subscribe each row and the panel to only the device they show.` : `**Where the load goes (read from the kit source after the test; the test itself is black-box):** \`DeviceList.tsx\` and \`TelemetryPanel.tsx\` both subscribe to the whole telemetry map, which the store replaces on every message, so both panels re-render for every telemetry message from any drone. The main-thread and frame-rate columns show that cost growing with fleet size; clicks stayed within the threshold on this machine up to the largest size measured.`}
`;
}
