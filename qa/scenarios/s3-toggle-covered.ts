/**
 * S3 · Map 2D/3D view toggle unusable at phone widths.
 *
 * Oracle (generic, catches "main action pushed off screen / covered" mutations): every control that is
 * usable on a laptop must, at every other screen size, be displayed, inside the viewport (or reachable by
 * scrolling) and not covered: document.elementFromPoint() at its visible centre must hit the control
 * itself. Checked for EVERY button/link/row on the page at 7 screen sizes, then confirmed with a real
 * pointer tap (did the map actually switch? aria-pressed) and a Playwright click (actionability error),
 * and cross-checked in a real device-emulation context (touch, DPR 2, mobile UA).
 */
import { cfg, sleep } from '../config.ts';
import { SetupError } from '../driver.ts';
import { crossCheckOnDevice, DeviceFrame, DEVICES, type Device } from '../device.ts';
import type { HudRow } from '../overlay.ts';
import { auditControls, auditFailures, locate, reachability, T, type AuditRow, type Scope } from '../oracles.ts';
import type { Scenario } from '../runner.ts';
import { withTitleCard } from './common.ts';

const SWEEP: Device[] = [DEVICES.ipad, DEVICES.pixel7, DEVICES.iphone13, DEVICES.galaxyS8, DEVICES.small, DEVICES.iphoneSE];
const TOGGLES = [T.map2d, T.map3d];

const interceptLine = (e: unknown) =>
  String((e as Error)?.message ?? e)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /intercepts pointer events/.test(l))
    ?.replace(/^-\s*/, '');

async function waitForToggle(scope: Scope, driver: { waitFor: (p: () => Promise<boolean>, ms: number, what: string) => Promise<void> }) {
  await driver.waitFor(async () => !!(await locate(scope, T.map2d)).loc, 30000, 'map view toggle rendered (map loaded)');
  await sleep(800);
}

async function pressed(scope: Scope, t = T.map2d) {
  const l = (await locate(scope, t)).loc;
  return l ? await l.getAttribute('aria-pressed') : null;
}

/** Why the cover wins: nearest positioned ancestors' z-index and DOM order. */
async function whyCovered(scope: Scope) {
  const l = (await locate(scope, T.map2d)).loc;
  if (!l) return undefined;
  return l.evaluate((btn) => {
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || btn.contains(hit)) return undefined;
    const layer = (e: Element) => {
      for (let p: Element | null = e; p; p = p.parentElement) if (getComputedStyle(p).position !== 'static') return p;
      return e;
    };
    const a = layer(btn);
    const b = layer(hit);
    const name = (e: Element) => (typeof e.className === 'string' && e.className ? `.${e.className.split(/\s+/)[0]}` : e.tagName.toLowerCase());
    const later = !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return `${name(b)} (z-index ${getComputedStyle(b).zIndex}) ${later ? 'comes later in the DOM than' : 'stacks above'} ${name(a)} (z-index ${getComputedStyle(a).zIndex}), so it paints on top`;
  });
}

export const S3: Scenario = {
  id: 'S3',
  title: 'Map 2D/3D view toggle is covered by the video tile on phones',
  category: 'Responsive · Devices · Map controls',
  brief: 'Works in modern browsers on phones, tablets, laptops and desktops',
  rootCause: 'mobile-video-tile-overlaps-map-controls',
  viewport: { width: 1440, height: 900 },
  startState: `faults cleared · sim reset · started ${cfg.speed}× · SIM_SEED ${cfg.seed} · cockpit in a device frame: laptop 1366×768 → 768 → 412 → 390 → 360 → 320 → 375 px`,
  steps: [
    'Clean start: clear faults, reset, start sim',
    'Laptop 1366×768: audit every control (baseline)',
    'Laptop control: tap "2D", map switches',
    'Resize through 6 tablet/phone sizes, audit every control',
    'iPhone SE: operator taps "2D"',
    'Cross-check in emulated iPhone SE (touch, DPR 2)',
  ],
  description:
    'The operator switches the map between 3D and 2D with the 2D/3D toggle at the bottom of the map. The product must work on phones, tablets, laptops and desktops. ' +
    'We open the cockpit at a laptop size and at six tablet/phone sizes and check that every control usable on the laptop can still be seen and pressed. ' +
    'Expected: the map view toggle is visible and pressable at every size.',
  approach:
    'Deterministic Playwright run, zero LLM calls. The cockpit runs in a device frame (an iframe whose CSS viewport is exactly the device size, so the app\'s own media queries apply) next to the evidence panel. ' +
    'At each size the harness audits every button, link and device row: displayed, inside the viewport or reachable by scrolling, and not covered: ' +
    'document.elementFromPoint() at the control\'s visible centre must return the control itself. The laptop result is the baseline; ' +
    'anything usable there and unusable elsewhere is flagged, which also catches controls pushed off-screen or hidden by a mutation. ' +
    'The failing control is then tapped like a user (real pointer) and the effect checked through its aria-pressed state, ' +
    'Playwright\'s own actionability check is recorded, and the result is re-checked in a real iPhone SE emulation context (touch, DPR 2, mobile UA).',

  async run(ctx) {
    const { page, hud, driver, browser, step, obs } = ctx;
    const dev = new DeviceFrame(page);
    const rows: HudRow[] = [];
    const others: { text: string; bad?: boolean }[] = [];
    let baseline: AuditRow[] = [];
    const perSize: Record<string, { toggle: string[]; other: string[] }> = {};

    await withTitleCard(ctx, () => step(0, () => driver.cleanStart(cfg.speed)));

    await step(1, async () => {
      await dev.mount(cfg.cockpitUrl, DEVICES.laptop);
      await waitForToggle(dev.frame, driver);
      baseline = await auditControls(dev.frame);
      const usable = baseline.filter((b) => b.state === 'ok');
      for (const t of TOGGLES) if (!usable.some((b) => b.key === t.testid)) throw new SetupError(`${t.name} not usable even on a laptop; cannot use it as baseline`);
      rows.push({ field: `Laptop 1366`, truth: 'usable', ui: '2D ok · 3D ok', ok: true });
      await hud.rows(rows, 'MAP VIEW TOGGLE PER SCREEN', ['SCREEN', 'EXPECTED', 'TOGGLE']);
      await hud.step(1, 'ok', `${usable.length} usable controls on the laptop`);
      perSize['1366×768'] = { toggle: [], other: [] };
    });

    await step(2, async () => {
      const box = await (await locate(dev.frame, T.map2d)).loc!.boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await driver.waitFor(async () => (await pressed(dev.frame)) === 'true', 4000, '"2D" pressed on laptop');
      const box3 = await (await locate(dev.frame, T.map3d)).loc!.boundingBox();
      await page.mouse.click(box3!.x + box3!.width / 2, box3!.y + box3!.height / 2);
      await hud.step(2, 'ok', 'aria-pressed="true" after tap, then back to 3D');
    });

    await step(3, async () => {
      for (const d of SWEEP) {
        await dev.resize(d);
        const now = await auditControls(dev.frame);
        const fails = auditFailures(now, baseline);
        const tog = TOGGLES.map((t) => ({ t, f: fails.find((x) => x.key === t.testid) }));
        const short = (reason: string) => (/video/.test(reason) ? 'under video tile' : reason);
        const toggleText = tog.map(({ t, f }) => `${t.name.slice(0, 2)} ${f ? short(f.reason) : 'ok'}`).join(' · ');
        const other = fails.filter((x) => !TOGGLES.some((t) => t.testid === x.key));
        perSize[`${d.width}×${d.height}`] = { toggle: tog.filter((x) => x.f).map((x) => `${x.t.name}: ${x.f!.reason}`), other: other.map((o) => `${o.label}: ${o.reason}`) };
        rows.push({ field: `${d.name} ${d.width}`, truth: 'usable', ui: toggleText, ok: tog.every((x) => !x.f) });
        if (other.length) others.push({ text: `${d.width} px: ${other.map((o) => `${o.label} (${o.reason})`).join('; ')}`, bad: true });
        const okSizes = Object.values(perSize).filter((v) => !v.other.length).length;
        const nOther = baseline.filter((b) => b.state === 'ok').length - TOGGLES.length;
        for (const { t, f } of tog) if (f) hud.box(t.testid!, (await locate(dev.frame, t)).loc, `${t.name.slice(0, 2)} covered`, { align: t === T.map3d ? 'left' : 'right' });
        await hud.log('EVERY OTHER CONTROL (buttons, links, rows)', [{ text: `all ${nOther} other controls usable at ${okSizes}/${Object.keys(perSize).length} sizes so far` }, ...others]);
        await hud.rows(rows, 'MAP VIEW TOGGLE PER SCREEN', ['SCREEN', 'EXPECTED', 'TOGGLE']);
        await sleep(600);
      }
    });

    const se = await step(4, async () => {
      hud.clearBoxes();
      const reach = await reachability(dev.frame, T.map2d);
      let pwError: string | undefined;
      try {
        await reach.located.loc!.click({ timeout: 2500 });
      } catch (e) {
        pwError = interceptLine(e) ?? String((e as Error).message).split('\n')[0];
      }
      const before = await pressed(dev.frame);
      const box = await reach.located.loc!.boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await sleep(800);
      const after = await pressed(dev.frame);
      const why = await whyCovered(dev.frame);
      const coverHandle = await reach.located.loc!.evaluateHandle((btn) => {
        const r = btn.getBoundingClientRect();
        let hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        for (let p = hit; p; p = p.parentElement) if (getComputedStyle(p).position !== 'static') return p;
        return hit;
      });
      hud.box('2d', reach.located.loc, `tapped 2D/3D → no effect`, { below: true });
      hud.box('3d', (await locate(dev.frame, T.map3d)).loc, '');
      hud.box('cover', coverHandle.asElement(), 'video tile receives the tap', { color: '#e3b341' });
      await hud.step(4, after === 'true' ? 'ok' : 'fail', `aria-pressed ${before} → ${after}${pwError ? ' · Playwright: ' + pwError.slice(0, 60) : ''}`);
      await hud.note(why);
      return { reach, pwError, pressedBefore: before, pressedAfter: after, why };
    });

    const cross = await step(5, async () => {
      await hud.step(5, 'run', 'separate context: touch, DPR 2, mobile UA (not recorded)');
      const r = await crossCheckOnDevice(browser, DEVICES.iphoneSE, cfg.cockpitUrl, async (p) => {
        await waitForToggle(p, driver);
        const reach = await reachability(p, T.map2d);
        let tapError: string | undefined;
        try {
          await reach.located.loc!.tap({ timeout: 2500 });
        } catch (e) {
          tapError = interceptLine(e) ?? String((e as Error).message).split('\n')[0];
        }
        return { state: reach.state, reason: reach.reason, tapError, pressed: await pressed(p) };
      });
      await hud.step(5, r.state === 'ok' ? 'ok' : 'fail', `emulated iPhone SE: ${r.reason ?? 'usable'}`);
      return r;
    });

    const failing = Object.entries(perSize).filter(([, v]) => v.toggle.length);
    obs.perSize = perSize;
    obs.iphoneSE = { playwrightClick: se.pwError, ariaPressedBefore: se.pressedBefore, ariaPressedAfterTap: se.pressedAfter, why: se.why };
    obs.crossCheck = cross;
    obs.table = {
      columns: ['screen', 'map view toggle', 'other controls'],
      rows: [['1366×768 (laptop, baseline)', 'usable', 'usable'], ...SWEEP.map((d) => {
        const v = perSize[`${d.width}×${d.height}`];
        return [`${d.width}×${d.height} (${d.name})`, v.toggle.length ? v.toggle.join('; ') : 'usable', v.other.length ? v.other.join('; ') : 'usable'];
      })],
    };
    dev.frame && hud.verdictAt({ left: dev.rect().right + 24, right: 434, top: '30%' });

    if (!failing.length) return { kind: 'PASS', headline: 'map view toggle usable at every screen size' };
    const ws = failing.map(([k]) => Number(k.split('×')[0])).sort((a, b) => a - b);
    const widths = ws.length > 2 ? `${ws[0]}–${ws[ws.length - 1]}` : ws.join(', ');
    return {
      kind: 'BUG',
      headline: `2D/3D toggle unusable at ${widths} px`,
      sub:
        `At phone widths the FPV video tile sits on top of the map view toggle (elementFromPoint hits the tile). Tapping "2D" on an iPhone SE leaves aria-pressed=${se.pressedAfter}: the map cannot be switched. ` +
        `Usable on laptop and iPad. Confirmed in real iPhone SE emulation: ${cross.reason ?? 'usable'}.`,
    };
  },
};
