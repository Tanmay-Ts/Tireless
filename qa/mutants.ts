/**
 * Mutation testing: plant each bug from mutants/ into the kit's cockpit source, run the invariant suite K
 * (recorded like every scenario), revert, and score: caught / missed / false alarm / correctly passed.
 *
 *   KIT_DIR=/path/to/flytbase-ahc-swe-qa-hackathon npm run mutants            # clean + all mutants
 *   KIT_DIR=... npm run mutants -- m3 h2                                         # a subset (id prefixes)
 *
 * Needs the cockpit in dev mode (npm run dev, or docker compose watch) so source edits are served live.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cfg, QA_ROOT, sleep } from './config.ts';
import { MUTANTS, type Mutant } from './mutants/index.ts';
import { writeReport } from './report.ts';
import { runScenario } from './runner.ts';
import { makeK } from './scenarios/k-invariants.ts';

const kit = process.env.KIT_DIR && path.resolve(process.env.KIT_DIR);
if (!kit || !existsSync(path.join(kit, 'frontend', 'src'))) {
  console.error('Set KIT_DIR to the kit checkout (the folder with frontend/src).');
  process.exit(2);
}
const git = (...args: string[]) => execFileSync('git', ['-C', kit, ...args], { encoding: 'utf8' });
if (git('status', '--porcelain', '--', 'frontend').trim()) {
  console.error('The kit frontend has local changes; commit or stash them first (mutants are applied and reverted with git apply).');
  process.exit(2);
}

const args = process.argv.slice(2);
const wanted = args.length ? MUTANTS.filter((m) => args.some((a) => m.id.startsWith(a))) : MUTANTS;
const baselineExists = existsSync(path.join(QA_ROOT, 'baseline', 'clean-invariants.json'));
const plan: Mutant[] = !wanted.some((m) => m.id === 'clean') && !baselineExists ? [MUTANTS[0], ...wanted] : wanted;

let applied: string | undefined;
const revert = () => {
  if (!applied) return;
  git('apply', '-R', applied);
  applied = undefined;
};
process.on('SIGINT', () => {
  revert();
  process.exit(130);
});

type Row = { id: string; title: string; planted: string; expected: string; failed: string[]; outcome: 'caught' | 'missed' | 'false alarm' | 'correctly passed' | 'error'; video: string; verdict: string };
const rows: Row[] = [];

for (const m of plan) {
  console.log(`\n▶ ${m.id} · ${m.title}`);
  let row: Row;
  try {
    if (m.patch) {
      const p = path.join(QA_ROOT, 'mutants', m.patch);
      git('apply', '--check', p);
      git('apply', p);
      applied = p;
      await sleep(2500); // let the dev server pick up the edit
    }
    const f = await runScenario(makeK(m));
    const failed = ((f.observations.failed as string[] | undefined) ?? []).slice();
    const outcome: Row['outcome'] =
      f.verdict.kind === 'ERROR' || f.verdict.kind === 'SETUP-FAILED'
        ? 'error'
        : m.expect.length
          ? failed.some((c) => m.expect.includes(c))
            ? 'caught'
            : 'missed'
          : failed.length
            ? 'false alarm'
            : 'correctly passed';
    row = { id: m.id, title: m.title, planted: m.planted, expected: m.expect.length ? m.expect.join(' + ') : 'PASS', failed, outcome, video: f.evidence.video, verdict: `${f.verdict.kind}: ${f.verdict.headline}` };
  } catch (e) {
    row = { id: m.id, title: m.title, planted: m.planted, expected: m.expect.join(' + ') || 'PASS', failed: [], outcome: 'error', video: '', verdict: String((e as Error).message).slice(0, 120) };
  } finally {
    revert();
  }
  rows.push(row);
  console.log(`  ${row.outcome.toUpperCase()} · failed: ${row.failed.join(', ') || 'none'} · expected: ${row.expected}`);
  await sleep(2000);
}

const planted = rows.filter((r) => r.id.startsWith('m'));
const harmless = rows.filter((r) => r.id.startsWith('h') || r.id === 'clean');
const summary = {
  caught: planted.filter((r) => r.outcome === 'caught').length,
  planted: planted.length,
  falseAlarms: harmless.filter((r) => r.outcome === 'false alarm').length,
  harmless: harmless.length,
  errors: rows.filter((r) => r.outcome === 'error').length,
};
mkdirSync(cfg.outDir, { recursive: true });
writeFileSync(path.join(cfg.outDir, 'mutants.json'), JSON.stringify({ ranAt: new Date().toISOString(), summary, rows }, null, 2));
console.log(`\nplanted bugs caught: ${summary.caught}/${summary.planted} · false alarms: ${summary.falseAlarms}/${summary.harmless} · errors: ${summary.errors}`);
console.log(`report → ${writeReport().md}`);
