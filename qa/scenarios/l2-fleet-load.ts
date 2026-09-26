/**
 * L2-1 · Performance: does selecting a drone stay responsive as the fleet grows?
 *
 * Brief ("What should be tested" → Performance): "Frequent updates, larger data or several video feeds make
 * unrelated controls unresponsive." The operator's core action is selecting a drone to see its telemetry.
 * Baseline = the kit's default 4 drones (must be responsive: the rule that a check is only meaningful if the
 * original kit passes it at baseline). Then drones are added in flight, 8 → 16 → 32 → 48 → 64, and at every
 * size the harness records browser load (main-thread busy %, script share, frame rate, heap, DOM nodes) and
 * times real clicks on the device list until the telemetry panel shows the clicked drone.
 * Verdict: BUG at the first fleet size where the median click takes > 500 ms ("poor" in Core Web Vitals INP).
 */
import { cfg, sleep } from '../config.ts';
import { SetupError } from '../driver.ts';
import type { HudRow } from '../overlay.ts';
import { locate, T } from '../oracles.ts';
import { clickToResult, fmtMs, GOOD_MS, installPerf, measureWindow, POOR_MS, type PerfWindow } from '../perf.ts';
import type { Scenario } from '../runner.ts';
import { withTitleCard } from './common.ts';

const LEVELS = (process.env.L2_LEVELS ?? '4,8,16,32,48,64').split(',').map(Number);
const SETTLE_MS = 6000;
const WINDOW_MS = 6000;
const MAX_RUN_MS = 300000;
const KIT_DRONES = new Set(['drone-1', 'drone-2', 'drone-3', 'drone-4']);
let added: string[] = [];

export const L2_1: Scenario = {
  id: 'L2-1',
  title: 'Selecting a drone as the fleet grows from 4 to 64',
  category: 'Performance',
  brief: 'Frequent updates, larger data or several video feeds make unrelated controls unresponsive',
  rootCause: 'store-wide-rerender-per-telemetry-message',
  viewport: { width: 1440, height: 900 },
  startState: `faults cleared · sim reset (4 drones standby at 100 %) · started 1× · SIM_SEED ${cfg.seed} · 1440×900 · Drone 1 selected and flying`,
  steps: [
    'Clean start: kit\'s 4 drones, faults cleared, sim started',
    'Open cockpit, select Drone 1, take off',
    'Baseline: 4 drones (kit default)',
    `Add drones in flight: ${LEVELS.slice(1).join(' → ')}`,
    'Verdict: first size where a click takes > 500 ms',
  ],
  description:
    'During a large incident an operator watches many drones and repeatedly selects one to see its telemetry. Selecting a drone must stay immediate however many drones are connected. ' +
    'We grow the fleet from the kit\'s 4 drones to 64, all flying and sending telemetry, and measure how long a click on the device list takes to show that drone\'s telemetry.',
  approach:
    'Deterministic Playwright run, zero LLM calls. At each fleet size the harness waits for the load to settle, then records 6 s of browser load through the Chrome DevTools Protocol ' +
    '(main-thread busy % and script share from TaskDuration/ScriptDuration, JS heap, DOM nodes), frame rate from requestAnimationFrame, and times 3 real clicks on the device list ' +
    '(timed in the page like Core Web Vitals INP: from the click\'s input timestamp to the first frame showing the clicked drone in the telemetry panel). ' +
    'The kit\'s 4-drone baseline must pass the same check (≤ 500 ms), otherwise the run is SETUP-FAILED rather than a bug. ' +
    'BUG at the first size where the median click exceeds 500 ms, the "poor" threshold of Core Web Vitals INP. Added drones are removed afterwards.',

  async run(ctx) {
    const { page, context, hud, driver, step, obs } = ctx;
    const t0 = Date.now();
    const log = (m: string) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s] ${m}`);
    added = [];
    await withTitleCard(ctx, () =>
      step(0, async () => {
        // A run interrupted earlier can leave extra drones behind (reset does not remove them).
        for (const d of await driver.devices()) if (d.type === 'drone' && !KIT_DRONES.has(d.id)) await driver.removeDrone(d.id).catch(() => {});
        await driver.cleanStart(1);
      }),
    );

    const cdp = await step(1, async () => {
      const c = await installPerf(context, page);
      await page.goto(cfg.cockpitUrl, { waitUntil: 'domcontentloaded' });
      await driver.waitFor(async () => !!(await locate(page, T.map2d)).loc, 40000, 'cockpit and map loaded');
      obs.webgl = await page
        .evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl');
          const ext = gl?.getExtension('WEBGL_debug_renderer_info');
          return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
        })
        .catch(() => 'unknown');
      await page.getByTestId('device-row-drone-1').click({ timeout: 20000 });
      await driver.takeoff('drone-1');
      await sleep(3000);
      return c;
    });

    const pair = [
      { id: 'drone-2', name: 'Drone 2' },
      { id: 'drone-1', name: 'Drone 1' },
    ];
    const results: { level: number; m: PerfWindow; click: { medianMs: number; maxMs: number; samples: number[] } }[] = [];
    const rows: HudRow[] = [];
    const show = () => hud.rows(rows, 'FLEET SIZE vs RESPONSIVENESS', ['DRONES', 'BROWSER LOAD', 'CLICK → TELEMETRY']);
    let knee: number | undefined;

    for (const [i, level] of LEVELS.entries()) {
      await hud.step(i === 0 ? 2 : 3, 'run', i === 0 ? undefined : `now ${level} drones in flight`);
      while (4 + added.length < level) added.push((await driver.addDrone()).drone.id);
      for (const id of added.slice(-(level - (LEVELS[i - 1] ?? 4)))) await driver.takeoff(id).catch(() => {});
      const settle = i === 0 ? 12000 : SETTLE_MS; // the baseline also waits for the map to finish loading
      await hud.countdown(`${level} drones: letting the load settle`, settle);
      await sleep(settle);
      await hud.countdown(`${level} drones: measuring 6 s of browser load`, WINDOW_MS);
      log(`${level} drones: measuring browser load`);
      const m = await measureWindow(page, cdp, WINDOW_MS);
      log(`${level} drones: ${m.busyPct}% busy · ${m.fps} fps · timing clicks`);
      await hud.countdown(`${level} drones: timing 3 clicks on the device list`, 3000);
      const click = await clickToResult(page, pair, 3);
      log(`${level} drones: click ${fmtMs(click.medianMs)} median (samples ${click.samples.join(', ')} ms)`);
      await hud.clearCountdown();
      results.push({ level, m, click });
      rows.push({
        field: `${level}${level === 4 ? ' (kit)' : ''}`,
        truth: `${m.busyPct}% busy · ${m.fps} fps`,
        ui: `${fmtMs(click.medianMs)} (max ${fmtMs(click.maxMs)})`,
        ok: click.medianMs <= GOOD_MS ? true : click.medianMs > POOR_MS ? false : null,
      });
      await show();
      if (i === 0) {
        if (click.medianMs > POOR_MS) throw new SetupError(`baseline click ${fmtMs(click.medianMs)} at the kit's 4 drones is already poor: this machine is too slow to judge`);
        await hud.step(2, 'ok', `${fmtMs(click.medianMs)} per click · ${m.busyPct}% busy · ${m.fps} fps`);
        continue;
      }
      if (click.medianMs > POOR_MS) {
        knee = level;
        hud.box('row', page.getByTestId('device-row-drone-2'), `click took ${fmtMs(click.medianMs)}`, { align: 'left' });
        await show();
        break;
      }
      if (Date.now() - t0 > MAX_RUN_MS) break;
    }
    await hud.step(3, 'ok', `${results.length - 1} fleet sizes measured`);
    await hud.note(`Thresholds: ≤ ${GOOD_MS} ms good · > ${POOR_MS} ms poor (Core Web Vitals INP). Baseline = the kit's 4 drones.`);

    const base = results[0];
    const last = results[results.length - 1];
    obs.levels = results;
    obs.table = {
      columns: ['drones in flight', 'main thread busy', 'script share', 'frame rate', 'JS heap', 'DOM nodes', 'click → telemetry (median / max)'],
      rows: results.map((r) => [r.level, `${r.m.busyPct} %`, `${r.m.scriptPct} %`, `${r.m.fps} fps`, `${r.m.heapMB} MB`, r.m.nodes, `${fmtMs(r.click.medianMs)} / ${fmtMs(r.click.maxMs)}`]),
    };

    if (knee !== undefined) {
      await hud.step(4, 'fail', `first poor size: ${knee} drones`);
      return {
        kind: 'BUG',
        headline: `selecting a drone takes ${fmtMs(last.click.medianMs)} with ${knee} drones (${fmtMs(base.click.medianMs)} with 4)`,
        sub:
          `Main thread ${last.m.busyPct}% busy and ${last.m.fps} fps at ${knee} drones, versus ${base.m.busyPct}% and ${base.m.fps} fps at 4. ` +
          `A click on the device list takes ${fmtMs(last.click.medianMs)} (max ${fmtMs(last.click.maxMs)}) to show the drone: "poor" responsiveness (> 500 ms).`,
      };
    }
    await hud.step(4, 'ok', `no poor size up to ${last.level} drones`);
    return { kind: 'PASS', headline: `still responsive with ${last.level} drones (${fmtMs(last.click.medianMs)} per click)`, sub: `Main thread ${last.m.busyPct}% busy, ${last.m.fps} fps.` };
  },

  async cleanup(driver) {
    for (const id of added) await driver.removeDrone(id).catch(() => {});
    added = [];
    await driver.cleanStart(1).catch(() => {});
  },
};
