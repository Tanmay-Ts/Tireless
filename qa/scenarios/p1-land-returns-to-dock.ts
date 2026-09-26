/**
 * P1 · Precision check: Land returns the drone to its dock. Intended; must NOT be flagged.
 *
 * The kit README says Land brings the drone "down where it is"; the latest kit commit
 * ("... and return-to-dock landing") changed it to fly back to the dock first. The backend is the
 * reference, so the harness expects what the backend does and only checks that the cockpit follows it:
 * status in_flight → landing → standby, altitude and distance from home tracking the simulator, and a
 * final state on the dock. A difference between docs and backend is classified INTENDED, not BUG.
 */
import { cfg, sleep } from '../config.ts';
import type { HudRow } from '../overlay.ts';
import { compareNum, flightClass, parseNum, readText, T } from '../oracles.ts';
import type { Scenario, Verdict } from '../runner.ts';
import { cleanStartWithTruth, DRONE, fmtS, selectDrone, takeoffToCruise, waitCockpitConnected, withTitleCard } from './common.ts';

const SPEED = 2;
/** Tolerances at 2× (20 m/s cruise, 6 m/s descent) for ~0.5 s between the UI read and the truth poll. */
const TOL = { altitude: 7, homeDistance: 25, battery: 2 };
const README_SAYS = 'Press Land to bring it down where it is';
const COMMIT_SAYS = 'feat(cockpit): add 2D/3D view toggle, terrain height references and return-to-dock landing';

type Sample = { at: number; truth: { status?: string; height?: number; dist?: number; battery?: number }; ui: { pill: string | null; alt: string | null; dist: string | null; battery: string | null } };

const dedupe = (xs: (string | null | undefined)[]) => xs.filter((x, i) => x && x !== xs[i - 1]) as string[];

export const P1: Scenario = {
  id: 'P1',
  section: 'precision',
  speed: SPEED,
  title: 'Land returns the drone to its dock: intended, not flagged',
  category: 'Precision · Intended behaviour vs outdated docs',
  brief: 'Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together',
  rootCause: 'intended-return-to-dock',
  viewport: { width: 1440, height: 900 },
  startState: `faults cleared · sim reset · started ${SPEED}× (shorter flight; video is real time) · SIM_SEED ${cfg.seed} · 1440×900 · ${DRONE} selected`,
  steps: [
    `Clean start at ${SPEED}×`,
    'Open cockpit, select Drone 1',
    'Take off, cruise away from the dock',
    'Land (POST /api/control/command)',
    'Follow: cockpit vs backend until the drone is down',
    'Classify: docs vs backend vs cockpit',
  ],
  description:
    'Precision check, not a numbered finding. The kit README says Land brings the drone "down where it is", but the backend now flies it back to its dock first (latest kit commit: "return-to-dock landing"). ' +
    'A tester that trusts the README would raise a false alarm. We land Drone 1 mid-flight and check that the cockpit shows what the drone really does.',
  approach:
    'The backend is the reference. After Land, the harness samples the cockpit (status pill, altitude, distance from home, battery) and the simulator state every ~0.7 s until the drone is down, ' +
    'checks the status sequence matches (in_flight → landing → standby), values stay within tolerance, and the final state is on the dock. ' +
    'It then compares the three sources: README (lands in place), backend (returned to the dock before descending), cockpit (followed the backend). ' +
    'Docs and backend disagreeing while the cockpit matches the backend is classified INTENDED, never BUG.',

  async run(ctx) {
    const { page, hud, driver, truth, step, obs } = ctx;
    let droneName = 'Drone 1';

    await withTitleCard(ctx, () =>
      step(0, async () => {
        droneName = (await cleanStartWithTruth(ctx, DRONE, SPEED)).name;
      }),
    );
    await step(1, async () => {
      await page.goto(cfg.cockpitUrl, { waitUntil: 'domcontentloaded' });
      await waitCockpitConnected(ctx, page);
      await hud.step(1, 'ok', `row found via ${await selectDrone(ctx, page, DRONE, droneName)}`);
    });

    const read = async (): Promise<Sample> => {
      const [pill, alt, dist, battery] = await Promise.all([T.statusPill, T.altRlt, T.homeDistance, T.battery].map((t) => readText(page, t)));
      const d = truth.drone(DRONE);
      return { at: Date.now(), truth: { status: d?.status, height: d?.height, dist: truth.homeDistanceM(DRONE), battery: d?.battery }, ui: { pill: pill.text, alt: alt.text, dist: dist.text, battery: battery.text } };
    };
    const rowsFor = (s: Sample): HudRow[] =>
      [
        { field: 'Status', truth: s.truth.status ?? '?', ui: s.ui.pill ?? 'missing', ok: flightClass(s.ui.pill) === flightClass(s.truth.status) || null },
        compareNum('Altitude', s.ui.alt, s.truth.height, TOL.altitude, 'm'),
        compareNum('Dist. home', s.ui.dist, s.truth.dist, TOL.homeDistance, 'm'),
        compareNum('Battery', s.ui.battery, s.truth.battery, TOL.battery, '%'),
        { field: 'Docs (README)', truth: 'lands where it is', ui: '—', ok: null },
      ].map((r) => ({ field: r.field, truth: r.truth, ui: r.ui, ok: r.ok }));

    await step(2, () =>
      takeoffToCruise(
        ctx,
        DRONE,
        async () => {
          await hud.rows(rowsFor(await read()), 'BACKEND vs COCKPIT');
        },
        3500,
      ),
    );

    const landAt = await step(3, async () => {
      await driver.land(DRONE);
      return Date.now();
    });
    const distAtLand = truth.homeDistanceM(DRONE);

    const samples: Sample[] = [];
    let truthDownAt: number | undefined;
    let distWhenDescending: number | undefined;
    await step(4, async () => {
      const end = landAt + 60000;
      while (Date.now() < end) {
        const s = await read();
        samples.push(s);
        const d = truth.drone(DRONE);
        if (distWhenDescending === undefined && d?.status === 'landing' && d.height < 29) distWhenDescending = truth.homeDistanceM(DRONE);
        if (d?.status === 'standby' && truthDownAt === undefined) truthDownAt = Date.now();
        const uiSeq = dedupe(samples.map((x) => x.ui.pill));
        const trSeq = dedupe(samples.map((x) => x.truth.status));
        await hud.rows(
          [
            ...rowsFor(s).slice(0, 4),
            { field: 'Backend did', truth: distWhenDescending !== undefined ? `back to dock (${distWhenDescending.toFixed(0)} m) then down` : 'flying back to dock…', ui: '—', ok: null },
          ],
          `BACKEND vs COCKPIT · t+${((Date.now() - landAt) / 1000).toFixed(0)} s after Land`,
        );
        await hud.log('STATUS SEQUENCE', [
          { text: `backend: ${['in_flight', ...trSeq].filter((x, i, a) => x !== a[i - 1]).join(' → ')}` },
          { text: `cockpit: ${['in_flight', ...uiSeq].filter((x, i, a) => x !== a[i - 1]).join(' → ')}` },
        ]);
        // Done once the cockpit has also shown the drone down (or 4 s after the backend did).
        if (truthDownAt !== undefined && (s.ui.pill === 'standby' || Date.now() > truthDownAt + 4000)) break;
        await sleep(Math.max(0, 700 - (Date.now() - s.at)));
      }
    });

    // Evaluate
    const inFlight = samples.filter((s) => s.truth.status !== undefined);
    const frac = (f: (s: Sample) => boolean) => inFlight.filter(f).length / Math.max(1, inFlight.length);
    const within = (ui: string | null, truthV: number | undefined, tol: number) => {
      const u = parseNum(ui);
      return truthV === undefined || (u !== undefined && Math.abs(u - truthV) <= tol);
    };
    const altOk = frac((s) => within(s.ui.alt, s.truth.height, TOL.altitude));
    const distOk = frac((s) => within(s.ui.dist, s.truth.dist, TOL.homeDistance));
    const statusOk = frac((s) => flightClass(s.ui.pill) === flightClass(s.truth.status));
    const last = samples[samples.length - 1];
    const uiSeq = ['in_flight', ...dedupe(samples.map((s) => s.ui.pill))].filter((x, i, a) => x !== a[i - 1]);
    const trSeq = ['in_flight', ...dedupe(samples.map((s) => s.truth.status))].filter((x, i, a) => x !== a[i - 1]);
    const finalOk = last?.ui.pill === 'standby' && (parseNum(last.ui.dist) ?? 99) <= 3 && (parseNum(last.ui.alt) ?? 99) <= 0.5;
    const tracked = altOk >= 0.8 && distOk >= 0.8 && statusOk >= 0.8 && finalOk && uiSeq.join() === trSeq.join();
    const returnedToDock = distWhenDescending !== undefined && distWhenDescending <= 3;

    obs.docs = { readme: README_SAYS, latestCommit: COMMIT_SAYS };
    obs.backend = { distAtLandM: distAtLand && +distAtLand.toFixed(0), distWhenDescentStartedM: distWhenDescending && +distWhenDescending.toFixed(1), returnedToDock, statusSequence: trSeq };
    obs.cockpit = { statusSequence: uiSeq, withinTolerance: { altitude: +altOk.toFixed(2), distance: +distOk.toFixed(2), status: +statusOk.toFixed(2) }, final: last?.ui, samples: samples.length };
    obs.table = {
      columns: ['source', 'what it says Land does', 'result'],
      rows: [
        ['Kit README', `"${README_SAYS}"`, 'outdated'],
        ['Latest kit commit', `"${COMMIT_SAYS}"`, 'intended change'],
        ['Backend (simulator state)', `flew back ${distAtLand?.toFixed(0) ?? '?'} m to the dock, descended at ${distWhenDescending?.toFixed(1) ?? '?'} m from it`, returnedToDock ? 'returns to dock' : 'lands in place'],
        ['Cockpit', `status ${uiSeq.join(' → ')}; final ${last?.ui.alt} / ${last?.ui.dist}`, tracked ? 'matches backend' : 'does NOT match backend'],
      ],
    };
    await hud.step(5, tracked ? 'ok' : 'fail', `cockpit ${tracked ? 'matches' : 'does not match'} backend · backend ${returnedToDock ? 'returned to dock' : 'landed in place'}`);

    if (!tracked) {
      const v: Verdict = {
        kind: 'BUG',
        headline: 'cockpit does not follow the landing',
        sub: `Status backend ${trSeq.join(' → ')} vs cockpit ${uiSeq.join(' → ')}; within tolerance: altitude ${Math.round(altOk * 100)} %, distance ${Math.round(distOk * 100)} %, status ${Math.round(statusOk * 100)} %; final ${last?.ui.pill}, ${last?.ui.alt}, ${last?.ui.dist}.`,
      };
      return v;
    }
    const tookS = truthDownAt ? fmtS(truthDownAt - landAt) : '?';
    if (returnedToDock)
      return {
        kind: 'INTENDED',
        headline: 'Land returns to the dock: intended behaviour, not flagged',
        sub:
          `README says "down where it is"; backend (latest commit: return-to-dock landing) flew ${distAtLand?.toFixed(0) ?? '?'} m back and landed on the dock in ${tookS}. ` +
          `Cockpit followed it: ${uiSeq.join(' → ')}, altitude/distance within tolerance in ${Math.round(Math.min(altOk, distOk) * 100)} % of ${samples.length} samples, final ${last?.ui.alt} / ${last?.ui.dist}.`,
      };
    return { kind: 'PASS', headline: 'Land: drone landed in place and the cockpit followed it', sub: `Status ${uiSeq.join(' → ')}.` };
  },
};
