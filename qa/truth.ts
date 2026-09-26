/**
 * Ground truth, independent of the UI under test:
 *  - our own socket.io client (same handshake and Subscribe protocol as the cockpit) recording every
 *    frame with its receive time and payload timestamp: "what data reached the browser tier, and when";
 *  - REST polling of /api/control/state (straight from the simulator over HTTP, so it keeps moving even
 *    when the telemetry socket path is broken) and /api/health: "what is really happening".
 * Oracles compare what the UI shows against these.
 */
import { io, type Socket } from 'socket.io-client';
import { cfg } from './config.ts';
import type { Driver, DroneState, Health } from './driver.ts';

export const DRONE_ATTRIBUTES = ['heartbeat', 'global_position', 'attitude', 'battery', 'flight_status', 'alerts', 'video'] as const;
export type Attribute = (typeof DRONE_ATTRIBUTES)[number] | 'dock';
export type Frame = { at: number; topic: string; deviceId: string; attribute: string; ts?: number; payload: any };
type LatLon = { latitude: number; longitude: number };

export function haversineM(a: LatLon, b: LatLon) {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class Truth {
  frames: Frame[] = [];
  snapshots: { at: number; drones: Record<string, DroneState> }[] = [];
  healths: { at: number; health: Health | undefined }[] = [];
  socketConnected = false;
  /** Dock position per drone, captured from the snapshot while the drone is standby on its dock. */
  home: Record<string, LatLon> = {};
  private socket?: Socket;
  private timers: NodeJS.Timeout[] = [];

  constructor(private driver: Driver) {}

  topic(deviceId: string, attribute: Attribute) {
    return `${cfg.orgId}/${deviceId}/telemetry/${attribute}`;
  }

  async connect(deviceIds: string[], timeoutMs = 8000) {
    const topics = deviceIds.flatMap((id) => (id.startsWith('dock') ? ['heartbeat', 'dock'] : [...DRONE_ATTRIBUTES]).map((a) => this.topic(id, a as Attribute)));
    const socket = io(cfg.socketUrl, { auth: { 'org-id': cfg.orgId }, reconnection: true, reconnectionDelay: 500 });
    this.socket = socket;
    socket.on('connect', () => {
      this.socketConnected = true;
      for (const topic of topics) socket.emit('Subscribe', { topic });
    });
    socket.on('disconnect', (reason) => {
      this.socketConnected = false;
      if (reason === 'io server disconnect') setTimeout(() => socket.connect(), 500); // socket.io won't retry by itself
    });
    socket.on('connect_error', () => {
      if (!socket.active) setTimeout(() => socket.connected || socket.connect(), 1000);
    });
    // The server emits each payload on an event named exactly the topic string.
    socket.onAny((event: string, payload: any) => {
      const parts = event.split('/');
      if (parts.length !== 4 || parts[2] !== 'telemetry') return;
      const ts = payload?.timestamp ?? payload?.device_heartbeat_timestamp;
      this.frames.push({ at: Date.now(), topic: event, deviceId: parts[1], attribute: parts[3], ts: typeof ts === 'number' ? ts : undefined, payload });
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`truth socket did not connect to ${cfg.socketUrl} within ${timeoutMs} ms`)), timeoutMs);
      socket.once('connect', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  startPolling(snapshotMs = 500, healthMs = 1000) {
    const pollSnap = async () => {
      const s = await this.driver.snapshot();
      if (!s) return;
      this.snapshots.push({ at: Date.now(), drones: s.drones });
      for (const d of Object.values(s.drones))
        if (d.status === 'standby' && d.height === 0) this.home[d.id] = { latitude: d.latitude, longitude: d.longitude };
    };
    const pollHealth = async () => this.healths.push({ at: Date.now(), health: await this.driver.health() });
    void pollSnap();
    void pollHealth();
    this.timers.push(setInterval(pollSnap, snapshotMs), setInterval(pollHealth, healthMs));
  }

  framesFor(deviceId: string, attribute?: string) {
    return this.frames.filter((f) => f.deviceId === deviceId && (!attribute || f.attribute === attribute));
  }

  last(deviceId: string, attribute: string) {
    const fs = this.framesFor(deviceId, attribute);
    return fs[fs.length - 1];
  }

  /** ms since the last telemetry frame of any attribute for the device reached our client. */
  frameAgeMs(deviceId: string) {
    const fs = this.framesFor(deviceId);
    return fs.length ? Date.now() - fs[fs.length - 1].at : Infinity;
  }

  drone(id: string): DroneState | undefined {
    return this.snapshots[this.snapshots.length - 1]?.drones[id];
  }

  health(): Health | undefined {
    return this.healths[this.healths.length - 1]?.health;
  }

  /** Real distance from the dock, from the simulator snapshot. */
  homeDistanceM(id: string) {
    const d = this.drone(id);
    const h = this.home[id];
    return d && h ? haversineM(h, d) : undefined;
  }

  /** Real horizontal speed over the last ~2 s of snapshots. */
  speedMps(id: string, windowMs = 2000) {
    const now = Date.now();
    const pts = this.snapshots.filter((s) => now - s.at <= windowMs + 600 && s.drones[id]);
    if (pts.length < 2) return undefined;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const dt = (b.at - a.at) / 1000;
    return dt >= 0.9 ? haversineM(a.drones[id], b.drones[id]) / dt : undefined;
  }

  /** Is the data path for this drone live? Stale = simulator link down, or no frame for staleMs. */
  freshness(id: string, staleMs = cfg.staleMs) {
    const ageMs = this.frameAgeMs(id);
    const sim = this.health()?.simulator ?? 'unknown';
    const reasons: string[] = [];
    if (sim === 'disconnected') reasons.push('/api/health simulator: disconnected');
    if (ageMs > staleMs) reasons.push(`no telemetry for ${Number.isFinite(ageMs) ? (ageMs / 1000).toFixed(1) + ' s' : 'ever'}`);
    return { stale: reasons.length > 0, ageMs, simulator: sim, reasons };
  }

  /** Frames on one topic whose payload timestamp is older than the previous frame's (out-of-order delivery). */
  reorders(id: string, attribute = 'global_position') {
    const fs = this.framesFor(id, attribute).filter((f) => f.ts !== undefined);
    let count = 0;
    for (let i = 1; i < fs.length; i++) if ((fs[i].ts as number) < (fs[i - 1].ts as number)) count++;
    return { count, of: fs.length };
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.socket?.removeAllListeners();
    this.socket?.close();
  }
}
