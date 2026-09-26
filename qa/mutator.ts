/**
 * Mutation agent (item 1). A SEPARATE LLM agent that reads the cockpit source and the product brief and
 * proposes realistic Level-1 mutations as JSON search/replace edits, each with an answer key
 * (category, file, what it breaks, brief line, expected user impact, expected check). Accepted mutations
 * are saved to qa/mutants/generated/<id>.{json,patch} so the QA runs replay deterministically.
 *
 * It is deliberately decoupled from the QA suite: the invariant checks (K1–K7) never import the answer
 * keys; scoring compares to them only AFTER each blind run (see mutants.ts).
 *
 *   MUTATOR_PROVIDER=openai|gemini|nim   (default: whichever key is set, in that order)
 *   GEMINI_API_KEY / NVIDIA_API_KEY / OPENAI_API_KEY
 *   KIT_DIR=/path/to/flytbase-ahc-swe-qa-hackathon
 *   npm run mutate -- 5          # propose ~5 mutations
 *
 * NOTE: the judged cloud container blocks outbound egress to these APIs by policy (only Anthropic is
 * reachable, and no key is provisioned), so this cannot call an LLM there. Run it on an open network
 * (e.g. the laptop) to regenerate qa/mutants/generated/. The mutations committed there were produced in
 * this exact schema by an LLM acting as this agent.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { QA_ROOT, sleep } from './config.ts';
import { assertKitClean, kitDir } from './kit.ts';
import type { AnswerKey } from './mutants/index.ts';

const kit = kitDir();
assertKitClean(kit);
const want = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5);
const git = (...a: string[]) => execFileSync('git', ['-C', kit, ...a], { encoding: 'utf8' });

const SOURCES = [
  'frontend/src/components/SocketBadge.tsx',
  'frontend/src/components/DeviceList.tsx',
  'frontend/src/components/TelemetryPanel.tsx',
  'frontend/src/components/VideoTile.tsx',
  'frontend/src/pages/CockpitPage.tsx',
  'frontend/src/styles.css',
  'frontend/src/testids.ts',
];
const BRIEF = [
  'makes clear whether information is live, delayed, stale, disconnected or unavailable',
  'Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together',
  'Works in modern browsers on phones, tablets, laptops and desktops',
  'Telemetry fields are not fixed in advance',
];
const CATEGORIES = [
  'status shown wrong (online/offline, live/stale)',
  'wrong value',
  'element removed',
  'control off-screen at phone width',
  'basic security (raw HTML in a device name)',
];

const SYSTEM =
  'You are a QA mutation agent for a drone cockpit web app. Propose realistic Level-1 UI bugs a developer could plausibly introduce, ' +
  'as minimal single-edit search/replace mutations. Each `search` MUST be an exact substring that occurs EXACTLY ONCE in the given file, ' +
  'copied verbatim. `replace` is the mutated version. Do not change behaviour in a way that crashes the build. ' +
  'Return JSON only: {"mutations":[{"id","category","file","search","replace","breaks","briefLine","expectedImpact","expectCheck"}]}. ' +
  'id is kebab-case starting "gen-". expectCheck is one of K1(presence),K2(values),K3(cross-panel status),K4(no false offline),K5(link loss shown),K6(phone reachability),K7(name-as-text/security).';

function buildUserPrompt() {
  const files = SOURCES.filter((f) => existsSync(path.join(kit, f)))
    .map((f) => `=== ${f} ===\n${readFileSync(path.join(kit, f), 'utf8')}`)
    .join('\n\n');
  return `Product brief lines to hold the UI to:\n${BRIEF.map((b) => `- ${b}`).join('\n')}\n\nMutation categories to cover (aim for a spread): ${CATEGORIES.join('; ')}.\n\nPropose ${want} mutations across different files/categories.\n\nSOURCE FILES:\n\n${files}`;
}

type Provider = 'openai' | 'gemini' | 'nim';
const pick = (): Provider => {
  const forced = process.env.MUTATOR_PROVIDER as Provider | undefined;
  if (forced) return forced;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.NVIDIA_API_KEY) return 'nim';
  if (process.env.OPENAI_API_KEY) return 'openai';
  console.error('No LLM key set (GEMINI_API_KEY, NVIDIA_API_KEY or OPENAI_API_KEY).');
  process.exit(2);
};

async function callLLM(provider: Provider): Promise<string> {
  const openaiLike = async (url: string, key: string, model: string) => {
    const body = { model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUserPrompt() }], response_format: { type: 'json_object' }, temperature: 0.7 };
    const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429) throw Object.assign(new Error('rate limited'), { retryable: true });
    if (!r.ok) throw new Error(`${provider} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).choices[0].message.content as string;
  };
  if (provider === 'openai') return openaiLike('https://api.openai.com/v1/chat/completions', process.env.OPENAI_API_KEY!, process.env.OPENAI_MODEL ?? 'gpt-4.1');
  if (provider === 'nim') return openaiLike('https://integrate.api.nvidia.com/v1/chat/completions', process.env.NVIDIA_API_KEY!, process.env.NIM_MODEL ?? 'meta/llama-3.3-70b-instruct');
  // Gemini
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: buildUserPrompt() }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } };
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 429) throw Object.assign(new Error('rate limited'), { retryable: true });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).candidates[0].content.parts[0].text as string;
}

/** Order: chosen provider, then the others as fallback; back off on 429. */
async function propose(): Promise<AnswerKey[]> {
  const order: Provider[] = [...new Set([pick(), 'gemini', 'nim', 'openai'])].filter((p) =>
    p === 'openai' ? process.env.OPENAI_API_KEY : p === 'gemini' ? process.env.GEMINI_API_KEY : process.env.NVIDIA_API_KEY,
  ) as Provider[];
  for (const provider of order) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        console.log(`[mutator] asking ${provider} (attempt ${attempt})`);
        const raw = await callLLM(provider);
        const json = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
        return (json.mutations ?? json) as AnswerKey[];
      } catch (e) {
        const retryable = (e as { retryable?: boolean }).retryable;
        console.warn(`[mutator] ${provider}: ${(e as Error).message}`);
        if (retryable && attempt < 4) await sleep(2000 * 2 ** (attempt - 1));
        else break;
      }
    }
  }
  throw new Error('all providers failed');
}

/** Accept a mutation only if its search is unique, it applies, and the mutated file still parses. */
async function validate(m: AnswerKey): Promise<string | undefined> {
  const abs = path.join(kit, m.file);
  if (!existsSync(abs)) return `no such file ${m.file}`;
  const src = readFileSync(abs, 'utf8');
  const n = src.split(m.search).length - 1;
  if (n !== 1) return `search occurs ${n}× (need exactly 1)`;
  const mutated = src.replace(m.search, m.replace);
  try {
    const esbuild = await import('esbuild');
    await esbuild.transform(mutated, { loader: m.file.endsWith('.css') ? 'css' : 'tsx' });
  } catch (e) {
    return `mutated file does not parse: ${(e as Error).message.split('\n')[0]}`;
  }
  return undefined;
}

const outDir = path.join(QA_ROOT, 'mutants', 'generated');
mkdirSync(outDir, { recursive: true });
const proposed = await propose();
console.log(`[mutator] ${proposed.length} proposed; validating`);
const accepted: AnswerKey[] = [];
for (const m of proposed) {
  const bad = await validate(m);
  if (bad) {
    console.warn(`[mutator] reject ${m.id}: ${bad}`);
    continue;
  }
  const abs = path.join(kit, m.file);
  const orig = readFileSync(abs, 'utf8');
  writeFileSync(abs, orig.replace(m.search, m.replace));
  const patch = git('diff');
  git('checkout', '--', 'frontend');
  writeFileSync(path.join(outDir, `${m.id}.patch`), patch);
  writeFileSync(path.join(outDir, `${m.id}.json`), JSON.stringify(m, null, 2));
  accepted.push(m);
  console.log(`[mutator] accept ${m.id} (${m.category})`);
}
console.log(`\n${accepted.length}/${proposed.length} accepted → ${path.relative(process.cwd(), outDir)}`);
console.log('Now run them blind:  npm run mutants -- gen');
