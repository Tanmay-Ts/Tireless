import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const QA_ROOT = path.dirname(fileURLToPath(import.meta.url));

const envFile = path.join(QA_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const str = (k: string, d: string) => process.env[k]?.trim() || d;
const num = (k: string, d: number) => {
  const raw = process.env[k]?.trim();
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) ? v : d;
};

const apiUrl = str('API_URL', 'http://localhost:4000');

export const cfg = {
  cockpitUrl: str('COCKPIT_URL', 'http://localhost:4010'),
  apiUrl,
  socketUrl: str('SOCKET_URL', apiUrl),
  dashboardPath: str('DASHBOARD_PATH', '/dashboard'),
  orgId: str('ORG_ID', 'flytbase'),
  seed: num('SEED', 42),
  speed: num('SPEED', 1),
  headed: str('HEADED', '1') !== '0',
  chromiumPath: process.env.CHROMIUM_PATH?.trim() || undefined,
  outDir: path.resolve(QA_ROOT, str('OUT_DIR', 'out')),
  cacheFile: path.resolve(QA_ROOT, '.qa-cache/api-shape.json'),
  /** Topic suffixes subscribed per drone: flytbase/<drone>/<suffix>. */
  topics: str(
    'TRUTH_TOPICS',
    'telemetry/global_position,telemetry/attitude,telemetry/heartbeat,telemetry/battery,telemetry/flight_status',
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  takeoffEndpoint: process.env.TAKEOFF_ENDPOINT?.trim() || undefined,
  landEndpoint: process.env.LAND_ENDPOINT?.trim() || undefined,
  faultKey: process.env.FAULT_KEY?.trim() || undefined,
  /** Truth side: no telemetry frame for this long means the data is stale. */
  staleMs: num('STALE_MS', 3000),
  /** UI side: how long the cockpit gets to show staleness once truth is stale (the kit's own heartbeat threshold is 5 s). */
  graceMs: num('GRACE_MS', 5000),
};

export type Cfg = typeof cfg;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** tsx/esbuild wraps functions in __name(); page.evaluate needs it defined in the browser. */
export const PAGE_SHIM = 'window.__name = window.__name || ((f) => f);';
