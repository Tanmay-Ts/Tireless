/**
 * Scenario lifecycle shared by every scenario: headed Chromium with real-time video at the
 * viewport size + Playwright trace, HUD mounted, API calls mirrored onto the HUD, verdict banner
 * held on screen, artefacts saved, finding JSON written. A precondition that cannot be met is
 * reported as SETUP-FAILED, never as a bug (precision first).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { cfg, PAGE_SHIM, sleep } from './config.ts';
import { Driver, SetupError } from './driver.ts';
import { Hud, type VerdictKind } from './overlay.ts';
import type { Via } from './oracles.ts';
import { Truth } from './truth.ts';

export type Verdict = { kind: VerdictKind; headline: string; sub?: string };

export type Scenario = {
  id: string;
  title: string;
  /** Breadth bucket(s) from the brief's "what should be tested" table. */
  category: string;
  /** The product-brief line this scenario holds the UI to. */
  brief: string;
  /** Root-cause key: findings sharing it are one bug, reported once. */
  rootCause: string;
  description: string;
  approach: string;
  viewport: { width: number; height: number };
  startState: string;
  steps: string[];
  run(ctx: Ctx): Promise<Verdict>;
  /** Undo anything the scenario added to the kit (runs after the recording is closed). */
  cleanup?(driver: Driver): Promise<void>;
};

export type Ctx = {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  hud: Hud;
  driver: Driver;
  truth: Truth;
  /** Marks step i running, runs fn, marks it ok (or fail and rethrows). */
  step<T>(i: number, fn: () => Promise<T>): Promise<T>;
  /** Free-form observations saved into the finding JSON (samples, timings, values). */
  obs: Record<string, unknown>;
  /** Which locator strategy found each element (testid/role/label/text/none). */
  via: Record<string, Via>;
};

export type Finding = {
  id: string;
  title: string;
  category: string;
  brief: string;
  rootCause: string;
  description: string;
  approach: string;
  startState: string;
  steps: { label: string; state: string; detail?: string }[];
  verdict: Verdict;
  observations: Record<string, unknown>;
  locators: Record<string, Via>;
  apiCalls: { method: string; path: string; body?: unknown; status: number; atS: number }[];
  evidence: { video: string; trace: string; screenshot: string };
  env: { cockpitUrl: string; apiUrl: string; viewport: { width: number; height: number }; speed: number; seed: number; headed: boolean };
  startedAt: string;
  durationS: number;
};

const fmtBody = (b: unknown) => (b === undefined ? '' : ' ' + JSON.stringify(b));

export async function runScenario(sc: Scenario): Promise<Finding> {
  const dirs = { videos: path.join(cfg.outDir, 'videos'), traces: path.join(cfg.outDir, 'traces'), shots: path.join(cfg.outDir, 'shots'), findings: path.join(cfg.outDir, 'findings') };
  Object.values(dirs).forEach((d) => mkdirSync(d, { recursive: true }));
  const tmpVideo = path.join(cfg.outDir, '.video-tmp', sc.id);
  const evidence = {
    video: path.join(dirs.videos, `${sc.id}.webm`),
    trace: path.join(dirs.traces, `${sc.id}.zip`),
    screenshot: path.join(dirs.shots, `${sc.id}-verdict.png`),
  };

  const browser = await chromium.launch({
    headless: !cfg.headed,
    executablePath: cfg.chromiumPath,
    // Cesium needs WebGL; allow the software fallback on machines/VMs without a GPU.
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: sc.viewport,
    deviceScaleFactor: 1,
    recordVideo: { dir: tmpVideo, size: sc.viewport },
  });
  await context.addInitScript(PAGE_SHIM);
  await context.tracing.start({ screenshots: true, snapshots: true, title: `${sc.id} ${sc.title}` });
  const page = await context.newPage();
  const videoSaved = page.video()?.saveAs(evidence.video);

  const hud = new Hud(page, { id: sc.id, title: sc.title, brief: sc.brief, start: sc.startState, steps: sc.steps });
  const driver = new Driver();
  const t0 = Date.now();
  driver.onCall = (c) => void hud.api(`${c.method} ${c.path}${fmtBody(c.body)} → ${c.status || 'ERR'}`);
  const truth = new Truth(driver);
  const obs: Record<string, unknown> = {};
  const via: Record<string, Via> = {};

  const step: Ctx['step'] = async (i, fn) => {
    await hud.step(i, 'run');
    try {
      const r = await fn();
      if (hud.s.steps[i]?.state === 'run') await hud.step(i, 'ok');
      return r;
    } catch (e) {
      await hud.step(i, 'fail', (e as Error).message.slice(0, 90));
      throw e;
    }
  };

  let verdict: Verdict;
  try {
    await hud.render();
    verdict = await sc.run({ page, context, browser, hud, driver, truth, step, obs, via });
  } catch (e) {
    const setup = e instanceof SetupError;
    verdict = { kind: setup ? 'SETUP-FAILED' : 'ERROR', headline: setup ? 'precondition not met, no verdict on the UI' : 'harness error', sub: (e as Error).message.slice(0, 200) };
    console.error(`[${sc.id}] ${verdict.kind}:`, e);
  }

  await hud.card(false);
  await hud.verdict(verdict.kind, verdict.headline, verdict.sub);
  await sleep(6000); // keep the banner on screen in the recording
  await page.screenshot({ path: evidence.screenshot }).catch(() => {});
  await context.tracing.stop({ path: evidence.trace }).catch(() => {});
  await context.close();
  await videoSaved?.catch((e) => console.error('video save failed', e));
  await browser.close();
  rmSync(tmpVideo, { recursive: true, force: true });

  truth.stop();
  await driver.clearFaults().catch(() => {});
  await sc.cleanup?.(driver).catch((e) => console.error(`[${sc.id}] cleanup failed:`, e));

  const finding: Finding = {
    id: sc.id,
    title: sc.title,
    category: sc.category,
    brief: sc.brief,
    rootCause: sc.rootCause,
    description: sc.description,
    approach: sc.approach,
    startState: sc.startState,
    steps: hud.s.steps,
    verdict,
    observations: obs,
    locators: via,
    apiCalls: driver.calls.map((c) => ({ method: c.method, path: c.path, body: c.body, status: c.status, atS: +((c.at - t0) / 1000).toFixed(1) })),
    evidence: Object.fromEntries(Object.entries(evidence).map(([k, v]) => [k, path.relative(cfg.outDir, v)])) as Finding['evidence'],
    env: { cockpitUrl: cfg.cockpitUrl, apiUrl: cfg.apiUrl, viewport: sc.viewport, speed: cfg.speed, seed: cfg.seed, headed: cfg.headed },
    startedAt: new Date(t0).toISOString(),
    durationS: +((Date.now() - t0) / 1000).toFixed(1),
  };
  writeFileSync(path.join(dirs.findings, `${sc.id}.json`), JSON.stringify(finding, null, 2));
  return finding;
}
