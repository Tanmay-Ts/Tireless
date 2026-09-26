/**
 * Builds the Level-1 evaluation document: submission/WRITEUP.md (+ WRITEUP.docx via pandoc).
 * One continuous numbering: caught agent mutations, caught seed mutations, then real kit bugs S1–S4.
 * Misses and precision controls are listed but not numbered. Video links are {{LINK:<file>.mp4}}
 * placeholders, filled from submission/LINKS.txt when it has URLs (TEAM_NAME too).
 *   npx tsx writeup.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cfg, QA_ROOT } from './config.ts';
import type { Finding } from './runner.ts';

const SUB = path.resolve(QA_ROOT, '..', 'submission');
const RECORDINGS = path.join(QA_ROOT, 'recordings');

const loadDir = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Finding) : []);
const local = loadDir(path.join(cfg.outDir, 'findings'));
const findings = new Map([...loadDir(path.join(RECORDINGS, 'findings')), ...local].map((f) => [f.id, f])); // local wins
type Row = { id: string; failed: string[]; outcome: string; generated?: boolean };
const matrixPath = [path.join(cfg.outDir, 'mutants.json'), path.join(RECORDINGS, 'mutants.json')].find(existsSync)!;
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as { rows: Row[] };
const row = (id: string) => matrix.rows.find((r) => r.id === id);
const patchOf = (id: string) => (id.startsWith('gen-') ? `qa/mutants/generated/${id}.patch` : `qa/mutants/${id}.patch`);
const L = (file: string) => `{{LINK:${file}}}`;

const BRIEF = {
  live: 'makes clear whether information is live, delayed, stale, disconnected or unavailable',
  select: 'Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together',
  devices: 'Works in modern browsers on phones, tablets, laptops and desktops',
};
const SECURITY_QUOTE = '> Level 1: “Static UI and basic security testing” · What should be tested: **Security and permissions**';

const CHECK: Record<string, string> = {
  K1: 'K1 (presence) probes every element the brief needs — connection badge, device rows, status pill, the nine telemetry values (with numbers), map, video tile, map toggles — for real visibility (inside the viewport, not covered: `elementFromPoint` hits the element), and diffs every interactive control against the saved clean-build baseline.',
  K2: 'K2 (values) compares battery, altitude, H-speed, distance from home and heading on screen with the latest telemetry frame our own socket client received for the same drone (tolerances ±1.5 %, ±2 m, ±1 m/s, ±12 m, ±3°); a field fails when 2 of 3 samples are off.',
  K3: 'K3 (cross-panel) classifies the flight state shown by the device-list pill, the telemetry status pill and the backend (`/api/control/state`) and requires all three to agree.',
  K4: 'K4 (no false offline) requires that, while our socket confirms telemetry is live, there is no stale/offline wording, marker or dimming anywhere on screen and the connection badge says connected.',
  K5: 'K5 (link loss shown) refuses the cockpit socket for 6 s (`POST /api/control/fault {"kind":"socket-refuse","seconds":6}`) and requires a new stale/offline cue within 5 s that clears after recovery.',
  K6: 'K6 (phone) re-opens the cockpit at 390×844 (iPhone 13) and requires every control that is reachable in the clean build at that size to still be visible and tappable, scrolling allowed.',
  K7: 'K7 (security) adds a drone named `<img src=x onerror=…><i data-xss>MARKER</i>` through `POST /api/control/drones` and requires the cockpit to show it as text: no `onerror` execution, no dialog, no injected element.',
};

type M = { title: string; category: string; broke: string; expects: string; why: string; quote: string; also?: string };
const MUT: Record<string, M> = {
  'gen-02-hspeed-wrong-source': {
    title: 'H-Speed wired to vertical speed: a cruising drone reads 0 m/s',
    category: 'Telemetry',
    broke: 'The mutation agent rewired the H-Speed readout in `TelemetryPanel.tsx` to the vertical-speed field.',
    expects: 'An operator watching Drone 1 cruise at 10 m/s expects H-Speed to read about 10 m/s.',
    why: 'Speed is how the operator predicts where the drone will be next; a drone that looks stationary while it flies away is an operational hazard.',
    quote: `> Product brief: “${BRIEF.select}”`,
  },
  'gen-03-device-name-raw-html': {
    title: 'Drone name rendered as raw HTML: a name can run script in the cockpit',
    category: 'Security and permissions',
    broke: 'The drone name in the device list (`DeviceList.tsx`) is rendered with `dangerouslySetInnerHTML` instead of as text.',
    expects: 'A drone name is displayed exactly as typed, whatever characters it contains, and never executes.',
    why: 'Anyone who can name a drone can run script in every operator\'s cockpit (stored XSS) and act with the operator\'s session.',
    quote: SECURITY_QUOTE,
    also: 'The same bug was produced independently by the mutation agent (gen-03) and by the hand-written seed set (m8, `qa/mutants/m8-xss-drone-name.patch`); it is counted once. Both runs were caught by K7.',
  },
  'gen-05-video-tile-removed': {
    title: 'Video tile removed: selecting a drone shows no video panel',
    category: 'Visual UI · Video and media',
    broke: 'The mutation agent removed `<VideoTile />` from `CockpitPage.tsx`.',
    expects: 'Selecting a drone shows its video tile (feed and its state) next to the telemetry.',
    why: 'The operator loses the drone\'s camera view and any indication of whether video is available.',
    quote: `> Product brief: “${BRIEF.select}”`,
  },
  'm1-badge-always-connected': {
    title: 'Connection badge stuck on “connected” while the link is down',
    category: 'Network and recovery',
    broke: 'The connection badge (`SocketBadge.tsx`) always renders “socket connected” in the connected colour, whatever the real socket state.',
    expects: 'When the telemetry link drops, the badge changes (reconnecting / disconnected) so the operator knows the numbers have stopped updating.',
    why: 'Operators would act on frozen data believing it is live.',
    quote: `> Product brief: “${BRIEF.live}”`,
  },
  'm2-online-shown-offline': {
    title: 'Live connection shown as “disconnected”',
    category: 'Visual UI',
    broke: 'The connection badge shows “socket disconnected” while the socket is actually connected.',
    expects: 'While telemetry is flowing, the cockpit says the link is live.',
    why: 'A false offline indication makes operators distrust correct data or abort a working mission.',
    quote: `> Product brief: “${BRIEF.live}”`,
  },
  'm3-battery-off-by-10': {
    title: 'Battery shown 10 % lower than the drone reports',
    category: 'Telemetry',
    broke: '`TelemetryPanel.tsx` subtracts 10 from the battery percentage before display.',
    expects: 'The battery on screen matches what the drone reports.',
    why: 'Battery decides when to bring a drone home; a wrong value causes needless returns, or with the opposite error, a stranded drone.',
    quote: `> Product brief: “${BRIEF.select}”`,
  },
  'm4-wrong-drone-telemetry': {
    title: 'Telemetry panel shows another drone\'s data',
    category: 'Telemetry',
    broke: '`TelemetryPanel.tsx` reads the data of drone N+1 for the selected drone N.',
    expects: 'Selecting Drone 1 shows Drone 1\'s altitude, speed and status.',
    why: 'Decisions are made about the wrong aircraft: the brief\'s “data belongs to the wrong source” failure.',
    quote: `> Product brief: “${BRIEF.select}”`,
  },
  'm5-flying-shown-as-landed': {
    title: 'Flying drone\'s status pill says “standby”',
    category: 'Visual UI',
    broke: 'The telemetry status pill shows “standby” whenever the drone is `in_flight`.',
    expects: 'The status pill, the device list and the drone\'s real state agree.',
    why: 'Conflicting statuses: an operator could treat an airborne drone as parked on its dock.',
    quote: `> Product brief: “${BRIEF.select}”`,
  },
  'm6-connection-badge-removed': {
    title: 'Connection indicator removed from the cockpit',
    category: 'Visual UI · Network and recovery',
    broke: '`<SocketBadge />` is deleted from `CockpitPage.tsx`.',
    expects: 'A visible connection indicator that changes when the link drops.',
    why: 'Without it the cockpit cannot say whether data is live, so link loss becomes invisible.',
    quote: `> Product brief: “${BRIEF.live}”`,
  },
  'm7-device-list-offscreen-phone': {
    title: 'Device list pushed off-screen on phones',
    category: 'Responsive UI',
    broke: '`styles.css` moves the side panel off-screen below 800 px (`translateX(-110vw)`).',
    expects: 'On a phone the operator can still see the drones and tap one to select it.',
    why: 'Selecting a drone, the cockpit\'s main action, becomes impossible on phones.',
    quote: `> Product brief: “${BRIEF.devices}”`,
  },
};

const MISS: Record<string, { title: string; category: string; text: string }> = {
  'gen-01-video-live-shown-off': {
    title: 'Live video shown as “off”',
    category: 'Video and media',
    text: 'The agent inverted the video-enabled test in `VideoTile.tsx`, so a live stream would display the “Video off” placeholder. In the kit\'s normal setup the cockpit shows a live FPV stream (organizers\' setup guide: MediaMTX serves one WHEP feed per drone). The cloud recording environment had no video stream, so the clean cockpit already showed “off”, and the suite has no video-liveness check yet: “video is live” cannot be asserted as an invariant there. Next step: a video-liveness oracle that compares the tile\'s label with actual playback (`currentTime` advancing, `videoWidth` > 0, frame hashes changing), run on a machine with the live stream up.',
  },
  'gen-04-left-panel-clipped-phone': {
    title: 'Phone side panel made unscrollable',
    category: 'Responsive UI',
    text: 'The agent added `overflow: hidden` to the phone side panel, clipping the telemetry below its fold. The unmodified kit already hides telemetry on phones (real bug S4 below), so “telemetry visible on a phone” cannot be a clean-passing invariant. K6 checks that interactive controls stay reachable; all four device-row controls still fit at 390 px, so control reachability is genuinely unchanged. The mutation worsens a pre-existing defect instead of introducing a newly detectable one.',
  },
};

const REAL_CATEGORY: Record<string, string> = {
  S1: 'Telemetry · Network and recovery',
  S2: 'Telemetry · Network and recovery',
  S3: 'Responsive UI',
  S4: 'Responsive UI',
};

function table(cols: string[], rows: (string | number)[][]) {
  const cell = (v: unknown) => String(v ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

// ---- numbering -------------------------------------------------------------------------------
const caught = (id: string) => row(id)?.outcome === 'caught';
const agentIds = Object.keys(MUT).filter((id) => id.startsWith('gen-') && caught(id));
const seedIds = Object.keys(MUT).filter((id) => id.startsWith('m') && caught(id));
const realIds = ['S1', 'S2', 'S3', 'S4'].filter((id) => findings.has(id));
const missIds = matrix.rows.filter((r) => r.generated && r.outcome === 'missed').map((r) => r.id);
type Entry = { n: number; id: string; kind: 'agent' | 'seed' | 'real' };
let n = 0;
const numbered: Entry[] = [
  ...agentIds.map((id) => ({ n: ++n, id, kind: 'agent' as const })),
  ...seedIds.map((id) => ({ n: ++n, id, kind: 'seed' as const })),
  ...realIds.map((id) => ({ n: ++n, id, kind: 'real' as const })),
];

// ---- per-scenario blocks ---------------------------------------------------------------------
function mutationBlock(e: Entry) {
  const m = MUT[e.id];
  const f = findings.get(`K-${e.id}`)!;
  const checks = (f.observations as { checks: Record<string, { ok: boolean | null; summary: string }> }).checks;
  const failed = Object.entries(checks).filter(([, c]) => c.ok === false);
  const passed = Object.entries(checks).filter(([, c]) => c.ok === true).map(([k]) => k);
  const shortId = e.id.split('-').slice(0, e.id.startsWith('gen-') ? 2 : 1).join('-');
  const alsoRow = e.id === 'gen-03-device-name-raw-html' ? findings.get('K-m8-xss-drone-name') : undefined;
  return `### ${e.n}. ${m.title}

**Category:** ${m.category} · **Injected by:** ${e.kind === 'agent' ? 'mutation agent (separate Claude subagent)' : 'seed set (written during development)'} · **Detected by:** ${failed.map(([k]) => k).join(' + ')}

**Description.** What is tested: whether the cockpit notices this change. **Broken:** ${m.broke} **Expected by the operator:** ${m.expects} **Why it matters:** ${m.why}${m.also ? `\n\n${m.also}` : ''}

${m.quote}

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation \`${patchOf(e.id)}\` applied to the kit.

**Steps.**
1. With the kit running and \`KIT_DIR\` set in \`qa/.env\`, run \`cd qa\` then \`npm run mutants -- ${shortId}\`. The runner applies \`${patchOf(e.id)}\` with \`git apply\`, runs the checks with a recording, then reverts it (\`git apply -R\`).
2. Clean start: \`DELETE /api/control/fault\`, \`POST /api/control/sim {"action":"reset"}\`, \`POST /api/control/sim {"action":"start","speed":1}\`.
3. Open the cockpit, click Drone 1 in the device list, \`POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}\`, wait for \`in_flight\`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** ${failed.map(([k]) => CHECK[k]).join(' ')} The checks never read the mutation's answer key; it is compared only after the run.

**Result.** ${failed.map(([k, c]) => `${k} failed: ${c.summary}.`).join(' ')} ${passed.length ? `${passed.join(', ')} passed.` : ''}${alsoRow ? ` Seed m8 run: ${alsoRow.verdict.headline}.` : ''}

**Video:** ${L(`K-${e.id}.mp4`)}${alsoRow ? ` · seed m8 run: ${L('K-m8-xss-drone-name.mp4')}` : ''}
`;
}

function realBlock(e: Entry) {
  const f = findings.get(e.id)!;
  const obs = f.observations as { table?: { columns: string[]; rows: (string | number | null)[][] } };
  const steps = f.steps.map((s, i) => `${i + 1}. ${s.label}${s.detail ? ` (${s.detail})` : ''}`).join('\n');
  const api = table(['t', 'call', 'status'], f.apiCalls.map((c) => [`+${c.atS} s`, `\`${c.method} ${c.path}${c.body ? ' ' + JSON.stringify(c.body) : ''}\``, c.status]));
  return `### ${e.n}. ${f.title}

**Category:** ${REAL_CATEGORY[e.id] ?? f.category} · **Found in:** the original, unmutated kit · **Verdict:** ${f.verdict.kind}: ${f.verdict.headline}

**Description.** ${f.description}

> Product brief: “${f.brief}”

**Starting state.** ${f.startState}.

**Steps** (run with \`cd qa\` then \`npm run scenario -- ${e.id}\`; every step is shown on the video's HUD):
${steps}

**API calls made** (seconds from start):

${api}

**Approach.** ${f.approach}

**Result.** ${f.verdict.sub ?? f.verdict.headline}
${obs.table ? `\n${table(obs.table.columns, obs.table.rows.map((r) => r.map((v) => (v ?? '—') as string | number)))}\n` : ''}
**Video:** ${L(`${e.id}.mp4`)}
`;
}

// ---- document ----------------------------------------------------------------------------------
const index = table(
  ['#', 'Scenario', 'Category', 'Type', 'Detected by / verdict', 'Video'],
  [
    ...numbered.map((e) =>
      e.kind === 'real'
        ? [e.n, findings.get(e.id)!.title, REAL_CATEGORY[e.id], 'real bug in the original kit', findings.get(e.id)!.verdict.kind, L(`${e.id}.mp4`)]
        : [e.n, MUT[e.id].title, MUT[e.id].category, e.kind === 'agent' ? 'agent mutation' : 'seed mutation', `caught by ${row(e.id)!.failed.join(' + ')}`, L(`K-${e.id}.mp4`)],
    ),
    ...missIds.map((id) => ['—', MISS[id]?.title ?? id, MISS[id]?.category ?? '', 'agent mutation', 'missed (see Misses)', L(`K-${id}.mp4`)]),
  ],
);

const agentCaught = agentIds.length;
const agentTotal = matrix.rows.filter((r) => r.generated).length;
const seedsCaught = matrix.rows.filter((r) => r.id.startsWith('m') && r.outcome === 'caught').length;
const seedsTotal = matrix.rows.filter((r) => r.id.startsWith('m')).length;
const falseAlarms = matrix.rows.filter((r) => (r.id === 'clean' || r.id.startsWith('h')) && r.outcome === 'false alarm').length;

const md = `# Tireless Hand · Level 1 evaluation

**Team:** {{TEAM_NAME}}

**Evaluation setup (host's note):** the hosts do not inject mutations during evaluation. Each team's system must include its own agent that inserts mutations into the product; the testing system then has to catch them, and each identification is a submitted scenario. Bugs our system found in the original kit are listed separately (scenarios ${realIds.length ? `${numbered.find((e) => e.kind === 'real')!.n}–${numbered[numbered.length - 1].n}` : ''}).

**Summary:** ${numbered.length} numbered scenarios: ${agentCaught + seedIds.length} caught mutations (${agentCaught}/${agentTotal} agent-generated, ${seedsCaught}/${seedsTotal} seed; the one bug both sets produced is counted once) and ${realIds.length} real bugs in the original kit. ${falseAlarms} false alarms on the clean kit and two harmless changes. The agent's ${missIds.length} misses are reported honestly in their own section.

## 1. System design

Two cooperating parts: a **mutation agent** that injects realistic Level-1 bugs into the cockpit, and a deterministic **QA system** that catches them blind. No LLM runs inside the test loop, so every judged run is repeatable.

\`\`\`
 mutation agent                                  QA system (deterministic, 0 LLM calls in the loop)
 reads cockpit source + product brief            driver.ts  -> clean start, takeoff/land, faults, add/remove drone
   | proposes JSON search/replace                truth.ts   -> own socket.io client + REST polling = ground truth
   | + answer key (category, file,               oracles.ts -> value vs truth, freshness, reachability,
   v   brief line, expected impact)                           cross-panel, control audit, XSS scan
 qa/mutants/generated/<id>.patch  -- apply -->  cockpit  -->  invariant suite K1-K7, recorded (video + trace)
 qa/mutants/generated/<id>.json (answer key)                  |
   +-------------- compared ONLY after the run ------------> mutants.ts: caught / missed / false alarm
\`\`\`

| Part | What it does |
|---|---|
| **Mutation agent** | Reads the cockpit source and the brief and proposes realistic mutations as search/replace edits, each with an **answer key** (category, file, what it breaks, brief line, expected impact). **For this submission the role was played by a separate Claude subagent that was given only the cockpit \`frontend/\` source, the brief lines and the Level-1 categories, with no access to the QA code (\`qa/\`).** \`qa/mutator.ts\` is the external-LLM version of the same agent (OpenAI / Gemini / NVIDIA NIM); it was **not run here**, because this environment blocks outbound access to those APIs. Every proposed edit is validated (search text occurs exactly once, mutated file still parses) and saved as a git patch so runs replay deterministically. |
| **Condition driver** (\`driver.ts\`) | Puts the cockpit in a known state through the kit's control API: clear faults, reset (seed 42), start, takeoff/land, inject faults, add/remove a drone. |
| **Truth observer** (\`truth.ts\`) | Independent ground truth: our own socket.io client (same handshake and topics as the cockpit) records every telemetry frame with arrival time and timestamp; \`/api/control/state\` and \`/api/health\` are polled from the backend. |
| **Oracles** (\`oracles.ts\`) | Zero-LLM checks that compare meaning, not pixels: value vs truth within a tolerance, freshness vs a live baseline, reachability (inside the viewport, not covered via \`elementFromPoint\`, enabled), cross-panel consistency, a whole-page control audit, and an XSS scan. Elements are located by test id, then role, then visible text, and the fallback used is recorded. |
| **Invariant suite K1–K7** | Seven checks that pass on the unmodified kit and must fail when a bug is present: the blind detector (table below). It never reads the answer keys. |
| **Blind scorer** (\`mutants.ts\`) | Applies each mutation, runs K1–K7 with a recording, reverts, and only then compares the failing checks with the answer key: caught / missed / false alarm. |
| **Real-bug scenarios** (\`scenarios/s1…s4\`) | Workflow scenarios with fault injection and device sizes that found four defects in the original kit. |
| **Evidence HUD** (\`overlay.ts\`) | Injected into the page for every recording: scenario, brief line, starting state, steps ticking off, the API calls, a live truth-vs-UI table, red boxes on failing elements, verdict banner. Closed shadow root with \`pointer-events:none\`, so it never affects a check. |

| Check | Holds on the unmodified kit |
|---|---|
| K1 Presence | Connection badge, every device row, status pill, all 9 telemetry values (with numbers), map, video tile and both map-view toggles are displayed; every control reachable in the clean build still is. |
| K2 Values | Battery, altitude, H-speed, distance from home and heading match the latest telemetry frame for the selected drone. |
| K3 Cross-panel | Device-list pill, telemetry status pill and backend agree on the flight state. |
| K4 No false offline | While data is live, no stale/offline cue is on screen and the connection badge says connected. |
| K5 Link loss shown | Refusing the socket for 6 s produces a new stale/offline cue within 5 s that clears on recovery. |
| K6 Phone | At 390×844 every control reachable in the clean build at that size still is. |
| K7 Security | A drone name containing HTML is shown as text and runs no script. |

**Rule learned from the misses:** a check can only catch mutations if the original kit already passes it. Anything the kit already gets wrong (see scenarios ${realIds.length ? numbered.find((e) => e.kind === 'real')!.n : ''}–${numbered.length}) cannot be an invariant.

**Recording environment:** runs were recorded in real time in a cloud container that lacked two things the kit normally has: internet **map tiles** (the globe renders plain; no check depends on map pixels, since the map is a canvas and K1 only asserts the map container is present) and a **live video stream** (the video tile reads “off”; this is the reason for the video-liveness gap explained under Misses). Telemetry, socket, faults, responsive layout and security are fully exercised.

## 2. Scenarios

${index}

${numbered.map((e) => (e.kind === 'real' ? realBlock(e) : mutationBlock(e))).join('\n---\n\n')}

## 3. Misses (not numbered)

The mutation agent produced ${missIds.length} mutations that the suite did not flag. They are reported, not hidden.

${missIds.map((id) => `**${MISS[id]?.title ?? id}** (${MISS[id]?.category ?? ''}, \`${patchOf(id)}\`). ${MISS[id]?.text ?? ''} Video: ${L(`K-${id}.mp4`)}`).join('\n\n')}

## 4. Precision controls (not numbered)

The suite must not raise false alarms. Each control below was run with a recording.

- **Clean kit:** all seven checks pass on the unmodified kit (${findings.get('K-clean')?.verdict.headline ?? ''}). Video: ${L('K-clean.mp4')}
- **Harmless: test ids renamed.** ${findings.get('K-h1-testids-renamed')?.verdict.headline ?? ''}: elements found through visible text and labels instead. Video: ${L('K-h1-testids-renamed.mp4')}
- **Harmless: wording changed** (“FlytBase Cockpit”→“FlytBase Operations”, “Devices”→“Fleet”, “socket …”→“link …”). ${findings.get('K-h2-wording-change')?.verdict.headline ?? ''}: meaning is compared, not text. Video: ${L('K-h2-wording-change.mp4')}
- **Land returns to the dock (intended, not flagged).** ${findings.get('P1')?.verdict.sub ?? ''} Video: ${L('P1.mp4')}
- **Scenario ${numbered.find((e) => e.id === 'S1')?.n ?? 'S1'} on a fixed cockpit.** The stale-data scenario re-run against a cockpit patched to flag stale data (\`qa/mutants/control-fix-stale.patch\`): ${findings.get('S1-fixed')?.verdict.kind}: ${findings.get('S1-fixed')?.verdict.headline}. Video: ${L('S1-fixed.mp4')}
`;

// ---- fill links -------------------------------------------------------------------------------
// 1) explicit per-file links from submission/LINKS.txt win; 2) otherwise a scenario points into the one
// portal video at its start time (submission/portal-index.json); 3) runs not in the portal link to the
// copy in the public repository.
const links: Record<string, string> = {};
const linksFile = path.join(SUB, 'LINKS.txt');
if (existsSync(linksFile)) {
  for (const line of readFileSync(linksFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([^#=\s][^=]*?)\s*=\s*(\S.*?)\s*$/.exec(line); // empty values are skipped
    if (m) links[m[1]] = m[2];
  }
}
const portalIdx = existsSync(path.join(SUB, 'portal-index.json'))
  ? (JSON.parse(readFileSync(path.join(SUB, 'portal-index.json'), 'utf8')) as { file: string; lengthS: number; clips: Record<string, number> })
  : undefined;
const portalUrl = portalIdx ? links[portalIdx.file] : undefined;
const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const REPO_VIDEOS = 'https://github.com/Tanmay-Ts/Tireless/blob/claude/flytbase-testing-harness-iwr6ar/submission/videos';
const videoRef = (file: string) => {
  if (links[file]) return `[recording](${links[file]})`;
  const at = portalIdx?.clips[file];
  if (at !== undefined) return portalUrl ? `[portal video, from ${mmss(at)}](${portalUrl})` : `portal video (this submission's Video link), from ${mmss(at)}`;
  return `[recording in the repository](${REPO_VIDEOS}/${file})`;
};
let out = md.replace(/\{\{LINK:([^}]+)\}\}/g, (_, f: string) => videoRef(f));
if (links.TEAM_NAME) out = out.replaceAll('{{TEAM_NAME}}', links.TEAM_NAME);
if (portalIdx) {
  const where = portalUrl ? `[${portalIdx.file}](${portalUrl})` : `the Video link of this submission (\`${portalIdx.file}\`)`;
  out = out.replace(
    '## 1. System design',
    `**Videos:** every numbered scenario is in one real-time recording, ${where}, ${mmss(portalIdx.lengthS)} long; each scenario states where it starts. Each run is also available as its own file in the repository (\`submission/videos/\`).\n\n## 1. System design`,
  );
}
writeFileSync(path.join(SUB, 'WRITEUP.md'), out);
const left = [...new Set(out.match(/\{\{[^}]+\}\}/g) ?? [])];
console.log(`WRITEUP.md: ${numbered.length} numbered scenarios, ${missIds.length} misses; placeholders left: ${left.length}`);

const pandoc = process.env.PANDOC ?? 'pandoc';
try {
  execFileSync(pandoc, [path.join(SUB, 'WRITEUP.md'), '-f', 'gfm', '-o', path.join(SUB, 'WRITEUP.docx')]);
  console.log('WRITEUP.docx written');
} catch (e) {
  console.warn(`docx skipped (${(e as Error).message.split('\n')[0]}); set PANDOC=/path/to/pandoc`);
}

// ---- the video files the document references ---------------------------------------------------
const referenced = [...new Set((md.match(/\{\{LINK:([^}]+)\}\}/g) ?? []).map((s) => s.slice(7, -2)))];
writeFileSync(path.join(SUB, 'referenced-videos.json'), JSON.stringify(referenced, null, 2));
console.log(`${referenced.length} video files referenced`);
