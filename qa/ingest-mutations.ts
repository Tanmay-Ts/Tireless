/**
 * Validate mutations authored by the mutation subagent and write them to qa/mutants/generated/.
 * This is the "you then validate them" step: it never trusts the agent's edits blindly.
 *   KIT_DIR=... npx tsx ingest-mutations.ts <mutations.json> [--replace]
 * <mutations.json> is {"mutations":[{id,category,file,search,replace,breaks,briefLine,expectedImpact,expectCheck}]}.
 * --replace clears any existing generated/*.{json,patch} first.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { QA_ROOT } from './config.ts';
import { assertKitClean, kitDir } from './kit.ts';
import type { AnswerKey } from './mutants/index.ts';

const kit = kitDir();
assertKitClean(kit);
const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: KIT_DIR=... npx tsx ingest-mutations.ts <mutations.json> [--replace]');
  process.exit(2);
}
const git = (...a: string[]) => execFileSync('git', ['-C', kit, ...a], { encoding: 'utf8' });
const outDir = path.join(QA_ROOT, 'mutants', 'generated');
mkdirSync(outDir, { recursive: true });
if (process.argv.includes('--replace')) for (const f of readdirSync(outDir)) rmSync(path.join(outDir, f));

const raw = readFileSync(file, 'utf8').replace(/^```json\s*|\s*```$/g, '');
const muts = (JSON.parse(raw).mutations ?? JSON.parse(raw)) as AnswerKey[];

async function validate(m: AnswerKey): Promise<string | undefined> {
  if (!m.file?.startsWith('frontend/')) return `file not under frontend/: ${m.file}`;
  const abs = path.join(kit, m.file);
  if (!existsSync(abs)) return `no such file ${m.file}`;
  if (typeof m.search !== 'string' || !m.search.length) return 'empty search';
  const src = readFileSync(abs, 'utf8');
  const n = src.split(m.search).length - 1;
  if (n !== 1) return `search occurs ${n}× (need exactly 1)`;
  if (src.replace(m.search, m.replace) === src) return 'replace equals search (no-op)';
  try {
    const esbuild = await import('esbuild');
    await esbuild.transform(src.replace(m.search, m.replace), { loader: m.file.endsWith('.css') ? 'css' : 'tsx' });
  } catch (e) {
    return `mutated file does not parse: ${(e as Error).message.split('\n')[0]}`;
  }
  return undefined;
}

let ok = 0;
for (const m of muts) {
  const bad = await validate(m);
  if (bad) {
    console.warn(`reject ${m.id}: ${bad}`);
    continue;
  }
  const abs = path.join(kit, m.file);
  const orig = readFileSync(abs, 'utf8');
  writeFileSync(abs, orig.replace(m.search, m.replace));
  const patch = git('diff');
  git('checkout', '--', 'frontend');
  writeFileSync(path.join(outDir, `${m.id}.patch`), patch);
  writeFileSync(path.join(outDir, `${m.id}.json`), JSON.stringify(m, null, 2));
  ok++;
  console.log(`accept ${m.id} (${m.category}) [${m.file.replace('frontend/src/', '')}]`);
}
console.log(`\n${ok}/${muts.length} accepted → ${path.relative(process.cwd(), outDir)}`);
console.log(git('status', '--porcelain', '--', 'frontend').trim() ? 'WARNING: kit frontend not clean!' : 'kit clean');
