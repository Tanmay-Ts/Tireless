/**
 * K · Cockpit invariant suite: checks that PASS on the unmodified kit and must FAIL when a bug is planted.
 * (S1–S4 document bugs the kit already has; K is the regression net for NEW bugs, e.g. judges' mutations.)
 *
 *  K1 Presence: every element the brief needs (connection badge, device rows, status pill, 9 telemetry values,
 *     map, video, map toggles) is displayed; every control reachable in the clean build still is (laptop).
 *  K2 Values: battery, altitude, H-speed, distance, heading match the latest telemetry frame for the selected drone.
 *  K3 Cross-panel: device-list pill, telemetry status pill and backend agree on flight state.
 *  K4 Live data is not shown as stale/offline (no stale cue, connection badge says connected).
 *  K5 Link loss is shown: socket-refuse 6 s → a new stale/offline cue within 5 s, gone again after recovery.
 *  K6 Phone (iPhone 13): every control reachable in the clean build at that size still is.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cfg, QA_ROOT, sleep } from '../config.ts';
import { DeviceFrame, DEVICES } from '../device.ts';
import type { Mutant } from '../mutants/index.ts';
import type { HudRow } from '../overlay.ts';
import {
  auditControls,
  auditRegressions,
  crossPanel,
  flightClass,
  freshnessScan,
  locate,
  newIndicators,
  parseNum,
  reachability,
  readText,
  T,
  type AuditRow,
  type Indicator,
  type Located,
  type Target,
} from '../oracles.ts';
import type { Scenario, Verdict } from '../runner.ts';
import { cleanStartWithTruth, DRONE, fmtS, selectDrone, takeoffToCruise, withTitleCard } from './common.ts';

export const K_CHECKS = [
  { id: 'K1', label: 'Presence: everything the clean build shows' },
  { id: 'K2', label: 'Values match the backend' },
  { id: 'K3', label: 'Flight status agrees across panels' },
  { id: 'K4', label: 'Live data not shown as offline' },
  { id: 'K5', label: 'Link loss shown, then recovers' },
  { id: 'K6', label: 'Phone 390 px: controls still reachable' },
] as const;

const BASELINE = path.join(QA_ROOT, 'baseline', 'clean-invariants.json');
type Slim = Pick<AuditRow, 'key' | 'label' | 'state' | 'afterScroll'>;
type Baseline = { recordedAt: string; laptop: Slim[]; phone: Slim[] };
const slim = (rows: AuditRow[]): Slim[] => rows.map(({ key, label, state, afterScroll }) => ({ key, label, state, afterScroll }));

const TELEMETRY: Target[] = [T.battery, T.altRlt, T.altAgl, T.altAsl, T.hSpeed, T.vSpeed, T.heading, T.wind, T.homeDistance];
/** Tolerance vs the latest frame the cockpit also received (≤ 1 frame apart at 2 Hz). */
const TOL = { battery: 1.5, altitude: 2, hSpeed: 1, homeDistance: 12, heading: 3 };

type Result = { ok: boolean | null; summary: string; details?: string[] };

export function makeK(m: Mutant): Scenario {
  const expectText = m.expect.length ? `expected: caught by ${m.expect.join(' + ')}` : 'expected: PASS (must not raise a false alarm)';
  return {
    id: m.id === 'clean' ? 'K-clean' : `K-${m.id}`,
    section: 'mutation',
    title: m.id === 'clean' ? 'Invariant suite on the unmodified kit' : `Planted: ${m.title}`,
    category: 'Mutation testing · Regression net',
    brief: 'makes clear whether information is live, delayed, stale, disconnected or unavailable',
    rootCause: `mutant:${m.id}`,
    viewport: { width: 1440, height: 900 },
    startState: `${m.id === 'clean' ? 'unmodified kit' : `planted bug: ${m.planted}`} · ${expectText} · faults cleared · sim reset · ${cfg.speed}× · SIM_SEED ${cfg.seed}`,
    steps: ['Clean start, select + take off Drone 1', ...K_CHECKS.map((c) => `${c.id} ${c.label}`)],
    description: `Mutation run "${m.id}": ${m.planted}. ${expectText}.`,
    approach: 'Runs the six cockpit invariants K1–K6 (see system design). Each passes on the unmodified kit; the mutant runner checks that planted bugs fail the expected invariant and harmless changes pass.',

    async run(ctx) {
      const { page, hud, driver, truth, step, obs } = ctx;
      const results: Record<string, Result> = {};
      const baseline: Baseline | undefined = m.id !== 'clean' && existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : undefined;
      const fresh: Partial<Baseline> = {};
      let droneName = 'Drone 1';

      const table = (): HudRow[] =>
        K_CHECKS.map((c) => ({ field: c.id, truth: c.label.split(':')[0], ui: results[c.id]?.summary ?? '…', ok: results[c.id] ? results[c.id].ok : null }));
      const record = async (i: number, id: string, r: Result, locs: (Located | undefined)[] = []) => {
        results[id] = r;
        for (const l of locs) if (l?.loc && r.ok === false) hud.box(`${id}-${l.target.name}`, l.loc, `${id}: ${l.target.name}`, { align: 'right' });
        await hud.rows(table(), `INVARIANTS · ${expectText}`, ['CHECK', 'MUST HOLD', 'THIS BUILD']);
        await hud.step(i, r.ok === false ? 'fail' : r.ok === null ? 'skip' : 'ok', r.summary);
      };

      await withTitleCard(ctx, () =>
        step(0, async () => {
          droneName = (await cleanStartWithTruth(ctx, DRONE)).name;
        }),
      );
      await step(0, async () => {
        await page.goto(cfg.cockpitUrl, { waitUntil: 'domcontentloaded' });
        // No dependency on the connection badge here: a mutant may have removed or broken it.
        await driver.waitFor(async () => !!(await locate(page, T.deviceRow(DRONE, droneName))).loc, 20000, 'device list rendered');
        await selectDrone(ctx, page, DRONE, droneName);
        await takeoffToCruise(ctx, DRONE, undefined, 2000);
        await driver.waitFor(async () => !!(await locate(page, T.map2d)).loc, 20000, 'map loaded');
      });

      // K1 — presence (laptop)
      await step(1, async () => {
        const devices = (await driver.devices()).filter((d) => d.type === 'drone');
        const items: Target[] = [T.socketBadge, T.statusPill, ...TELEMETRY, T.mapCanvas, T.videoPlayer, T.map2d, T.map3d, ...devices.map((d) => T.deviceRow(d.id, d.name))];
        const missing: string[] = [];
        for (const t of items) {
          const r = await reachability(page, t);
          ctx.via[t.name] = r.via;
          if (!r.ok) missing.push(`${t.name}: ${r.reason}`);
          else if (TELEMETRY.includes(t) && parseNum((await readText(page, t)).text) === undefined) missing.push(`${t.name}: no value`);
        }
        const audit = await auditControls(page);
        fresh.laptop = slim(audit);
        const reg = baseline ? auditRegressions(audit, baseline.laptop).map((r) => `${r.label}: ${r.reason}`) : [];
        const fails = [...missing, ...reg];
        const fallbacks = Object.entries(ctx.via).filter(([, v]) => v !== 'testid' && v !== 'none').map(([k, v]) => `${k}→${v}`);
        await record(1, 'K1', {
          ok: fails.length === 0,
          summary: fails.length ? fails[0] + (fails.length > 1 ? ` (+${fails.length - 1})` : '') : `${items.length} items present${fallbacks.length ? ` · located via fallback: ${fallbacks.join(', ')}` : ''}`,
          details: fails,
        });
      });

      // K2 — values vs the latest frame the cockpit also received
      await step(2, async () => {
        const fails: Record<string, number> = {};
        const lastSeen: Record<string, string> = {};
        const locs: Record<string, Located> = {};
        for (let i = 0; i < 3; i++) {
          const gp = truth.last(DRONE, 'global_position')?.payload;
          const bat = truth.last(DRONE, 'battery')?.payload;
          const att = truth.last(DRONE, 'attitude')?.payload;
          const pairs: [Target, number | undefined, number][] = [
            [T.battery, bat?.percent, TOL.battery],
            [T.altRlt, gp?.position?.height, TOL.altitude],
            [T.hSpeed, gp?.speed?.horizontal, TOL.hSpeed],
            [T.homeDistance, gp?.home_position?.distance, TOL.homeDistance],
            [T.heading, att?.yaw, TOL.heading],
          ];
          for (const [t, tv, tol] of pairs) {
            const r = await readText(page, t);
            locs[t.name] = r.located;
            const uv = parseNum(r.text);
            if (tv === undefined) continue;
            if (uv === undefined || Math.abs(uv - tv) > tol) {
              fails[t.name] = (fails[t.name] ?? 0) + 1;
              lastSeen[t.name] = `${r.text ?? 'missing'} vs ${tv.toFixed(1)}`;
            }
          }
          await sleep(900);
        }
        const bad = Object.entries(fails).filter(([, n]) => n >= 2).map(([k]) => k);
        await record(
          2,
          'K2',
          { ok: bad.length === 0, summary: bad.length ? bad.map((k) => `${k} ${lastSeen[k]}`).join(' · ') : '5 values within tolerance (3 samples)', details: bad.map((k) => `${k}: UI ${lastSeen[k]} (backend)`) },
          bad.map((k) => locs[k]),
        );
      });

      // K3 — cross-panel status
      await step(3, async () => {
        let disagree = 0;
        let last = '';
        let pillLoc: Located | undefined;
        for (let i = 0; i < 2; i++) {
          const pill = await readText(page, T.statusPill);
          pillLoc = pill.located;
          const row = await readText(page, T.deviceRow(DRONE, droneName));
          const cp = crossPanel([
            { source: 'device list', value: row.text },
            { source: 'status pill', value: pill.text },
            { source: 'backend', value: truth.drone(DRONE)?.status ?? null },
          ]);
          if (!cp.agree) {
            disagree++;
            last = cp.classes.map((c) => `${c.source} ${c.cls}`).join(' / ');
          }
          await sleep(700);
        }
        await record(3, 'K3', { ok: disagree < 2, summary: disagree >= 2 ? last : 'list, pill and backend agree' }, [pillLoc]);
      });

      // K4 — live data not shown as offline
      let liveScan: Indicator[] = [];
      await step(4, async () => {
        await driver.waitFor(() => truth.frameAgeMs(DRONE) < 1500, 5000, 'backend telemetry live');
        liveScan = await freshnessScan(page);
        const cues = liveScan.filter((x) => x.region === 'app');
        const badge = await readText(page, T.socketBadge);
        const badgeOk = badge.text === null || (/connected/i.test(badge.text) && !/dis/i.test(badge.text));
        const fails = [...cues.map((c) => `cue "${c.text}"`), ...(badgeOk ? [] : [`badge says "${badge.text}"`])];
        await record(4, 'K4', { ok: fails.length === 0, summary: fails.length ? `${fails.join(' · ')} while live` : 'no stale/offline cue while live' }, badgeOk ? [] : [badge.located]);
      });

      // K5 — link loss is shown, then recovers
      await step(5, async () => {
        await driver.fault({ kind: 'socket-refuse', seconds: 6 });
        const t0 = Date.now();
        let shownAt: number | undefined;
        let cue: Indicator[] = [];
        while (Date.now() < t0 + 5000 && shownAt === undefined) {
          cue = newIndicators(await freshnessScan(page), liveScan);
          if (cue.length) shownAt = Date.now();
          else await sleep(400);
        }
        await hud.note(shownAt ? `link loss shown after ${fmtS(shownAt - t0)}: "${cue[0].text}"` : 'no cue within 5 s of the link being refused');
        let recoveredAt: number | undefined;
        while (Date.now() < t0 + 20000 && recoveredAt === undefined) {
          await sleep(500);
          if (Date.now() > t0 + 6000 && newIndicators(await freshnessScan(page), liveScan).length === 0) recoveredAt = Date.now();
        }
        await hud.note(undefined);
        await record(5, 'K5', {
          ok: shownAt !== undefined && recoveredAt !== undefined,
          summary: shownAt === undefined ? 'link refused 6 s: no stale/offline cue at all' : recoveredAt === undefined ? `cue "${cue[0].text}" did not clear after recovery` : `"${cue[0].text}" after ${fmtS(shownAt - t0)}, cleared after ${fmtS(recoveredAt - t0)}`,
        });
      });

      // K6 — phone reachability vs the clean build at the same size
      await step(6, async () => {
        const dev = new DeviceFrame(page);
        await dev.mount(cfg.cockpitUrl, DEVICES.iphone13);
        await driver.waitFor(async () => !!(await locate(dev.frame, T.map2d)).loc, 25000, 'phone: map loaded');
        await sleep(1200);
        const audit = await auditControls(dev.frame);
        fresh.phone = slim(audit);
        hud.verdictAt({ left: dev.rect().right + 24, right: 434, top: '30%' });
        if (!baseline && m.id !== 'clean') return record(6, 'K6', { ok: null, summary: 'no clean baseline yet: run the clean kit first' });
        const reg = auditRegressions(audit, baseline?.phone ?? fresh.phone).map((r) => `${r.label}: ${r.reason}`);
        await record(6, 'K6', { ok: reg.length === 0, summary: reg.length ? reg[0] + (reg.length > 1 ? ` (+${reg.length - 1})` : '') : `${audit.length} controls as reachable as in the clean build`, details: reg });
      });

      if (m.id === 'clean') {
        mkdirSync(path.dirname(BASELINE), { recursive: true });
        writeFileSync(BASELINE, JSON.stringify({ recordedAt: new Date().toISOString(), laptop: fresh.laptop ?? [], phone: fresh.phone ?? [] } satisfies Baseline, null, 2));
      }
      obs.mutant = { id: m.id, planted: m.planted, expect: m.expect };
      obs.checks = results;
      const failed = K_CHECKS.filter((c) => results[c.id]?.ok === false).map((c) => c.id);
      obs.failed = failed;
      obs.table = { columns: ['check', 'result'], rows: K_CHECKS.map((c) => [`${c.id} ${c.label}`, `${results[c.id]?.ok === false ? 'FAIL' : results[c.id]?.ok === null ? 'skipped' : 'pass'}: ${results[c.id]?.summary ?? ''}`]) };
      const v: Verdict = failed.length
        ? { kind: 'BUG', headline: `caught by ${failed.join(' + ')}`, sub: failed.map((id) => `${id}: ${results[id].summary}`).join(' | ') }
        : { kind: 'PASS', headline: `all ${K_CHECKS.length} invariants hold`, sub: m.id === 'clean' ? 'Clean baseline recorded for K1/K6.' : m.expect.length ? `Expected ${m.expect.join(' + ')} to fail: MISSED.` : 'Harmless change: no false alarm.' };
      return v;
    },
  };
}
