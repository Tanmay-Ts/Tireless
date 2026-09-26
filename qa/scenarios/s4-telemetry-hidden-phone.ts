/**
 * S4 · Selecting a drone on a phone does not show its telemetry.
 *
 * Brief: "Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together".
 * Oracle: right after the operator selects a drone, its status and telemetry values must be visible to
 * the user, i.e. inside the viewport, not clipped by a scroll container, and not covered
 * (elementFromPoint), at the same time as the map and video. Checked on a laptop (control) and on phones.
 * The operator is then allowed to scroll the side panel like a user would, and what is visible together
 * is measured again, so the finding states exactly what a phone user can and cannot see.
 */
import { cfg, sleep } from '../config.ts';
import { SetupError } from '../driver.ts';
import { crossCheckOnDevice, DeviceFrame, DEVICES } from '../device.ts';
import type { HudRow } from '../overlay.ts';
import { locate, reachability, T, type Reach, type Scope, type Target } from '../oracles.ts';
import type { Scenario } from '../runner.ts';
import { cleanStartWithTruth, DRONE, selectDrone, waitCockpitConnected, withTitleCard } from './common.ts';

const TELEMETRY: Target[] = [T.battery, T.altRlt, T.altAgl, T.altAsl, T.hSpeed, T.vSpeed, T.heading, T.wind, T.homeDistance];
const KEY: Target[] = [T.battery, T.altRlt, T.hSpeed];

type View = { row: Reach; pill: Reach; tele: Reach[]; map: Reach; video: Reach };

async function look(scope: Scope, droneName: string): Promise<View> {
  const [row, pill, map, video, ...tele] = await Promise.all([
    reachability(scope, T.deviceRow(DRONE, droneName)),
    reachability(scope, T.statusPill),
    reachability(scope, T.mapCanvas),
    reachability(scope, T.videoPlayer),
    ...TELEMETRY.map((t) => reachability(scope, t)),
  ]);
  return { row, pill, tele, map, video };
}

/** The scroll container around the device list (the phone layout's fixed-height side panel). */
async function scrollPanel(scope: Scope, droneName: string) {
  const row = (await locate(scope, T.deviceRow(DRONE, droneName))).loc;
  const h = await row?.evaluateHandle((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
    return el;
  });
  return h?.asElement() ?? null;
}

async function panelHeight(scope: Scope, droneName: string) {
  const panel = await scrollPanel(scope, droneName);
  return panel ? (await panel.boundingBox())?.height : undefined;
}

const nVisible = (v: View) => v.tele.filter((r) => r.ok).length;
const keyVisible = (v: View) => KEY.every((k) => v.tele[TELEMETRY.indexOf(k)].ok);
const cell = (r: Reach) => (r.ok ? 'visible' : r.state === 'clipped' ? `hidden (${Math.round(r.fraction * 100)} % in view)` : r.state);

export const S4: Scenario = {
  id: 'S4',
  title: 'Selecting a drone on a phone does not show its telemetry',
  category: 'Responsive · Devices · Operator workflow',
  brief: 'Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together',
  rootCause: 'mobile-side-panel-fixed-220px',
  viewport: { width: 1440, height: 900 },
  startState: `faults cleared · sim reset · started ${cfg.speed}× · SIM_SEED ${cfg.seed} · Drone 1 taking off (live data) · cockpit in a device frame: laptop 1366×768, then iPhone SE 375×667`,
  steps: [
    'Clean start, take off Drone 1 (live values)',
    'Laptop: select Drone 1, all shown together (control)',
    'iPhone SE: operator taps Drone 1',
    'What is visible right after selecting?',
    'Operator scrolls the side panel to find telemetry',
    'What is visible together after scrolling?',
    'Cross-check: iPhone 13, Pixel 7, emulated iPhone SE',
  ],
  description:
    'An operator selects a drone to see how it is doing: status, battery, altitude, speed, distance, next to the map and video. ' +
    'The brief says selecting a drone shows these together, and that the product works on phones. On a laptop this holds. ' +
    'We repeat the same action on phone-sized screens while Drone 1 is flying. Expected: after tapping the drone, its status and key telemetry (battery, altitude, speed) are visible without hunting for them.',
  approach:
    'Deterministic Playwright run, zero LLM calls. The cockpit runs in a device frame (iframe with the exact device viewport, so the app\'s media queries apply). ' +
    'After the select action the harness probes the selected row, status pill, all 9 telemetry values, the map and the video: an item counts as visible only if it is ' +
    'inside the viewport, at least 60 % unclipped by any scroll container, and document.elementFromPoint() at its visible centre returns the item itself. ' +
    'Laptop first as the control (everything visible together), then iPhone SE. The operator is then allowed to scroll the side panel with the mouse wheel and visibility is measured again, ' +
    'to state precisely what a phone user can see at once. Repeated on iPhone 13 and Pixel 7, and re-checked in a real iPhone SE emulation context (touch, DPR 2).',

  async run(ctx) {
    const { page, hud, driver, browser, step, obs } = ctx;
    const dev = new DeviceFrame(page);
    let droneName = 'Drone 1';
    const cols: [string, string, string] = ['ITEM', 'LAPTOP', 'PHONE'];
    let laptop: View | undefined;

    const table = (phone?: View, phoneLabel = 'after tap'): HudRow[] => {
      const r = (field: string, a?: Reach, b?: Reach) => ({ field, truth: a ? cell(a) : '…', ui: b ? cell(b) : '…', ok: b ? b.ok : null });
      const idx = (t: Target) => TELEMETRY.indexOf(t);
      return [
        r(`Selected row`, laptop?.row, phone?.row),
        r('Status pill', laptop?.pill, phone?.pill),
        r('Battery', laptop?.tele[idx(T.battery)], phone?.tele[idx(T.battery)]),
        r('Altitude RLT', laptop?.tele[idx(T.altRlt)], phone?.tele[idx(T.altRlt)]),
        r('H-speed', laptop?.tele[idx(T.hSpeed)], phone?.tele[idx(T.hSpeed)]),
        r('Dist. home', laptop?.tele[idx(T.homeDistance)], phone?.tele[idx(T.homeDistance)]),
        { field: 'Telemetry values', truth: laptop ? `${nVisible(laptop)}/9 visible` : '…', ui: phone ? `${nVisible(phone)}/9 visible (${phoneLabel})` : '…', ok: phone ? nVisible(phone) === 9 : null },
        r('Map', laptop?.map, phone?.map),
        r('Video tile', laptop?.video, phone?.video),
      ];
    };

    await withTitleCard(ctx, () =>
      step(0, async () => {
        droneName = (await cleanStartWithTruth(ctx, DRONE)).name;
        await driver.takeoff(DRONE);
      }),
    );

    await step(1, async () => {
      await dev.mount(cfg.cockpitUrl, DEVICES.laptop);
      await waitCockpitConnected(ctx, dev.frame);
      await driver.waitFor(async () => !!(await locate(dev.frame, T.map2d)).loc, 30000, 'map loaded');
      await selectDrone(ctx, dev.frame, DRONE, droneName);
      await sleep(800);
      laptop = await look(dev.frame, droneName);
      await hud.rows(table(), 'VISIBLE AFTER SELECTING DRONE 1', cols);
      if (nVisible(laptop) < 9 || !laptop.pill.ok) throw new SetupError(`control failed: only ${nVisible(laptop)}/9 telemetry visible on a laptop`);
      await hud.step(1, 'ok', 'status + 9/9 telemetry + map + video visible together');
    });

    await step(2, async () => {
      await dev.resize(DEVICES.iphoneSE, 1200);
      await selectDrone(ctx, dev.frame, DRONE, droneName);
      await sleep(800);
    });

    const afterTap = await step(3, async () => {
      const v = await look(dev.frame, droneName);
      await hud.rows(table(v), 'VISIBLE AFTER SELECTING DRONE 1', cols);
      const clip = v.tele.find((r) => r.clippedBy)?.clippedBy ?? v.pill.clippedBy;
      // Hidden items have no on-screen position worth outlining: outline the box that hides them.
      hud.box('panel', await scrollPanel(dev.frame, droneName), `status + telemetry are below the fold of this box (${Math.round(((await panelHeight(dev.frame, droneName)) ?? 0) / dev.scale)} px tall)`, { align: 'right' });
      await hud.step(3, keyVisible(v) ? 'ok' : 'fail', `${nVisible(v)}/9 telemetry visible · status pill ${cell(v.pill)}${clip ? ` · clipped by ${clip}` : ''}`);
      return { v, clip };
    });

    // The operator looks for the telemetry: scroll the side panel with the mouse wheel.
    const scrolled = await step(4, async () => {
      hud.clearBoxes();
      const rowBox = await afterTap.v.row.located.loc?.boundingBox();
      if (!rowBox) throw new SetupError('selected row has no box');
      await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
      const views: View[] = [];
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, 90);
        await sleep(350);
        const v = await look(dev.frame, droneName);
        views.push(v);
        if (v.pill.ok && keyVisible(v)) break;
      }
      // keep scrolling to the end of the panel: what else becomes visible, what disappears
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, 90);
        await sleep(300);
        views.push(await look(dev.frame, droneName));
      }
      const best = views.reduce((a, b) => (nVisible(b) > nVisible(a) ? b : a), views[0]);
      const maxTogether = Math.max(...views.map(nVisible));
      const everWithRow = views.some((v) => v.row.ok && keyVisible(v));
      const neverSeen = TELEMETRY.filter((_, i) => !views.some((v) => v.tele[i].ok)).map((t) => t.name);
      await hud.step(4, 'ok', `${views.length} wheel steps · at most ${maxTogether}/9 values at once`);
      return { best, maxTogether, everWithRow, neverSeen, pillWithKey: views.some((v) => v.pill.ok && keyVisible(v)) };
    });

    await step(5, async () => {
      // Show the best position the operator can reach (status + most telemetry), and what it costs.
      await hud.rows(table(scrolled.best, 'best after scrolling'), 'VISIBLE AFTER SCROLLING THE SIDE PANEL', cols);
      await hud.note(
        `After scrolling: at most ${scrolled.maxTogether}/9 values at once; selected row ${scrolled.everWithRow ? 'can' : 'can never'} be seen together with battery/altitude/speed` +
          (scrolled.neverSeen.length ? `; never visible: ${scrolled.neverSeen.join(', ')}` : ''),
      );
      await hud.step(5, scrolled.everWithRow ? 'ok' : 'fail');
    });

    const others = await step(6, async () => {
      const out: Record<string, string> = {};
      for (const d of [DEVICES.iphone13, DEVICES.pixel7]) {
        await dev.resize(d, 900);
        await selectDrone(ctx, dev.frame, DRONE, droneName);
        await sleep(500);
        const v = await look(dev.frame, droneName);
        out[`${d.name} ${d.width}×${d.height}`] = `${nVisible(v)}/9 telemetry visible, status pill ${cell(v.pill)}`;
      }
      const emu = await crossCheckOnDevice(browser, DEVICES.iphoneSE, cfg.cockpitUrl, async (p) => {
        await waitCockpitConnected(ctx, p);
        const row = (await locate(p, T.deviceRow(DRONE, droneName))).loc;
        await row?.tap({ timeout: 5000 });
        await sleep(800);
        const v = await look(p, droneName);
        return `${nVisible(v)}/9 telemetry visible, status pill ${cell(v.pill)}`;
      });
      out['emulated iPhone SE (touch, DPR 2)'] = emu;
      await dev.resize(DEVICES.iphoneSE, 600);
      await hud.log('OTHER PHONES (right after selecting)', Object.entries(out).map(([k, v]) => ({ text: `${k}: ${v}`, bad: !v.startsWith('9/9') })));
      await hud.step(6, Object.values(out).every((v) => v.startsWith('9/9')) ? 'ok' : 'fail');
      return out;
    });

    const v = afterTap.v;
    obs.laptop = { telemetryVisible: nVisible(laptop!), pill: cell(laptop!.pill), map: cell(laptop!.map), video: cell(laptop!.video) };
    obs.iphoneSE = {
      afterTap: { telemetryVisible: nVisible(v), pill: cell(v.pill), row: cell(v.row), map: cell(v.map), video: cell(v.video), clippedBy: afterTap.clip },
      afterScrolling: { maxTelemetryAtOnce: scrolled.maxTogether, rowWithKeyTelemetry: scrolled.everWithRow, neverVisible: scrolled.neverSeen },
    };
    obs.otherDevices = others;
    obs.table = {
      columns: ['screen', 'right after selecting Drone 1', 'after scrolling the side panel'],
      rows: [
        ['Laptop 1366×768 (control)', `status ${cell(laptop!.pill)}, ${nVisible(laptop!)}/9 telemetry, map ${cell(laptop!.map)}, video ${cell(laptop!.video)}`, 'not needed'],
        ['iPhone SE 375×667', `status ${cell(v.pill)}, ${nVisible(v)}/9 telemetry, map ${cell(v.map)}, video ${cell(v.video)}`, `at most ${scrolled.maxTogether}/9 at once; selected row ${scrolled.everWithRow ? 'still visible' : 'scrolled out of view'}${scrolled.neverSeen.length ? `; never visible: ${scrolled.neverSeen.join(', ')}` : ''}`],
        ...Object.entries(others).map(([k, val]) => [k, val, '']),
      ],
    };
    hud.verdictAt({ left: dev.rect().right + 24, right: 434, top: '28%' });
    hud.clearBoxes();
    hud.box('panel', await scrollPanel(dev.frame, droneName), 'telemetry hidden below this side panel', { align: 'right' });
    const alike = Object.entries(others).filter(([, val]) => !val.startsWith('9/9')).map(([k]) => k.replace(/\s\d+×\d+$/, ''));

    if (keyVisible(v) && v.pill.ok) return { kind: 'PASS', headline: 'status and key telemetry visible right after selecting on a phone' };
    return {
      kind: 'BUG',
      headline: `phone: selecting a drone shows ${nVisible(v)}/9 telemetry values`,
      sub:
        `On iPhone SE, after tapping ${droneName} (in flight), its status, battery, altitude and speed are not on screen: they sit below a fixed-height side panel (${afterTap.clip ?? 'scroll box'}) filled by the device list. ` +
        `Scrolling that panel shows at most ${scrolled.maxTogether}/9 values at once and ${scrolled.everWithRow ? 'keeps' : 'loses'} the selected row. Laptop: 9/9 together with map and video.` +
        (alike.length ? ` Also on: ${alike.join(', ')}.` : ''),
    };
  },
};
