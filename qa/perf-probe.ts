/**
 * L2 feasibility probe (Performance): does fleet size make the cockpit's controls unresponsive?
 * Measures at 4 drones (the kit default) and after adding more drones in flight:
 *   main-thread busy % (CDP TaskDuration delta / wall time), long tasks + total blocking time,
 *   frame rate (requestAnimationFrame), JS heap, DOM nodes, and click-to-result latency
 *   (click a device row → telemetry panel title shows that drone).
 * Added drones are removed and the simulator reset afterwards.
 *   npx tsx perf-probe.ts 24        # second load level = 24 drones total
 */
import { chromium, type CDPSession, type Page } from 'playwright';
import { cfg, PAGE_SHIM, sleep } from './config.ts';
import { Driver } from './driver.ts';

const TARGET = Number(process.argv[2] ?? 24);
const PROBE = `(() => { if (window.__perf) return; const P = window.__perf = { long: [], frames: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const loop = () => { P.frames++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); })();`;

async function metrics(cdp: CDPSession) {
  const { metrics: m } = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
  return Object.fromEntries(m.map((x) => [x.name, x.value])) as Record<string, number>;
}

async function measure(page: Page, cdp: CDPSession, ms = 10000) {
  const m0 = await metrics(cdp);
  const p0 = await page.evaluate(() => ({ f: (window as any).__perf.frames, n: (window as any).__perf.long.length, t: performance.now() }));
  await sleep(ms);
  const m1 = await metrics(cdp);
  const p1 = await page.evaluate(() => ({ f: (window as any).__perf.frames, t: performance.now() }));
  const longs = (await page.evaluate((n) => (window as any).__perf.long.slice(n), p0.n)) as [number, number][];
  const wall = (p1.t - p0.t) / 1000;
  return {
    busyPct: Math.round(((m1.TaskDuration - m0.TaskDuration) / wall) * 100),
    scriptPct: Math.round(((m1.ScriptDuration - m0.ScriptDuration) / wall) * 100),
    fps: +((p1.f - p0.f) / wall).toFixed(1),
    longTasks: longs.length,
    tbtMs: Math.round(longs.reduce((a, [, d]) => a + Math.max(0, d - 50), 0)),
    heapMB: +(m1.JSHeapUsedSize / 1e6).toFixed(1),
    nodes: m1.Nodes,
  };
}

async function clickLatency(page: Page, names: string[], n = 6) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const name = names[i % names.length];
    const row = page.getByTestId(`device-row-${name.toLowerCase().replace(' ', '-')}`);
    const t0 = Date.now();
    await row.click({ timeout: 15000 });
    await page.getByText(new RegExp(`Drone Telemetry · ${name}$`)).first().waitFor({ timeout: 15000 });
    out.push(Date.now() - t0);
  }
  out.sort((a, b) => a - b);
  return { medianMs: out[Math.floor(out.length / 2)], maxMs: out[out.length - 1] };
}

const driver = new Driver();
const added: string[] = [];
const browser = await chromium.launch({ headless: !cfg.headed, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  await driver.cleanStart(1);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(PAGE_SHIM);
  await ctx.addInitScript(PROBE);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(cfg.cockpitUrl, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('map-view-2d').waitFor({ timeout: 30000 });
  await driver.takeoff('drone-1');
  await sleep(8000);
  const results: Record<string, unknown>[] = [];

  const level = async (label: string) => {
    const m = await measure(page, cdp);
    const c = await clickLatency(page, ['Drone 1', 'Drone 2']);
    const row = { drones: label, ...m, clickMedianMs: c.medianMs, clickMaxMs: c.maxMs };
    results.push(row);
    console.log(JSON.stringify(row));
  };

  await level('4 (kit default)');
  while (added.length + 4 < TARGET) {
    const r = await driver.addDrone();
    added.push(r.drone.id);
  }
  await sleep(3000);
  for (const id of added) await driver.takeoff(id).catch(() => {});
  await sleep(12000); // let them climb and the cockpit subscribe/render everything
  await level(`${TARGET} (all flying)`);
  console.table(results);
} finally {
  for (const id of added) await driver.removeDrone(id).catch(() => {});
  await driver.cleanStart(1).catch(() => {});
  await browser.close();
  console.log(`cleanup: removed ${added.length} added drones; kit back to ${(await driver.devices()).filter((d) => d.type === 'drone').length} drones`);
}
