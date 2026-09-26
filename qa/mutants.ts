/**
 * Mutation testing: plant each bug from mutants/ into the kit's cockpit source, run the invariant suite K
 * (recorded like every scenario), revert, and score: caught / missed / false alarm / correctly passed.
 *
 *   KIT_DIR=/path/to/flytbase-ahc-swe-qa-hackathon npm run mutants            # clean + all mutants
 *   KIT_DIR=... npm run mutants -- m3 h2                                         # a subset (id prefixes)
 *
 * Needs the cockpit in dev mode (npm run dev, or docker compose watch) so source edits are served live.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cfg, QA_ROOT, sleep } from './config.ts';
import { assertKitClean, kitDir, withKitPatch } from './kit.ts';
import { loadGenerated, MUTANTS, type Mutant } from './mutants/index.ts';
import { writeReport } from './report.ts';
import { runScenario } from './runner.ts';
import { makeK } from './scenarios/k-invariants.ts';

const kit = kitDir();
assertKitClean(kit);

const args = process.argv.slice(2);
const ALL: Mutant[] = [...MUTANTS, ...loadGenerated()];
// `gen` selects every agent-generated mutation; `seed` the hand-written ones; otherwise match by id prefix.
const wanted = args.length
  ? ALL.filter((m) => args.some((a) => (a === 'gen' ? m.generated : a === 'seed' ? !m.generated && m.id !== 'clean' : m.id.startsWith(a))))
  : ALL;
const baselineExists = existsSync(path.join(QA_ROOT, 'baseline', 'clean-invariants.json'));
const plan: Mutant[] = !wanted.some((m) => m.id === 'clean') && !baselineExists ? [MUTANTS[0], ...wanted] : wanted;

type Row = { id: string; title: string; planted: string; expected: string; failed: string[]; attributed: boolean; generated: boolean; outcome: 'caught' | 'missed' | 'false alarm' | 'correctly passed' | 'error'; video: string; verdict: string };
const rows: Row[] = [];

for (const m of plan) {
  console.log(`\n▶ ${m.id} · ${m.title}`);
  let row: Row;
  try {
    const f = await withKitPatch(kit, m.patch && path.join(QA_ROOT, 'mutants', m.patch), () => runScenario(makeK(m)));
    const failed = ((f.observations.failed as string[] | undefined) ?? []).slice();
    const detected = failed.length > 0;
    const isBug = m.expect.length > 0; // mutation (should be caught) vs harmless/clean (should pass)
    const outcome: Row['outcome'] =
      f.verdict.kind === 'ERROR' || f.verdict.kind === 'SETUP-FAILED' ? 'error' : isBug ? (detected ? 'caught' : 'missed') : detected ? 'false alarm' : 'correctly passed';
    row = { id: m.id, title: m.title, planted: m.planted, expected: m.expect.length ? m.expect.join(' + ') : 'PASS', failed, attributed: m.expect.every((c) => failed.includes(c)), generated: !!m.generated, outcome, video: f.evidence.video, verdict: `${f.verdict.kind}: ${f.verdict.headline}` };
  } catch (e) {
    row = { id: m.id, title: m.title, planted: m.planted, expected: m.expect.join(' + ') || 'PASS', failed: [], attributed: false, generated: !!m.generated, outcome: 'error', video: '', verdict: String((e as Error).message).slice(0, 120) };
  }
  rows.push(row);
  console.log(`  ${row.outcome.toUpperCase()} · failed: ${row.failed.join(', ') || 'none'} · expected: ${row.expected}`);
  await sleep(2000);
}

// Merge into the previous matrix: re-running a subset updates those rows and keeps the others.
const matrixFile = path.join(cfg.outDir, 'mutants.json');
const previous: Row[] = existsSync(matrixFile) ? (JSON.parse(readFileSync(matrixFile, 'utf8')).rows as Row[]) : [];
const merged = ALL.map((m) => rows.find((r) => r.id === m.id) ?? previous.find((r) => r.id === m.id)).filter((r): r is Row => !!r);
const planted = merged.filter((r) => r.id.startsWith('m'));
const harmless = merged.filter((r) => r.id.startsWith('h') || r.id === 'clean');
const summary = {
  caught: planted.filter((r) => r.outcome === 'caught').length,
  planted: planted.length,
  falseAlarms: harmless.filter((r) => r.outcome === 'false alarm').length,
  harmless: harmless.length,
  errors: merged.filter((r) => r.outcome === 'error').length,
};
mkdirSync(cfg.outDir, { recursive: true });
writeFileSync(matrixFile, JSON.stringify({ ranAt: new Date().toISOString(), summary, rows: merged }, null, 2));
console.log(`\nplanted bugs caught: ${summary.caught}/${summary.planted} · false alarms: ${summary.falseAlarms}/${summary.harmless} · errors: ${summary.errors}`);
console.log(`report → ${writeReport().md}`);
