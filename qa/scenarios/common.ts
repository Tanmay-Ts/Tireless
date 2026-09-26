/** Operator workflow steps shared by scenarios: clean start, open cockpit, select a drone, take off. */
import { cfg, sleep } from '../config.ts';
import { SetupError } from '../driver.ts';
import { parseNum, readText, T, type Scope } from '../oracles.ts';
import type { Ctx } from '../runner.ts';

export const DRONE = 'drone-1';

export const fmtS = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '∞');

/** Title card on screen while the (fast) clean start runs, held for at least `ms`. */
export async function withTitleCard<T>(ctx: Ctx, fn: () => Promise<T>, ms = 4000): Promise<T> {
  await ctx.hud.card(true);
  const until = Date.now() + ms;
  try {
    return await fn();
  } finally {
    await sleep(Math.max(0, until - Date.now()));
    await ctx.hud.card(false);
  }
}

/** Clear faults, reset, start; attach the truth recorder to the drone and its dock. */
export async function cleanStartWithTruth(ctx: Ctx, droneId = DRONE) {
  const { driver, truth } = ctx;
  await driver.cleanStart(cfg.speed);
  const dev = (await driver.devices()).find((d) => d.id === droneId);
  if (!dev) throw new SetupError(`${droneId} not in /api/devices`);
  await truth.connect([droneId, dev.dockId ?? 'dock-1']);
  truth.startPolling();
  await driver.waitFor(() => truth.frameAgeMs(droneId) < 1500, 5000, `truth socket receiving ${droneId} telemetry`);
  return { name: dev.name, dockId: dev.dockId };
}

export async function waitCockpitConnected(ctx: Ctx, scope: Scope) {
  await ctx.driver.waitFor(
    async () => {
      const t = (await readText(scope, T.socketBadge)).text ?? '';
      return /connected/i.test(t) && !/dis/i.test(t);
    },
    20000,
    'cockpit socket badge connected',
  );
}

/** Click/tap the drone's row like an operator and wait until its telemetry is populated. */
export async function selectDrone(ctx: Ctx, scope: Scope, droneId: string, name: string, waitTelemetry = true) {
  const target = T.deviceRow(droneId, name);
  const row = await readText(scope, target);
  ctx.via[target.name] = row.via;
  if (!row.located.loc) throw new SetupError(`device row for ${name} not found (testid, role or text)`);
  await row.located.loc.click();
  if (waitTelemetry)
    await ctx.driver.waitFor(async () => parseNum((await readText(scope, T.battery)).text) !== undefined, 10000, 'telemetry panel shows battery');
  return row.via;
}

/** Take off and wait for in_flight plus a short cruise; onTick keeps the HUD live meanwhile. */
export async function takeoffToCruise(ctx: Ctx, droneId: string, onTick?: () => Promise<void>, cruiseMs = 2400) {
  await ctx.driver.takeoff(droneId);
  const end = Date.now() + 30000;
  while (ctx.truth.drone(droneId)?.status !== 'in_flight') {
    if (Date.now() > end) throw new SetupError(`${droneId} did not reach in_flight`);
    await onTick?.();
    await sleep(700);
  }
  const until = Date.now() + cruiseMs;
  while (Date.now() < until) {
    await onTick?.();
    await sleep(800);
  }
}
