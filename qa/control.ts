/**
 * Precision control run: S1 against a cockpit patched to flag stale data. Must report PASS.
 *   KIT_DIR=/path/to/kit npm run control
 */
import path from 'node:path';
import { QA_ROOT } from './config.ts';
import { assertKitClean, kitDir, withKitPatch } from './kit.ts';
import { writeReport } from './report.ts';
import { runScenario } from './runner.ts';
import { S1_FIXED } from './scenarios/s1-stale-data.ts';

const kit = kitDir();
assertKitClean(kit);
const f = await withKitPatch(kit, path.join(QA_ROOT, 'mutants', 'control-fix-stale.patch'), () => runScenario(S1_FIXED));
console.log(`${f.id}: ${f.verdict.kind} · ${f.verdict.headline}${f.verdict.sub ? `\n  ${f.verdict.sub}` : ''}`);
console.log(`report → ${writeReport().md}`);
