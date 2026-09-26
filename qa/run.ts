/** Usage: tsx run.ts S1 [S2 ...] | all */
import { writeReport } from './report.ts';
import { runScenario, type Scenario } from './runner.ts';
import { S1 } from './scenarios/s1-stale-data.ts';

const SCENARIOS: Record<string, Scenario> = { S1 };

const args = process.argv.slice(2).map((a) => a.toUpperCase());
const ids = !args.length || args.includes('ALL') ? Object.keys(SCENARIOS) : args;
const unknown = ids.filter((id) => !SCENARIOS[id]);
if (unknown.length) {
  console.error(`unknown scenario(s): ${unknown.join(', ')}; known: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(2);
}

for (const id of ids) {
  console.log(`\n▶ ${id} · ${SCENARIOS[id].title}`);
  const f = await runScenario(SCENARIOS[id]);
  console.log(`  ${f.verdict.kind}: ${f.verdict.headline}`);
  if (f.verdict.sub) console.log(`  ${f.verdict.sub}`);
  console.log(`  video ${f.evidence.video} · trace ${f.evidence.trace} · ${f.durationS} s`);
}
const { md } = writeReport();
console.log(`\nreport → ${md}`);
