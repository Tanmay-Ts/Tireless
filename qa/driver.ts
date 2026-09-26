/**
 * Condition driver: everything that changes the world under test goes through the kit's
 * control API (docs/reference.md), and REST ground truth (state, health) is read here.
 * Every state-changing call is logged so the HUD and the report show exactly what was done.
 */
import { cfg, sleep } from './config.ts';

export type FlightStatus = 'standby' | 'taking_off' | 'in_flight' | 'landing';
/** GET /api/control/state → SimSnapshot.drones[id] (protocol/src/index.ts DroneSnapshot). */
export type DroneState = {
  id: string;
  status: FlightStatus;
  latitude: number;
  longitude: number;
  height: number;
  heading: number;
  battery: number;
};
export type SimSnapshot = { running: boolean; speed: number; tick: number; drones: Record<string, DroneState> };
/** GET /api/health → { status, simulator, video, uptime }. */
export type Health = { status: string; simulator: 'connected' | 'disconnected'; video: 'up' | 'down'; uptime: number };
export type FaultKind =
  | 'socket-kick'
  | 'socket-refuse'
  | 'socket-delay'
  | 'socket-drop'
  | 'sim-offline'
  | 'video-freeze'
  | 'video-stutter'
  | 'video-degrade'
  | 'video-flicker';
export type FaultRequest = { kind: FaultKind; deviceId?: string; seconds?: number; value?: number };
export type ApiCall = { at: number; method: string; path: string; body?: unknown; status: number; ms: number };

/** Precondition not met: the scenario could not be set up, so no verdict on the UI is possible. */
export class SetupError extends Error {}

export class Driver {
  calls: ApiCall[] = [];
  onCall?: (c: ApiCall) => void;

  constructor(readonly api = cfg.apiUrl) {}

  async req<T = any>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: T; text: string }> {
    const t0 = Date.now();
    let status = 0;
    let text = '';
    try {
      const r = await fetch(this.api + path, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
      });
      status = r.status;
      text = await r.text();
    } catch (e) {
      text = String(e);
    }
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    // Polling GETs would flood the HUD; only state-changing calls are logged.
    if (method !== 'GET') {
      const call = { at: t0, method, path, body, status, ms: Date.now() - t0 };
      this.calls.push(call);
      this.onCall?.(call);
    }
    return { ok: status >= 200 && status < 300, status, json, text };
  }

  private async must<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req<T>(method, path, body);
    if (!r.ok) throw new SetupError(`${method} ${path} → HTTP ${r.status} ${r.text.slice(0, 160)}`);
    return r.json;
  }

  async health(): Promise<Health | undefined> {
    const r = await this.req<Health>('GET', '/api/health');
    return r.ok ? r.json : undefined;
  }

  async snapshot(): Promise<SimSnapshot | undefined> {
    const r = await this.req<SimSnapshot>('GET', '/api/control/state');
    return r.ok ? r.json : undefined;
  }

  async drone(id: string): Promise<DroneState | undefined> {
    return (await this.snapshot())?.drones?.[id];
  }

  async devices(): Promise<{ id: string; type: 'drone' | 'dock'; name: string; dockId?: string; droneId?: string }[]> {
    return (await this.req('GET', '/api/devices')).json?.devices ?? [];
  }

  async activeFaults(): Promise<{ kind: FaultKind; until: number | null; value?: number; deviceId?: string }[]> {
    return (await this.req('GET', '/api/control/fault')).json?.faults ?? [];
  }

  sim(action: 'start' | 'stop' | 'reset', speed?: number) {
    return this.must('POST', '/api/control/sim', speed === undefined ? { action } : { action, speed });
  }

  async command(deviceId: string, type: 'takeoff' | 'land') {
    const ack = await this.must<{ ok: boolean; error?: string }>('POST', '/api/control/command', { deviceId, type });
    if (!ack?.ok) throw new SetupError(`${type} ${deviceId} rejected: ${ack?.error}`);
    return ack;
  }

  takeoff(id: string) {
    return this.command(id, 'takeoff');
  }

  land(id: string) {
    return this.command(id, 'land');
  }

  /** Inject a fault and confirm the backend reports it active (one-shot socket-kick never lists). */
  async fault(req: FaultRequest) {
    const res = await this.must<{ faults: { kind: string }[] }>('POST', '/api/control/fault', req);
    if (req.kind !== 'socket-kick' && !res?.faults?.some((f) => f.kind === req.kind))
      throw new SetupError(`fault ${req.kind} not listed as active after POST`);
    return res.faults;
  }

  /** POST /api/control/drones {name?, latitude?, longitude?} → { drone, dock }. */
  async addDrone(name?: string): Promise<{ drone: { id: string; name: string; dockId?: string }; dock: { id: string } }> {
    return this.must('POST', '/api/control/drones', name === undefined ? {} : { name });
  }

  removeDrone(id: string) {
    return this.must('DELETE', `/api/control/drones/${encodeURIComponent(id)}`);
  }

  clearFaults() {
    return this.must('DELETE', '/api/control/fault');
  }

  /**
   * Clean, reproducible start: faults cleared, sim reset (every drone standby on its dock at 100 %),
   * started at `speed`. The RNG seed is the simulator's SIM_SEED (42 by default); it is not an API field.
   */
  async cleanStart(speed = cfg.speed) {
    await this.clearFaults();
    await this.sim('reset');
    await this.sim('start', speed);
    await this.waitFor(async () => (await this.health())?.simulator === 'connected', 20000, 'simulator connected');
    await this.waitFor(
      async () => {
        const s = await this.snapshot();
        return !!s?.running && Object.values(s.drones).every((d) => d.status === 'standby' && d.battery === 100);
      },
      10000,
      'all drones standby at 100 %',
    );
  }

  async waitFor(pred: () => Promise<boolean> | boolean, timeoutMs: number, what: string, everyMs = 250) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await pred()) return;
      await sleep(everyMs);
    }
    throw new SetupError(`timed out after ${timeoutMs / 1000}s waiting for: ${what}`);
  }
}
