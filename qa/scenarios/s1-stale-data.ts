/**
 * S1 · Stale telemetry presented as live when the simulator link drops.
 *
 * Truth: /api/health says the simulator is disconnected and our own socket client stops receiving
 * frames, while /api/control/state (straight from the simulator) shows the drone still flying.
 * Oracle: once truth is stale and a grace period has passed, the cockpit must communicate it
 * somewhere visible (wording, "N s ago", data-state/aria/class, dashes, or dimmed values) that was
 * NOT already on screen while data was live. Wording is matched by meaning, never exact text.
 * The same run also checks the reverse direction (a stale/offline cue while live = bug) and that
 * values match truth while live, so a mutated "online↔offline" or "value off by N" is caught too.
 */
import { cfg, sleep } from '../config.ts';
import { SetupError } from '../driver.ts';
import type { HudRow } from '../overlay.ts';
import {
  compareNum,
  crossPanel,
  flightClass,
  freshnessScan,
  motionContradiction,
  newIndicators,
  parseNum,
  readText,
  T,
  type Indicator,
  type Located,
  type Target,
} from '../oracles.ts';
import type { Ctx, Scenario, Verdict } from '../runner.ts';
import { cleanStartWithTruth, DRONE, fmtS, selectDrone, takeoffToCruise, waitCockpitConnected, withTitleCard } from './common.ts';

/** Fault outlasts the recording so the verdict frames still show the broken state (cleared after). */
const FAULT_SECONDS = 30;
/** Judged window: from the end of the grace period for this long. */
const JUDGE_MS = 8000;
const TOL = { battery: 1.5, altitude: 2, hSpeed: 1.5, homeDistance: 15 };

type UiRead = { at: number; text: Record<string, string | null>; loc: Record<string, Located> };

async function readUi(ctx: Ctx, droneName: string): Promise<UiRead> {
  const targets: Record<string, Target> = {
    badge: T.socketBadge,
    pill: T.statusPill,
    row: T.deviceRow(DRONE, droneName),
    battery: T.battery,
    alt: T.altRlt,
    hSpeed: T.hSpeed,
    homeDist: T.homeDistance,
  };
  const out: UiRead = { at: Date.now(), text: {}, loc: {} };
  await Promise.all(
    Object.entries(targets).map(async ([k, t]) => {
      const r = await readText(ctx.page, t);
      out.text[k] = r.text;
      out.loc[k] = r.located;
      ctx.via[t.name] = r.via;
    }),
  );
  return out;
}

const describe = (ind: Indicator[]) => (ind.length ? [...new Set(ind.map((i) => `"${i.text}"`))].slice(0, 2).join(', ') : 'none');

export const S1: Scenario = {
  id: 'S1',
  title: 'Stale telemetry shown as live when the simulator link drops',
  category: 'Live data · Network/recovery · Freshness',
  brief: 'makes clear whether information is live, delayed, stale, disconnected or unavailable',
  rootCause: 'freshness-not-tracked',
  viewport: { width: 1440, height: 900 },
  startState: `faults cleared · sim reset (all drones standby at 100 %) · started ${cfg.speed}× · SIM_SEED ${cfg.seed} · 1440×900 · ${DRONE} selected`,
  steps: [
    'Clean start: clear faults, reset, start sim',
    'Open cockpit, select Drone 1',
    'Take off Drone 1, wait for in_flight',
    'Control: UI = truth and no stale cue while live',
    `Inject sim-offline (${FAULT_SECONDS} s window)`,
    `Grace ${cfg.graceMs / 1000} s: UI may flag staleness`,
    'Observe: does the UI say data is stale?',
  ],
  description:
    'An operator watching a drone in flight must be able to tell when the telemetry on screen stops being live. ' +
    'We cut the simulator→backend link (sim-offline) while Drone 1 is in flight. The expected behaviour, per the brief, ' +
    'is that within a few seconds the cockpit shows the data as stale/disconnected (wording, age, greyed values, or an offline status) ' +
    'instead of continuing to present the last values as current.',
  approach:
    'Deterministic Playwright run, zero LLM calls. Ground truth comes from the backend (/api/health simulator link), our own socket.io client ' +
    '(frame age for drone-1), and /api/control/state polled straight from the simulator (the drone keeps flying). ' +
    'While live, the harness checks the UI matches truth (battery, altitude, speed, distance, status) and records every freshness cue on screen as a baseline. ' +
    'After the fault and a 5 s grace (the cockpit\'s own heartbeat threshold), it samples the page every second and looks for any NEW cue that data is stale: ' +
    'stale/offline/disconnected/"N s ago" wording, data-state/aria/class markers, dashed-out or dimmed telemetry. Wording is matched by meaning. ' +
    'It also cross-checks the UI against itself (claimed speed vs unchanged distance) and against the simulator (real distance keeps growing). ' +
    'BUG only if every judged sample shows no cue; a precondition that fails (fault not active) is SETUP-FAILED, not a bug.',

  async run(ctx) {
    const { page, hud, driver, truth, step, obs } = ctx;
    let droneName = 'Drone 1';

    // 1 ─ clean start, with the title card on screen
    await withTitleCard(ctx, () =>
      step(0, async () => {
        droneName = (await cleanStartWithTruth(ctx, DRONE)).name;
      }),
    );

    // 2 ─ open the cockpit and select the drone like an operator would
    await step(1, async () => {
      await page.goto(cfg.cockpitUrl, { waitUntil: 'domcontentloaded' });
      await waitCockpitConnected(ctx, page);
      await hud.step(1, 'ok', `row found via ${await selectDrone(ctx, page, DRONE, droneName)}`);
    });

    const liveRows = (ui: UiRead): HudRow[] => {
      const d = truth.drone(DRONE);
      const fr = truth.freshness(DRONE);
      return [
        { field: 'Data link', truth: `sim ${fr.simulator} · last frame ${fmtS(fr.ageMs)}`, ui: ui.text.badge ?? 'missing', ok: !fr.stale },
        { field: 'Flight status', truth: d?.status ?? '?', ui: ui.text.pill ?? 'missing', ok: flightClass(ui.text.pill) === flightClass(d?.status) },
        compareNum('Battery', ui.text.battery, d?.battery, TOL.battery, '%'),
        compareNum('Altitude', ui.text.alt, d?.height, TOL.altitude, 'm'),
        compareNum('H-speed', ui.text.hSpeed, truth.speedMps(DRONE), TOL.hSpeed, 'm/s'),
        compareNum('Dist. home', ui.text.homeDist, truth.homeDistanceM(DRONE), TOL.homeDistance, 'm'),
      ].map((r) => ({ field: r.field, truth: r.truth, ui: r.ui, ok: r.ok }));
    };

    // 3 ─ take off and reach cruise
    await step(2, () =>
      takeoffToCruise(ctx, DRONE, async () => {
        await hud.rows(liveRows(await readUi(ctx, droneName)), 'TRUTH vs UI · live');
      }),
    );

    // 4 ─ control: UI matches truth and shows no stale cue while data is live
    const baseline: Indicator[] = [];
    const control = { samples: 0, rowFails: {} as Record<string, number>, falseStale: [] as Indicator[] };
    await step(3, async () => {
      for (let i = 0; i < 3; i++) {
        const ui = await readUi(ctx, droneName);
        const rows = liveRows(ui);
        const scan = await freshnessScan(page);
        baseline.push(...scan);
        control.samples++;
        rows.filter((r) => r.ok === false).forEach((r) => (control.rowFails[r.field] = (control.rowFails[r.field] ?? 0) + 1));
        // A stale/offline cue while truth is live is the reverse bug (e.g. "online shown as offline").
        const falseCue = scan.filter((x) => x.region === 'app' && x.kind !== 'unavailable');
        if (falseCue.length && !truth.freshness(DRONE).stale) control.falseStale.push(...falseCue);
        await hud.rows([...rows, { field: 'Stale cue on screen', truth: 'live → none expected', ui: describe(falseCue), ok: falseCue.length === 0 }], 'TRUTH vs UI · live control');
        await sleep(1000);
      }
      const cp = crossPanel([
        { source: 'status pill', value: (await readText(page, T.statusPill)).text },
        { source: 'device row', value: (await readText(page, T.deviceRow(DRONE, droneName))).text },
        { source: 'simulator', value: truth.drone(DRONE)?.status ?? null },
      ]);
      obs.control = { ...control, crossPanel: cp, baseline: baseline.map((b) => b.key) };
      const persistent = Object.entries(control.rowFails).filter(([, n]) => n >= 2);
      const problems = [...persistent.map(([f]) => f), ...(cp.agree ? [] : ['cross-panel status']), ...(control.falseStale.length ? ['stale cue while live'] : [])];
      if (problems.length) {
        await hud.step(3, 'fail', `mismatch while live: ${problems.join(', ')}`);
        obs.controlProblems = problems;
      } else await hud.step(3, 'ok', 'all fields within tolerance, no stale cue');
    });

    // 5 ─ cut the simulator link and prove it from truth before judging the UI
    const tFault = await step(4, async () => {
      await driver.fault({ kind: 'sim-offline', seconds: FAULT_SECONDS });
      const t = Date.now();
      await driver.waitFor(async () => (await driver.health())?.simulator === 'disconnected', 4000, '/api/health simulator: disconnected');
      await hud.step(4, 'ok', `/api/health → simulator: disconnected (${fmtS(Date.now() - t)} after POST)`);
      return t;
    });
    const judgeEnds = tFault + cfg.graceMs + JUDGE_MS;

    type Sample = { at: number; tS: number; judged: boolean; fail: boolean; newCues: Indicator[]; ui: Record<string, string | null>; truth: { stale: boolean; ageMs: number; simulator: string; status?: string; distM?: number; speed?: number } };
    const samples: Sample[] = [];
    const motion: { at: number; hSpeed?: number; homeDist?: number }[] = [];
    let firstCueAt: number | undefined;

    const sampleOnce = async (judging: boolean) => {
      const ui = await readUi(ctx, droneName);
      const cues = newIndicators(await freshnessScan(page), baseline);
      const fr = truth.freshness(DRONE);
      const d = truth.drone(DRONE);
      const realDist = truth.homeDistanceM(DRONE);
      const uiDist = parseNum(ui.text.homeDist);
      const at = Date.now();
      if (cues.length && firstCueAt === undefined) firstCueAt = at;
      motion.push({ at, hSpeed: parseNum(ui.text.hSpeed), homeDist: uiDist });
      const judged = judging && fr.stale && at >= tFault + cfg.graceMs && at <= judgeEnds;
      const s: Sample = {
        at,
        tS: +((at - tFault) / 1000).toFixed(1),
        judged,
        fail: judged && cues.length === 0,
        newCues: cues,
        ui: ui.text,
        truth: { stale: fr.stale, ageMs: fr.ageMs, simulator: fr.simulator, status: d?.status, distM: realDist, speed: truth.speedMps(DRONE) },
      };
      samples.push(s);
      const cue = cues.length > 0;
      const mc = motionContradiction(motion.filter((m) => m.at >= tFault + 1000));
      const distDelta = realDist !== undefined && uiDist !== undefined ? Math.abs(realDist - uiDist) : undefined;
      if (s.fail) {
        hud.box('badge', ui.loc.badge?.loc, `"${ui.text.badge}" · simulator disconnected`, { align: 'right' });
        hud.box('pill', ui.loc.pill?.loc, `no data ${fmtS(fr.ageMs)}`, { align: 'right' });
        hud.box('dist', ui.loc.homeDist?.loc, `frozen · real ${realDist?.toFixed(0) ?? '?'} m`);
        hud.box('hspeed', ui.loc.hSpeed?.loc, 'frozen');
      }
      await hud.rows(
        [
          // Before the grace period ends nothing is judged, so mismatches show as neutral (·), not ✗.
          { field: 'Data link', truth: fr.simulator === 'disconnected' ? 'SIM DISCONNECTED' : `sim ${fr.simulator}`, ui: ui.text.badge ?? 'missing', ok: cue ? true : judged ? false : null },
          { field: 'Last telemetry', truth: `${fmtS(fr.ageMs)} ago`, ui: cue ? `cue: ${describe(cues)}` : 'no stale cue', ok: cue ? true : judged ? false : null },
          { field: 'Flight status', truth: `${d?.status ?? '?'} (sim)`, ui: ui.text.pill ?? 'missing', ok: null },
          { field: 'H-speed', truth: `${truth.speedMps(DRONE)?.toFixed(1) ?? '?'} m/s (sim)`, ui: ui.text.hSpeed ?? 'missing', ok: null },
          { field: 'Dist. home', truth: realDist !== undefined ? `${realDist.toFixed(0)} m (sim)` : '?', ui: ui.text.homeDist ?? 'missing', ok: distDelta === undefined ? null : cue || distDelta <= TOL.homeDistance ? true : judged ? false : null },
          ...(mc && mc.span >= 3
            ? [{ field: 'UI self-check', truth: `${mc.claimed.toFixed(0)} m/s × ${mc.span.toFixed(0)} s ⇒ +${mc.expected.toFixed(0)} m`, ui: `moved ${mc.moved.toFixed(0)} m`, ok: !mc.contradiction || cue ? true : judged ? false : null }]
            : []),
        ],
        `TRUTH vs UI · t+${s.tS.toFixed(0)} s after fault`,
      );
      return s;
    };

    // 6 ─ grace: the UI gets time to notice (not judged)
    await step(5, async () => {
      await hud.countdown(`grace: UI has ${cfg.graceMs / 1000} s to flag staleness`, cfg.graceMs - (Date.now() - tFault));
      while (Date.now() < tFault + cfg.graceMs) {
        const t = Date.now();
        await sampleOnce(false);
        await sleep(Math.max(0, 1000 - (Date.now() - t)));
      }
      await hud.clearCountdown();
      await hud.step(5, 'ok', firstCueAt ? `UI flagged it after ${fmtS(firstCueAt - tFault)}` : 'no cue yet');
    });

    // 7 ─ judged window: every second until just before the fault expires
    await step(6, async () => {
      await hud.countdown('judging: stale cue required on every sample', judgeEnds - Date.now());
      while (Date.now() <= judgeEnds - 400) {
        const t = Date.now();
        await sampleOnce(true);
        await sleep(Math.max(0, 1000 - (Date.now() - t)));
      }
      await hud.clearCountdown();
    });

    const judged = samples.filter((s) => s.judged);
    const failed = judged.filter((s) => s.fail);
    const mc = motionContradiction(motion.filter((m) => m.at >= tFault + 1000));
    const last = judged[judged.length - 1] ?? samples[samples.length - 1];
    obs.fault = { kind: 'sim-offline', seconds: FAULT_SECONDS, graceMs: cfg.graceMs, staleMs: cfg.staleMs };
    obs.samples = samples.map(({ at: _at, ...s }) => ({ ...s, newCues: s.newCues.map((c) => c.text) }));
    obs.judged = { total: judged.length, withoutCue: failed.length };
    obs.firstCueS = firstCueAt ? +((firstCueAt - tFault) / 1000).toFixed(1) : null;
    obs.motionContradiction = mc;
    obs.table = {
      columns: ['t after fault', 'truth: last frame', 'truth: simulator', 'UI badge', 'UI status', 'UI H-speed', 'UI dist.', 'real dist.', 'new stale cue'],
      rows: samples
        .filter((s) => s.judged)
        .map((s) => [`${s.tS} s`, `${fmtS(s.truth.ageMs)} ago`, s.truth.simulator, s.ui.badge, s.ui.pill, s.ui.hSpeed, s.ui.homeDist, s.truth.distM !== undefined ? `${s.truth.distM.toFixed(0)} m` : null, describe(s.newCues)]),
    };

    const controlProblems = (obs.controlProblems as string[] | undefined) ?? [];
    if (judged.length < 3) throw new SetupError(`only ${judged.length} judged samples (fault window too short)`);

    if (failed.length === judged.length) {
      await hud.step(6, 'fail', `no stale cue in ${failed.length}/${judged.length} samples`);
      const v: Verdict = {
        kind: 'BUG',
        headline: `telemetry ${fmtS(last.truth.ageMs)} old, still shown as live`,
        sub:
          `Simulator disconnected, no data for ${fmtS(last.truth.ageMs)}; cockpit still says "${last.ui.badge}", "${last.ui.pill}", ${last.ui.hSpeed}, ` +
          `distance ${last.ui.homeDist} (real ${last.truth.distM?.toFixed(0) ?? '?'} m). No stale/offline cue in ${failed.length}/${judged.length} samples after a ${cfg.graceMs / 1000} s grace.` +
          (controlProblems.length ? ` Also while live: ${controlProblems.join(', ')}.` : ''),
      };
      return v;
    }
    const latency = firstCueAt !== undefined ? firstCueAt - tFault : Infinity;
    if (latency > cfg.graceMs + 1500) {
      await hud.step(6, 'fail', `cue only after ${fmtS(latency)}`);
      return { kind: 'BUG', headline: `staleness flagged late (${fmtS(latency)})`, sub: `Cue: ${describe(samples.find((s) => s.newCues.length)?.newCues ?? [])}. ${failed.length}/${judged.length} judged samples had no cue.` };
    }
    await hud.step(6, 'ok', `cue after ${fmtS(latency)}: ${describe(samples.find((s) => s.newCues.length)?.newCues ?? [])}`);
    if (controlProblems.length)
      return { kind: 'BUG', headline: `UI disagrees with truth while live: ${controlProblems.join(', ')}`, sub: 'Staleness itself was flagged correctly.' };
    return { kind: 'PASS', headline: `UI flagged stale data after ${fmtS(latency)}`, sub: `Cue: ${describe(samples.find((s) => s.newCues.length)?.newCues ?? [])}` };
  },
};
