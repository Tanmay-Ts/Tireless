/**
 * S2 · Out-of-order telemetry rendered as current.
 *
 * Condition: socket-delay 3000 ms. The backend holds every message back by 3000 ms plus up to 50 %
 * random jitter, independently per message, so frames sent 500 ms apart can arrive swapped.
 * Truth: our own socket client sits in the same socket.io rooms, so it receives the same frames in the
 * same order as the cockpit; each global_position payload carries the simulator `timestamp`.
 * Oracle: Drone 1 flies a straight line away from its dock, so real distance-from-home only grows.
 * A MutationObserver records EVERY value the UI shows. A backward jump in the UI that coincides with
 * the arrival of a frame older than one already delivered = the UI rendered stale data over newer data.
 */
import { cfg, sleep } from '../config.ts';
import { SetupError } from '../driver.ts';
import { freshnessScan, newIndicators, parseNum, readSeries, readText, T, watchText, type Indicator } from '../oracles.ts';
import type { Scenario } from '../runner.ts';
import type { Frame } from '../truth.ts';
import { cleanStartWithTruth, DRONE, fmtS, selectDrone, takeoffToCruise, waitCockpitConnected, withTitleCard } from './common.ts';

const DELAY_MS = 3000;
const CONTROL_MS = 5000;
const OBSERVE_MS = 22000;
/** UI shows whole metres; a real backward step is ≥ 5 m (10 m/s × 0.5 s per frame). */
const JUMP_TOL_M = 2;
/** A UI change and the frame that caused it arrive within this window (render latency + clock jitter). */
const MATCH_MS = 600;

type Jump = { t: number; from: number; to: number; olderByMs?: number };

function findJumps(series: { t: number; text: string }[], since: number, until = Infinity): Jump[] {
  const pts = series.map((p) => ({ t: p.t, v: parseNum(p.text) })).filter((p): p is { t: number; v: number } => p.v !== undefined);
  const out: Jump[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t < since || pts[i].t > until) continue;
    if (pts[i].v < pts[i - 1].v - JUMP_TOL_M) out.push({ t: pts[i].t, from: pts[i - 1].v, to: pts[i].v });
  }
  return out;
}

/** Tie a UI jump to its cause: the frame showing that value arrived after a frame with a newer timestamp. */
function explain(j: Jump, frames: Frame[]) {
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const d = f.payload?.home_position?.distance;
    if (typeof d !== 'number' || Math.abs(f.at - j.t) > MATCH_MS || Math.abs(d - j.to) > 1) continue;
    const newestBefore = Math.max(...frames.slice(0, i).map((x) => x.ts ?? -Infinity));
    if (f.ts !== undefined && f.ts < newestBefore) return newestBefore - f.ts;
  }
  return undefined;
}

export const S2: Scenario = {
  id: 'S2',
  title: 'Out-of-order telemetry rendered as current: drone jumps backwards',
  category: 'Live data · Changing network conditions · Telemetry integrity',
  brief: 'makes clear whether information is live, delayed, stale, disconnected or unavailable',
  rootCause: 'ignores-message-timestamp',
  viewport: { width: 1440, height: 900 },
  startState: `faults cleared · sim reset · started ${cfg.speed}× · SIM_SEED ${cfg.seed} · 1440×900 · ${DRONE} selected, flying straight out`,
  steps: [
    'Clean start: clear faults, reset, start sim',
    'Open cockpit, select Drone 1',
    'Take off Drone 1, wait for in_flight',
    `Control ${CONTROL_MS / 1000} s: distance only grows (no fault)`,
    `Inject socket-delay ${DELAY_MS} ms (+≤50 % jitter)`,
    `Record every UI update for ${OBSERVE_MS / 1000} s`,
    'Match each backward jump to a late frame',
  ],
  description:
    'Networks deliver telemetry late and occasionally out of order. When a newer position has already been shown, an older one must not replace it: ' +
    'the operator would see the drone jump backwards and read a wrong position, distance and track. We delay the telemetry path by 3 s with jitter ' +
    '(the kit\'s socket-delay fault) while Drone 1 flies a straight line away from its dock, so its true distance from home only increases. ' +
    'Expected: the cockpit keeps showing the newest data (discarding late, older frames) and makes clear the data is delayed.',
  approach:
    'Deterministic Playwright run, zero LLM calls. A MutationObserver in the page records every value "Dist. from home" displays, with wall-clock time. ' +
    'Our own socket.io client subscribes to the same topics and receives the same frames in the same order as the cockpit, each with the simulator timestamp. ' +
    'Control first: 5 s without the fault, the displayed distance must never decrease. Then socket-delay 3000 ms for 22 s. ' +
    'Every backward step in the UI larger than 2 m is matched to the frame that caused it (same value, arrived within 600 ms) and counts only if that frame\'s ' +
    'timestamp is older than a frame already delivered. BUG requires at least 2 such matched jumps; if the network produced fewer than 2 out-of-order frames the run is SETUP-FAILED, not PASS.',

  async run(ctx) {
    const { page, hud, driver, truth, step, obs } = ctx;
    let droneName = 'Drone 1';
    const dist = () => readText(page, T.homeDistance);

    await withTitleCard(ctx, () =>
      step(0, async () => {
        droneName = (await cleanStartWithTruth(ctx, DRONE)).name;
      }),
    );
    await step(1, async () => {
      await page.goto(cfg.cockpitUrl, { waitUntil: 'domcontentloaded' });
      await waitCockpitConnected(ctx, page);
      await hud.step(1, 'ok', `row found via ${await selectDrone(ctx, page, DRONE, droneName)}`);
    });

    const posFrames = (from: number, to = Infinity) => truth.framesFor(DRONE, 'global_position').filter((f) => f.at >= from && f.at <= to);
    const liveRows = async (phaseStart: number, faultAt?: number) => {
      const series = await readSeries(page, 'dist');
      const js = findJumps(series, phaseStart);
      const frames = posFrames(faultAt ?? phaseStart);
      const ooo = frames.filter((f, i) => i > 0 && f.ts !== undefined && f.ts < Math.max(...frames.slice(0, i).map((x) => x.ts ?? -Infinity))).length;
      const ages = frames.filter((f) => f.ts !== undefined).map((f) => f.at - (f.ts as number));
      const real = truth.homeDistanceM(DRONE);
      const updates = series.filter((p) => p.t >= phaseStart).length;
      await hud.rows(
        [
          { field: 'Frames out of order', truth: `${ooo} of ${frames.length} (our socket)`, ui: '—', ok: null },
          { field: 'Data age on arrival', truth: ages.length ? `${fmtS(Math.min(...ages))}–${fmtS(Math.max(...ages))}` : '—', ui: faultAt ? 'shown as current' : 'live', ok: null },
          { field: 'UI updates', truth: 'distance only grows', ui: `${updates} changes`, ok: null },
          { field: 'UI backward jumps', truth: 'none expected', ui: `${js.length}`, ok: js.length === 0 },
          { field: 'Dist. home', truth: real !== undefined ? `${real.toFixed(0)} m (sim)` : '?', ui: (await dist()).text ?? 'missing', ok: null },
        ],
        faultAt ? `TRUTH vs UI · t+${((Date.now() - faultAt) / 1000).toFixed(0)} s after delay on` : 'TRUTH vs UI · control, no fault',
      );
      return { series, js, frames };
    };

    await step(2, () => takeoffToCruise(ctx, DRONE, undefined, 1500));

    // Control: record the UI series without any fault; the distance must only grow.
    const baseline: Indicator[] = [];
    const controlStart = Date.now();
    await step(3, async () => {
      const d = await dist();
      ctx.via[T.homeDistance.name] = d.via;
      if (!d.located.loc) throw new SetupError('"Dist. from home" not found (testid, label or text)');
      await watchText(d.located.loc, 'dist');
      while (Date.now() < controlStart + CONTROL_MS) {
        await liveRows(controlStart);
        await sleep(1000);
      }
      baseline.push(...(await freshnessScan(page)));
      const { js, series } = await liveRows(controlStart);
      obs.control = { updates: series.length, backwardJumps: js.length };
      if (js.length) throw new SetupError(`distance went backwards ${js.length}× without any fault; cannot attribute jumps to the delay`);
      await hud.step(3, 'ok', `${series.length} updates, 0 backward jumps`);
    });

    const faultAt = await step(4, async () => {
      await driver.fault({ kind: 'socket-delay', value: DELAY_MS });
      await hud.step(4, 'ok', 'GET /api/control/fault lists socket-delay');
      return Date.now();
    });

    let last = { series: [] as { t: number; text: string }[], js: [] as Jump[], frames: [] as Frame[] };
    await step(5, async () => {
      await hud.countdown(`recording every UI update · frames arrive ${DELAY_MS / 1000}–${(DELAY_MS * 1.5) / 1000} s late`, OBSERVE_MS);
      while (Date.now() < faultAt + OBSERVE_MS) {
        const t = Date.now();
        last = await liveRows(faultAt, faultAt);
        const explained = last.js.map((j) => ({ ...j, olderByMs: explain(j, truth.framesFor(DRONE, 'global_position')) }));
        await hud.log(
          `UI "DIST. FROM HOME" WENT BACKWARDS · ${explained.length}×`,
          explained.map((j) => ({
            text: `t+${((j.t - faultAt) / 1000).toFixed(1)} s  ${j.from} → ${j.to} m  ${j.olderByMs !== undefined ? `late frame, −${j.olderByMs} ms` : 'unmatched'}`,
            bad: true,
          })),
        );
        const lastJump = explained[explained.length - 1];
        if (lastJump) hud.box('dist', (await dist()).located.loc, `went back ${lastJump.from} → ${lastJump.to} m at t+${((lastJump.t - faultAt) / 1000).toFixed(1)} s`);
        await sleep(Math.max(0, 1000 - (Date.now() - t)));
      }
      await hud.clearCountdown();
    });

    // Verdict
    const frames = posFrames(faultAt);
    const outOfOrder = frames.filter((f, i) => i > 0 && f.ts !== undefined && f.ts < Math.max(...frames.slice(0, i).map((x) => x.ts ?? -Infinity)));
    const jumps = findJumps(last.series, faultAt).map((j) => ({ ...j, olderByMs: explain(j, truth.framesFor(DRONE, 'global_position')) }));
    const matched = jumps.filter((j) => j.olderByMs !== undefined);
    const ages = frames.filter((f) => f.ts !== undefined).map((f) => f.at - (f.ts as number));
    const delayCue = newIndicators(await freshnessScan(page), baseline);
    obs.fault = { kind: 'socket-delay', valueMs: DELAY_MS, observeMs: OBSERVE_MS };
    obs.truth = { frames: frames.length, outOfOrder: outOfOrder.length, ageMinS: +(Math.min(...ages) / 1000).toFixed(1), ageMaxS: +(Math.max(...ages) / 1000).toFixed(1) };
    obs.ui = { updates: last.series.filter((p) => p.t >= faultAt).length, backwardJumps: jumps.length, matched: matched.length };
    obs.delayCue = delayCue.map((c) => c.text);
    if (!delayCue.length)
      obs.alsoObserved = [{ rootCause: 'freshness-not-tracked', note: `Data arrived ${obs.truth && (obs.truth as any).ageMinS}–${(obs.truth as any).ageMaxS} s late with no "delayed" cue anywhere in the cockpit (same root cause as S1).` }];
    obs.table = {
      columns: ['t after delay on', 'UI showed', 'then UI showed', 'cause (our socket)'],
      rows: jumps.map((j) => [`${((j.t - faultAt) / 1000).toFixed(1)} s`, `${j.from} m`, `${j.to} m`, j.olderByMs !== undefined ? `frame ${j.olderByMs} ms older than one already delivered` : 'not matched']),
    };

    if (outOfOrder.length < 2) throw new SetupError(`only ${outOfOrder.length} out-of-order frames in ${OBSERVE_MS / 1000} s; condition not reproduced`);
    if (matched.length >= 2) {
      await hud.step(6, 'fail', `${matched.length}/${jumps.length} jumps caused by late frames`);
      return {
        kind: 'BUG',
        headline: `UI rendered older telemetry over newer: ${matched.length} backward jumps`,
        sub:
          `With ${DELAY_MS} ms delay + jitter, ${outOfOrder.length}/${frames.length} position frames arrived out of order. The cockpit displayed them anyway: ` +
          `distance-from-home went backwards ${jumps.length}× (e.g. ${matched[0].from} → ${matched[0].to} m) while the drone flew straight away from its dock. ` +
          `${delayCue.length ? '' : `No "delayed" cue while data was ${obs.truth && (obs.truth as any).ageMinS}–${(obs.truth as any).ageMaxS} s old.`}`,
      };
    }
    if (jumps.length === 0) {
      await hud.step(6, 'ok', `${outOfOrder.length} late frames, none shown over newer data`);
      return { kind: 'PASS', headline: `UI never showed older data over newer (${outOfOrder.length} out-of-order frames)` };
    }
    throw new SetupError(`inconclusive: ${jumps.length} backward jump(s), ${matched.length} matched to late frames`);
  },
};
