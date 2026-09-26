/**
 * Planted bugs (patches against the kit's cockpit source) used to prove the invariant suite K catches
 * mutations, plus harmless changes it must let through. Each patch is a `git diff` of the kit repo.
 * `expect` = the K checks that must fail ([] = must PASS: a failure there would be a false alarm).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Mutant = { id: string; title: string; planted: string; expect: string[]; patch?: string; generated?: boolean };

/** Answer key produced by the mutation agent (qa/mutator.ts). The QA suite never imports this at check time. */
export type AnswerKey = { id: string; category: string; file: string; search: string; replace: string; breaks: string; briefLine: string; expectedImpact: string; expectCheck: string };

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Agent-generated mutations from mutants/generated/*.json, replayed deterministically from their patches. */
export function loadGenerated(): Mutant[] {
  const dir = path.join(HERE, 'generated');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const g = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as AnswerKey;
      return { id: g.id, title: g.category, planted: `${g.breaks} [${g.file.replace('frontend/src/', '')}]`, expect: [g.expectCheck], patch: `generated/${g.id}.patch`, generated: true };
    });
}

export function answerKeys(): Record<string, AnswerKey> {
  const dir = path.join(HERE, 'generated');
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
      const g = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as AnswerKey;
      return [g.id, g];
    }),
  );
}

export const MUTANTS: Mutant[] = [
  { id: 'clean', title: 'Unmodified kit', planted: 'nothing (records the clean baseline)', expect: [] },
  {
    id: 'm1-badge-always-connected',
    title: 'Connection shown as live when it is down',
    planted: 'SocketBadge.tsx: badge text and colour hard-coded to "socket connected"',
    expect: ['K5'],
  },
  {
    id: 'm2-online-shown-offline',
    title: 'Live connection shown as offline',
    planted: 'SocketBadge.tsx: shows "socket disconnected" while connected',
    expect: ['K4'],
  },
  { id: 'm3-battery-off-by-10', title: 'Battery 10 % too low', planted: 'TelemetryPanel.tsx: battery value − 10', expect: ['K2'] },
  {
    id: 'm4-wrong-drone-telemetry',
    title: "Telemetry of the wrong drone",
    planted: 'TelemetryPanel.tsx: reads data of drone N+1 for selected drone N',
    expect: ['K2', 'K3'],
  },
  {
    id: 'm5-flying-shown-as-landed',
    title: 'Flying drone shown as landed',
    planted: 'TelemetryPanel.tsx: status pill shows "standby" while in_flight',
    expect: ['K3'],
  },
  { id: 'm6-connection-badge-removed', title: 'Connection indicator removed', planted: 'CockpitPage.tsx: <SocketBadge /> deleted', expect: ['K1', 'K5'] },
  {
    id: 'm7-device-list-offscreen-phone',
    title: 'Device list pushed off-screen on phones',
    planted: 'styles.css (< 800 px): side panel translateX(-110vw)',
    expect: ['K6'],
  },
  {
    id: 'm8-xss-drone-name',
    title: 'Drone name rendered as raw HTML (stored XSS)',
    planted: 'DeviceList.tsx: renders drone.name with dangerouslySetInnerHTML instead of as text',
    expect: ['K7'],
  },
  {
    id: 'h1-testids-renamed',
    title: 'Harmless: test ids renamed',
    planted: 'testids.ts: socket-status, telemetry-battery, telemetry-hspeed renamed (UI unchanged)',
    expect: [],
  },
  {
    id: 'h2-wording-change',
    title: 'Harmless: wording changed',
    planted: '"FlytBase Cockpit"→"FlytBase Operations", "Devices"→"Fleet", "socket …"→"link …", "Dist. from home"→"Distance to home"',
    expect: [],
  },
].map((m) => ({ ...m, patch: m.id === 'clean' ? undefined : `${m.id}.patch` }));
