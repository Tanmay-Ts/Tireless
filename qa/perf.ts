/**
 * Performance probes (Level 2). Zero-LLM, black-box, measured in the running cockpit:
 *  - main-thread busy % and script share: Chrome DevTools Protocol Performance.getMetrics
 *    (TaskDuration / ScriptDuration deltas over a wall-clock window);
 *  - frame rate: requestAnimationFrame count; long tasks: PerformanceObserver('longtask');
 *  - JS heap and DOM node count (CDP);
 *  - click-to-result latency: click a device row, time from the click's input timestamp to the first frame
 *    showing that drone in the telemetry panel (what the operator feels; Core Web Vitals INP: <=200 ms good, >500 ms poor).
 */
import type { BrowserContext, CDPSession, Page } from 'playwright';
import { sleep } from './config.ts';

export const GOOD_MS = 200;
export const POOR_MS = 500;

const PROBE = `(() => { if (window.__perf) return; const P = window.__perf = { long: [], frames: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const loop = () => { P.frames++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); })();`;

/** Call before the page navigates to the app. */
export async function installPerf(context: BrowserContext, page: Page): Promise<CDPSession> {
  await context.addInitScript(PROBE);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  return cdp;
}

async function metrics(cdp: CDPSession) {
  const { metrics: m } = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
  return Object.fromEntries(m.map((x) => [x.name, x.value])) as Record<string, number>;
}

export type PerfWindow = { busyPct: number; scriptPct: number; fps: number; longTasks: number; tbtMs: number; heapMB: number; nodes: number };

export async function measureWindow(page: Page, cdp: CDPSession, ms: number): Promise<PerfWindow> {
  const m0 = await metrics(cdp);
  const p0 = await page.evaluate(() => ({ f: (window as any).__perf?.frames ?? 0, n: (window as any).__perf?.long.length ?? 0, t: performance.now() }));
  await sleep(ms);
  const m1 = await metrics(cdp);
  const p1 = await page.evaluate(() => ({ f: (window as any).__perf?.frames ?? 0, t: performance.now() }));
  const longs = (await page.evaluate((n) => ((window as any).__perf?.long ?? []).slice(n), p0.n)) as [number, number][];
  const wall = (p1.t - p0.t) / 1000;
  return {
    busyPct: Math.min(100, Math.round(((m1.TaskDuration - m0.TaskDuration) / wall) * 100)),
    scriptPct: Math.min(100, Math.round(((m1.ScriptDuration - m0.ScriptDuration) / wall) * 100)),
    fps: +((p1.f - p0.f) / wall).toFixed(1),
    longTasks: longs.length,
    tbtMs: Math.round(longs.reduce((a, [, d]) => a + Math.max(0, d - 50), 0)),
    heapMB: +(m1.JSHeapUsedSize / 1e6).toFixed(1),
    nodes: m1.Nodes,
  };
}

/**
 * Real clicks on the device list, alternating between drones so every click changes the selection.
 * Timed inside the page, the way Core Web Vitals INP times an interaction: from the click's input timestamp
 * (so time spent queued behind a busy main thread counts) to the first animation frame in which the telemetry
 * panel title shows the clicked drone. Playwright's own round trips are not part of the number.
 */
export async function clickToResult(page: Page, drones: { id: string; name: string }[], n = 3, timeoutMs = 20000) {
  const samples: number[] = [];
  const title = () =>
    page.evaluate(() => {
      const w = window as any;
      if (!w.__clkTitle?.isConnected) w.__clkTitle = [...document.querySelectorAll('span')].find((s) => s.textContent?.startsWith('Drone Telemetry'));
      return (w.__clkTitle?.textContent as string | undefined) ?? '';
    });
  for (let i = 0; i < n; i++) {
    const now = await title().catch(() => '');
    const d = drones.find((x) => now !== `Drone Telemetry · ${x.name}`) ?? drones[0];
    try {
      await page.evaluate(() => {
        const w = window as any;
        w.__clk = { t0: 0 };
        document.addEventListener('pointerdown', (e) => { w.__clk.t0 = e.timeStamp; }, { capture: true, once: true });
      });
      await page.getByTestId(`device-row-${d.id}`).click({ timeout: timeoutMs });
      const h = await page.waitForFunction(
        (want) => {
          const w = window as any;
          if (!w.__clkTitle?.isConnected) w.__clkTitle = [...document.querySelectorAll('span')].find((s) => s.textContent?.startsWith('Drone Telemetry'));
          return w.__clkTitle?.textContent === want && w.__clk.t0 ? performance.now() - w.__clk.t0 : 0;
        },
        `Drone Telemetry · ${d.name}`,
        { polling: 'raf', timeout: timeoutMs },
      );
      samples.push(Math.round((await h.jsonValue()) as number));
    } catch {
      samples.push(timeoutMs); // never reacted within the timeout
    }
  }
  const s = [...samples].sort((a, b) => a - b);
  return { medianMs: s[Math.floor(s.length / 2)], maxMs: s[s.length - 1], samples };
}

export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
